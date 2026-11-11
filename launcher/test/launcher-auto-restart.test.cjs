'use strict';
//By leewheel 2026年11月9日 启动器「更新完必须强制重启」的回归测试。
// 老大原话：「启动器更新完毕必须强制重启！」—— 这条链路的两种错法都很贵：
//   · 该重启却没重启 → 玩家拿老启动器去装新格式的更新包，把服务端换坏；
//   · 重启方式错了   → 走 app.quit() 会触发 before-quit 里的停服逻辑，把玩家正在跑的世界服关掉。
// 所以这里钉三件事：① 倒计时归零自己拉起替换进程并 app.exit（不是 quit）；
//                  ② 正在装包/准备数据时不许硬来，如实显示在等、30 秒一轮重试；
//                  ③ ready 之后没有“稍后再说”，忽略无效、装包照样被拦。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const su = require('../src/launcher-selfupdate.cjs');
const launcherSwap = require('../src/launcher-swap.cjs');
const { createLauncherUpdates } = require('../src/launcher-updates.cjs');

const CURRENT = '1.0.202611090727';
const NEXT = '1.0.202611091900';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coa-restart-'));
}

// 只认 PE 头的“exe”（looksLikeExe 不解析结构）
function fakeExe(size = 2048) {
  const buffer = Buffer.alloc(size, 0);
  buffer[0] = 0x4d; buffer[1] = 0x5a;
  return buffer;
}

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function fakeApp({ exits = [], quits = [] } = {}) {
  return {
    isPackaged: true,
    getVersion: () => CURRENT,
    quit: () => quits.push(true),
    exit: code => exits.push(code),
  };
}

const notFound = { ok: false, status: 404, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) };

// 网络替身：清单通道给版本与 sha256，资产本身当“镜像上的 exe”返回。
// 可选让第一个地址 404，验证“拼出来的几种 tag 写法会依次退”。
function net(exe, { firstUrlDead = false } = {}) {
  const manifest = { version: NEXT, asset: `CoA-Launcher-${NEXT}.exe`, size: exe.length, sha256: sha256(exe) };
  let assetHits = 0;
  const asked = [];
  const impl = async url => {
    const text = String(url);
    asked.push(text);
    if (text.includes('launcher-release.json')) {
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(manifest), arrayBuffer: async () => Buffer.from(JSON.stringify(manifest)) };
    }
    if (/\.exe$/.test(text)) {
      assetHits += 1;
      if (firstUrlDead && assetHits === 1) return notFound;
      return { ok: true, status: 200, headers: { get: name => (String(name).toLowerCase() === 'content-length' ? String(exe.length) : null) }, text: async () => '', arrayBuffer: async () => exe };
    }
    return notFound;
  };
  impl.asked = asked;
  return impl;
}

// 让挂起的异步（fs.promises 那些）全部落地：只转 setImmediate，不碰被打桩的 setTimeout
async function flush(times = 30) {
  for (let i = 0; i < times; i += 1) await new Promise(resolve => setImmediate(resolve));
}

test('下载完自动强制重启：倒计时归零 → 拉起替换进程（--restart）→ app.exit 退出', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const root = tmpDir();
  const exe = fakeExe();
  const exits = [];
  const quits = [];
  const spawns = [];
  const real = launcherSwap.spawnTakeover;
  launcherSwap.spawnTakeover = (file, pid, options) => { spawns.push({ file, pid, options }); return true; };
  try {
    const updates = createLauncherUpdates(fakeApp({ exits, quits }), {
      currentVersion: CURRENT, root, repo: 'leewheel/squidbots-launcher',
      mirrors: ['https://ghfast.top/'], fetchImpl: net(exe), autoRestartDelay: 3000,
    }, () => {});

    const ready = await updates.check();
    assert.equal(ready.phase, 'ready', '下完就该是 ready，不是等玩家点');
    assert.equal(ready.newer, true);
    assert.equal(ready.secondsLeft, 3, '倒计时第一拍立刻推一次，界面不用干等 1 秒');
    assert.ok(fs.existsSync(path.join(root, launcherSwap.STAGED_NAME)), '新版要真的落在启动器目录里');

    t.mock.timers.tick(1000);
    assert.equal(updates.status.secondsLeft, 2);
    t.mock.timers.tick(1000);
    assert.equal(updates.status.secondsLeft, 1);

    t.mock.timers.tick(1000); // 归零 → 自动重启
    await flush();
    assert.equal(spawns.length, 1, '倒计时结束必须自己拉起替换进程');
    assert.equal(spawns[0].options.restart, true, '换完要自己把新启动器拉起来（不是换完就没了）');
    assert.equal(spawns[0].pid, process.pid);
    assert.equal(updates.status.phase, 'installing');

    t.mock.timers.tick(900);
    assert.deepEqual(exits, [0], '本进程要 app.exit(0) 让位');
    assert.deepEqual(quits, [], '绝不能走 app.quit()：before-quit 里有停服逻辑，会把玩家的世界服关掉');
  } finally {
    launcherSwap.spawnTakeover = real;
  }
});

test('正在准备数据时不硬来：横幅如实说在等，30 秒后自己重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const root = tmpDir();
  const exe = fakeExe();
  const exits = [];
  const spawns = [];
  const real = launcherSwap.spawnTakeover;
  launcherSwap.spawnTakeover = (file, pid, options) => { spawns.push({ file, options }); return true; };
  let busy = true;
  try {
    const updates = createLauncherUpdates(fakeApp({ exits }), {
      currentVersion: CURRENT, root, repo: 'leewheel/squidbots-launcher',
      mirrors: ['https://ghfast.top/'], fetchImpl: net(exe), autoRestartDelay: 2000,
    }, () => {}, async () => { if (busy) throw new Error('服务器正在准备数据'); });

    await updates.check();
    t.mock.timers.tick(2000); // 倒计时归零
    await flush();
    assert.equal(spawns.length, 0, '忙的时候不许硬重启');
    assert.equal(updates.status.phase, 'ready', '还是 ready：文件还在，等它空下来');
    assert.equal(updates.status.waiting, true);
    assert.match(updates.status.message, /服务器正在准备数据/, '横幅要写清在等什么，不能假装没发生');
    assert.deepEqual(exits, [], '没换成就不能退出');

    busy = false;
    t.mock.timers.tick(30000); // 30 秒一轮的自动重试
    await flush();
    assert.equal(spawns.length, 1, '空下来之后必须自己把重启补上，不用玩家再点');
    assert.equal(spawns[0].options.restart, true);
  } finally {
    launcherSwap.spawnTakeover = real;
  }
});

test('世界服在跑时不算失败：一直等，停服后 60 秒内自己把升级补上', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const root = tmpDir();
  const exe = fakeExe();
  const spawns = [];
  const real = launcherSwap.spawnTakeover;
  launcherSwap.spawnTakeover = (file, pid, options) => { spawns.push({ file, options }); return true; };
  let worldRunning = true;
  const refuse = () => {
    const error = new Error('世界服正在运行，重启启动器会让它掉线');
    error.code = 'SERVER_RUNNING';
    throw error;
  };
  try {
    const updates = createLauncherUpdates(fakeApp(), {
      currentVersion: CURRENT, root, repo: 'leewheel/squidbots-launcher',
      mirrors: ['https://ghfast.top/'], fetchImpl: net(exe), autoRestartDelay: 2000,
    }, () => {}, async () => { if (worldRunning) refuse(); });
    await updates.check();
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(spawns.length, 0);
    assert.equal(updates.status.waiting, true);
    assert.equal(updates.status.waitingOnServer, true, '界面要认出这是“等世界服”，不是“等装包”');
    assert.match(updates.status.message, /世界服正在运行/);
    // 不设放弃期限：连着被拦几十轮也还是 waiting（中途放弃会留下“下好了却永远是老版本”）
    for (let i = 0; i < 65; i += 1) { t.mock.timers.tick(60000); await flush(3); }
    assert.equal(updates.status.waiting, true);
    assert.equal(spawns.length, 0);
    // 玩家停服 → 下一轮（60 秒）就把升级补上
    worldRunning = false;
    t.mock.timers.tick(60000);
    await flush();
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].options.restart, true);
  } finally {
    launcherSwap.spawnTakeover = real;
  }
});

test('ready 之后没有“稍后再说”：忽略无效，装更新包照样被拦', async () => {
  const root = tmpDir();
  const exe = fakeExe();
  const updates = createLauncherUpdates(fakeApp(), {
    currentVersion: CURRENT, root, repo: 'leewheel/squidbots-launcher',
    mirrors: ['https://ghfast.top/'], fetchImpl: net(exe), autoRestart: false,
  }, () => {});

  await updates.check();
  assert.equal(updates.status.phase, 'ready');
  updates.skip();
  assert.equal(updates.status.phase, 'ready', 'ready 阶段忽略不生效：只剩“现在就装”');
  const gate = await updates.gate();
  assert.equal(gate.blocked, true, '老启动器装不了新格式的包');
  assert.ok(fs.existsSync(path.join(root, launcherSwap.STAGED_NAME)));
});

test('清单通道（主力）必须带下载地址：没有它每次真更新都会报“没有下载地址”', async () => {
  const info = await su.fromManifest({ repo: 'leewheel/squidbots-launcher', fetchImpl: net(fakeExe()) });
  assert.equal(info.version, NEXT);
  assert.equal(info.urls.length, 3, '三种 tag 写法都要排上，tag 命名换了也还能下');
  assert.match(info.urls[0], new RegExp(`/releases/download/${NEXT}/CoA-Launcher-${NEXT}\\.exe$`));
  assert.match(info.urls[1], /\/releases\/download\/v1\.0\./);
  assert.match(info.urls[2], new RegExp(`/releases/latest/download/CoA-Launcher-${NEXT}\\.exe$`));
  assert.ok(info.url, '单地址字段也要有，老代码路径读的是它');
});

test('第一个地址 404 时自动退到下一种 tag 写法，不用玩家重来', async () => {
  const root = tmpDir();
  const updates = createLauncherUpdates(fakeApp(), {
    currentVersion: CURRENT, root, repo: 'leewheel/squidbots-launcher',
    mirrors: ['https://ghfast.top/'], fetchImpl: net(fakeExe(), { firstUrlDead: true }), autoRestart: false,
  }, () => {});
  const status = await updates.check();
  assert.equal(status.phase, 'ready');
  assert.equal(status.newer, true);
});
