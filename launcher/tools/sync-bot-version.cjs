'use strict';
// 同步机器人版本号：从核心源码树的 mod-playerbots 读取版本，写入 Server 的
// configs/modules/playerbots.conf 固定注释行。打包发布前在本机跑一次，
// 玩家手里的启动器/检查页就能从这一行读到机器人版本（源码树不会随包发布）。
// 用法：node tools/sync-bot-version.cjs [--source <mod-playerbots 目录>] <Server根目录>...
//By leewheel 2026年11月3日
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = 'G:/WOW-COA/SourceAndBuild/azerothcore-wotlk-coa/modules/mod-playerbots';
const MARKER = 'AiPlayerbot.Version';

// 版本来源 1：src 里 Playerbots.cpp 的 COA_BOTS_VERSION = "x.y.z"（与 .playerbots version 命令同源）
function versionFromCpp(source) {
  for (const candidate of ['src/Playerbots.cpp', 'src/Script/Playerbots.cpp']) {
    const file = path.join(source, ...candidate.split('/'));
    if (!fs.existsSync(file)) continue;
    const match = /COA_BOTS_VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
    if (match) return match[1];
  }
  return '';
}
// 版本来源 2：CHANGELOG_COA.md 顶部的 "## vX.Y.Z"
function versionFromChangelog(source) {
  const text = fs.readFileSync(path.join(source, 'CHANGELOG_COA.md'), 'utf8');
  const match = /^\s*##\s*v?(\d+\.\d+(?:\.\d+)?[^\s)]*)/m.exec(text);
  return match ? match[1] : '';
}

function syncConf(root, version) {
  const file = path.join(root, 'configs', 'modules', 'playerbots.conf');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const original = fs.readFileSync(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const line = `# ${MARKER} = ${version} （CoA 机器人版本，由启动器同步工具写入，请勿手改）`;
  let text;
  const re = new RegExp(`^#\\s*${MARKER}\\s*=.*$`, 'm');
  if (re.test(original)) {
    text = original.replace(re, line); // 幂等：替换已有的固定行
  } else {
    // 插到文件最前（纯注释行，worldserver 不解析，不产生任何配置告警）
    text = line + eol + (original.startsWith('#') || original.startsWith('\uFEFF') ? original : original);
  }
  if (text !== original) fs.writeFileSync(file, text);
  return { file, changed: text !== original };
}

function main() {
  const argv = process.argv.slice(2);
  let source = DEFAULT_SOURCE;
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') source = argv[++i];
    else roots.push(argv[i]);
  }
  if (!roots.length) {
    console.error('用法：node tools/sync-bot-version.cjs [--source <mod-playerbots 目录>] <Server根目录>...');
    process.exit(1);
  }
  const version = versionFromCpp(source) || versionFromChangelog(source);
  if (!version) {
    console.error(`在 ${source} 里没读到版本号（Playerbots.cpp 的 COA_BOTS_VERSION 与 CHANGELOG_COA.md 都没有）。`);
    process.exit(1);
  }
  console.log(`机器人版本：v${version}（来自 ${source}）`);
  for (const root of roots) {
    const { file, changed } = syncConf(root, version);
    console.log(`${changed ? '已写入' : '无变化'} ${file}`);
  }
}
main();
