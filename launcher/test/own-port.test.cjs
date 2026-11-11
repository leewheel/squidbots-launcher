'use strict';
//By leewheel 2026年11月12日 回归：启动器自己拉起的服务占着自己的端口，绝不能再报“端口被别的程序占用”。
// 现场：点「启动服务器」的瞬间，mysqld 刚监听，netstat 缓存还是旧的、PowerShell 也可能读不到路径，
// 老代码只按“进程路径 == 本服务 exe”判断，于是自家 MySQL 被当成外来程序弹红框。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { ServerControl } = require('../src/server-control.cjs');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-own-port-'));
  fs.mkdirSync(path.join(root, 'mysql', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mysql', 'bin', 'mysqld.exe'), '');
  fs.writeFileSync(path.join(root, 'worldserver.exe'), '');
  fs.writeFileSync(path.join(root, 'authserver.exe'), '');
  return root;
}

function listen() {
  return new Promise(resolve => {
    const server = net.createServer(() => {});
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function build(root, port) {
  return new ServerControl({
    root,
    services: [
      { id: 'mysql', name: 'MySQL 数据库', exe: 'mysql/bin/mysqld.exe', args: [], port, startTimeout: 5 },
      { id: 'world', name: '世界服', exe: 'worldserver.exe', args: [], port: 1, startTimeout: 5 },
    ],
  });
}

test('本启动器刚拉起的进程（children 里的 PID）占着端口时，算自己人', async () => {
  const { server, port } = await listen();
  const root = makeRoot();
  try {
    const control = build(root, port);
    control.children.set('mysql', { pid: process.pid });
    const rows = await control.scanPorts();
    const mysql = rows.find(row => row.id === 'mysql');
    assert.equal(mysql.busy, true, '端口在监听');
    assert.equal(mysql.mine, true, 'children 里的 PID 必须算自己人，哪怕读不到路径');
    assert.equal(mysql.managed, true);
    assert.equal(mysql.pid, process.pid);
    // 首页状态：运行中，不是“端口被其他程序占用”
    const status = await control.status();
    const row = status.find(item => item.id === 'mysql');
    assert.equal(row.state, 'running');
    assert.equal(row.other, '');
    // 再次点「启动服务器」不能抛“端口被别的程序占着”
    assert.equal(await control.assertPortFree(control.services[0]), true);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('.state 记录里的 PID 与本包 exe 对得上时，也算自己人（管理脚本起的库）', async () => {
  const { server, port } = await listen();
  const root = makeRoot();
  try {
    const control = build(root, port);
    fs.mkdirSync(path.join(root, '.state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.state', 'mysql.json'), JSON.stringify({ pid: process.pid, exe: path.join(root, 'mysql', 'bin', 'mysqld.exe') }));
    const rows = await control.scanPorts();
    const mysql = rows.find(row => row.id === 'mysql');
    assert.equal(mysql.mine, true);
    assert.equal(mysql.managed, false, '不是这次拉起的，仍走 taskkill 兜底');
    const status = await control.status();
    assert.equal(status.find(item => item.id === 'mysql').state, 'running');
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('真正的外来程序（PID 对不上、路径也不在包里）仍然报出来', async () => {
  const { server, port } = await listen();
  const root = makeRoot();
  try {
    const control = build(root, port);
    const rows = await control.scanPorts();
    const mysql = rows.find(row => row.id === 'mysql');
    assert.equal(mysql.busy, true);
    assert.equal(mysql.mine, false, '别的 node 进程占着端口，不是我们的 mysqld');
    assert.equal(mysql.managed, false);
    const status = await control.status();
    assert.equal(status.find(item => item.id === 'mysql').state, 'foreign');
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('children 里记的是另一个 PID 时不算自己人（不能把真冲突藏起来）', async () => {
  const { server, port } = await listen();
  const root = makeRoot();
  try {
    const control = build(root, port);
    control.children.set('mysql', { pid: 999999 });
    const rows = await control.scanPorts();
    const mysql = rows.find(row => row.id === 'mysql');
    assert.equal(mysql.managed, true, 'children 有记录');
    assert.equal(mysql.mine, false, 'PID 对不上就不是这个进程');
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
