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
function spawnTakeover(stagedPath, oldPid) {
  try {
    const child = spawn(stagedPath, [`${TAKEOVER_FLAG}${oldPid}`], { stdio: 'ignore', windowsHide: true });
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
async function performTakeover(root, oldPid, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const target = path.join(root, 'CoA启动器.exe');
  const legacy = path.join(root, LEGACY_NAME);
  const source = path.join(root, STAGED_NAME);
  const deadline = Date.now() + timeoutMs;
  while (isRunning(oldPid) && Date.now() < deadline) await sleep(500);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (sizeOf(source) <= 0) return false;
      fs.rmSync(legacy, { force: true });
      if (fs.existsSync(target)) fs.renameSync(target, legacy);
      fs.copyFileSync(source, target);
      try { fs.rmSync(source, { force: true }); } catch { /* 便携版原文件若还占着，下次启动再清 */ }
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
function ensureStagedSwap(root, selfPid) {
  const staged = path.join(root, STAGED_NAME);
  const target = path.join(root, 'CoA启动器.exe');
  if (sizeOf(staged) <= 0) return false;
  if (sizeOf(staged) === sizeOf(target)) { try { fs.rmSync(staged, { force: true }); } catch { /* 删不掉就算了 */ } return false; }
  if (spawnReplaceHelper(root, selfPid)) return true;
  return spawnTakeover(staged, selfPid);
}

module.exports = { stageLauncher, spawnTakeover, spawnReplaceHelper, performTakeover, cleanupLegacy, ensureStagedSwap, isRunning, STAGED_NAME, LEGACY_NAME, HELPER_NAME, TAKEOVER_FLAG };
