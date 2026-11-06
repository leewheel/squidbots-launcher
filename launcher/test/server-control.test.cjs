'use strict';
//By leewheel 2026年11月4日 服务归属判定测试：端口后面的进程必须是“本服务自己的 exe”才算我们的服务，
// 系统里、别的项目里的 mysqld.exe 一律不算（老大规则：不属于 Server\mysql 的 MySQL 不许显示为运行状态）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerControl, ensureWorldConsole } = require('../src/server-control.cjs');

const ROOT = path.resolve('D:\\CoA\\Server');
const control = () => new ServerControl({
  root: ROOT,
  services: [
    { id: 'mysql', name: 'MySQL 数据库', port: 3396, exe: 'mysql/bin/mysqld.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null },
    { id: 'world', name: '世界服务器', port: 8085, exe: 'worldserver.exe', args: [], cwd: '.', start: null, stop: null,
      alternatives: [{ exists: 'CoA-Bots/Core/worldserver.exe', label: 'with CoA Bots', start: { exe: 'CoA-Bots/Core/worldserver.exe', args: [], timeout: 60 } }] },
    { id: 'relay', name: '管理脚本', port: 3443, exe: '', args: [], cwd: '.', start: { exe: 'Scripts/manage.exe', args: [], timeout: 60 }, stop: null, alternatives: [] },
  ],
});

const service = id => control().services.find(item => item.id === id);

test('MySQL counts as ours only when it is the repack own mysql\\bin\\mysqld.exe', () => {
  const found = control();
  const mysql = service('mysql');
  assert.equal(found.ownsExe(mysql, path.join(ROOT, 'mysql', 'bin', 'mysqld.exe')), true, '本包的数据库');
  assert.equal(found.ownsExe(mysql, path.join(ROOT, 'mysql', 'BIN', 'MYSQLD.EXE')), true, '大小写不同也算');
  assert.equal(found.ownsExe(mysql, path.resolve('E:\\OtherProject\\Server\\mysql\\bin\\mysqld.exe')), false, '别的项目的 MySQL 不算');
  assert.equal(found.ownsExe(mysql, path.resolve('C:\\Program Files\\MySQL\\bin\\mysqld.exe')), false, '系统装的 MySQL 不算');
  assert.equal(found.ownsExe(mysql, path.join(ROOT, 'Backups', 'mysqld.exe')), false, '包内别处的同名程序不算');
  assert.equal(found.ownsExe(mysql, ''), false, '读不到路径不算');
});

test('a service with an alternative exe accepts both of them and nothing else', () => {
  const found = control();
  const world = service('world');
  assert.equal(found.ownsExe(world, path.join(ROOT, 'worldserver.exe')), true);
  assert.equal(found.ownsExe(world, path.join(ROOT, 'CoA-Bots', 'Core', 'worldserver.exe')), true, '带机器人的世界服也是本服务');
  assert.equal(found.ownsExe(world, path.resolve('F:\\Another\\worldserver.exe')), false);
});

test('a script-started service falls back to "inside the repack folder"', () => {
  const found = control();
  const relay = service('relay');
  assert.equal(found.ownsExe(relay, path.join(ROOT, 'Scripts', 'manage.exe')), true);
  assert.equal(found.ownsExe(relay, path.resolve('E:\\Windows\\evil.exe')), false);
});

//By leewheel 2026-11-05 RA 远程控制台自愈回归测试：主服 conf 里 Ra.Enable = 0 会让控制台命令全部失灵
function tempServer(t, conf, raPort = 3443) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-ra-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['configs', 'Settings']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'worldserver.exe'), ''); // 让布局识别成发布版 flat 结构
  fs.writeFileSync(path.join(root, 'configs', 'worldserver.conf'), conf);
  fs.writeFileSync(path.join(root, 'Settings', 'repack.json'), JSON.stringify({ raPort, raUsername: 'local', raPassword: 'local' }));
  return root;
}
const confOf = root => fs.readFileSync(path.join(root, 'configs', 'worldserver.conf'), 'utf8');
const backupsOf = root => fs.readdirSync(path.join(root, 'configs')).filter(name => name.startsWith('worldserver.conf.bak-'));

test('主服 Ra.Enable = 0 时，启动前自动打开 RA 并留一份备份', async t => {
  const root = tempServer(t, 'LogsDir = "logs"\r\nRa.Enable = 0\r\nRa.IP = "127.0.0.1"\r\nRa.Port = 3443\r\n');
  await ensureWorldConsole(root);
  assert.match(confOf(root), /Ra\.Enable = 1/);
  assert.equal(backupsOf(root).length, 1, '改前必须留备份');
});

test('Ra.Port 与 repack.json 不一致时对齐，RA 只绑本机回环地址', async t => {
  const root = tempServer(t, 'Ra.Enable = 0\nRa.IP = "0.0.0.0"\nRa.Port = 9999\n', 3543);
  await ensureWorldConsole(root);
  const conf = confOf(root);
  assert.match(conf, /Ra\.Enable = 1/);
  assert.match(conf, /Ra\.Port = 3543/);
  assert.match(conf, /Ra\.IP = "127\.0\.0\.1"/);
});

test('配置本来就正确时不动文件、不产生备份', async t => {
  const conf = 'Ra.Enable = 1\nRa.IP = "127.0.0.1"\nRa.Port = 3443\n';
  const root = tempServer(t, conf);
  await ensureWorldConsole(root);
  assert.equal(confOf(root), conf);
  assert.equal(backupsOf(root).length, 0);
});

test('配置里缺 Ra 键时补齐，不破坏已有内容', async t => {
  const root = tempServer(t, 'LogsDir = "logs"\n');
  await ensureWorldConsole(root);
  const conf = confOf(root);
  assert.match(conf, /LogsDir = "logs"/);
  assert.match(conf, /Ra\.Enable = 1/);
  assert.match(conf, /Ra\.Port = 3443/);
  assert.match(conf, /Ra\.IP = "127\.0\.0\.1"/);
});
//End By leewheel
