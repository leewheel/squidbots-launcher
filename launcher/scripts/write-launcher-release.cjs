//By leewheel 2026年11月9日 打包后生成「启动器发版清单」launcher-release.json。
// 为什么要有这个东西：启动器自更新要一条**最轻最稳**的通道。GitHub API 在国内经常连不上、还会限流；
// 而 jsDelivr（国内有节点）能直接读仓库里的纯文本文件，几十字节，秒开。
// 所以发版流程固定为：
//   1) npm run dist:obf / dist:obf:token → 产出 dist\CoA-Launcher[-Token]-<版本号>.exe，本脚本自动写清单；
//   2) 把对应清单提交到 main（jsDelivr 立刻能读到）；
//   3) 在 GitHub 建 Release：标题前缀、tag、资产名按渠道走（见 src/launcher-channel.cjs）。
// 数据全部实测得来（sha256 现算、size 现读），不靠人手填，避免发出去的清单和 exe 对不上。
//By leewheel 2026年11月17日 双渠道：标准版写 launcher-release.json、捐赠版写 launcher-release-token.json，
// 两份清单各自只被自己那一路启动器读，线上互不覆盖。跑哪个渠道由 package.json 的 coaChannel 决定
// （dist:obf / dist:obf:token 开头都会先跑 set-channel.cjs，不会串）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { channelOf } = require('../src/launcher-channel.cjs');

const launcherDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(launcherDir, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(launcherDir, 'package.json'), 'utf8'));
const channel = channelOf(pkg.coaChannel);
const version = String(pkg.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号不合法：${version}（应为 1.0.yyyymmddHHMM）`);
  process.exit(1);
}

const exeName = channel.assetOf(version);
const exePath = path.join(launcherDir, 'dist', exeName);
if (!fs.existsSync(exePath)) {
  // 捐赠版：electron-builder 的 artifactName 由 set-channel 写进 package.json，正常应直接产出带 Token 的名字；
  // 万一构建用了旧配置（产出 CoA-Launcher-<版本号>.exe），这里补一次改名，别让清单指向不存在的文件。
  const plainName = `CoA-Launcher-${version}.exe`;
  const plainPath = path.join(launcherDir, 'dist', plainName);
  if (channel.key === 'token' && fs.existsSync(plainPath)) {
    fs.renameSync(plainPath, exePath);
    console.log(`已把 ${plainName} 改名为 ${exeName}`);
  } else {
    console.error(`找不到安装包：${exePath}\n请先运行 npm run ${channel.key === 'token' ? 'dist:obf:token' : 'dist:obf'}`);
    process.exit(1);
  }
}

const stat = fs.statSync(exePath);
// 375MB 的包不能一次性 readFileSync 再逐字节遍历（3.75 亿次迭代，要跑十几分钟）：分块读、块级喂 hash
const hash = crypto.createHash('sha256');
{
  const fd = fs.openSync(exePath, 'r');
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
}
const sha256 = hash.digest('hex');

// 发版说明：命令行 --notes "…" 优先，其次读 dist\release-notes.txt，最后用一句占位
const notesArgIndex = process.argv.indexOf('--notes');
const notesFile = path.join(launcherDir, 'dist', 'release-notes.txt');
const notes = notesArgIndex > 0
  ? String(process.argv[notesArgIndex + 1] || '')
  : (fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : `启动器 ${version}`);

const manifest = {
  version,
  title: `${channel.titlePrefix}${version}`,
  asset: exeName,
  tag: channel.tagOf(version),
  channel: channel.key,
  size: stat.size,
  sha256,
  notes,
  at: new Date().toISOString(),
};

// 两处都写：dist\ 里留一份给发版人看，仓库根写一份给 jsDelivr 读（git add 时带上）
for (const target of [path.join(launcherDir, 'dist', channel.manifest), path.join(repoRoot, channel.manifest)]) {
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// 发版指引：把「点哪几下」写清楚，省得每次想。
const guide = `# COA 启动器 ${version}（${channel.label}）发版清单

## 1. 文件
- 安装包：${exePath}
- 大小：${stat.size} 字节（${(stat.size / 1048576).toFixed(1)} MB）
- sha256：${sha256}

## 2. 提交清单（jsDelivr 通道）
把 \`${path.join(repoRoot, channel.manifest)}\` 提交到 main 分支。
${channel.label}启动器启动时会先读 https://cdn.jsdelivr.net/gh/leewheel/squidbots-launcher@main/${channel.manifest}
（标准版与捐赠版是**两份不同清单**，互不覆盖；只提交自己这一份就行）

## 3. 建 GitHub Release
- 页面：https://github.com/leewheel/squidbots-launcher/releases/new
- **Release title 必须是**：${channel.titlePrefix}${version}
- Tag：${channel.tagOf(version)}
- 资产：只上传 \`${exeName}\`
- 说明里带上 sha256，启动器会用它做二次校验：
  \`${exeName} sha256=${sha256}\`

## 4. 验证
同渠道的老版本启动器打开 → 启动约 1.5 秒后自动检查 → 自动下载 → 横幅显示「X 秒后自动重启安装」→
**自己重启换成新版**（不停服务端进程）。另一渠道的启动器不会看到这个版本。
`;
fs.writeFileSync(path.join(launcherDir, 'dist', `发版说明_${channel.key}_${version}.md`), guide, 'utf8');

console.log(`发版清单已生成（${channel.label}）：`);
console.log(`  版本   ${version}`);
console.log(`  标题   ${channel.titlePrefix}${version}   tag ${channel.tagOf(version)}`);
console.log(`  资产   ${exeName}`);
console.log(`  大小   ${stat.size} 字节`);
console.log(`  sha256 ${sha256}`);
console.log(`  写入   dist\\${channel.manifest}`);
console.log(`  写入   ${path.join(repoRoot, channel.manifest)}（发版时提交到 main）`);
