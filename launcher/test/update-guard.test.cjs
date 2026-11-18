'use strict';
//By leewheel 2026年11月19日 更新端口守卫测试（移植自上游 update-guard 的思路）：
// 更新前要能认出「端口被本包目录以外的程序占着」，同时不能把自家服务（服务身份跑、路径读不到）
// 误判成外来占用。portOwner 用替身注入，测试不碰真实端口。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerControl } = require('../src/server-control.cjs');

const ROOT = path.resolve('G:\\CoA\\Server');

function control() {
  return new ServerControl({
    root: ROOT,
    services: [
      { id: 'mysql', name: 'MySQL 数据库', port: 3396, exe: 'mysql/bin/mysqld.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null },
      { id: 'auth', name: '登录服务器', port: 3724, exe: 'authserver.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null },
      { id: 'world', name: '世界服务器', port: 8085, exe: 'worldserver.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null },
    ],
  });
}

// 把某端口的监听者替成给定值（null = 没人监听）
function stub(found, table) {
  found.portOwner = async port => table[port] || null;
  return found;
}

test('本包目录里的程序占着端口：不算外来，不拦更新', async () => {
  const found = stub(control(), {
    3396: { pid: 100, file: path.join(ROOT, 'mysql', 'bin', 'mysqld.exe'), name: 'mysqld.exe', inside: true },
    8085: { pid: 101, file: path.join(ROOT, 'worldserver.exe'), name: 'worldserver.exe', inside: true },
  });
  assert.deepEqual(await found.foreignListeners(), []);
});

test('别的目录的程序占着端口：报为外来（这就是会把 SQL 灌错库的情形）', async () => {
  const other = path.resolve('E:\\OtherRepack\\Server\\mysql\\bin\\mysqld.exe');
  const found = stub(control(), { 3396: { pid: 200, file: other, name: 'mysqld.exe', inside: false } });
  const list = await found.foreignListeners();
  assert.equal(list.length, 1);
  assert.equal(list[0].port, 3396);
  assert.equal(list[0].file, other);
});

test('没人监听的端口不算外来', async () => {
  const found = stub(control(), {});
  assert.deepEqual(await found.foreignListeners(), []);
});

test('路径读不到、但 .state 记录的就是这个 pid：认作自家，不拦', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-guard-'));
  try {
    fs.mkdirSync(path.join(root, '.state'), { recursive: true });
    // 自家服务以服务/管理员身份跑时端口主人读不到路径，脚本会写 .state\<id>.json
    fs.writeFileSync(path.join(root, '.state', 'mysql.json'), JSON.stringify({ pid: 309, exe: path.join(root, 'mysql', 'bin', 'mysqld.exe') }), 'utf8');
    const found = new ServerControl({ root, services: [{ id: 'mysql', name: 'MySQL 数据库', port: 3396, exe: 'mysql/bin/mysqld.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null }] });
    found.portOwner = async () => ({ pid: 309, file: '', name: 'mysqld.exe', inside: null });
    assert.deepEqual(await found.foreignListeners(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('路径读不到、.state 也对不上：不拦（宁可漏报也不误伤自家启动）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-guard2-'));
  try {
    const found = new ServerControl({ root, services: [{ id: 'world', name: '世界服务器', port: 8085, exe: 'worldserver.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null }] });
    found.portOwner = async () => ({ pid: 777, file: '', name: 'worldserver.exe', inside: null });
    assert.deepEqual(await found.foreignListeners(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
