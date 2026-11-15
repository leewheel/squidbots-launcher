'use strict';
//By leewheel 2026年11月6日 启动器替换自己（不用 PowerShell：本机实测 detached 起不来，且中文路径易出错）。
// 🔴 正在运行的 exe 在 Windows 上既不能改名也不能覆盖（运行镜像不共享删除权限），老大实测：
//    EBUSY: resource busy or locked, copyfile ... -> CoA启动器.exe
//By leewheel 2026年11月15日 替换**只有一条路**：<root>\Update\Update.exe（见下方独立更新器段）。
// 旧的 launcher-replace.exe 助手、以及“新 exe 自己带 --takeover 等旧进程”的自替换，
// 全部删除——三套逻辑并存只会互相抢同一个文件名，谁也换不干净（老大原话：
// “怎么还有 launcher-replace.exe”，这条必须彻底断掉）。
// 现在的流程：
//  1) 新版 exe 先落成 CoA启动器.new.exe（下载校验通过才落）；
//  2) 拉起 Update.exe：它按映像路径强杀启动器整棵进程树（含 portable 外壳与 %TEMP% 内层）、
//     用“能否独占打开目标文件”确认句柄真释放，再改名覆盖，最后按 --restart 决定是否拉起；
//  3) 上一轮的 .old.exe、以及老版本遗留的 launcher-replace.exe 由下次启动清理。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STAGED_NAME = 'CoA启动器.new.exe';
const LEGACY_NAME = 'CoA启动器.old.exe';
//By leewheel 2026年11月15日 老版本的替换助手文件名：只用于启动时清理残留，不再有任何调用。
const LEGACY_HELPER_NAME = 'launcher-replace.exe';
//By leewheel 2026年11月15日 独立更新器（LauncherUpdate\Update.exe）：见下方 ensureUpdater / spawnUpdater
// ⚠️ 为什么不是 Update\：<root>\Update\ 是**更新包临时目录**（下载、解压、装完删除），
// 把更新器放进去会被当成临时文件一起清掉（2026-11-15 实弹：更新完 Update\Update.exe 就没了）。
// 换到独立的 LauncherUpdate\，语义清楚、永不与更新包抢目录。
const UPDATER_DIR = 'LauncherUpdate';
const UPDATER_NAME = 'Update.exe';
const LEGACY_UPDATER_DIR = 'Update';   // 老位置，只用于启动时清理

/** <root>\LauncherUpdate\Update.exe */
function updaterPath(root) {
  return path.join(root, UPDATER_DIR, UPDATER_NAME);
}

/** 确保 <root>\LauncherUpdate\Update.exe 就位：打包版从 resources 拷，开发态从 tools 拷。
 *  每次启动都核一次大小，被删了/被截断了就补回来——更新器本身丢了，自更新就没法装了。 */
function ensureUpdater(root) {
  const dest = updaterPath(root);
  const candidates = [
    path.join(process.resourcesPath || '', UPDATER_NAME),
    path.join(__dirname, '..', 'tools', UPDATER_NAME),
  ];
  const source = candidates.find(item => item && sizeOf(item) > 0);
  if (!source) return false;
  // 老位置的副本没有任何用处（那里是更新包临时目录），启动时顺手清掉
  try { fs.rmSync(path.join(root, LEGACY_UPDATER_DIR, UPDATER_NAME), { force: true }); } catch { /* 占着就下次 */ }
  // 已经就位且大小一致就不动（更新器可能正在运行，覆盖会失败，没必要试）
  if (sizeOf(dest) === sizeOf(source)) return true;
  try {
    fs.mkdirSync(path.join(root, UPDATER_DIR), { recursive: true });
    fs.copyFileSync(source, dest);
    return sizeOf(dest) === sizeOf(source);
  } catch {
    return sizeOf(dest) > 0;   // 拷不动但老的还在，也算能用
  }
}

/**
 * 组装 Update.exe 的命令行（纯函数，方便单测逐条钉住参数）。
 * 有 staged（已下好并校验过的文件）就带 --staged，让它跳过下载直接换；
 * 没有才带 --url 让它自己下 —— 两条路都走同一个更新器。
 */
function updaterArgs(root, { url = '', sha256 = '', size = 0, version = '', staged = '', restart = false, waitMs = 1200, proxy = '', pid = process.pid } = {}) {
  const args = [
    `--target=${path.join(root, 'CoA启动器.exe')}`,
    `--root=${root}`,
    `--pid=${pid}`,
    `--restart=${restart ? 1 : 0}`,
    `--wait-ms=${waitMs}`,
  ];
  if (version) args.push(`--version=${version}`);
  if (sha256) args.push(`--sha256=${sha256}`);
  if (size) args.push(`--size=${size}`);
  if (proxy) args.push(`--proxy=${proxy}`);
  if (staged) args.push(`--staged=${staged}`);
  else if (url) args.push(`--url=${url}`);
  return args;
}

/**
 * 拉起独立更新器——这是自更新唯一的执行入口。
 * 它自己会：强杀启动器整棵进程树（含 portable 外壳与 %TEMP% 内层）→ 确认文件句柄释放 →
 * 下载（或用 --staged 复用已下好的）→ 校验 SHA256 → 替换 → 重启。
 *
 * 关键点：detached + unref。启动器紧接着就会 app.exit(0)，更新器必须活下来继续干活。
 * 启动器是 portable 打包，玩家双击的 exe 只是自解压外壳，真正在跑的是 %TEMP% 里的内层；
 * 外壳在内层退出后还要清理临时目录、期间一直映射着 CoA启动器.exe —— 所以“等进程退出再换”
 * 必须能把外壳也强杀掉，这正是旧方案（只等内层 PID）做不到的事。
 */
function spawnUpdater(root, options = {}) {
  const exe = updaterPath(root);
  if (sizeOf(exe) <= 0) return false;
  const usableStaged = options.staged && sizeOf(options.staged) > 0 ? options.staged : '';
  if (!usableStaged && !options.url) return false;
  const args = updaterArgs(root, { ...options, staged: usableStaged });
  try {
    const child = spawn(exe, args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
//End By leewheel

function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

//By leewheel 2026年11月15日 这里原来有 stageLauncher / spawnTakeover / spawnReplaceHelper 三个函数，
// 分别负责“新版落位”“新 exe 自替换”“launcher-replace.exe 助手替换”。三套并存互相抢文件，
// 全部删除，替换只由 Update.exe 完成（见本文件“独立更新器”段）。
//End By leewheel

//By leewheel 2026年11月15日 performTakeover（新 exe 自己当替换器：等旧 PID → 改名 → 复制自己）也已删除。
// 它只等“内层 PID”，而玩家双击的 portable 外壳还在映射目标文件 → 必然 EBUSY，
// 这正是老大说的“完全做不到稳定自动替换”。替换独占交给 Update.exe。
//End By leewheel

/** 启动时清理：上一轮留下的 .old.exe、老版本遗留的替换助手（删不掉就留着，不影响运行） */
function cleanupLegacy(root) {
  try { fs.rmSync(path.join(root, LEGACY_NAME), { force: true }); } catch { /* 占用中 */ }
  //By leewheel 2026年11月15日 老玩家根目录里还躺着 launcher-replace.exe：替换机制已经拆掉，
  // 这个文件不再有任何用处，启动时顺手清掉，别让它一直挂在发布目录里。
  try { fs.rmSync(path.join(root, LEGACY_HELPER_NAME), { force: true }); } catch { /* 占用中就下次 */ }
}

/** 已落地新版的元数据（下载落位时写入） */
//By leewheel 2026年11月9日 就绪判据改成**先看元数据**：
// 在线更新落位时会写 CoA启动器.new.json（版本 + size + sha256）。只有元数据里的 size 与文件实际大小一致
// 才算“真就绪”；大小对不上（下载中断、磁盘出错、被别的东西覆盖）就认定是坏文件，直接删掉重下，
// 绝不再把半截 exe 顶上去——那会让启动器直接打不开，玩家只能重下整个 375MB。
function readStagedMeta(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'CoA启动器.new.json'), 'utf8')); } catch { return null; }
}

/** 启动时核对已落地的新版：坏包/半截包直接删掉重下，正常的留着等退出时由 Update.exe 换。
 *  ⚠️ 这里**只做校验与清理**，绝不拉起任何替换进程——启动瞬间替换等于“刚打开就被换掉”，
 *  玩家看到的只有窗口闪一下，日志也无从解释；退出时换最干净。 */
function pruneStaged(root) {
  const staged = path.join(root, STAGED_NAME);
  const target = path.join(root, 'CoA启动器.exe');
  if (sizeOf(staged) <= 0) return false;
  const meta = readStagedMeta(root);
  const drop = () => {
    try { fs.rmSync(staged, { force: true }); } catch { /* 删不掉就先留着 */ }
    try { fs.rmSync(path.join(root, 'CoA启动器.new.json'), { force: true }); } catch { /* 同上 */ }
    return false;
  };
  if (meta?.size && sizeOf(staged) !== meta.size) return drop();
  // 自更新落位的包：交给 swapOnQuit（退出时换）
  if (meta?.size) return false;
  // 没有元数据的是老流程遗留（内容更新包里带的 exe）：与目标同尺寸说明早就换过了，删掉
  if (sizeOf(staged) === sizeOf(target)) return drop();
  return false;
}
//End By leewheel

/** 退出前调用：把自更新下载好的新版换上去（不拉新窗口，下次打开就是新版）。
 *  唯一入口是 <root>\Update\Update.exe——它在本进程退出后强杀整棵进程树、确认句柄释放再替换。 */
//By leewheel 2026年11月15日 旧的“助手替换 / 新 exe 自替换”两条兜底已删除：
// 兜底看着安全，实际是三套逻辑抢同一个文件名，反而让替换永远不稳。
function swapOnQuit(root) {
  try {
    const meta = readStagedMeta(root);
    if (!meta?.size) return false;
    const staged = path.join(root, STAGED_NAME);
    if (sizeOf(staged) !== meta.size) return false;
    if (!ensureUpdater(root)) return false;
    return spawnUpdater(root, { staged, sha256: meta.sha256 || '', size: meta.size, version: meta.version || '', restart: false });
  } catch { return false; }
}
//End By leewheel

module.exports = {
  cleanupLegacy, pruneStaged, swapOnQuit, readStagedMeta,
  STAGED_NAME, LEGACY_NAME,
  //By leewheel 2026年11月15日 独立更新器（Update\Update.exe）：替换的唯一入口
  UPDATER_DIR, UPDATER_NAME, updaterPath, ensureUpdater, updaterArgs, spawnUpdater };
