'use strict';
//By leewheel 2026年11月15日 独立更新器（Update\Update.exe）的契约测试。
// 背景：启动器是 electron-builder portable 打包，玩家双击的 exe 只是自解压外壳，
// 真正在跑的是 %TEMP% 里的内层。旧方案“等内层 PID 退出 → 改名”会撞外壳还没释放的文件映射，
// 所以替换统一交给独立进程 Update.exe（强杀整棵进程树 + 独占打开判据 + 替换 + 重启）。
// 这里钉住“启动器到底怎么把活交给它”——参数错一个，更新器就白跑一趟。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const swap = require('../src/launcher-swap.cjs');

const ROOT = 'G:\\WOW-COA\\COA-PUBLISH-REPACK';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coa-updater-'));
}

test('更新器路径固定在 <root>\\LauncherUpdate\\Update.exe（不能放 Update\\，那是更新包临时目录）', () => {
  assert.equal(swap.UPDATER_DIR, 'LauncherUpdate');
  assert.equal(swap.UPDATER_NAME, 'Update.exe');
  assert.equal(swap.updaterPath(ROOT), path.join(ROOT, 'LauncherUpdate', 'Update.exe'));
});

test('基本参数：目标、根目录、PID、重启开关都要按要求传', () => {
  const args = swap.updaterArgs(ROOT, { staged: 'C:\\x\\new.exe', version: '1.0.202611151605', restart: true });
  const joined = args.join(' ');
  assert.ok(args.includes(`--target=${path.join(ROOT, 'CoA启动器.exe')}`), '目标必须指向玩家的 CoA启动器.exe');
  assert.ok(args.includes(`--root=${ROOT}`), 'root 必须是安装根');
  assert.ok(joined.includes(`--pid=${process.pid}`), '要带上启动器自己的 PID，更新器才知道等谁退出');
  assert.ok(args.includes('--restart=1'), '点了更新并重启，就必须让更新器把新启动器拉起来');
  assert.ok(args.includes('--version=1.0.202611151605'));
});

test('不重启时要显式传 --restart=0（不能靠默认值猜）', () => {
  const args = swap.updaterArgs(ROOT, { staged: 'C:\\x\\new.exe' });
  assert.ok(args.includes('--restart=0'));
});

test('已经下好并校验过的文件优先复用，避免重复下载 390MB', () => {
  const args = swap.updaterArgs(ROOT, { staged: 'C:\\x\\new.exe', url: 'https://example.com/a.exe' });
  assert.ok(args.some(item => item === '--staged=C:\\x\\new.exe'), '有 staged 就用 staged');
  assert.ok(!args.some(item => item.startsWith('--url=')), '有 staged 时不该再带下载地址，否则会白下一遍');
});

test('没有 staged 时交给更新器自己下（老大要求：Update.exe 自己下载）', () => {
  const args = swap.updaterArgs(ROOT, { url: 'https://example.com/a.exe', sha256: 'abc123', size: 4096 });
  assert.ok(args.includes('--url=https://example.com/a.exe'));
  assert.ok(args.includes('--sha256=abc123'), '校验值必须一起给，更新器下完要核对');
  assert.ok(args.includes('--size=4096'));
  assert.ok(!args.some(item => item.startsWith('--staged=')));
});

test('代理可按需透传（国内直连 GitHub 下不动）', () => {
  const args = swap.updaterArgs(ROOT, { staged: 'C:\\x\\new.exe', proxy: '127.0.0.1:7897' });
  assert.ok(args.includes('--proxy=127.0.0.1:7897'));
});

test('没给来源时不产生任何来源参数，由 spawnUpdater 直接拒绝', () => {
  const args = swap.updaterArgs(ROOT, {});
  assert.ok(!args.some(item => item.startsWith('--staged=')));
  assert.ok(!args.some(item => item.startsWith('--url=')));
  const root = tmpDir();
  try { fs.mkdirSync(path.join(root, 'LauncherUpdate'), { recursive: true }); fs.writeFileSync(path.join(root, 'LauncherUpdate', 'Update.exe'), 'stub'); } catch { /* ignore */ }
  assert.equal(swap.spawnUpdater(root, {}), false, '既没有已下载文件也没有地址，不能瞎拉起进程');
});

test('ensureUpdater 会把随包的 Update.exe 落到 <root>\\LauncherUpdate\\', () => {
  const root = tmpDir();
  assert.equal(swap.ensureUpdater(root), true, 'tools 里有 Update.exe，就必须能落位');
  const dest = swap.updaterPath(root);
  assert.ok(fs.existsSync(dest), '目标是 <root>\\LauncherUpdate\\Update.exe');
  assert.ok(fs.statSync(dest).size > 0, '不能是空文件');
  // 老位置（Update\Update.exe）必须被清掉：那是更新包临时目录
  assert.ok(!fs.existsSync(path.join(root, 'Update', 'Update.exe')));
  // 再调一次不该出错（幂等）
  assert.equal(swap.ensureUpdater(root), true);
});

test('中文与空格路径原样传递（安装目录可能是 Program Files\\征服艾泽拉斯）', () => {
  const weird = 'C:\\Program Files\\征服艾泽拉斯\\CoA';
  const args = swap.updaterArgs(weird, { staged: 'C:\\a b\\new.exe' });
  assert.ok(args.includes(`--target=${path.join(weird, 'CoA启动器.exe')}`));
  assert.ok(args.includes('--staged=C:\\a b\\new.exe'), '空格不能被提前拆开，交给 spawn 去加引号');
});
