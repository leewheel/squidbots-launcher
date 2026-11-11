'use strict';
//By leewheel 2026年11月6日 启动器替换自己（不用 PowerShell：本机实测 detached 起不来，且中文路径易出错）。
// 🔴 正在运行的 exe 在 Windows 上既不能改名也不能覆盖（运行镜像不共享删除权限），老大实测：
//    EBUSY: resource busy or locked, copyfile ... -> CoA启动器.exe
// 做法：
//  1) 更新时先把新 exe 落成 CoA启动器.new.exe；
//  2) 用它自己当“替换器”：spawn(CoA启动器.new.exe --takeover=<旧PID>)，它等旧进程退出后
//     把旧 exe 改名 .old.exe、把自己**复制**成 CoA启动器.exe（复制运行中的自己是读，允许），然后退出；
//  3) 下次打开就是新版；上一轮的 .old.exe 由下次启动清理。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STAGED_NAME = 'CoA启动器.new.exe';
const LEGACY_NAME = 'CoA启动器.old.exe';
const HELPER_NAME = 'launcher-replace.exe';
const TAKEOVER_FLAG = '--takeover=';

function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

function isRunning(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 把包里的新 exe 落成 启动器.new.exe */
function stageLauncher(root, sourceFile) {
  const staged = path.join(root, STAGED_NAME);
  fs.copyFileSync(sourceFile, staged);
  return staged;
}

/** 启动“替换器”（就是新 exe 自己），它负责等旧进程退出后替换 */
function spawnTakeover(stagedPath, oldPid, { restart = false } = {}) {
  try {
    const args = [`${TAKEOVER_FLAG}${oldPid}`];
    if (restart) args.push('--restart');
    const child = spawn(stagedPath, args, { stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 用独立助手做替换（常规做法：旧进程退出后改名，原文件不会被占用）：
 *  launcher-replace.exe <旧PID> <新exe> <目标exe> [restart]
 * 助手是独立的小 exe，它不动自己，只给别的文件改名，所以不会撞 EBUSY。 */
function spawnReplaceHelper(root, oldPid, { restart = false } = {}) {
  const helper = path.join(root, HELPER_NAME);
  if (sizeOf(helper) <= 0 || sizeOf(path.join(root, STAGED_NAME)) <= 0) return false;
  try {
    const child = spawn(helper, [String(oldPid || 0), STAGED_NAME, 'CoA启动器.exe', restart ? '1' : '0'], { cwd: root, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 替换器本体：等旧进程退出 → 旧 exe 改名 → 用**便携版原文件**（不是 process.execPath！
 *  便携版会把自己解压到 %TEMP% 再运行，process.execPath 指向的是临时目录里的内层 exe，
 *  复制它会把启动器换成“没有资源目录”的裸 exe）覆盖目标位置，然后删掉 .new.exe。 */
//By leewheel 2026年11月9日 restart：替换成功后把新 exe 拉起来。
// 在线更新点「重启并安装」时用得上——不然玩家会看到启动器自己消失，以为崩了。
// ⚠️ 只给"玩家主动点更新"这一条路径用；启动时发现残留 .new.exe 的自动替换不能 restart，
//   否则会在玩家刚关掉启动器时凭空弹出一个窗口。
async function performTakeover(root, oldPid, { timeoutMs = 10 * 60 * 1000, restart = false } = {}) {
  const target = path.join(root, 'CoA启动器.exe');
  const legacy = path.join(root, LEGACY_NAME);
  const source = path.join(root, STAGED_NAME);
  const deadline = Date.now() + timeoutMs;
  while (isRunning(oldPid) && Date.now() < deadline) await sleep(500);
  const metaFile = path.join(root, 'CoA启动器.new.json');
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (sizeOf(source) <= 0) return false;
      fs.rmSync(legacy, { force: true });
      if (fs.existsSync(target)) fs.renameSync(target, legacy);
      fs.copyFileSync(source, target);
      try { fs.rmSync(source, { force: true }); } catch { /* 便携版原文件若还占着，下次启动再清 */ }
      try { fs.rmSync(metaFile, { force: true }); } catch { /* 同上 */ }
      if (restart) {
        // 新 exe 已经就位：等 1 秒让文件句柄彻底释放，再拉起（不带 --takeover，走正常启动）
        await sleep(1000);
        try {
          const child = spawn(target, [], { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
          child.unref();
        } catch { /* 拉不起来时玩家手动双击也一样 */ }
      }
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

/** 启动时清理上一轮留下的 .old.exe（删不掉就留着，不影响运行） */
function cleanupLegacy(root) {
  try { fs.rmSync(path.join(root, LEGACY_NAME), { force: true }); } catch { /* 占用中 */ }
}

/** 启动时：如果有已落地的 new.exe，优先用独立助手换；没有助手时退回“新 exe 当替换器” */
//By leewheel 2026年11月9日 就绪判据改成**先看元数据**：
// 在线更新落位时会写 CoA启动器.new.json（版本 + size + sha256）。只有元数据里的 size 与文件实际大小一致
// 才算“真就绪”；大小对不上（下载中断、磁盘出错、被别的东西覆盖）就认定是坏文件，直接删掉重下，
// 绝不再把半截 exe 顶上去——那会让启动器直接打不开，玩家只能重下整个 375MB。
//By leewheel 2026年11月9日 自更新落位的包（有元数据）**不在启动时换**，改到退出时换（见 swapOnQuit）：
// 启动时 spawn 一个新 exe 等着本进程退出，而玩家可能要用上几个小时，那个进程就白等成一个僵尸；
// 而且启动瞬间替换意味着“刚打开就被换掉”，日志/提示都没法解释。退出时换最干净：
// 玩家关掉启动器 → 换好 → 下次打开就是新版。
function readStagedMeta(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'CoA启动器.new.json'), 'utf8')); } catch { return null; }
}

function ensureStagedSwap(root, selfPid) {
  const staged = path.join(root, STAGED_NAME);
  const target = path.join(root, 'CoA启动器.exe');
  if (sizeOf(staged) <= 0) return false;
  const meta = readStagedMeta(root);
  if (meta?.size && sizeOf(staged) !== meta.size) {
    try { fs.rmSync(staged, { force: true }); } catch { /* 删不掉就先留着 */ }
    try { fs.rmSync(path.join(root, 'CoA启动器.new.json'), { force: true }); } catch { /* 同上 */ }
    return false;
  }
  // 自更新落位的包：交给 swapOnQuit（退出时换），这里什么都不做
  if (meta?.size) return false;
  // 没有元数据的是老流程（内容更新包里带的 exe）：沿用原来的“大小不同才换”
  if (sizeOf(staged) === sizeOf(target)) { try { fs.rmSync(staged, { force: true }); } catch { /* 删不掉就算了 */ } return false; }
  if (spawnReplaceHelper(root, selfPid)) return true;
  return spawnTakeover(staged, selfPid, { restart: false });
}

/** 退出前调用：把自更新下载好的新版换上去（不拉新窗口，下次打开就是新版）。
 *  这里必须在本进程真正退出**之前** spawn，takeover 会等 PID 消失后再改名覆盖。 */
function swapOnQuit(root, selfPid) {
  try {
    const meta = readStagedMeta(root);
    if (!meta?.size) return false;
    const staged = path.join(root, STAGED_NAME);
    if (sizeOf(staged) !== meta.size) return false;
    return spawnTakeover(staged, selfPid, { restart: false });
  } catch { return false; }
}

module.exports = { stageLauncher, spawnTakeover, spawnReplaceHelper, performTakeover, cleanupLegacy, ensureStagedSwap, swapOnQuit, readStagedMeta, isRunning, STAGED_NAME, LEGACY_NAME, HELPER_NAME, TAKEOVER_FLAG };
