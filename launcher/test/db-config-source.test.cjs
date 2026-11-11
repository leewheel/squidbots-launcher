//By leewheel 2026年11月11日 数据库地址来源的回归测试。
// 老大明确：MySQL 就在 Server\mysql\bin，启动参数就在 Server\my.ini。
// 玩家反馈的「连不上数据库 mysql\admin-client.ini 里的地址」就是把这层关系搞错了：
// 端口该跟 my.ini，用户与库名该跟 configs\worldserver.conf，那个 ini 只配在没连接串时借账号。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const releaseUpdate = require('../src/release-update.cjs');

function makeRoot({ iniPort, iniAccount = true, conf = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-dbcfg-'));
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mysql', 'bin'), { recursive: true });
  if (iniPort) fs.writeFileSync(path.join(root, 'my.ini'), `[mysqld]\nport = ${iniPort}\n`);
  if (iniAccount) {
    // 故意把 ini 里的端口写成 3999：它不该被当成数据库端口
    fs.writeFileSync(path.join(root, 'mysql', 'admin-client.ini'), '[client]\nhost=127.0.0.1\nport=3999\nuser=trinity\npassword=trinity\n');
  }
  fs.writeFileSync(path.join(root, 'configs', 'worldserver.conf'), conf);
  return root;
}

test('端口跟 Server/my.ini，不跟 worldserver.conf 里的旧端口', () => {
  const root = makeRoot({ iniPort: 3397, conf: 'WorldDatabaseInfo = "127.0.0.1;3396;acore;acore;acore_world"\n' });
  const world = releaseUpdate.readDbConfig(root).world;
  assert.equal(world.port, 3397, 'my.ini 说 3397 就必须连 3397');
  assert.equal(world.user, 'acore', '用户仍取 worldserver.conf');
});

test('worldserver.conf 不带引号也能解析出来', () => {
  const root = makeRoot({ iniPort: 3396, conf: 'WorldDatabaseInfo = 127.0.0.1;3396;acore;acore;acore_world\n' });
  const world = releaseUpdate.readDbConfig(root).world;
  assert.equal(world.user, 'acore');
  assert.equal(world.db, 'acore_world');
});

test('worldserver.conf 没有连接串时，用 my.ini 的端口 + 借来的账号', () => {
  const root = makeRoot({ iniPort: 3401, conf: '# 一个连接串都没有\n' });
  const world = releaseUpdate.readDbConfig(root).world;
  assert.equal(world.port, 3401, '没有连接串也要按 my.ini 的端口拼');
  assert.equal(world.user, 'trinity', '账号借 admin-client.ini 的 [client]');
});

test('连 admin-client.ini 都不存在时也不许崩', () => {
  const root = makeRoot({ iniPort: 3401, iniAccount: false, conf: '' });
  const world = releaseUpdate.readDbConfig(root).world;
  assert.equal(world.port, 3401);
  assert.ok(world.user, '要有可用账号，不能返回空');
});

test('my.ini 都没有时返回空而不是瞎猜端口', () => {
  const root = makeRoot({ iniPort: 0, conf: '' });
  assert.deepEqual(releaseUpdate.readDbConfig(root), {});
});

test('报告端口与时长的函数可用', () => {
  const root = makeRoot({ iniPort: 3396 });
  assert.deepEqual(releaseUpdate.readMysqlIni(root), { port: 3396 });
  assert.equal(releaseUpdate.readAdminClient(root).user, 'trinity');
});

test('源码不得再把 admin-client.ini 当数据库地址', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const update = fs.readFileSync(path.join(__dirname, '..', 'src', 'release-update.cjs'), 'utf8');
  for (const [name, code] of [['main.cjs', main], ['release-update.cjs', update]]) {
    assert.ok(!/admin-client\.ini 里的地址/.test(code), `${name} 仍把 admin-client.ini 当成数据库地址`);
  }
  assert.match(main, /Server\\\\my\.ini 里的端口/, 'main.cjs 的失败提示要指向 Server\\my.ini');
  assert.match(main, /数据库没能启动：/, '起库失败要把真实原因抛出来，不能只说“连不上数据库”');
});
