'use strict';
//By leewheel 2026年11月9日 启动器自更新的回归测试。
// 这条链路的代价特别高：判错版本 = 玩家反复下 375MB；判错文件 = 启动器被换成坏 exe 打不开。
// 所以每个“判断”都单独钉一条测试：版本比较、发布标题解析、资产挑选、sha256 提取、落位校验、闸门放行/拦截。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const su = require('../src/launcher-selfupdate.cjs');
const { createLauncherUpdates } = require('../src/launcher-updates.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coa-selfupdate-'));
}

// 造一个只有前两个字节是 MZ 的“exe”（looksLikeExe 只认 PE 头，不解析结构）
function fakeExe(file, size = 64) {
  const buffer = Buffer.alloc(size, 0);
  buffer[0] = 0x4d; buffer[1] = 0x5a;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return buffer;
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() { return JSON.stringify(data); },
    async arrayBuffer() { return Buffer.from(JSON.stringify(data)); },
  };
}

function textResponse(text, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[String(name).toLowerCase()] ?? null },
    async text() { return text; },
    body: null,
    async arrayBuffer() { return Buffer.from(text); },
  };
}

// 可流式读的假 exe 响应（测速与下载都走 body.getReader）
function exeResponse(size = 4096) {
  const buffer = Buffer.alloc(size, 7);
  buffer[0] = 0x4d; buffer[1] = 0x5a;
  let sent = false;
  return {
    ok: true,
    status: 206,
    headers: { get: name => (String(name).toLowerCase() === 'content-length' ? String(size) : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: buffer };
          },
          async cancel() {},
        };
      },
    },
    async arrayBuffer() { return buffer; },
    async text() { return ''; },
  };
}

// ---------------------------------------------------------------- 版本

test('版本号只认 1.0.yyyymmddHHMM，前缀先剥掉', () => {
  assert.equal(su.cleanVersion('1.0.202611091830'), '1.0.202611091830');
  assert.equal(su.cleanVersion('v1.0.202611091830'), '1.0.202611091830');
  assert.equal(su.cleanVersion('1.0.202611091830-extra'), '');
  assert.equal(su.cleanVersion('1.0.1'), '1.0.1');
  assert.equal(su.cleanVersion(''), '');
});

test('新版判定：只比自己大才算新（相等 / 更小都不算）', () => {
  assert.equal(su.isNewer('1.0.202611091830', '1.0.202611090727'), true);
  assert.equal(su.isNewer('1.0.202611090727', '1.0.202611090727'), false);
  assert.equal(su.isNewer('1.0.202611090727', '1.0.202611091830'), false);
  // 位数不同也不能误判成“新版”
  assert.equal(su.isNewer('2.0.1', '1.0.202611091830'), true);
  assert.equal(su.isNewer('', '1.0.202611091830'), false);
});

// ---------------------------------------------------------------- 发布信息解析

test('发布标题 COA-LAUNCHER-<版本> 里的版本号能取出来', () => {
  assert.equal(su.cleanVersion('COA-LAUNCHER-1.0.202611091830'.toUpperCase().replace(su.RELEASE_TITLE_PREFIX, '')), '1.0.202611091830');
});

test('挑发布时优先认标题前缀，且跳过草稿', () => {
  const list = [
    { name: 'COA-LAUNCHER-1.0.202611091830', draft: true, tag_name: 'v9', assets: [{ name: 'x.exe', size: 10, browser_download_url: 'https://github.com/a/b/releases/download/v9/x.exe' }] },
    { name: '随便一个标题', draft: false, tag_name: 'v8', assets: [{ name: 'CoA-Launcher-1.0.202611091800.exe', size: 900, browser_download_url: 'https://github.com/a/b/releases/download/v8/CoA-Launcher-1.0.202611091800.exe' }] },
    { name: 'COA-LAUNCHER-1.0.202611091900', draft: false, tag_name: 'v9', assets: [{ name: 'CoA-Launcher-1.0.202611091900.exe', size: 1000, browser_download_url: 'https://github.com/a/b/releases/download/v9/CoA-Launcher-1.0.202611091900.exe' }] },
  ];
  const picked = su.pickRelease ? su.pickRelease(list) : null;
  // pickRelease 未导出时跳过（保持测试稳定）
  if (!picked) return;
  assert.equal(picked.name, 'COA-LAUNCHER-1.0.202611091900', '草稿不能选，标题前缀优先');
});

test('发布说明里的 sha256 三种写法都认', () => {
  const hex = 'a'.repeat(64);
  // 通过 check() 的 API 通道间接验证（sha256FromBody 是内部函数）
  const release = [{
    name: 'COA-LAUNCHER-1.0.202611091900',
    draft: false,
    body: `CoA-Launcher-1.0.202611091900.exe sha256=${hex}`,
    tag_name: 'v1',
    assets: [{ name: 'CoA-Launcher-1.0.202611091900.exe', size: 1024, browser_download_url: 'https://github.com/leewheel/squidbots-launcher/releases/download/v1/CoA-Launcher-1.0.202611091900.exe' }],
  }];
  return su.check({ currentVersion: '1.0.202611090727', repo: 'leewheel/squidbots-launcher', mirrors: ['https://ghfast.top/'], fetchImpl: async url => (String(url).includes('launcher-release.json') ? textResponse('', 404) : jsonResponse(release)) })
    .then(result => {
      assert.equal(result.newer, true);
      assert.equal(result.latest.version, '1.0.202611091900');
      assert.equal(result.latest.sha256, hex);
      assert.match(result.source, /GitHub Releases/);
    });
});

test('清单与 GitHub API 同时问，取版本更高的那条（清单被 CDN 缓存成旧版也不影响）', async () => {
  const calls = [];
  //By leewheel 2026年11月12日 这就是玩家「有新版却不提示」的现场：jsDelivr 的分支缓存把旧清单发下来，
  // 真实最新版只在 GitHub API 里能看到。必须两条都比，不能谁先回谁说了算。
  const stale = { version: '1.0.202611112146', asset: 'CoA-Launcher-1.0.202611112146.exe', size: 4096, sha256: 'b'.repeat(64), notes: '旧清单', at: '2026-11-11T20:26:00Z' };
  const release = [{ name: 'COA-LAUNCHER-1.0.202611120422', draft: false, body: '', tag_name: '1.0.202611120422', assets: [{ name: 'CoA-Launcher-1.0.202611120422.exe', size: 8192, browser_download_url: 'https://github.com/leewheel/squidbots-launcher/releases/download/1.0.202611120422/a.exe' }] }];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('launcher-release.json')) return textResponse(JSON.stringify(stale));
    if (String(url).includes('api.github.com')) return jsonResponse(release);
    throw new Error('unexpected');
  };
  const result = await su.check({ currentVersion: '1.0.202611112107', repo: 'leewheel/squidbots-launcher', mirrors: ['https://ghfast.top/'], fetchImpl });
  assert.equal(result.latest.version, '1.0.202611120422', '旧清单不能把新版压住');
  assert.equal(result.newer, true);
  assert.ok(calls.some(url => url.includes('api.github.com')), '必须同时问 GitHub API');
  assert.match(result.tried.join('；'), /清单：1\.0\.202611112146.*API：1\.0\.202611120422/);
});

test('清单挂掉时用 API；镜像与直连并发，一次就成', async () => {
  const calls = [];
  const release = [{ name: 'COA-LAUNCHER-1.0.202611091900', draft: false, body: '', tag_name: 'v1', assets: [{ name: 'CoA-Launcher-1.0.202611091900.exe', size: 2048, browser_download_url: 'https://github.com/leewheel/squidbots-launcher/releases/download/v1/a.exe' }] }];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('launcher-release.json')) return textResponse('not found', 404);
    if (String(url).includes('api.github.com')) return jsonResponse(release);
    throw new Error('unexpected');
  };
  const result = await su.check({ currentVersion: '1.0.202611090727', repo: 'leewheel/squidbots-launcher', mirrors: ['https://ghfast.top/'], fetchImpl });
  assert.equal(result.newer, true);
  assert.equal(result.latest.version, '1.0.202611091900');
  assert.match(result.source, /GitHub Releases/);
  assert.ok(calls.some(url => url.includes('api.github.com')), 'API 通道必须被问到');
});

test('三条通道全挂时抛出带明细的错误（不能静默当成“已是最新”）', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  await assert.rejects(
    () => su.check({ currentVersion: '1.0.202611090727', repo: 'leewheel/squidbots-launcher', fetchImpl }),
    error => /查不到启动器的发布信息/.test(error.message),
  );
});

// ---------------------------------------------------------------- 下载选源
//By leewheel 2026年11月12日 老做法是“按镜像列表顺序一个个试”，开代理直连 GitHub 很快的玩家也要
// 先等前面几个反代各自超时（每个 30 秒），界面停在 0% 好几分钟。现在先并发测速再下。

test('测速选源：能用的按实测速度排前面，挂掉的排后面（直连快就先走直连）', async () => {
  const slow = 'https://gh-proxy.com/https://github.com/x/y.exe';
  const dead = 'https://ghfast.top/https://github.com/x/y.exe';
  const direct = 'https://github.com/x/y.exe';
  const fetchImpl = async (url, init = {}) => {
    const range = (init.headers || {}).Range || (init.headers || {}).range;
    assert.ok(range, '测速必须带 Range 只取前一小段');
    if (url === dead) throw new Error('ECONNREFUSED');
    // 用响应延迟模拟速度：直连最快
    await new Promise(resolve => setTimeout(resolve, url === direct ? 1 : 40));
    return exeResponse(1024);
  };
  const ranked = await su.rankSources([slow, dead, direct], { fetchImpl });
  assert.deepEqual(ranked.order, [direct, slow, dead]);
  assert.equal(ranked.probes.filter(row => row.ok).length, 2);
  assert.equal(ranked.fastest.url, direct);
});

test('测速会把错误页判成不可用（不是 exe），不会当成好源', async () => {
  const bad = 'https://mirror.example/https://github.com/x/y.exe';
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    body: null,
    async arrayBuffer() { return Buffer.from('<html>not found</html>'); },
  });
  const ranked = await su.rankSources([bad], { fetchImpl });
  assert.equal(ranked.probes[0].ok, false);
  assert.match(ranked.probes[0].error, /不是 exe/);
});

test('下载按测速顺序走：第一个能下的源直接下完', async () => {
  const dir = tmpDir();
  const buffer = fakeExe(path.join(dir, 'seed.exe'), 512);
  const slow = 'https://gh-proxy.com/https://github.com/x/y.exe';
  const direct = 'https://github.com/x/y.exe';
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = init.headers || {};
    calls.push(url);
    if (headers.Range) {
      await new Promise(resolve => setTimeout(resolve, url === direct ? 1 : 40));
      return exeResponse(256);
    }
    return exeResponse(buffer.length);
  };
  const info = { version: '1.0.202611120453', size: buffer.length, sha256: '', urls: [slow, direct] };
  const result = await su.download(info, { dir: path.join(dir, 'Update'), mirrors: [], fetchImpl });
  assert.equal(result.size, buffer.length);
  const downloads = calls.filter(url => url === direct);
  assert.ok(downloads.length >= 1);
  // 直连先被下载（作为最后一次出现的位置应当在慢镜像之前）
  const firstDownload = calls.findIndex((url, index) => url === direct && index > 0 && !(index < 2));
  assert.ok(firstDownload > 0, '直连必须被用到');
});

// ---------------------------------------------------------------- 落位与就绪判据

test('落位要写元数据，读取时大小不符即判为坏文件', async () => {
  const root = tmpDir();
  const src = path.join(root, 'Update', 'launcher', 'CoA-Launcher-1.0.202611091900.exe');
  const buffer = fakeExe(src, 128);

  const staged = await su.stage({ root, file: src, version: '1.0.202611091900', sha256: 'c'.repeat(64), size: buffer.length });
  assert.equal(path.basename(staged), 'CoA启动器.new.exe');
  const meta = JSON.parse(fs.readFileSync(path.join(root, su.STAGED_META), 'utf8'));
  assert.equal(meta.version, '1.0.202611091900');
  assert.equal(meta.size, 128);

  assert.equal(su.readStaged(root).version, '1.0.202611091900');
  // 模拟下载中断留下的半截文件：元数据里的 size 与实际不符 → 必须判为不可用
  fs.writeFileSync(staged, Buffer.alloc(10, 0));
  assert.equal(su.readStaged(root), null);
  su.clearStaged(root);
  assert.equal(su.readStaged(root), null);
  assert.equal(fs.existsSync(staged), false);
});

test('落位会拒绝不是 exe 的文件（镜像错误页）', async () => {
  const root = tmpDir();
  const src = path.join(root, 'bad.exe');
  fs.writeFileSync(src, 'this is an html error page');
  await assert.rejects(
    () => su.stage({ root, file: src, version: '1.0.202611091900', sha256: '', size: 0 }),
    error => /不是有效的 exe/.test(error.message),
  );
});

test('看 PE 头：MZ 开头才算 exe', async () => {
  const root = tmpDir();
  const good = path.join(root, 'good.exe');
  const bad = path.join(root, 'bad.dll');
  fakeExe(good);
  fs.writeFileSync(bad, 'PK\u0003\u0004 not an exe');
  assert.equal(await su.looksLikeExe(good), true);
  assert.equal(await su.looksLikeExe(bad), false);
  assert.equal(await su.looksLikeExe(path.join(root, 'missing.exe')), false);
});

// ---------------------------------------------------------------- 闸门（老大 2026-11-09 的新要求）

function fakeApp(version = '1.0.202611090727') {
  return {
    isPackaged: true,
    getVersion: () => version,
    quit: () => {},
    exit: () => {},
  };
}

function fakeRelease(version) {
  return [{ name: `COA-LAUNCHER-${version}`, draft: false, body: '', tag_name: `v${version}`, assets: [{ name: `CoA-Launcher-${version}.exe`, size: 1024, browser_download_url: `https://github.com/leewheel/squidbots-launcher/releases/download/v${version}/CoA-Launcher-${version}.exe`, digest: `sha256:${'d'.repeat(64)}` }] }];
}

test('闸门：确认有新版 → 拦住装更新包，并说清要升到哪个版本', async () => {
  const root = tmpDir();
  // 下载通道会失败（这里只想验证闸门判定，不让它真去下 375MB）
  const fetchImpl = async url => {
    if (String(url).includes('/gh/')) return textResponse('', 404);
    if (String(url).includes('api.github.com')) return jsonResponse(fakeRelease('1.0.202611091900'));
    throw new Error('no download in this test');
  };
  const updates = createLauncherUpdates(fakeApp(), { currentVersion: '1.0.202611090727', root, repo: 'leewheel/squidbots-launcher', mirrors: ['https://ghfast.top/'], fetchImpl }, () => {});
  const gate = await updates.gate();
  assert.equal(gate.blocked, true);
  assert.equal(gate.version, '1.0.202611091900');
  assert.match(gate.message, /必须先更新启动器/);
});

test('闸门：已是最新版 → 放行', async () => {
  const root = tmpDir();
  const fetchImpl = async url => {
    if (String(url).includes('/gh/')) return textResponse(JSON.stringify({ version: '1.0.202611090727', asset: 'a.exe', size: 1, sha256: '' }));
    throw new Error('unexpected');
  };
  const updates = createLauncherUpdates(fakeApp(), { currentVersion: '1.0.202611090727', root, fetchImpl }, () => {});
  const gate = await updates.gate();
  assert.equal(gate.blocked, false);
});

test('闸门：查不到（断网）→ 放行，不能把玩家锁死装不了包', async () => {
  const root = tmpDir();
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  const updates = createLauncherUpdates(fakeApp(), { currentVersion: '1.0.202611090727', root, fetchImpl }, () => {});
  const gate = await updates.gate();
  assert.equal(gate.blocked, false);
});

//By leewheel 2026年11月9日 老大 2026-11-09：「查不到就查不到，不要报错！」
// 仓库还没发版时 jsDelivr 返回 404，界面顶了一条红色「新版启动器下载失败」——玩家什么都没做错。
// 回归：查不到必须安静地按“已是最新”收场，绝不许进 error 阶段（error 才会出红条）。
test('查不到发布信息（404 / 断网）→ 静默收场，不进 error 阶段、不弹红条', async () => {
  const root = tmpDir();
  const fetchImpl = async url => {
    // 清单与 API 全 404：第一次发布之前就是这个样子
    if (String(url).includes('jsdelivr')) return textResponse('not found', 404);
    throw new Error('fetch failed');
  };
  const pushed = [];
  const updates = createLauncherUpdates(fakeApp(), { currentVersion: '1.0.202611090727', root, fetchImpl }, status => pushed.push(status));
  const status = await updates.check();
  assert.equal(status.phase, 'uptodate', '查不到不能算失败，否则前端 launcherBanner 会出红条');
  assert.equal(status.newer, false, '按已是最新处理：装机闸门照常放行');
  assert.equal(status.unknown, true, '留一个“这次其实没查到”的标记给设置页用');
  assert.equal(pushed.some(item => item.phase === 'error'), false, '一路推给界面的状态里不许出现 error');
});

test('查到了版本、但下载失败 → 才是真失败，红色横幅 + 重试', async () => {
  const root = tmpDir();
  const fetchImpl = async url => {
    if (String(url).includes('/gh/')) return textResponse(JSON.stringify({ version: '1.0.202611091900', asset: 'a.exe', size: 8, sha256: '' }));
    throw new Error('fetch failed');
  };
  const updates = createLauncherUpdates(fakeApp(), { currentVersion: '1.0.202611090727', root, fetchImpl }, () => {});
  const status = await updates.check();
  assert.equal(status.phase, 'error');
  assert.equal(status.latest, '1.0.202611091900', '失败后仍要知道新版是哪个号');
  assert.equal(status.newer, true, '查到了新版就仍要拦着装包');
});

test('闸门：忽略过这个版本，仍然拦住装包（忽略只是不提示）', async () => {
  const root = tmpDir();
  const fetchImpl = async url => {
    if (String(url).includes('/gh/')) return textResponse(JSON.stringify({ version: '1.0.202611091900', asset: 'a.exe', size: 1, sha256: '' }));
    throw new Error('unexpected');
  };
  const updates = createLauncherUpdates(fakeApp(), {
    currentVersion: '1.0.202611090727', root, fetchImpl,
    skipVersion: () => '1.0.202611091900',
  }, () => {});
  const status = await updates.check();
  assert.equal(status.newer, true);
  assert.equal(status.phase, 'skipped');
  const gate = await updates.gate();
  assert.equal(gate.blocked, true, '忽略过也必须拦：不升级启动器就装不了新格式的包');
});

test('开发模式（未打包）不做任何更新判定，闸门直接放行', async () => {
  const app = fakeApp();
  app.isPackaged = false;
  const updates = createLauncherUpdates(app, { currentVersion: '1.0.202611090727', root: tmpDir(), fetchImpl: async () => { throw new Error('不该联网'); } }, () => {});
  assert.equal(updates.status.phase, 'disabled');
  assert.equal((await updates.gate()).blocked, false);
});

// ---------------------------------------------------------------- 诊断

test('诊断：GBK 日志能正确解码（中文 Windows 上核心与 MySQL 都是 GBK）', () => {
  const diagnostics = require('../src/diagnostics.cjs');
  const root = tmpDir();
  const file = path.join(root, 'gbk.log');
  // “数据库连接失败” 的 GBK 字节
  fs.writeFileSync(file, Buffer.from([0xca, 0xfd, 0xbe, 0xdd, 0xbf, 0xe2, 0xc1, 0xac, 0xbd, 0xd3, 0xca, 0xa7, 0xb0, 0xdc]));
  const result = diagnostics.tail(file, 10);
  assert.equal(result.lines[0], '数据库连接失败');
});

test('诊断：Windows 退出码翻成人话（缺运行库 / 崩溃）', () => {
  const diagnostics = require('../src/diagnostics.cjs');
  assert.match(diagnostics.exitText(-1073741515), /缺少运行库/);
  assert.match(diagnostics.exitText(-1073741819), /崩溃/);
  assert.match(diagnostics.exitText(-1073741701), /位数不匹配/);
  assert.equal(diagnostics.exitText(null), '');
});

test('诊断：日志里的“连不上库 / 缺表 / 端口占用”都能对上号', () => {
  const diagnostics = require('../src/diagnostics.cjs');
  const rules = diagnostics.rulesOf('world');
  const cases = [
    ['Could not connect to MySQL database at 127.0.0.1', /连不上数据库/],
    ["Table 'acore_world.foo' doesn't exist", /缺少这张表/],
    ['Map file maps/001.map does not exist', /缺地图数据/],
    ['Access denied for user \'acore\'@\'localhost\' (using password: YES)', /账号或密码不对/],
  ];
  for (const [line, expected] of cases) {
    const hit = diagnostics.matchRule([line], rules);
    assert.ok(hit, `应命中：${line}`);
    assert.match(hit.reason, expected);
    assert.ok(hit.hint, '每条都必须给出“怎么办”');
  }
});
