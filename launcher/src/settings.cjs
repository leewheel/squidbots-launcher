'use strict';
// The player's choices, kept in <user data>/settings.json and cleaned at every read and write.
const fs = require('node:fs/promises');
const path = require('node:path');
const { REALMLIST } = require('./game.cjs');

const LANGUAGES = new Set(['en', 'fr', 'ru', 'zh']);
const PAGES = new Set(['play', 'server']);
const THEMES = new Set(['classic', 'abyss']);
const CHANNELS = new Set(['stable', 'test']);
const defaults = Object.freeze({
  //By leewheel 2026-11-02 中文发射版：默认界面语言改为简体中文
  language: 'zh', theme: 'abyss', channel: 'stable', startPage: 'play', realmlist: '', minimizeOnLaunch: true, reduceMotion: false,
  //By leewheel 2026年11月7日 dailyBackup 默认改为 false：启动器不再自动备份（老大要求），
  // 保留这个键只为兼容老配置文件，不再有任何自动备份逻辑读它。
  autoCheckAddons: true, betaUpdates: false, hideCloseNotice: false, trayOnClose: false, notifications: true, startWithWindows: false, startServerOnOpen: false, restartWorldOnCrash: false, dailyBackup: false, lastSeenVersion: '', installPaths: {}, components: {}, instances: [], modules: { squidbots: true },
  //By leewheel 2026年11月9日 启动器自更新：玩家点过「忽略这个版本」的版本号（空 = 不忽略任何版本）
  launcherSkipVersion: '',
});

//By leewheel 2026年11月4日 目录可以是相对的（相对启动器所在目录，如 Client、Server），这样整个整合包
// 拷到任何盘、任何目录名都能用；绝对路径照旧接受。相对路径不许带盘符、不许用 .. 往外跳。
const FOLDER_SEGMENT = /^[A-Za-z0-9 ._ -]+$/;
function cleanFolder(folder) {
  if (typeof folder !== 'string' || !folder) return '';
  if (path.isAbsolute(folder)) return path.normalize(folder);
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.' || !FOLDER_SEGMENT.test(part))) return '';
  return parts.join(path.sep);
}
//End By leewheel

function sanitize(value) {
  const out = structuredClone(defaults);
  if (!value || typeof value !== 'object') return out;
  if (LANGUAGES.has(value.language)) out.language = value.language;
  if (PAGES.has(value.startPage)) out.startPage = value.startPage;
  if (THEMES.has(value.theme)) out.theme = value.theme;
  if (CHANNELS.has(value.channel)) out.channel = value.channel;
  if (typeof value.realmlist === 'string' && REALMLIST.test(value.realmlist)) out.realmlist = value.realmlist;
  for (const key of ['minimizeOnLaunch', 'reduceMotion', 'autoCheckAddons', 'betaUpdates', 'hideCloseNotice', 'trayOnClose', 'notifications', 'startWithWindows', 'startServerOnOpen', 'restartWorldOnCrash', 'dailyBackup']) if (typeof value[key] === 'boolean') out[key] = value[key];
  if (value.installPaths && typeof value.installPaths === 'object') {
    for (const [area, folder] of Object.entries(value.installPaths)) {
      if (!/^[a-z]{1,20}$/.test(area)) continue;
      const clean = cleanFolder(folder);
      if (clean) out.installPaths[area] = clean;
    }
  }
  if (typeof value.lastSeenVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.lastSeenVersion)) out.lastSeenVersion = value.lastSeenVersion;
  //By leewheel 2026年11月9日 被忽略的启动器版本号（只认 1.0.yyyymmddHHMM 形态）
  if (typeof value.launcherSkipVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.launcherSkipVersion)) out.launcherSkipVersion = value.launcherSkipVersion;
  if (value.modules && typeof value.modules.squidbots === 'boolean') out.modules.squidbots = value.modules.squidbots;
  if (Array.isArray(value.instances)) out.instances = [...new Set(value.instances.filter(folder => typeof folder === 'string' && path.isAbsolute(folder)).map(folder => path.normalize(folder)))].slice(0, 12);
  if (value.components && typeof value.components === 'object') {
    for (const [area, choice] of Object.entries(value.components)) {
      if (!/^[a-z]{1,20}$/.test(area) || !choice || typeof choice !== 'object') continue;
      out.components[area] = Object.fromEntries(Object.entries(choice).filter(([id, on]) => /^[a-z0-9-]{1,40}$/.test(id) && typeof on === 'boolean'));
    }
  }
  return out;
}

async function readSettings(file) {
  try { return sanitize(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch { return sanitize(null); }
}

async function writeSettings(file, value) {
  const clean = sanitize(value);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(clean, null, 2));
  await fs.rename(file + '.tmp', file);
  return clean;
}

module.exports = { readSettings, writeSettings, sanitize, cleanFolder, defaults };
