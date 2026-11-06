//By leewheel 2026年11月6日 启动器版本号规则：1.0.年月日时（例：2026 年 11 月 6 日 20 点 → 1.0.2026110620）
// 每次构建前自动写入 package.json 的 version，界面上状态栏直接显示这个号。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

const now = process.env.COA_VERSION_TIME ? new Date(process.env.COA_VERSION_TIME) : new Date();
const pad = value => String(value).padStart(2, '0');
const version = `1.0.${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}`;

let dirty = false;
if (pkg.version !== version) { pkg.version = version; dirty = true; }
//By leewheel 2026年11月6日 便携版解压目录必须带版本号：
// 便携版 exe 会把自身解压到 %TEMP%\<解压目录名> 再运行，目录名固定的话新启动器会**复用旧的解压内容**，
// 结果就是“exe 换了、跑的还是老代码”（实弹：界面/功能都还是上一版）。带上版本号，每次都是新的解压目录。
const unpackDirName = `CoALauncherLite-${version}`;
if (pkg.build?.portable && pkg.build.portable.unpackDirName !== unpackDirName) {
  pkg.build.portable.unpackDirName = unpackDirName;
  dirty = true;
}
if (dirty) {
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`启动器版本号：${version}（解压目录 ${unpackDirName}）`);
} else {
  console.log(`启动器版本号（未变）：${version}`);
}
