'use strict';
//By leewheel 2026年11月19日 国度级维护：备份 / 恢复 / 重置世界（移植上游 0.4.2 的 “Reset the world” 与 “Restore a backup”，
// 按我们自己的库名规则改写）：
//   · 每个国度有自己的角色库与机器人库：主服用 acore_characters / acore_playerbots，
//     其它国度是 acore_characters_<key> / acore_playerbots_<key>；世界库 acore_world 是五个国度共用的，**绝不动**。
//   · 重置 = 先整包备份（出错还能回去）→ 校验玩家输入的国度名 → 再清空这两个库的所有表。
//     不删库、不动表结构：库和表都留着，下一次启动机器人会重新生成，角色从零开始。
//   · 恢复 = 先给当前状态再备份一份，然后把选中的备份导入回去。
// 所有操作都要求国度处于停止状态：运行中清库会把世界服写坏（它还在往里写数据）。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const DUMP_LIMIT = 30 * 60 * 1000;
const LOAD_LIMIT = 60 * 60 * 1000;
const BACKUP_DIR = root => path.join(root, 'Backups');
const STAMP = /^realm-([a-z0-9]+)-(\d{8}-\d{6})\.sql\.gz$/;

// 这个国度自己的两个库（世界库共用，不在此列）
function databasesOf(key) {
  const k = String(key || '').toLowerCase();
  if (!/^[a-z][a-z0-9]{1,11}$/.test(k)) throw new Error('国度标识不合法');
  return k === 'coa' ? ['acore_characters', 'acore_playerbots'] : [`acore_characters_${k}`, `acore_playerbots_${k}`];
}

function mysqlArgs(root) { return [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`]; }

function run(exe, args, { timeout, stdoutFile = '', stdinFile = '' } = {}) {
  return new Promise((resolve, reject) => {
    const out = stdoutFile ? fs.openSync(stdoutFile, 'w') : 'ignore';
    const input = stdinFile ? fs.openSync(stdinFile, 'r') : 'ignore';
    const child = spawn(exe, args, { windowsHide: true, stdio: [input, out, 'pipe'] });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk.toString(); if (err.length > 40000) err = err.slice(-20000); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(`${path.basename(exe)} 超时（${Math.round(timeout / 60000)} 分钟）`)); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (stdoutFile) { try { fs.closeSync(out); } catch {} }
      if (stdinFile) { try { fs.closeSync(input); } catch {} }
      if (code === 0) resolve(err);
      else reject(new Error(String(err).trim().split(/\r?\n/).filter(Boolean).pop() || `${path.basename(exe)} 退出码 ${code}`));
    });
  });
}

function sql(root, query) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'mysql', 'bin', 'mysql.exe'), [...mysqlArgs(root), '-N', '-B', '-e', query], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('数据库没有响应（超时）')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(String(err).trim().split(/\r?\n/).filter(Boolean).pop() || `mysql 退出码 ${code}`));
    });
  });
}

const stampOf = (date = new Date()) => {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

// 整包备份：mysqldump → gzip → Backups\realm-<key>-<时间戳>.sql.gz
async function backup(root, key, { notify = () => {} } = {}) {
  const dbs = databasesOf(key);
  await fsp.mkdir(BACKUP_DIR(root), { recursive: true });
  const file = path.join(BACKUP_DIR(root), `realm-${key}-${stampOf()}.sql.gz`);
  notify(`正在备份 ${dbs.join('、')} …`);
  const dumpExe = path.join(root, 'mysql', 'bin', 'mysqldump.exe');
  if (!fs.existsSync(dumpExe)) throw new Error(`找不到 ${dumpExe}：这个整合包缺备份工具。`);
  const args = [...mysqlArgs(root), '--single-transaction', '--quick', '--no-tablespaces', '--skip-lock-tables',
    '--routines', '--events', '--set-gtid-purged=OFF', '--default-character-set=utf8mb4', '--databases', ...dbs];
  // 子进程直接往 gzip 流里写，不产生中间明文文件
  await new Promise((resolve, reject) => {
    const child = spawn(dumpExe, args, { windowsHide: true });
    const gzip = zlib.createGzip({ level: 6 });
    const out = fs.createWriteStream(file);
    let err = '';
    child.stderr.on('data', chunk => { err += chunk.toString(); if (err.length > 40000) err = err.slice(-20000); });
    child.stdout.pipe(gzip).pipe(out);
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('备份超时（30 分钟）')); }, DUMP_LIMIT);
    out.once('error', error => { clearTimeout(timer); reject(error); });
    out.once('finish', () => {
      clearTimeout(timer);
      if (child.exitCode === 0) resolve();
      else reject(new Error(String(err).trim().split(/\r?\n/).filter(Boolean).pop() || `mysqldump 退出码 ${child.exitCode}`));
    });
  });
  const size = (await fsp.stat(file)).size;
  notify(`备份完成：${path.basename(file)}（${(size / 1048576).toFixed(1)} MB）`);
  return { file, name: path.basename(file), size, databases: dbs };
}

// 这个国度的备份列表（新的在前）
async function list(root, key) {
  const dir = BACKUP_DIR(root);
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const rows = [];
  for (const name of names) {
    const match = STAMP.exec(name);
    if (!match || match[1] !== key) continue;
    const full = path.join(dir, name);
    try { const stat = await fsp.stat(full); rows.push({ name, file: full, size: stat.size, at: stat.mtime.toISOString() }); } catch { /* 正在写 */ }
  }
  return rows.sort((a, b) => (a.name < b.name ? 1 : -1));
}

async function tablesOf(root, db) {
  const out = await sql(root, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_TYPE='BASE TABLE'`);
  return out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

// 清空一个国度：先备份，再逐表 TRUNCATE（保留库与表结构；外键在清空期间关掉，清完再开）
async function reset(root, key, { typedName = '', expectName = '', notify = () => {}, stopped = true } = {}) {
  if (!stopped) throw new Error('这个国度还在运行：请先停止它，再重置（运行中清库会把正在写的数据弄坏）。');
  const want = String(expectName || '').trim();
  const typed = String(typedName || '').trim();
  // 二次确认：输入的必须是这个国度的名字（和游戏国度列表里看到的一致）
  if (!want || typed.toLowerCase() !== want.toLowerCase()) throw new Error(`国度名不对（应输入「${want}」）：什么都没有重置。`);
  const saved = await backup(root, key, { notify });
  const dbs = databasesOf(key);
  const plan = [];
  for (const db of dbs) plan.push({ db, tables: await tablesOf(root, db) });
  const total = plan.reduce((sum, item) => sum + item.tables.length, 0);
  if (!total) throw new Error('这两个库里没有表：这个国度可能还没成功启动过，不用重置。');
  await sql(root, 'SET FOREIGN_KEY_CHECKS=0');
  let done = 0;
  try {
    for (const item of plan) {
      notify(`正在清空 ${item.db}（${item.tables.length} 张表）…`);
      for (const table of item.tables) {
        await sql(root, `SET FOREIGN_KEY_CHECKS=0; TRUNCATE TABLE \`${item.db}\`.\`${table}\``);
        done++;
        if (done % 10 === 0) notify(`正在清空：${done}/${total}`);
      }
    }
  } finally {
    await sql(root, 'SET FOREIGN_KEY_CHECKS=1').catch(() => {});
  }
  notify(`重置完成：清空 ${done} 张表；备份在 ${saved.name}`);
  return { ...saved, tables: done, databases: dbs };
}

// 恢复：先把“现在”备份一份，再把选中的备份导回去（导入的是整库，含库名，直接覆盖）
async function restore(root, key, file, { notify = () => {}, stopped = true } = {}) {
  if (!stopped) throw new Error('这个国度还在运行：请先停止它，再恢复备份。');
  const target = path.resolve(String(file || ''));
  if (!STAMP.test(path.basename(target)) || !fs.existsSync(target)) throw new Error('找不到这个备份文件。');
  const safety = await backup(root, key, { notify: line => notify(`恢复前先备份：${line}`) }).catch(() => null);
  const mysqlExe = path.join(root, 'mysql', 'bin', 'mysql.exe');
  notify(`正在导入 ${path.basename(target)} …`);
  await new Promise((resolve, reject) => {
    const child = spawn(mysqlExe, [...mysqlArgs(root)], { windowsHide: true });
    const gunzip = zlib.createGunzip();
    fs.createReadStream(target).pipe(gunzip).pipe(child.stdin);
    let err = '';
    child.stderr.on('data', chunk => { err += chunk.toString(); if (err.length > 40000) err = err.slice(-20000); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('导入超时（60 分钟）')); }, LOAD_LIMIT);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(String(err).trim().split(/\r?\n/).filter(Boolean).pop() || `mysql 退出码 ${code}`));
    });
  });
  notify(`恢复完成：${path.basename(target)}`);
  return { restored: path.basename(target), safety: safety?.name || '' };
}

module.exports = { databasesOf, backup, list, reset, restore, tablesOf, BACKUP_DIR };
