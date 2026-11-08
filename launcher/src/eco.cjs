//By leewheel 2026年11月9日 省电模式（eco）：一个国度（含主服）世界里连续 10 分钟没有真人玩家时，
// 让远离玩家的机器人休眠（把 AiPlayerbot.BotActiveAlone 写成 1，再 .reload config 让世界服重新读），
// 一旦有真人进来立刻还原。机器人版本低于 2.9.1 的一律不碰（那时 .reload config 不会重读这个值）。
// 玩家的原值先记进 Royaumes\eco-state.json：启动器崩溃、断电、直接关窗口都不会把它丢在 eco 值上，
// 下次开服前（以及启动器一打开）先把原值还回去。
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const live = require('./live.cjs');
const dbConfig = require('./db-config.cjs');
const serverControl = require('./server-control.cjs');
// 端口探测用整合包自己的 portOpen（server-control 导出），保留成变量是为了测试能替换。
const portOpen = port => serverControl.portOpen(port);

const KEY = 'AiPlayerbot.BotActiveAlone';
const ECO_VALUE = '1';
// COA_ECO_AFTER_MS：只给真机测试用，正式跑是 10 分钟。
const ECO_AFTER = Number(process.env.COA_ECO_AFTER_MS) || 10 * 60 * 1000;
// 2.9.1 起 .reload config 才会重读 BotActiveAlone。
const SINCE = [2, 9, 1];
const REALM_KEYS = ['dawnrise', 'reborn', 'wildcard'];
const ALL_KEYS = ['coa', ...REALM_KEYS];

const readJson = async file => { try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; } };
const readText = file => { try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };

const stateFile = root => path.join(root, 'Royaumes', 'eco-state.json');
// 主服的开关与设置挂在 Settings\repack.json；国度各自挂在 Royaumes\<key>\realm.json。
const optionsFile = (root, key) => (key === 'coa' ? path.join(root, 'Settings', 'repack.json') : path.join(root, 'Royaumes', key, 'realm.json'));
const confOf = (root, key) => (key === 'coa'
  ? path.join(root, 'configs', 'modules', 'playerbots.conf')
  : path.join(root, 'Royaumes', key, 'configs', 'modules', 'playerbots.conf'));
const worldConfOf = (root, key) => (key === 'coa'
  ? path.join(root, 'configs', 'worldserver.conf')
  : path.join(root, 'Royaumes', key, 'configs', 'worldserver.conf'));

const escapeKey = () => KEY.replace(/\./g, '\\.');
const linePattern = () => new RegExp(`^[ \\t]*${escapeKey()}[ \\t]*=.*(\\r?\\n)?`, 'gm');
const valueOf = text => new RegExp(`^[ \\t]*${escapeKey()}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim() ?? null;

// 还原：original 为 null 表示原来根本没有这行，那就把为 eco 加的那行删掉。
function restoreText(text, original) {
  if (original === null) return text.replace(linePattern(), '');
  return text.replace(linePattern(), (line, eol) => `${KEY} = ${original}${eol || ''}`);
}
function ecoText(text) {
  if (valueOf(text) !== null) return text.replace(linePattern(), (line, eol) => `${KEY} = ${ECO_VALUE}${eol || ''}`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text.replace(/\s*$/, '')}${eol}${KEY} = ${ECO_VALUE}${eol}`;
}

// 机器人版本：先看 conf 首行（编译后由 Tempfiles/set_bot_version.ps1 写入），再看 CoA-Bots\release.json。
// 两个都读不到时按"支持"处理：本项目在跑的核都是 2.9.x，误判成不支持会让开关白开。
function botsVersion(root, key = 'coa') {
  const text = readText(confOf(root, key)) || '';
  const inConf = /^[ \t]*#[ \t]*AiPlayerbot\.Version[ \t]*=[ \t]*([0-9][0-9.]*)/m.exec(text)?.[1];
  if (inConf) return inConf;
  const release = readJsonSync(path.join(root, 'CoA-Bots', 'release.json'));
  return String(release?.version || '');
}
function readJsonSync(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function supported(root) {
  const raw = botsVersion(root);
  if (!raw) return true;
  const parts = (/^(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw) || []).slice(1).map(value => Number(value || 0));
  if (!parts.length) return true;
  for (let i = 0; i < 3; i += 1) {
    const mine = Number(parts[i] || 0);
    if (mine !== SINCE[i]) return mine > SINCE[i];
  }
  return true;
}

async function records(root) { return (await readJson(stateFile(root))) || {}; }
async function saveRecords(root, all) {
  await fsp.mkdir(path.dirname(stateFile(root)), { recursive: true });
  if (!Object.keys(all).length) return fsp.rm(stateFile(root), { force: true });
  return fsp.writeFile(stateFile(root), JSON.stringify(all, null, 2));
}
async function activeRecord(root, key) { return (await records(root))[key] || null; }

async function enabled(root, key) { return (await readJson(optionsFile(root, key)))?.eco === true; }
async function keys(root) {
  const out = [];
  for (const key of ALL_KEYS) if (await enabled(root, key)) out.push(key);
  return out;
}

// 端口与 RA：和 realms.cjs 读的是同一份存档，国度各自一份 realm.json。
async function ports(root, key) {
  if (key === 'coa') {
    const s = (await readJson(path.join(root, 'Settings', 'repack.json'))) || {};
    return { world: Number(s.worldPort) || 8085, ra: Number(s.raPort) || 3443 };
  }
  const saved = await readJson(path.join(root, 'Royaumes', key, 'realm.json'));
  return { world: Number(saved?.worldPort) || 0, ra: Number(saved?.raPort) || 0 };
}

function dbName(text, option) {
  const line = new RegExp(`^[ \\t]*${option}[ \\t]*=[ \\t]*"?([^"\\r\\n]*)`, 'm').exec(text || '')?.[1] || '';
  return line.split(';')[4]?.trim() || '';
}
const safe = name => /^[A-Za-z0-9_]{1,64}$/.test(name);

function sql(root, query) {
  const conn = dbConfig.mysqlConnOf(root);
  const exe = path.join(root, 'mysql', 'bin', 'mysql.exe');
  const args = ['-h', conn.host, '-P', String(conn.port), '-u', conn.user, `-p${conn.pass}`, '--connect-timeout=5', '--default-character-set=utf8mb4', '-N', '-B', '-e', query];
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true, timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim()))));
}

// 世界服里有几个真人：在线角色里，账号不是随机机器人、不是副本清场/拍卖行机器人。
// 玩家的分身只有他本人在线时才在线，所以这个数就等于"有几个真人"。
async function players(root, key) {
  const ws = readText(worldConfOf(root, key)) || '';
  const auth = dbName(ws, 'LoginDatabaseInfo') || 'acore_auth';
  const chars = dbName(ws, 'CharacterDatabaseInfo') || (key === 'coa' ? 'acore_characters' : `acore_characters_${key}`);
  const prefix = /^[ \t]*AiPlayerbot\.RandomBotAccountPrefix[ \t]*=[ \t]*"?([A-Za-z0-9_]*)/m.exec(readText(confOf(root, key)) || '')?.[1] || 'rndbot';
  if (!safe(auth) || !safe(chars) || !safe(prefix)) return null;
  const query = `SELECT COUNT(*) FROM \`${chars}\`.characters c JOIN \`${auth}\`.account a ON a.id = c.account`
    + ` WHERE c.online = 1 AND a.username NOT LIKE '${prefix.toUpperCase()}%' AND a.username NOT IN ('DCDRIVER','AHBOT')`;
  const count = Number(await sql(root, query));
  return Number.isFinite(count) ? count : null;
}
const ra = (root, key, p, command, timeout) => live.raCommand(root, command, timeout, key === 'coa' ? 0 : p.ra);

// 进入省电：先记原值，再写 eco 值让世界服重读。
async function sleep(root, key, p) {
  const file = confOf(root, key);
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text === null) return false;
  const original = valueOf(text);
  // 玩家本来就把机器人全关着（或比 eco 值更省）：没什么可保存的。
  if (original !== null && Number(original) <= Number(ECO_VALUE)) return false;
  const all = await records(root);
  all[key] = { original, at: new Date().toISOString() };
  await saveRecords(root, all);
  await fsp.writeFile(file, ecoText(text));
  await ra(root, key, p, 'reload config', 30000).catch(() => {});
  return true;
}

// 退出省电：把原值还回去。若文件里的值已经不是 eco 值，说明玩家中途自己改过——以玩家的为准。
async function wake(root, key, { reload = false, p = null } = {}) {
  const all = await records(root);
  const record = all[key];
  if (!record) return false;
  const file = confOf(root, key);
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text !== null && valueOf(text) === ECO_VALUE) await fsp.writeFile(file, restoreText(text, record.original));
  delete all[key];
  await saveRecords(root, all);
  if (reload) await ra(root, key, p || await ports(root, key), 'reload config', 30000).catch(() => {});
  return true;
}

// 开服前、以及启动器一打开：所有没有在跑的世界先把原值还回去。
async function wakeStopped(root, only = null, isOpen = portOpen) {
  if (!root) return;
  for (const key of Object.keys(await records(root))) {
    if (only && key !== only) continue;
    const p = await ports(root, key);
    if (!p.world) continue;
    if (!(await isOpen(p.world))) await wake(root, key).catch(() => {});
  }
}

// 每分钟看一眼：各世界的真人数。lastSeen：最后一个真人离开（或开始看）的时刻。
// deps 只给测试用（假的开服探测与人数查询），正式调用不传。
const lastSeen = new Map();
async function tick(root, deps = {}) {
  if (!root) return;
  const isOpen = deps.portOpen || portOpen;
  const countPlayers = deps.players || ((r, k) => players(r, k));
  await wakeStopped(root, null, isOpen);
  const on = supported(root) ? await keys(root) : [];
  // 开关被关掉（或机器人版本不支持）：立刻还原；世界在跑就让它重读。
  for (const key of Object.keys(await records(root))) {
    if (!on.includes(key)) await wake(root, key, { reload: true }).catch(() => {});
  }
  for (const key of on) {
    const p = await ports(root, key);
    if (!p.world) { lastSeen.delete(key); continue; }
    if (!(await isOpen(p.world))) { lastSeen.delete(key); continue; }
    const count = await countPlayers(root, key).catch(() => null);
    if (count === null) continue;
    const asleep = !!(await activeRecord(root, key));
    if (count > 0) {
      lastSeen.set(key, Date.now());
      if (asleep) await wake(root, key, { reload: true, p }).catch(() => {});
    } else {
      if (!lastSeen.has(key)) lastSeen.set(key, Date.now());
      if (!asleep && Date.now() - lastSeen.get(key) >= ECO_AFTER) await sleep(root, key, p).catch(() => {});
    }
  }
}

async function setEnabled(root, key, on) {
  if (!ALL_KEYS.includes(key)) throw new Error('没有这个国度。');
  const file = optionsFile(root, key);
  const saved = (await readJson(file)) || (key === 'coa' ? {} : null);
  if (!saved) throw new Error('这个国度还没建好，先把它建出来。');
  saved.eco = on === true;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  lastSeen.delete(key);
  if (!saved.eco) await wake(root, key, { reload: true }).catch(() => {});
}

// 给界面卡片用：支不支持、开关开没开、现在是不是已经睡了。
async function status(root) {
  const all = await records(root);
  const out = { supported: supported(root), after: ECO_AFTER, realms: {} };
  for (const key of ALL_KEYS) out.realms[key] = { on: await enabled(root, key), asleep: !!all[key], since: all[key]?.at || null };
  return out;
}

module.exports = {
  players, tick, wake, wakeStopped, setEnabled, status, supported, botsVersion,
  restoreText, ecoText, activeRecord, ports, ALL_KEYS, ECO_VALUE, ECO_AFTER, KEY,
};
//End By leewheel
