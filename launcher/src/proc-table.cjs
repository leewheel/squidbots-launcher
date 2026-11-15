'use strict';
//By leewheel 2026年11月15日 进程表：一次 tasklist 拿全表，取代“状态轮询里每 5 秒打一次 PowerShell”。
//
// 老大实弹（2026-11-15 截图）：更新过程中 PowerShell 一个接一个地开，8 个各占 2%~7% CPU，
// 最后电脑卡到没法操作。根因不是“更新”本身，而是**状态轮询**：
//   · status() 每 5 秒问一次“世界服/登录服/数据库还在不在”，原来用
//     powershell.exe -Command Get-CimInstance Win32_Process ...；
//   · PowerShell 冷启动要 1~3 秒（慢盘/杀软更久），超时设的是 15 秒；
//   · 缓存只认 4 秒，上一轮没回来下一轮又起一个新的 —— 直接叠加，
//     进程越多机器越慢、PowerShell 起得越慢，正反馈失控。
//
// 现在的分层（两条都单飞，永不并发）：
//   1) 进程表：tasklist.exe（原生小程序，几毫秒）→ { pid, name, memory }，缓存 3 秒；
//   2) 进程路径：只在“确实有同名进程”时才问（服务停着 = 一次都不问），一次批量查回所有候选，
//      结果缓存 60 秒 —— 状态轮询因此最多每分钟一个 PowerShell，而且服务全停时是 0 个。
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

// execFile 的 promisify 签名是 (file, args, options)，不会把 options 误当回调。
const run = promisify(execFile);
const SHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const CACHE_MS = 3000;
const PATH_CACHE_MS = 60000;

let rows = [];
let at = 0;
let pending = null;

const pathCache = new Map();     // pid -> { file, at }
let pathPending = null;

// tasklist /FO CSV /NH 每行形如：
//   "worldserver.exe","12345","Console","1","1,234,567 K"
// 中间两列（会话名/会话号）照抄不管，只取映像名、PID、内存。
function parse(stdout) {
  const list = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/.exec(line);
    if (!match) continue;
    const memory = Number(String(match[3]).replace(/[^\d]/g, '')) * 1024;   // K → B
    list.push({ name: match[1], pid: Number(match[2]), memory: memory || 0 });
  }
  return list;
}

/** 全表快照：[{ name, pid, memory }]。fresh=true 时忽略缓存，但仍然不会并发。 */
async function processTable({ fresh = false } = {}) {
  if (process.platform !== 'win32') return [];
  if (pending) return pending;
  if (!fresh && at && Date.now() - at < CACHE_MS) return rows;
  pending = run('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 15000 })
    .then(result => { rows = parse(result.stdout); at = Date.now(); return rows; })
    .catch(() => rows)
    .finally(() => { pending = null; });
  return pending;
}

/**
 * 这批 PID 的可执行文件完整路径：Map<pid, file>。
 * 只在有 pid 要问的时候才启动 PowerShell，一次问全批，结果缓存 60 秒。
 * 拿不到（权限不足 / 进程刚退出）不会写入缓存，下次再问。
 */
async function exePaths(pids) {
  if (process.platform !== 'win32') return new Map();
  const wanted = [...new Set(pids.map(Number).filter(pid => pid > 0))];
  if (!wanted.length) return new Map();
  const now = Date.now();
  const stale = wanted.filter(pid => {
    const hit = pathCache.get(pid);
    return !hit || now - hit.at > PATH_CACHE_MS;
  });
  if (stale.length && !pathPending) {
    const filter = stale.map(pid => `ProcessId=${pid}`).join(' OR ');
    const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }`;
    pathPending = run(SHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 20000 })
      .then(result => {
        for (const line of String(result.stdout).split(/\r?\n/)) {
          const cut = line.indexOf('|');
          if (cut <= 0) continue;
          const pid = Number(line.slice(0, cut));
          const file = line.slice(cut + 1).trim();
          if (pid && file) pathCache.set(pid, { file, at: Date.now() });
        }
      })
      .catch(() => {})
      .finally(() => { pathPending = null; });
  }
  if (pathPending) await pathPending;
  const out = new Map();
  for (const pid of wanted) {
    const hit = pathCache.get(pid);
    if (hit?.file) out.set(pid, hit.file);
  }
  // 进程已不在表里：把它的路径缓存一起丢掉，免得 PID 复用后拿到旧路径
  if (pathCache.size > 256) pathCache.clear();
  return out;
}

/** 按映像名取进程（大小写不敏感），names 可以是数组或单个字符串。 */
function byName(table, names) {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean).map(name => String(name).toLowerCase());
  if (!wanted.length) return [];
  return table.filter(row => wanted.includes(String(row.name).toLowerCase()));
}

module.exports = { processTable, exePaths, byName };
//End By leewheel
