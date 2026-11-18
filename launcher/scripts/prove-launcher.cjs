'use strict';
//By leewheel 2026年11月19日 发布门禁（移植上游 tools/prove-launcher.mjs 的思路，按我们的便携版改写）：
// 发出去的每一个 exe 都必须先证明自己**能启动、能画出首页**，否则清单不写、Release 不发。
// 做法：把刚打出来的便携版 exe 用 --smoke 跑一遍（隐藏窗口，截图 + 首页文字写进 smoke.log），
// 检查：进程正常退出、首页文字出现、没有任何一步失败。通过后写 <exe>.proof.json（含 sha256、体积、版本、首页文字）。
// 用法：node scripts/prove-launcher.cjs [exe路径]（省略时取 dist 里最新那个 CoA-Launcher-*.exe）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const launcherDir = path.resolve(__dirname, '..');

function newestExe(dir) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const rows = names.filter(name => /^CoA-Launcher-.*\.exe$/i.test(name))
    .map(name => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return rows.length ? path.join(dir, rows[0].name) : '';
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  try { for (;;) { const read = fs.readSync(fd, buffer, 0, buffer.length, null); if (read <= 0) break; hash.update(buffer.subarray(0, read)); } }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

const exe = path.resolve(process.argv[2] || newestExe(path.join(launcherDir, 'dist')));
if (!fs.existsSync(exe)) {
  console.error(`找不到要验证的安装包：${exe}`);
  process.exit(1);
}

const smokeDir = path.join(os.tmpdir(), `coa-proof-${Date.now()}`);
fs.mkdirSync(smokeDir, { recursive: true });
const version = (/CoA-Launcher-(.+)\.exe$/i.exec(path.basename(exe)) || [])[1] || '';
console.log(`正在验证 ${path.basename(exe)}（隐藏窗口跑一遍首页）…`);

const child = spawn(exe, [`--smoke=${smokeDir}`], {
  // 冒烟时给一份独立的用户配置目录，绝不碰玩家/老大正在用的那份
  env: { ...process.env, COA_LAUNCHER_PROFILE: path.join(smokeDir, 'profile'), COA_SMOKE_PAGES: 'play,server', COA_SMOKE_DELAY: '1500' },
  windowsHide: true, stdio: 'ignore',
});
const timer = setTimeout(() => { try { child.kill(); } catch {} }, 120000);

child.once('exit', code => {
  clearTimeout(timer);
  const logFile = path.join(smokeDir, 'smoke.log');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const texts = log.split(/\r?\n/).filter(line => line.includes(' text: '));
  const failed = log.split(/\r?\n/).filter(line => /step failed|error:/i.test(line));
  const problems = [];
  if (code !== 0) problems.push(`进程退出码 ${code}`);
  if (!texts.length) problems.push('首页没有画出任何文字（可能是启动就报错）');
  if (failed.length) problems.push(`有步骤失败：${failed[0].slice(0, 160)}`);
  if (problems.length) {
    console.error(`验证失败（${path.basename(exe)}）：\n- ${problems.join('\n- ')}`);
    console.error(`现场在 ${smokeDir}（未删除，方便排查）`);
    process.exit(1);
  }
  const proof = {
    exe: path.basename(exe), version, size: fs.statSync(exe).size, sha256: sha256(exe),
    homeText: texts[0].replace(/^.*? text: /, '').slice(0, 300), at: new Date().toISOString(),
  };
  fs.writeFileSync(`${exe}.proof.json`, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  fs.rmSync(smokeDir, { recursive: true, force: true });
  console.log(`验证通过：${proof.exe} · ${(proof.size / 1048576).toFixed(1)} MB · sha256 ${proof.sha256.slice(0, 16)}…`);
  console.log(`证明已写入 ${path.basename(exe)}.proof.json`);
});
