'use strict';
//By leewheel 2026年11月6日 服务端配置体检（启动前 / 更新后 / 每次启动世界服前都跑一遍）：
//  1) 数据库端口对齐：worldserver.conf 的 Login/World/CharacterDatabaseInfo、authserver.conf 的 LoginDatabaseInfo
//     一律改成整合包自带 MySQL 实际监听的端口（Settings/repack.json 的 mysqlPort 或 my.ini 的 port），
//     老整合包里写死 3395、新包是 3396，不改就是“世界服连不上库”；
//  2) 数据库自动更新关掉：Updates.EnableDatabases = 0（worldserver/authserver）、
//     Playerbots.Updates.EnableDatabases = 0（modules\playerbots.conf），否则服务端启动时会自己改库、卡死或报错；
//  3) 去掉 UTF-8 BOM：带 BOM 时核心只读到 “Config::LoadFile: Failure to read line number 1”。
// 只改不一致的键，改前留一份 .bak-时间戳，玩家不用手动动配置。
const fs = require('node:fs/promises');
const path = require('node:path');
const layout = require('./layout.cjs');

const UPDATE_KEYS = [
  ['worldserver.conf', ['Updates.EnableDatabases']],
  ['authserver.conf', ['Updates.EnableDatabases']],
  [path.join('modules', 'playerbots.conf'), ['Playerbots.Updates.EnableDatabases']],
];
const DBINFO_KEYS = ['LoginDatabaseInfo', 'WorldDatabaseInfo', 'CharacterDatabaseInfo', 'PlayerbotsDatabaseInfo'];
//By leewheel 2026年11月6日 老大的硬要求：这几个参数**每次都要确认**（启动器启动、更新后、启动服务端前各查一次）：
//  Quests.IgnoreAutoAccept = 1 —— 不自动接任务，玩家自己点。
const FORCED_SETTINGS = [
  { relative: 'worldserver.conf', key: 'Quests.IgnoreAutoAccept', value: '1' },
];

function mysqlPortOf(root) {
  const L = layout.serverLayout(root);
  const settings = layout.readJson(L.path('Settings/repack.json')) || {};
  const fromSettings = Number(settings.mysqlPort);
  if (fromSettings > 0) return fromSettings;
  const fromIni = Number(layout.iniValue(path.join(L.path('my.ini')), 'mysqld', 'port'));
  if (fromIni > 0) return fromIni;
  //By leewheel 2026年11月6日 兜底写死 3396：整合包自带的 MySQL 一直是 3396，
  // 退到 3306 会让世界服去连一个根本不存在的实例（老大点名要求的就是 3396）。
  return 3396;
}

/** 把 "host;port;user;pass;db" 里的端口换掉，host 固定本机回环 */
function rewriteDatabaseInfo(value, port) {
  const parts = String(value).replace(/^"|"$/g, '').split(';');
  if (parts.length < 5) return { next: '', changed: false };
  const wanted = ['127.0.0.1', String(port), parts[2], parts[3], parts[4]];
  const next = `"${wanted.join(';')}"`;
  return { next, changed: next !== value.trim() };
}

async function alignFile(file, port, updateKeys) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { return []; }
  const hadBom = text.charCodeAt(0) === 0xFEFF;
  let next = hadBom ? text.slice(1) : text;
  const changed = [];
  const name = path.basename(file);
  if (hadBom) changed.push(`${name}：去掉 UTF-8 BOM`);

  for (const key of DBINFO_KEYS) {
    const pattern = new RegExp(`^([ \\t]*${key}[ \\t]*=[ \\t]*)(.*)$`, 'm');
    const match = pattern.exec(next);
    if (!match) continue;
    const { next: value, changed: differs } = rewriteDatabaseInfo(match[2], port);
    if (!value || !differs) continue;
    next = next.replace(pattern, (_, head) => `${head}${value}`);
    changed.push(`${name}：${key} 端口改为 ${port}`);
  }

  for (const key of updateKeys) {
    const pattern = new RegExp(`^([ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*=[ \\t]*)([^\\r\\n#]+)`, 'm');
    const match = pattern.exec(next);
    if (!match || match[2].trim() === '0') continue;
    next = next.replace(pattern, (_, head) => `${head}0`);
    changed.push(`${name}：${key} = ${match[2].trim()} ⇒ 0`);
  }

  //By leewheel 2026年11月6日 强制参数：不管玩家原来写什么，都改回要求值（缺这个键就追加到文件末尾）
  for (const forced of FORCED_SETTINGS.filter(item => item.relative === path.basename(file))) {
    const pattern = new RegExp(`^([ \\t]*${forced.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*=[ \\t]*)([^\\r\\n#]+)`, 'm');
    const match = pattern.exec(next);
    if (!match) {
      const eol = next.includes('\r\n') ? '\r\n' : '\n';
      next = `${next.replace(/\s*$/, '')}${eol}${eol}# 由启动器强制写入：${forced.key}${eol}${forced.key} = ${forced.value}${eol}`;
      changed.push(`${name}：${forced.key} = ${forced.value}（新增）`);
      continue;
    }
    if (match[2].trim() === forced.value) continue;
    next = next.replace(pattern, (_, head) => `${head}${forced.value}`);
    changed.push(`${name}：${forced.key} = ${match[2].trim()} ⇒ ${forced.value}`);
  }

  if (changed.length) {
    if (hadBom || changed.some(item => item.includes('端口') || item.includes('⇒'))) {
      await fs.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`).catch(() => {});
    }
    await fs.writeFile(file, next, 'utf8');
  }
  return changed;
}

/** 体检并修复；返回改了什么（空数组表示本来就对） */
async function ensureDatabaseConfig(root) {
  if (!root) return [];
  const port = mysqlPortOf(root);
  const changed = [];
  for (const [relative, updateKeys] of UPDATE_KEYS) {
    const file = path.join(root, 'configs', relative);
    changed.push(...await alignFile(file, port, updateKeys));
  }
  return changed;
}

module.exports = { ensureDatabaseConfig, mysqlPortOf, rewriteDatabaseInfo };
