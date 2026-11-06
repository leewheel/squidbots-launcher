'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const live = require('../src/live.cjs');

test('server info: players, characters, tick and its mean', () => {
  const info = live.parseInfo('AzerothCore rev. abc\nConnected players: 1. Characters in world: 21.\nConnection peak: 2.\nServer uptime: 5 minute(s) 3 second(s)\nUpdate time diff: 52ms. Last 500 diffs summary:\n|- Mean: 48ms\n|- Median: 47ms');
  assert.deepEqual({ players: info.players, characters: info.characters, tick: info.tick, tickMean: info.tickMean }, { players: 1, characters: 21, tick: 52, tickMean: 48 });
  assert.equal(live.parseInfo('nothing here').players, null);
});

//By leewheel 2026-11-05 回归测试：世界服日志还在刷时，不得误报"卡住了"
// 复现的两条根因：① RA 提示符被机器人日志挤到缓冲区中间，/AC>\s*$/ 永远匹配不上；
// ② 超时后连接保留 10 分钟，期间"没探测"被当成"无响应"持续累计。

test('RA 提示符后面紧跟日志时仍能识别，不再要求提示符位于缓冲区末尾', () => {
  const hit = live.promptIn('Connected players: 3.\r\nAC> \r\n艾泽拉斯守护者 某某 left the group: back to their own scaling choice.\r\n');
  assert.ok(hit && hit.start > 0, '提示符后面跟日志也必须能找到');
  assert.ok(live.promptIn('AC> '), '提示符位于末尾的常规情况仍要能找到');
  assert.equal(live.promptIn('只有日志，没有提示符\r\n'), null);
});

// 造一个发布版布局的临时服务端目录（worldserver.exe + configs/worldserver.conf -> logs/）
function tempRoot(t, repack) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Settings'), { recursive: true });
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'worldserver.exe'), '');
  fs.writeFileSync(path.join(root, 'configs', 'worldserver.conf'), 'LogsDir = "logs"\n');
  if (repack) fs.writeFileSync(path.join(root, 'Settings', 'repack.json'), JSON.stringify(repack));
  return root;
}

test('Server.log 还在刷就是世界还活着；日志停刷且久未更新才不活着', t => {
  const root = tempRoot(t);
  const log = path.join(root, 'logs', 'Server.log');
  fs.writeFileSync(log, '第一行\r\n');
  assert.equal(live.worldHeartbeat(root), true, '首次采样：日志刚写过');
  fs.appendFileSync(log, '第二行\r\n');
  assert.equal(live.worldHeartbeat(root), true, '大小变化 = 机器人日志还在刷');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(log, old, old);
  assert.equal(live.worldHeartbeat(root), false, '十分钟没写日志：不再有心跳');
});

test('刚写入的日志时间戳略超前于本机时钟时，仍算世界活着', t => {
  const root = tempRoot(t);
  const log = path.join(root, 'logs', 'Server.log');
  fs.writeFileSync(log, '第一行\r\n');
  // Windows 文件时间戳精度高于 Date.now()，刚写完的日志可能"快"几百毫秒
  const soon = new Date(Date.now() + 500);
  fs.utimesSync(log, soon, soon);
  assert.equal(live.worldHeartbeat(root), true, '不能把刚写入的日志误判成未来时间');
});

test('没有 Server.log 时，机器人状态文件的新鲜时间戳仍可证明世界活着', t => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, 'logs', 'bot-status.json'), JSON.stringify({ bots: [], at: Math.floor(Date.now() / 1000) }));
  assert.equal(live.worldHeartbeat(root), true);
});

test('日志还在刷时，RA 连续探测失败也绝不判定卡死', t => {
  const root = tempRoot(t);
  for (let i = 0; i < 5; i++) {
    const verdict = live.silentVerdict(root, { answered: false, probed: true, alive: true, stuckAfter: 0 });
    assert.equal(verdict.stuck, false);
    assert.equal(verdict.stuckFor, 0, '有心跳就不该累计静默时长');
  }
});

test('只有"探测失败 + 日志停刷"持续超窗口才判卡死；RA 被占用不凭空起计时', t => {
  const root = tempRoot(t);
  let verdict = live.silentVerdict(root, { answered: false, probed: false, alive: false, stuckAfter: 0 });
  assert.equal(verdict.stuck, false, '本次根本没探测，不能当成"无响应"');
  verdict = live.silentVerdict(root, { answered: false, probed: true, alive: false, stuckAfter: -1 });
  assert.equal(verdict.stuck, true, '真探测失败且日志停刷，才允许报卡死');
  verdict = live.silentVerdict(root, { answered: true, probed: true, alive: false, stuckAfter: -1 });
  assert.equal(verdict.stuck, false, '控制台恢复应答，计时立刻清零');
});

test('端到端：RA 完全不通但机器人日志还在刷时，stats 绝不判定卡死', async t => {
  const sockets = new Set();
  // RA 一连接就被断开：模拟控制台无应答，且不会留下 10 分钟的 LINGER 定时器
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const root = tempRoot(t, { raPort: server.address().port, raUsername: 'local', raPassword: 'local' });
  fs.mkdirSync(path.join(root, '.state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.state', 'world.json'), JSON.stringify({ pid: process.pid, exe: path.join(root, 'worldserver.exe') }));
  fs.writeFileSync(path.join(root, 'logs', 'Server.log'), '艾泽拉斯守护者 某某 left the group: back to their own scaling choice.\r\n');
  const result = await live.stats(root);
  assert.equal(result.running, true);
  assert.equal(result.worldAlive, true, '机器人日志还在刷 = 世界主循环活着');
  assert.equal(result.stuck, false, '绝不能报"卡住了"');
  assert.equal(result.consoleBusy, true, 'RA 不通仍如实反映为控制台无应答，只是不再升级为卡死');
});

test('控制台日志刷屏时 server info 仍能拿到应答（原实现在此必超时）', async t => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('Username: ');
    let stage = 0;
    socket.on('data', chunk => {
      if (stage === 0) { stage = 1; socket.write('Password: '); return; }
      if (stage === 1) { stage = 2; socket.write('\r\nAC> '); return; }
      if (stage === 2) {
        stage = 3;
        // 应答 + 提示符 + 紧跟一大段机器人日志：提示符不再位于数据末尾
        const noise = '艾泽拉斯守护者 某某 left the group: back to their own scaling choice.\r\n'.repeat(200);
        socket.write('Connected players: 3. Characters in world: 21.\r\nUpdate time diff: 12ms. Last 500 diffs summary:\r\n|- Mean: 10ms\r\nAC> \r\n' + noise);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const root = tempRoot(t, { raPort: server.address().port, raUsername: 'local', raPassword: 'local' });
  const answer = await live.raCommand(root, 'server info', 4000);
  assert.match(answer, /Update time diff: 12/);
  assert.equal(live.parseInfo(answer).players, 3);
  assert.equal(live.parseInfo(answer).tick, 12);
});
//End By leewheel
