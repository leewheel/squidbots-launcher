//By leewheel 2026年11月6日 启动器版本号规则：1.0.年月日时分（例：2026 年 11 月 8 日 13:26 → 1.0.202611081326）
// 每次构建前自动写入 package.json 的 version，界面上状态栏直接显示这个号。
//By leewheel 2026年11月8日 精确到分钟：原来只到小时，同一小时内连打两次版本号一样，
// 便携版解压目录（unpackDirName）也就一样 —— 会复用上一次的解压内容，出现“exe 换了、跑的
// 还是老代码”（实弹：13:18 与 13:26 两次构建撞号）。带上分钟，每次构建都唯一。
//By leewheel 2026年11月8日 同一分钟内连打两次还是会撞（实弹：16:44 连打两次都是 …1644，
// 第二次的改动根本没生效）。这里跟上一版比一下：算出来的号不比上一版新，就自动往后顺延一分钟，
// 保证「每构建一次版本号一定不同」，不用人记着等一分钟。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

const now = process.env.COA_VERSION_TIME ? new Date(process.env.COA_VERSION_TIME) : new Date();
const pad = value => String(value).padStart(2, '0');
const stampOf = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
const dateOfStamp = stamp => new Date(
  Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)),
  Number(stamp.slice(8, 10)), Number(stamp.slice(10, 12)));

let stamp = stampOf(now);
const previous = /^1\.0\.(\d{12})$/.exec(String(pkg.version || ''));
if (previous && Number(previous[1]) >= Number(stamp)) {
  // 同一分钟（或系统时间被往回调）：以旧号为准往后顺延，直到严格大于它
  const bumped = new Date(dateOfStamp(previous[1]).getTime() + 60000);
  stamp = stampOf(bumped);
  console.log(`注意：本次算出的号 ${stampOf(now)} 不比上一版 ${previous[1]} 新，已顺延到 ${stamp}`);
}

const version = `1.0.${stamp}`;

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
  console.log(`启动器版本号：${version}`);
}
