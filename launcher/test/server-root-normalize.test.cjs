//By leewheel 2026年11月11日 「服务端目录纠偏 + 缺文件报错给绝对路径」的回归测试。
// 起因（玩家反馈，老大转来截图）：更新时报「MySQL 数据库: mysql\bin\mysqld.exe is missing」，
// 而文件明明在 Server\mysql\bin 下。两个问题：
//   ① 调用方把「整合包根」当成了「服务端根」，路径解析成 <整合包>\mysql\bin\mysqld.exe；
//   ② 报错只印相对路径 mysql\bin\mysqld.exe，看起来就像启动器跑到 mysql\bin 目录里去找 mysql。
// 现在：ServerControl 按布局自动纠正目录，报错一律印绝对路径。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerControl, normalizeServerRoot, serverDirIn } = require('../src/server-control.cjs');

const SERVICES = [{ id: 'mysql', name: 'MySQL 数据库', exe: 'mysql/bin/mysqld.exe', args: [], port: 39411, cwd: '.', startTimeout: 10 }];

// 造一个整合包：<pack>/Server/mysql/bin/mysqld.exe，可选 worldserver.exe
function makePack({ withMysqld = true, withWorld = true } = {}) {
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-root-'));
  const server = path.join(pack, 'Server');
  fs.mkdirSync(path.join(server, 'mysql', 'bin'), { recursive: true });
  if (withMysqld) fs.writeFileSync(path.join(server, 'mysql', 'bin', 'mysqld.exe'), 'stub');
  if (withWorld) fs.writeFileSync(path.join(server, 'worldserver.exe'), 'stub');
  return { pack, server };
}

test('传整合包根时自动纠正为 <包>\\Server', () => {
  const { pack, server } = makePack();
  assert.equal(normalizeServerRoot(pack), server);
  const control = new ServerControl({ root: pack, services: SERVICES });
  assert.equal(control.root, server, 'mysql 必须在 <包>\\Server\\mysql\\bin 下找到');
  assert.equal(control.rootGiven, pack, '原始路径要留着，报错时才说得清');
});

test('传服务端根本身时不动它', () => {
  const { server } = makePack();
  assert.equal(normalizeServerRoot(server), server);
  assert.equal(new ServerControl({ root: server, services: SERVICES }).root, server);
});

test('两个目录都没有 mysqld 时不瞎猜，保持原样', () => {
  const { pack } = makePack({ withMysqld: false, withWorld: false });
  assert.equal(normalizeServerRoot(pack), pack);
});

test('缺少 mysqld.exe 的报错必须给出绝对路径，不能只有相对路径', async () => {
  const { pack } = makePack({ withMysqld: false, withWorld: false });
  const control = new ServerControl({ root: pack, services: SERVICES });
  const missing = path.join(pack, 'mysql', 'bin', 'mysqld.exe');
  await assert.rejects(control.start('mysql'), error => {
    assert.match(error.message, /找不到/, '报错要说清“找不到什么”');
    assert.ok(error.message.includes(missing), `报错里要有绝对路径 ${missing}`);
    assert.match(error.message, /整合包/, '要告诉玩家下一步做什么');
    return true;
  });
});

test('源码不得再出现只印相对路径的缺文件提示', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'server-control.cjs'), 'utf8');
  assert.ok(!/is missing\. Install or repair the repack first/.test(code), '旧的英文提示会把绝对路径藏起来');
  assert.match(code, /找不到 \$\{exe\}/, 'startOnce 的提示要带解析后的绝对路径');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.ok(!/Server\\\\\\\\mysql\\\\\\\\bin\\\\\\\\mysqld\.exe --defaults-file/.test(main), '更新日志不准再写死相对路径');
  assert.match(main, /normalizeServerRoot/, '更新路径要复用同一套目录纠偏');
});

test('serverDirIn：发布版取 <根>\\Server', () => {
  const { pack, server } = makePack();
  assert.equal(serverDirIn(pack), server);
});

test('serverDirIn：根目录本身就是服务端目录时不许拼成 Server\\Server', () => {
  const { server } = makePack();
  assert.equal(serverDirIn(server), server);
});

test('serverDirIn：还没装全时仍指向 <根>\\Server，交给报错说清楚', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-root-empty-'));
  assert.equal(serverDirIn(empty), path.join(empty, 'Server'));
});
