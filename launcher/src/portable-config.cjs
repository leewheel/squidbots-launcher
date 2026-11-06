'use strict';
//By leewheel 2026年11月4日 发布版的配置与目录一律跟着整合包走，不再锁死在某个盘、某个目录名上：
//  · <启动器所在目录>\Server\configs\launcher.config.json    启动器自身的配置，启动时没有就按内置默认自动生成；
//  · <启动器所在目录>\Server\configs\launcher-settings.json  玩家的选择，客户端/服务端目录写成相对目录（Client、Server）；
//  · 解析时：设置里的相对目录按启动器所在目录展开；残留的绝对目录一旦不存在（换机器、挪文件夹、改名），
//    自动回到启动器同级的 Client\、Server\；玩家手动挑的、且真实存在的外部目录保持原样，不抢他的选择。
// Server\configs 建不出来或不可写（只读盘、Program Files、U盘保护）时退回原来的 %APPDATA%，功能不受影响。
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_NAME = 'launcher.config.json';
const SETTINGS_NAME = 'launcher-settings.json';
// 发布版布局里各区域对应的相对目录名（启动器与 Client\、Server\ 同级）。
const PUBLISHED_REL = Object.freeze({ game: 'Client', addon: 'Client', server: 'Server' });

// 便携配置目录：根目录下确有 Server\ 才创建并使用（纯客户端的启动器不去动目录结构），且必须真的可写。
function portableDir(root, exists = fs.existsSync) {
  if (!root) return '';
  try {
    if (!exists(path.join(root, 'Server'))) return '';
    const dir = path.join(root, 'Server', 'configs');
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.coa-write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return dir;
  } catch { return ''; }
}

const parses = file => { try { JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); return true; } catch { return false; } };

// 启动时没有配置文件就按内置默认生成一份；已有的绝不覆盖，坏掉的（手改坏了、半截保存）挪开留档再生成。
function ensureConfigFile(dir, bundledFile) {
  const target = configFileOf(dir);
  if (!target) return '';
  if (fs.existsSync(target)) {
    if (parses(target)) return target;
    try { fs.renameSync(target, `${target}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`); } catch { return ''; }
  }
  try { fs.copyFileSync(bundledFile, target); } catch { return ''; }
  return fs.existsSync(target) ? target : '';
}

function configFileOf(dir) { return dir ? path.join(dir, CONFIG_NAME) : ''; }
function settingsFileOf(dir, fallback) { return dir ? path.join(dir, SETTINGS_NAME) : fallback; }

// 老版本只把设置写在 %APPDATA%：便携文件还不存在时把它搬过来，玩家原来的选择不丢。
function migrateSettings(target, legacy) {
  try {
    if (!target || fs.existsSync(target) || !legacy || !fs.existsSync(legacy)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacy, target);
    return true;
  } catch { return false; }
}

// 存进设置的样子：在启动器目录内写相对（换盘换名都有效），其余写绝对。
function toStoredPath(folder, root) {
  if (!folder) return '';
  const abs = path.resolve(folder);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs;
}

// 某个区域真正用的目录：相对目录按启动器所在目录展开；绝对目录一旦不存在（换机器、挪文件夹、改名）就回到
// 启动器同级的 Client\、Server\；绝对目录还在、但它其实是“另一份整合包的同级目录”时同样回到本包（否则一份包
// 会把另一份包的路径带跑）；玩家手选的外部目录（如 E:\Games\WoW）保持原样，不抢他的选择。
function resolveArea(area, stored, root, exists = fs.existsSync) {
  const rel = PUBLISHED_REL[area];
  const sibling = rel ? path.join(root, rel) : '';
  const published = sibling && exists(sibling) ? path.normalize(sibling) : '';
  if (!stored) return published;
  if (!path.isAbsolute(stored)) {
    const resolved = path.resolve(root, stored);
    return exists(resolved) ? resolved : (published || resolved);
  }
  if (!exists(stored)) return published || path.normalize(stored);
  if (published && rel && path.basename(stored).toLowerCase() === rel.toLowerCase()) return published;
  return path.normalize(stored);
}
//End By leewheel

module.exports = {
  CONFIG_NAME, SETTINGS_NAME, PUBLISHED_REL,
  portableDir, ensureConfigFile, configFileOf, settingsFileOf, migrateSettings, parses,
  toStoredPath, resolveArea,
};
