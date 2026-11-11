//By leewheel 2026年11月11日 安装目录完整性检查的回归测试。
// 老大要求：Server 下必须有 authserver.exe、worldserver.exe 和完整的 mysql 目录；
// Client 下必须是完整客户端。不匹配就报错，并且要说清缺什么、该放哪。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const integrity = require('../src/dir-integrity.cjs');

const touch = (root, rel) => {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
};
const mkdir = (root, rel) => fs.mkdirSync(path.join(root, ...rel.split('/')), { recursive: true });

function fullServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-srv-'));
  for (const rel of ['authserver.exe', 'worldserver.exe', 'my.ini', 'configs/worldserver.conf', 'configs/authserver.conf', 'mysql/bin/mysqld.exe', 'mysql/bin/mysql.exe', 'mysql/bin/mysqladmin.exe']) touch(root, rel);
  for (const rel of ['mysql/Data', 'mysql/share/english', 'ClientData/dbc']) mkdir(root, rel);
  return root;
}

function fullClient() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-cli-'));
  touch(root, 'Ascension.exe');
  for (const rel of ['Data/common.MPQ', 'Data/common-2.MPQ', 'Data/expansion.MPQ', 'Data/lichking.MPQ', 'Data/patch-M.MPQ']) touch(root, rel);
  for (const rel of ['Data/enUS', 'Interface/AddOns', 'WTF']) mkdir(root, rel);
  return root;
}

const has = (result, needle) => result.problems.some(item => item.rel.toLowerCase().includes(needle.toLowerCase()));

test('完整的 Server 目录判为合格', () => {
  const result = integrity.checkServer(fullServer());
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.problems.filter(item => item.severity === 'bad').length, 0);
});

test('缺 worldserver.exe 时必须点名，并且不合格', () => {
  const root = fullServer();
  fs.rmSync(path.join(root, 'worldserver.exe'));
  const result = integrity.checkServer(root);
  assert.equal(result.ok, false);
  assert.ok(has(result, 'worldserver.exe'), '报错里要点名 worldserver.exe');
});

test('整个 mysql 目录缺失时只报一条，不刷一堆子文件', () => {
  const root = fullServer();
  fs.rmSync(path.join(root, 'mysql'), { recursive: true, force: true });
  const result = integrity.checkServer(root);
  assert.equal(result.ok, false);
  assert.equal(result.problems.filter(item => item.severity === 'bad').length, 1, 'mysql 整个缺只报一条');
  assert.match(result.problems[0].rel, /mysql/i);
});

test('mysql 里少了 mysqld.exe 也算不完整', () => {
  const root = fullServer();
  fs.rmSync(path.join(root, 'mysql', 'bin', 'mysqld.exe'));
  const result = integrity.checkServer(root);
  assert.equal(result.ok, false);
  assert.ok(has(result, 'mysqld.exe'));
});

test('完整的 Client 目录判为合格', () => {
  const result = integrity.checkClient(fullClient(), { executable: 'Ascension.exe' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('Client 缺基础 MPQ 或补丁 MPQ 都要报出来', () => {
  const root = fullClient();
  fs.rmSync(path.join(root, 'Data', 'common.MPQ'));
  fs.rmSync(path.join(root, 'Data', 'patch-M.MPQ'));
  const result = integrity.checkClient(root, { executable: 'Ascension.exe' });
  assert.equal(result.ok, false);
  assert.ok(has(result, 'common.MPQ'));
  assert.ok(has(result, 'patch-'));
});

test('Client 没有任何补丁 MPQ 时报“至少一个”', () => {
  const root = fullClient();
  fs.rmSync(path.join(root, 'Data', 'patch-M.MPQ'));
  const result = integrity.checkClient(root);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(item => /至少一个/.test(item.label)));
});

test('目录压根不存在时直接点名目录本身', () => {
  const result = integrity.checkServer(path.join(os.tmpdir(), 'coa-not-exist-' + Date.now()));
  assert.equal(result.ok, false);
  assert.match(result.problems[0].label, /服务端目录/);
});

test('assertServerReady 抛出的是中文 + 绝对路径，不是英文明细', () => {
  const root = fullServer();
  fs.rmSync(path.join(root, 'authserver.exe'));
  assert.throws(() => integrity.assertServerReady(root), error => {
    assert.match(error.message, /不完整/);
    assert.match(error.message, /authserver\.exe/);
    assert.ok(error.message.includes(root), '要带上目录绝对路径，玩家才知道在查哪个目录');
    return true;
  });
});

test('checkIntegrity 汇总两边，且给出可读文本', () => {
  const server = fullServer();
  const client = fullClient();
  fs.rmSync(path.join(client, 'Ascension.exe'));
  const result = integrity.checkIntegrity({ server, client, executable: 'Ascension.exe' });
  assert.equal(result.ok, false);
  assert.equal(result.server.ok, true);
  assert.equal(result.client.ok, false);
  assert.match(result.text, /客户端目录/);
  assert.ok(!/服务端目录/.test(result.text), '服务端没问题就不要在文本里提');
});
