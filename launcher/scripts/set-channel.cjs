'use strict';
//By leewheel 2026年11月17日 构建前切渠道：把 coaChannel 与产物名（artifactName）写进 package.json。
// 为什么写 package.json 而不是单独一个文件：electron-builder 的 build.files 已经把 package.json 打进 asar，
// 运行期 src/main.cjs 直接 require('../package.json').coaChannel 就能读到，不用再抬一条打包路径。
// 用法：node scripts/set-channel.cjs plain|token（每次构建脚本开头都会跑，避免上次留下的渠道串到下一次）。
const fs = require('node:fs');
const path = require('node:path');
const { channelOf, CHANNELS } = require('../src/launcher-channel.cjs');

const wanted = String(process.argv[2] || '').trim().toLowerCase();
if (!CHANNELS[wanted]) {
  console.error(`渠道不合法：${process.argv[2] || '(空)'}（只能是 plain / token）`);
  process.exit(1);
}
const channel = channelOf(wanted);

const file = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
let dirty = false;
if (pkg.coaChannel !== channel.key) { pkg.coaChannel = channel.key; dirty = true; }
// 产物名按渠道分开：捐赠版的 exe 名字里带 Token，玩家在 Release 页面一眼能分清，下载地址也不会互相撞。
const artifactName = channel.assetOf('${version}').replace(/\.exe$/, '.${ext}');
if (pkg.build?.artifactName !== artifactName) { pkg.build.artifactName = artifactName; dirty = true; }
if (dirty) {
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`构建渠道：${channel.label}（coaChannel=${channel.key}，产物名 ${artifactName}）`);
} else {
  console.log(`构建渠道：${channel.label}（coaChannel=${channel.key}）`);
}
