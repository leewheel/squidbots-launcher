'use strict';
//By leewheel 2026年11月6日 数据库导入日志：每次更新/补导都把“每个 SQL 是否导入成功”写进同一个日志文件，
// 多个更新包、多次补导都追加在里面（老大要求：保留每次的 log，多包共用一个文件）。
// 文件：<整合包根>\.coa-launcher\logs\sql-import.log
// 格式：
// ===== 2026-11-06 22:50:00 更新 2026.11.06（共 13 个脚本） =====
//   OK   acore_world/xxx.sql（120ms）
//   FAIL acore_auth/yyy.sql：Duplicate column ...（30ms）
// 小计：12 成功 / 1 失败（用时 8.2s）
const fs = require('node:fs');
const path = require('node:path');

function logFile(root) {
  return path.join(root, '.coa-launcher', 'logs', 'sql-import.log');
}

function append(root, text) {
  try {
    const file = logFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return file;
  } catch {
    return '';
  }
}

function stamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** 开始一次导入：写头部（含完整计划清单） */
function startRun(root, { version = '', origin = '', files = [] } = {}) {
  const header = `\n===== ${stamp()} ${origin || '更新'} ${version || ''}（共 ${files.length} 个脚本） =====`;
  const plan = files.map((item, index) => `  ${String(index + 1).padStart(2, ' ')}. ${item.database ? `${item.database}/` : ''}${item.file}`);
  append(root, [header, '计划清单：', ...plan].join('\n'));
  return { startedAt: Date.now(), total: files.length, ok: 0, failed: 0 };
}

/** 单个脚本的结果 */
function recordFile(root, { database = '', file, ok, ms = 0, error = '' }) {
  const label = `${database ? `${database}/` : ''}${file}`;
  const line = ok
    ? `  OK   ${label}（${ms}ms）`
    : `  FAIL ${label}：${String(error).split(/\r?\n/)[0]}（${ms}ms）`;
  append(root, line);
}

/** 结束：写小计 */
function finishRun(root, run, { failed = [], note = '' } = {}) {
  const seconds = ((Date.now() - (run?.startedAt || Date.now())) / 1000).toFixed(1);
  // 调用方没记 ok 计数时按“总数 - 失败数”算，避免日志里出现 0 成功
  const total = Number(run?.total || 0);
  const ok = Number(run?.ok || 0) || Math.max(0, total - failed.length);
  const lines = [`小计：${ok} 成功 / ${failed.length} 失败（用时 ${seconds}s）`];
  if (failed.length) lines.push(`失败清单：${failed.map(item => `${item.database ? `${item.database}/` : ''}${item.file}`).join('、')}`);
  if (note) lines.push(note);
  append(root, lines.join('\n'));
}

module.exports = { logFile, startRun, recordFile, finishRun, append };
