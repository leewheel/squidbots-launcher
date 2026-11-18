'use strict';
//By leewheel 2026年11月19日 首次启动等待数据库更新的测试（移植自上游 late-start 的思路）：
// 世界服自己的超时到了，但日志还在增长 ⇒ 继续等；日志不动 ⇒ 才算卡住。
// 这里把 portOpen 与时间参数注入，测试不碰真实端口、几秒内跑完。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerControl } = require('../src/server-control.cjs');

function make(root) {
  const found = new ServerControl({
    root,
    services: [{ id: 'world', name: '世界服务器', port: 8085, exe: 'worldserver.exe', args: [], cwd: '.', alternatives: [], start: null, stop: null }],
    notify: () => {},
  });
  // 状态查询会去扫真实端口，测试里直接短路
  found.status = async () => [];
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  return found;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('日志一直在增长：继续等，端口开了就算成功（不再把自己的超时当失败）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-late-'));
  try {
    const found = make(root);
    const file = path.join(root, 'logs', 'Server.log');
    let open = false;
    // 每 300ms 写一段日志，模拟“正在应用 SQL 更新”；1.2 秒后端口打开
    const writer = setInterval(() => fs.appendFileSync(file, 'applying update...\n'), 300);
    setTimeout(() => { open = true; }, 1200);
    const result = await found.waitWhileUpdating(found.services[0], Date.now(), {
      alive: async () => true,
      open: async () => open,
      quietMs: 900,
      maxMs: 8000,
    });
    clearInterval(writer);
    assert.equal(result, 'open');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('日志不动了：判定卡住（quiet），不再无限等下去', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-late2-'));
  try {
    const found = make(root);
    const file = path.join(root, 'logs', 'Server.log');
    fs.writeFileSync(file, 'starting...\n', 'utf8');
    const result = await found.waitWhileUpdating(found.services[0], Date.now(), {
      alive: async () => true,
      open: async () => false,
      quietMs: 400,
      maxMs: 10000,
    });
    assert.equal(result, 'quiet');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('进程没了：立刻停止等待（gone），别把崩溃当成“还在更新”', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-late3-'));
  try {
    const found = make(root);
    const result = await found.waitWhileUpdating(found.services[0], Date.now(), {
      alive: async () => false,
      open: async () => false,
      quietMs: 5000,
      maxMs: 10000,
    });
    assert.equal(result, 'gone');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('日志一直在动但 20 分钟上限到了：返回 timeout（交给上层报失败）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-late4-'));
  try {
    const found = make(root);
    const file = path.join(root, 'logs', 'Server.log');
    const writer = setInterval(() => fs.appendFileSync(file, 'still working...\n'), 300);
    const result = await found.waitWhileUpdating(found.services[0], Date.now(), {
      alive: async () => true,
      open: async () => false,
      quietMs: 60000,
      maxMs: 2600,
    });
    clearInterval(writer);
    assert.equal(result, 'timeout');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
