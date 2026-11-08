'use strict';
//By leewheel 2026年11月8日 回归：国度的「运行中」只能是【本整合包里的世界服】占着它的端口。
// 实弹（老大截图）：机器上同时开着两个整合包，另一个包的 Reborn 也监听 8285，
// 这个包的国度假报“运行中”，玩家对着别人的世界服点“停止”还会把它关掉。
// 判据必须是“端口 + 进程 exe 归属”双确认，端口开着但监听者不是自己的 → foreign。
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ownWorldPid, portStranger } = require('../src/realms.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-realm-port-'));
const winOnly = process.platform === 'win32';

function listen(host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer(() => {});
    server.listen(0, host, () => resolve(server));
  });
}

test('端口被别的程序占着：不算这个国度在跑，而是报“端口被占用”；关掉后恢复空闲', async t => {
  if (!winOnly) return t.skip('Windows only');
  // 监听在 0.0.0.0：netstat 里是 0.0.0.0:port，解析同样要能认出端口和 PID
  const server = await listen('0.0.0.0');
  const port = server.address().port;
  try {
    assert.equal(await ownWorldPid(root, port), 0, '监听者不是本包的世界服，绝不能算运行中');
    const stranger = await portStranger(root, port);
    assert.ok(stranger && stranger.pid, '必须能拿到占用者的 PID，界面才能告诉玩家是谁');
    assert.equal(String(stranger.file || ''), '', '占端口的是 node，不是 worldserver.exe，路径应为空');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  // 端口表的缓存是 3 秒（状态页 5 秒轮询一次），等它过期再看“空着”的结果
  await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal(await ownWorldPid(root, port), 0);
  assert.equal(await portStranger(root, port), null);
});

test('国度状态判定：端口开着不再直接等于 running', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'realms.cjs'), 'utf8');
  assert.match(src, /const minePid = await ownWorldPid\(root, p\.worldPort\);/, '状态页必须按归属取运行中的 PID');
  assert.match(src, /const open = !!minePid;/, 'open 只能来自归属判定');
  assert.match(src, /: stranger \? 'foreign'/, '端口被别人占着要报 foreign');
  // 启动/停止/改模块/清机器人：凡“这个国度在跑吗”都不许再用 portOpen
  const wrong = [
    /if \(await portOpen\(saved\.worldPort\)\) return;/,
    /portOpen\(saved\.worldPort\) \|\| await processOf/,
    /const up = async \(\) => \(pid \? pidAlive\(pid\) : await portOpen/,
    /if \(!pid && !\(await portOpen\(saved\.worldPort\)\)\) return;/,
  ];
  for (const pattern of wrong) assert.equal(pattern.test(src), false, `仍在使用只看端口的老写法：${pattern}`);
});

test('启动前先分清端口是谁的：别人的程序占着要报错，不能静默返回', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'realms.cjs'), 'utf8');
  assert.match(src, /Port \$\{saved\.worldPort\} is already used by another program/, '启动前必须报“端口被其他程序占用”');
  assert.match(src, /Port \$\{saved\.worldPort\} was taken by another program while starting/, '启动过程中端口被抢也要报错并停掉刚起的进程');
});

test('主服不会把国度的世界服认成自己在加载（同一个 worldserver.exe）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server-control.cjs'), 'utf8');
  assert.match(src, /const others = realmPids\(this\.root\);/, '主服判定“加载中”时必须排除国度自己的进程');
  assert.match(src, /!others\.has\(row\.pid\)/);
});

test.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
