'use strict';
//By leewheel 2026-11-03
// 首次运行的结构整形（只做一次）：把玩家解压出来的一堆散文件归位成
//   发布目录\
//     CoA启动器.exe
//     Client\        ← 客户端（Ascension.exe、Data、Interface…）
//     Server\        ← 服务端（worldserver.exe、configs、ClientData、mysql…）
//     Update\        ← 以后更新的临时目录
// 规则：认文件名/目录名，绝不移动启动器自己和 .coa-launcher；同名的已有文件不覆盖（保留旧文件并记日志）。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MARKER = '.coa-launcher/layout.json';

// 服务端：这些名字出现在根目录就归到 Server\
const SERVER_FILES = /^(worldserver|authserver|dbimport|map_extractor|vmap4_extractor|vmap4_assembler|mmaps_generator)\.exe$/i;
const SERVER_FILES_EXTRA = /^(1\.MySQL\.bat|my\.ini|RELEASE\.json|mmaps-config\.yaml|dc_test_dungeons\.json)$/i;
const SERVER_DLL = /^(libmysql|libcurl|legacy|libcrypto-3-x64|libssl-3-x64|libeay32|libssl32|ssleay32)\.dll$/i;
const SERVER_DIRS = /^(configs|ClientData|mysql|Settings|logs|Crashes|reference|tools|Database|Scripts|Runtime|Assembler)$/i;

// 客户端：这些名字出现在根目录就归到 Client\
const CLIENT_EXES = /^(ascension|wow|wow-64|ascension-64|mmgr64|wowerror|divxtac)\.exe$/i;
const CLIENT_DLL = /^(d3d8|d3d9|d3d10core|d3d11|dxgi|dxvk|discord_game_sdk|divxdecoder|xviddecoder|extensions|memorybridge)\.(dll|conf|log)$/i;
const CLIENT_DIRS = /^(Data|Interface|Fonts|Fonts\.loose|WTF|Cache|Language|Mapblp|x64|DLL_Logs|Screenshots|错误截图|Document)$/i;
const CLIENT_FILES = /^(realmlist\.wtf|ascension\.ok|client-release\.json|hd_patches_description\.txt|readme\.txt|\.coa-races\.lock)$/i;

const isLauncher = name => /^coa.*\.exe$/i.test(name) || /launcher/i.test(name) || name === 'Update' || name === '.coa-launcher';

async function readMarker(root) {
  try { return JSON.parse(await fsp.readFile(path.join(root, MARKER), 'utf8')); } catch { return null; }
}
async function writeMarker(root, value) {
  const file = path.join(root, MARKER);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2));
}

// 判断根目录是否已经是标准结构
async function isNormalized(root) {
  const has = name => fs.existsSync(path.join(root, name));
  return has('Client') && has('Server');
}

// 把内容搬进目标目录；目标已存在同名文件时不覆盖，改名为 名字.旧 保留
async function moveInto(source, targetDir, log) {
  await fsp.mkdir(targetDir, { recursive: true });
  let target = path.join(targetDir, path.basename(source));
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    target = `${target}.旧-${stamp}`;
    log(`同名已存在，保留旧文件：${path.basename(source)} → ${path.basename(target)}`);
  }
  try {
    await fsp.rename(source, target);
  } catch {
    // 跨盘/被占用：退化为复制后删除
    await fsp.cp(source, target, { recursive: true });
    await fsp.rm(source, { recursive: true, force: true });
  }
  log(`移动 ${path.basename(source)} → ${path.relative(path.dirname(targetDir), target)}`);
  return target;
}

// 主入口：returns { done: bool, moved: [], skipped: [], reason }
async function normalizeLayout(root, { log = () => {} } = {}) {
  const marker = await readMarker(root);
  if (marker?.normalized) return { done: false, reason: '已经整形过', moved: [] };
  if (await isNormalized(root)) {
    await writeMarker(root, { normalized: true, at: new Date().toISOString(), note: '启动时已是标准结构' });
    return { done: false, reason: '已是标准结构', moved: [] };
  }
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  if (!entries.length) return { done: false, reason: '目录为空', moved: [] };

  const moved = [];
  const skipped = [];
  for (const entry of entries) {
    const name = entry.name;
    if (isLauncher(name)) continue;
    const full = path.join(root, name);
    let target = '';
    if (entry.isDirectory()) {
      if (SERVER_DIRS.test(name)) target = path.join(root, 'Server');
      else if (CLIENT_DIRS.test(name)) target = path.join(root, 'Client');
    } else if (SERVER_FILES.test(name) || SERVER_FILES_EXTRA.test(name) || SERVER_DLL.test(name)) target = path.join(root, 'Server');
    else if (CLIENT_EXES.test(name) || CLIENT_DLL.test(name) || CLIENT_FILES.test(name)) target = path.join(root, 'Client');
    else if (/\.(mpq|MPQ)$/.test(name)) target = path.join(root, 'Client', 'Data');
    else if (/\.(dbc)$/i.test(name)) target = path.join(root, 'Server', 'ClientData', 'dbc');
    else if (/\.sql$/i.test(name)) target = path.join(root, 'Server', 'Database');
    if (!target) { skipped.push(name); continue; }
    try {
      await moveInto(full, target, log);
      moved.push({ name, to: path.relative(root, target) });
    } catch (error) {
      log(`移动失败：${name}（${error.message}）`);
      skipped.push(name);
    }
  }
  // 保证两个目录都在（哪怕这次没搬东西）
  await fsp.mkdir(path.join(root, 'Client'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Server'), { recursive: true });
  await writeMarker(root, { normalized: true, at: new Date().toISOString(), moved: moved.length, skipped });
  return { done: moved.length > 0, moved, skipped, reason: moved.length ? `已归位 ${moved.length} 项` : '没有需要归位的文件' };
}

module.exports = { normalizeLayout, isNormalized, readMarker, writeMarker, MARKER };
