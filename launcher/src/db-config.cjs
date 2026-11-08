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

function readText(file) {
  try { return require('node:fs').readFileSync(file, 'utf8'); } catch { return ''; }
}

//By leewheel 2026年11月9日 端口以 `Server\my.ini` 为准（老大 2026-11-09 明确要求）。
// 为什么改优先级：my.ini 决定 mysqld 真正监听哪个端口；repack.json / worldserver.conf 只是“以为”的端口。
// 以前 repack.json 优先，出现过 mysqld 听 3396、配置被改成 3395 的错位（server-control 那边也踩过）。
function mysqlPortOf(root) {
  const L = layout.serverLayout(root);
  const fromIni = Number(layout.iniValue(readText(path.join(L.path('my.ini'))), 'mysqld', 'port'));
  if (fromIni > 0) return fromIni;
  const settings = layout.readJson(L.path('Settings/repack.json')) || {};
  const fromSettings = Number(settings.mysqlPort);
  if (fromSettings > 0) return fromSettings;
  // 再看世界服自己的连接串：能跑起来的服，这里的端口一定是对的
  const fromConf = Number((/^\s*WorldDatabaseInfo\s*=\s*"[^"]*?;(\d{2,5});/m.exec(readText(path.join(root, 'configs', 'worldserver.conf'))) || [])[1]);
  if (fromConf > 0) return fromConf;
  // 最后才退回 MySQL 默认端口：不再猜 3396（老写死值害过两次）
  return 3306;
}

//By leewheel 2026年11月9日 连库的连接串同理：端口听 my.ini 的，账号密码按配套的 admin-client.ini 取。
// 以前这里只有“读 worldserver.conf”，没有 ini 就直接拿 3396 硬连 —— 库没起、端口不对、账号不对，
// 三种情况全报成同一句话，看不出到底哪一步错。
function mysqlConnOf(root) {
  const port = mysqlPortOf(root);
  const L = layout.serverLayout(root);
  const iniText = readText(path.join(root, 'mysql', 'admin-client.ini'));
  const iniPort = Number(layout.iniValue(iniText, 'client', 'port'));
  const iniUser = layout.iniValue(iniText, 'client', 'user');
  const iniPass = layout.iniValue(iniText, 'client', 'password');
  //By leewheel 2026年11月9日 库名也要带出来。
  // 只给 -h/-P/-u/-p 而不给库，`SELECT ... FROM coa_bot_settings` 会报
  // ERROR 1046 No database selected；界面把这句话当成“表还没建”，老大看到的就是
  // 「数据库里还没有 coa_bot_settings 表」。库名一律取世界服连接串里的那个。
  const conf = readText(path.join(root, 'configs', 'worldserver.conf'));
  const match = /^\s*WorldDatabaseInfo\s*=\s*"([^"]+)"/m.exec(conf);
  const confParts = match ? match[1].split(';') : [];
  const db = (confParts[4] || 'acore_world').trim() || 'acore_world';
  // 只有 ini 的端口与 my.ini 一致时才采信它的账号：端口不同说明是另一个实例的存档，账号不一定存在
  if (iniUser && (!iniPort || iniPort === port)) {
    return { host: '127.0.0.1', port, user: iniUser, pass: iniPass || '', db, source: 'mysql/admin-client.ini' };
  }
  if (match) {
    const [host, confPort, user, pass] = confParts;
    return { host: host || '127.0.0.1', port, user: user || '', pass: pass || '', db, source: 'configs/worldserver.conf' };
  }
  return { host: '127.0.0.1', port, user: '', pass: '', db, source: 'my.ini（包里既没有 admin-client.ini 也没有世界服连接串，按无账号连接）' };
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

module.exports = { ensureDatabaseConfig, mysqlPortOf, mysqlConnOf, rewriteDatabaseInfo };
