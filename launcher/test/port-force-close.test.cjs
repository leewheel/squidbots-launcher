'use strict';
//By leewheel 2026年11月11日 「端口占用 → 强制关闭」按钮回归测试：
// 这个按钮曾经只挂在开机那一刻的一次性弹窗上；端口在启动器开着之后才被占时，
// 首页只显示一行红字，报错文案却让玩家「用首页的强制关闭占用程序」，按钮根本不存在。
// 这里固化三条硬约束：首页常驻入口、体检可复查、服务端能处理残留实例。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('首页在端口被占用时必须给出「强制关闭占用程序」常驻按钮', () => {
  const home = read('public/js/serverhome.js');
  assert.match(home, /data-action="port-kill"/, '首页必须渲染强制关闭按钮');
  assert.match(home, /data-action="port-rescan"/, '首页必须能手动重新检查端口');
  assert.match(home, /App\.actions\['port-kill'\]/, '强制关闭按钮必须绑定动作');
  assert.match(home, /App\.actions\['port-rescan'\]/, '重新检查按钮必须绑定动作');
});

test('端口体检不再只在开机扫一次，也不再静默吞掉失败', () => {
  const boot = read('public/js/boot.js');
  assert.match(boot, /async function checkPorts\(/, '要有可复查的端口体检函数');
  assert.match(boot, /setInterval\([\s\S]{0,300}checkPorts\(/, '启动器开着时要定时复查');
  assert.match(boot, /api\.onServices\([\s\S]{0,800}checkPorts\(/, '服务状态变化后要复查');
  //By leewheel 2026年11月12日 断言跟着实现走：现在用 && 组合三个条件（外来、非托管、非运行中服务自己的端口）
  assert.match(boot, /busy && !item\.mine && !item\.managed/, '必须把本包残留实例也算作占用');
  assert.match(boot, /service\.state === 'running'[\s\S]{0,120}own\.has\(item\.port\)/, '启动过程中不能把自己正在跑的服务报成占用');
  assert.equal(
    /portsScan\(\)\.then\(list => showPortAlert\(list\)\)\.catch\(\(\) => \{\}\)/.test(boot),
    false,
    '不能再把开机端口体检的失败静默吞掉'
  );
});

test('残留的本包进程也要能被强制关闭（不是启动器拉起的实例）', () => {
  const control = read('src/server-control.cjs');
  assert.match(control, /const managed = this\.children\.has\(service\.id\);/, 'scanPorts 必须区分「本包 exe」与「启动器拉起」');
  //By leewheel 2026年11月12日 优雅停止的判据换成 isOurs：读不到进程路径时靠 children/.state 仍能认定是自己拉起的
  assert.match(control, /this\.isOurs\(service, owner\) && this\.children\.has\(service\.id\)/, '只有托管进程才走优雅停止');
});

test('中文文案键齐全', () => {
  const zh = JSON.parse(read('public/locales/zh.json'));
  assert.equal(zh['home.forceKillPort'], '强制关闭占用程序');
  assert.equal(zh['home.recheckPorts'], '重新检查端口');
});
//End By leewheel
