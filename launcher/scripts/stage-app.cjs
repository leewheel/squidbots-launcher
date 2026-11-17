'use strict';
//By leewheel 2026年11月6日 打包含混淆：把 src/ 与 public/ 复制到 build/app，用 javascript-obfuscator 处理后
// 再由 electron-builder 从 build/app 打包。源码目录保持可读，只有发出去的 asar 是混淆过的。
// 配合 electronFuses（asar 完整性 + 只从 asar 加载），改过的 asar 直接启动失败。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build', 'app');

const OPTIONS = {
  compact: true,
  simplify: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  unicodeEscapeSequence: false,
};

async function copyTree(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    // 不把备份/映射/临时文件打进包：*.bak、*.broken.* 是老版本源码，*.map 能还原源码
    if (/\.(bak|map)$/i.test(entry.name) || /\.broken\./i.test(entry.name)) continue;
    if (entry.isDirectory()) await copyTree(src, dst);
    else await fsp.copyFile(src, dst);
  }
}

function obfuscate(file) {
  const code = fs.readFileSync(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, { ...OPTIONS, target: file.endsWith('.js') && file.includes(`${path.sep}public${path.sep}`) ? 'browser' : 'node' });
  fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
}

(async () => {
  await fsp.rm(path.join(root, 'build'), { recursive: true, force: true });
  await copyTree(path.join(root, 'src'), path.join(out, 'src'));
  await copyTree(path.join(root, 'public'), path.join(out, 'public'));
  if (fs.existsSync(path.join(root, 'editions'))) await copyTree(path.join(root, 'editions'), path.join(out, 'editions'));
  await fsp.copyFile(path.join(root, 'launcher.config.json'), path.join(out, 'launcher.config.json'));
  // electron-builder 从“开发用的 package.json”读 build 配置，app 目录里的那份不能带 build/scripts/devDependencies
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const staged = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    author: pkg.author,
    main: pkg.main,
  };
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(staged, null, 2), 'utf8');

  let count = 0;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  for (const file of walk(out)) {
    //By leewheel 2026年11月6日 只混淆渲染层（public/js）：
    // 主进程 src/*.cjs 大量用 require(...).xxx 动态取属性，混淆器切字符串后会把属性名拼坏
    // （实弹两次：fs[...+"nc"] is not a function / require(...)[...+ "chema"] is not a function，服务端都起不来）。
    // 主进程的防护交给 asar 完整性校验：改过的包直接启动失败。
    const isRenderer = /[\\/]public[\\/]js[\\/].*\.js$/i.test(file);
    if (isRenderer) { obfuscate(file); count++; }
  }
  console.log(`已混淆 ${count} 个脚本 → ${path.relative(root, out)}`);
})().catch(error => { console.error('混淆失败：', error); process.exit(1); });
