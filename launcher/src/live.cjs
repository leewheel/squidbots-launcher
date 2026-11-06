'use strict';
// The live state of a running server, for the home page and the Console tab:
// - commands go to the worldserver's remote console (RA, 127.0.0.1 only, the repack's own account);
// - "server info" gives the players online and the update time (tick);
// - the worldserver's memory and CPU come from Windows; the bots in game from CoA-Bots' bot-status.json.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

function raSettings(root) {
  const settings = readJson(path.join(root, 'Settings', 'repack.json')) || {};
  return { port: Number(settings.raPort) || 3443, user: String(settings.raUsername || 'local'), password: String(settings.raPassword || 'local') };
}

// One command on the remote console: log in, send it, read until the next prompt.
// The socket is never closed while the world may still write its answer: cores before CoA Bots 2.4 crash when
// they write to a closed RA connection (RASession::Send throws). After the timeout the caller gets its error,
// but the connection stays open until the answer and the next prompt came (10 minutes at most).
const LINGER = 10 * 60 * 1000;
//By leewheel 2026-11-05 修复：RA 提示符被机器人日志淹没，导致控制台被误判为"无响应"
// RA 会话会同时收到 worldserver 转发的控制台日志。本项目机器人日志高频刷屏时，提示符 "AC>" 后面
// 立刻又跟着新的日志行，原实现用 /AC>\s*$/ 要求提示符必须落在缓冲区末尾，于是永远等不到应答：
// 8 秒超时后连接按 LINGER 保留 10 分钟，期间主页轮询又因 raOpen 跳过探测，最终被误报成"卡住了"。
// 这里改为在缓冲区里查找独立成行的提示符并返回其位置，后面跟多少日志都不影响识别。
function promptIn(text) {
  const match = /(?:^|[\r\n])[ \t]*AC>[ \t]*/.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
//End By leewheel
const openOn = new Map();
const raOpen = root => (openOn.get(root) || 0) > 0;
// The remote console of a realm (same server, its own RA port) still busy with an earlier question.
const raBusy = (root, port) => raOpen(port ? `${root}|${Number(port)}` : root);
// portOverride: the RA port of another realm of the same server (same RA account, shared auth database).
function raCommand(root, command, timeout = 15000, portOverride = 0) {
  const { port: own, user, password } = raSettings(root);
  const port = Number(portOverride) || own;
  if (portOverride) root = `${root}|${port}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    openOn.set(root, (openOn.get(root) || 0) + 1);
    let counted = true;
    const uncount = () => { if (counted) { counted = false; openOn.set(root, openOn.get(root) - 1); } };
    let data = '';
    let step = 0;
    let settled = false;
    const settle = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const close = () => { clearTimeout(timer); clearTimeout(linger); socket.destroy(); uncount(); };
    const done = (error, value) => { settle(error, value); close(); };
    // Logged in and the command sent: the world will answer, so the connection waits for it.
    const timer = setTimeout(() => { if (step < 3) done(new Error('The world console did not answer in time.')); else settle(new Error('The world console did not answer in time.')); }, timeout);
    const linger = setTimeout(close, Math.max(timeout, LINGER));
    socket.on('error', () => done(new Error('The world console is not reachable: start the worldserver first.')));
    socket.on('close', () => { settle(new Error('The world console closed the connection.')); clearTimeout(linger); uncount(); });
    socket.on('data', chunk => {
      //By leewheel 2026-11-05 探测已结束的 socket 仍为兼容旧核心而保留，但不再无限制堆积日志
      if (settled) return;
      data += chunk.toString('utf8');
      // 截断时同时保留开头与结尾：命令应答在开头，提示符可能被后续日志挤到末尾
      if (data.length > 262144) data = data.slice(0, 4096) + data.slice(-4096);
      const prompt = promptIn(data);
      if (step === 0 && data.includes('Username:')) { step = 1; data = ''; socket.write(`${user}\r\n`); }
      else if (step === 1 && data.includes('Password:')) { step = 2; data = ''; socket.write(`${password}\r\n`); }
      else if (step === 2 && prompt) { step = 3; data = ''; socket.write(`${command}\r\n`); if (/^\.?server (shutdown|restart)/i.test(command)) settle(null, 'Requested.'); }
      else if (step === 2 && /(failed|denied|wrong)/i.test(data)) done(new Error('The world console refused the repack account (Settings\\repack.json).'));
      // 应答取提示符之前的全部内容：parseInfo 从中提取人数、tick 等数字，夹杂的日志不影响
      else if (step === 3 && prompt) done(null, data.slice(0, prompt.start).trim());
      //End By leewheel
    });
  });
}

// "server info": players and update time. The wording differs between cores: numbers are read loosely.
function parseInfo(text) {
  const num = pattern => { const m = pattern.exec(text); return m ? Number(m[1]) : null; };
  return {
    players: num(/Connected players:\s*(\d+)/i) ?? num(/players online:\s*(\d+)/i),
    characters: num(/Characters in world:\s*(\d+)/i),
    tick: num(/Update time diff:\s*(\d+)/i),
    tickMean: num(/(?:Mean|average)[^\d]{0,12}(\d+)\s*ms/i),
    uptime: /uptime:\s*([^\r\n.]+)/i.exec(text)?.[1]?.trim() || '',
  };
}

// The worldserver process of this repack (its pid is in .state\world.json, written by manage.py).
function worldPid(root) {
  const record = readJson(path.join(root, '.state', 'world.json'));
  return record?.pid && String(record.exe || '').toLowerCase().startsWith(root.toLowerCase()) ? Number(record.pid) : null;
}

let lastCpu = null;
// tasklist (much lighter than starting PowerShell): memory in KB, CPU time in h:mm:ss with /V.
function tasklistRow(pid, verbose) {
  return new Promise(resolve => {
    execFile('tasklist.exe', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH', ...(verbose ? ['/V'] : [])], { windowsHide: true, timeout: 8000 }, (error, out) => {
      const cells = (String(out || '').match(/"[^"]*"/g) || []).map(cell => cell.slice(1, -1));
      if (error || Number(cells[1]) !== Number(pid)) return resolve(null);
      const bytes = Number(String(cells[4] || '').replace(/\D/g, '')) * 1024;
      const [h, m, s] = String(cells[7] || '').split(':').map(Number);
      resolve({ bytes: bytes > 0 ? bytes : null, cpuMs: [h, m, s].every(Number.isFinite) ? ((h * 60 + m) * 60 + s) * 1000 : null });
    });
  });
}

function processStats(pid) {
  return tasklistRow(pid, true).then(row => {
    if (!row?.bytes) return null;
    const now = Date.now();
    let cpu = null;
    if (row.cpuMs !== null && lastCpu?.pid === pid && now > lastCpu.at) cpu = Math.max(0, Math.min(100, ((row.cpuMs - lastCpu.ms) / (now - lastCpu.at) / os.cpus().length) * 100));
    if (row.cpuMs !== null) lastCpu = { pid, ms: row.cpuMs, at: now };
    return { memory: row.bytes, cpu };
  });
}

// Memory of one process (the world of a realm), without touching the CPU reading of the CoA world.
function processMemory(pid) {
  return tasklistRow(pid, false).then(row => row?.bytes || null);
}

// The home page figures with the extra realms that run (list from realms.status, with .memory): players, bots and
// memory of every world added up, the tick of the CoA world; CoA stopped, the figures of the realms alone.
function withRealms(stats, list) {
  const others = (list || []).filter(realm => realm.state === 'running');
  if (!others.length) return stats;
  const sum = field => others.reduce((total, realm) => total + (realm[field] || 0), 0);
  const memory = sum('memory') + (stats.running ? stats.memory || 0 : 0);
  if (stats.running) {
    // Players, bots and memory of every world added up; the tick stays the CoA one (each world has its own).
    stats.realms = { count: others.length + 1, players: sum('players') + (stats.players || 0), bots: sum('online') + (stats.bots?.count || 0) };
    stats.memory = memory || stats.memory;
    return stats;
  }
  // CoA stopped, realms running: the figures are theirs, the tick that of the first one running.
  const main = others[0];
  return {
    //By leewheel 2026-11-05 只有国度在跑时，主世界没有 RA 会话，卡死判定一律为否
    running: true, realmOnly: main.key, consoleBusy: false, worldAlive: false, stuck: false, stuckFor: 0, at: Date.now(),
    //End By leewheel
    players: sum('players'), characters: sum('characters'), tick: main.tick, tickMean: main.tickMean, uptime: main.uptime,
    memory: memory || null, cpu: null,
    bots: { count: sum('online'), inCombat: null, target: sum('bots') || null },
    realms: others.length > 1 ? { count: others.length, players: sum('players'), bots: sum('online') } : null,
  };
}

function botsTarget(root) {
  try {
    //By leewheel 2026-11-02 机器人配置位置按布局取（发布版是 configs/modules）
    const layout = require('./layout.cjs').serverLayout(root);
    const conf = fs.readFileSync(path.join(root, ...`${layout.botsConfigs}/modules/playerbots.conf`.split('/')), 'utf8');
    return Number(/^[ \t]*AiPlayerbot\.MaxRandomBots[ \t]*=[ \t]*(\d+)/m.exec(conf)?.[1]) || null;
  } catch { return null; }
}

function botsInGame(root) {
  //By leewheel 2026-11-02 状态文件也按布局取（发布版是 logs/bot-status.json）
  const layout = require('./layout.cjs').serverLayout(root);
  const status = readJson(path.join(root, ...`${layout.logs}/bot-status.json`.split('/')));
  if (!status || !Array.isArray(status.bots)) return null;
  // The world writes it every 5 s: older than a minute, it is the one of a world that stopped (not shown).
  const fresh = !status.at || Date.now() / 1000 - Number(status.at) < 60;
  return fresh ? { count: status.bots.length, inCombat: status.bots.filter(bot => bot.combat).length, target: botsTarget(root) } : null;
}

//By leewheel 2026-11-05 世界服是否仍在推进：以"日志还在刷"为第一判据
// 判据（老大）：机器人日志还在刷，就说明服务器没有崩溃。Server.log 由世界主循环持续写入，
// 只要它的修改时间保持新鲜（或内容仍在增长），主循环就一定还在跑，绝不能报"卡住"；
// 日志停刷超过两分钟、时间戳也不再前进，才算失去心跳。
// 辅助证据是 playerbots 每 5 秒写一次的 bot-status.json（日志路径随布局变化时兜底）。
const logSeen = new Map();
function worldHeartbeat(root) {
  const now = Date.now();
  const layout = require('./layout.cjs');
  // ① 世界日志仍在写入
  for (const relative of layout.logCandidates(root)) {
    if (!/Server\.log$/i.test(relative)) continue;
    let stat;
    try { stat = fs.statSync(path.join(root, ...relative.split('/'))); } catch { continue; }
    const previous = logSeen.get(root);
    logSeen.set(root, { size: stat.size, mtimeMs: stat.mtimeMs, at: now });
    // 文件时间明显在未来（时间倒退、时钟回拨）不算心跳；留两秒容差，否则 Windows 时间戳精度
    // 会让"刚写入的一行日志"被误判成未来时间，反而把活着的世界判成停刷。
    if (stat.mtimeMs > now + 2000) return false;
    // 世界每写一行日志都会把 mtime 往前推：最近两分钟内写过，主循环就还在跑
    if (now - stat.mtimeMs < 120000) return true;
    // 文件系统时间戳精度不足时，内容增长也能证明在写；但时间戳不得倒退，也不能是十分钟前的旧文件
    return !!previous && stat.size > previous.size && stat.mtimeMs >= previous.mtimeMs && now - stat.mtimeMs < 360000;
  }
  // ② 机器人状态文件由世界主循环每 5 秒刷新
  try {
    const file = path.join(root, ...`${layout.serverLayout(root).logs}/bot-status.json`.split('/'));
    const status = readJson(file);
    const raw = Number(status?.at);
    const at = raw > 1e12 ? raw : raw > 0 ? raw * 1000 : 0;
    if (at > 0 && now >= at && now - at < 120000) return true;
  } catch {}
  return false;
}

// 只有"确实发出过 server info 且没得到应答"+"日志停刷"同时持续 20 分钟，才认定世界卡死。
// 上一条 RA 连接占用导致本次根本没有探测时，不新起计时（不能把"没检测"当成"无响应"）。
// stuckAfter 允许传入更短的窗口，便于回归测试覆盖这条判定。
const silentSince = new Map();
function silentVerdict(root, { answered, probed, alive, stuckAfter = 20 * 60 * 1000 }) {
  if (answered || alive) silentSince.delete(root);
  else if (probed && !silentSince.has(root)) silentSince.set(root, Date.now());
  const forMs = silentSince.has(root) ? Date.now() - silentSince.get(root) : 0;
  return { stuckFor: forMs, stuck: silentSince.has(root) && forMs > stuckAfter };
}
//End By leewheel

//By leewheel 2026-11-05 卡死判定改由"RA 应答 + 世界日志心跳"共同决定
async function stats(root) {
  const pid = worldPid(root);
  if (!pid) return { running: false };
  try { process.kill(pid, 0); } catch { return { running: false }; }
  // 区分"上一条 RA 连接占用、本次没有探测"与"探测了但没应答"：
  // 原实现把两者都算成"世界无响应"并持续累加，10 分钟 LINGER 期间会累出几十分钟的假卡死。
  const occupied = raOpen(root);
  const asking = occupied ? Promise.resolve(null) : raCommand(root, 'server info', 8000).then(parseInfo).catch(() => null);
  const [info, proc] = await Promise.all([asking, processStats(pid)]);
  const alive = worldHeartbeat(root);
  const verdict = silentVerdict(root, { answered: !!info, probed: !occupied, alive });
  // busySince 现在只表示"控制台无应答时长"供页面显示，不再作为卡死依据
  if (info) busySince.delete(root); else if (!busySince.has(root)) busySince.set(root, Date.now());
  return {
    running: true, consoleBusy: !info, busyFor: info ? 0 : Date.now() - (busySince.get(root) || Date.now()),
    worldAlive: alive, stuck: verdict.stuck, stuckFor: verdict.stuckFor, probed: !occupied,
    ...(info || {}), memory: proc?.memory ?? null, cpu: proc?.cpu ?? null, bots: botsInGame(root), at: Date.now(),
  };
}
//End By leewheel

const busySince = new Map();

// Last resort when the world no longer answers: its own process (and only it) is ended. MySQL keeps the data;
// what players did since the last save is lost.
function forceStopWorld(root) {
  const pid = worldPid(root);
  if (!pid) throw new Error('The worldserver of this server is not running.');
  return new Promise((resolve, reject) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 20000 }, error => {
    if (error) reject(new Error(`The worldserver could not be stopped: ${error.message}`));
    //By leewheel 2026-11-05 强制停止后清掉心跳与静默计时，下次启动从干净状态开始
    else { busySince.delete(root); silentSince.delete(root); logSeen.delete(root); resolve(true); }
    //End By leewheel
  }));
}

//By leewheel 2026-11-05 导出心跳与判定函数，供回归测试直接验证误报场景
module.exports = { raBusy, raCommand, parseInfo, stats, forceStopWorld, processMemory, withRealms, promptIn, worldHeartbeat, silentVerdict };
//End By leewheel
