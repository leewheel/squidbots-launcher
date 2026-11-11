'use strict';
//By leewheel 2026年11月9日 自动更新执行面的“防骗”回归测试。
// 起因（老大要求重新审一遍更新链路）：下面每一类问题都会让玩家看到“更新成功”，实际却什么都没做成：
//   ① 镜像挂掉回 200 + HTML 错误页 → 以前当成功，解压才炸，而且不再换源；
//   ② 下载写盘失败 → 主进程没有 error 监听，直接崩；
//   ③ 包结构不对（空包/别人的 zip）→ 一路空跑，照样记版本、推基线；
//   ④ 顶层 configs\ 优先于 server\configs\ → 落地核对拿旧内容比新文件，报假失败。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const releaseUpdate = require('../src/release-update.cjs');
const { looksLikeZip } = releaseUpdate;

const tempDir = prefix => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
const writeFiles = async (root, files) => {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content);
  }
};
// 一个最小的、签名正确的 zip（PK\x03\x04 + 无内容）
const ZIP_BYTES = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);
const HTML_BYTES = Buffer.from('<!DOCTYPE html><html><body>404 Not Found</body></html>');

const responseOf = (bytes, { ok = true, status = 200 } = {}) => ({
  ok, status,
  headers: { get: () => String(bytes.length) },
  body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) })), cancel: async () => {} }; } },
  arrayBuffer: async () => bytes,
});

test('不是 zip 的内容落地后要判失败（镜像错误页不能当成功）', async () => {
  const dir = await tempDir('coa-zip-');
  const good = path.join(dir, 'a.zip');
  const bad = path.join(dir, 'b.zip');
  await fsp.writeFile(good, ZIP_BYTES);
  await fsp.writeFile(bad, HTML_BYTES);
  assert.equal(await looksLikeZip(good), true);
  assert.equal(await looksLikeZip(bad), false);
  assert.equal(await looksLikeZip(path.join(dir, 'missing.zip')), false, '文件不存在要返回 false，不能抛');

  await assert.rejects(
    () => releaseUpdate.downloadOnce('https://mirror.test/a.zip', path.join(dir, 'c.zip'), { fetchImpl: async () => responseOf(HTML_BYTES) }),
    /不是 zip/,
  );
  await fsp.rm(dir, { recursive: true, force: true });
});

test('第一个源返回 HTML 错误页：自动换下一个源，最终拿到真 zip', async () => {
  const dir = await tempDir('coa-fallback-');
  const target = path.join(dir, 'update.zip');
  const url = 'https://github.com/owner/repo/releases/download/v1/CoA-Update-1.zip';
  const seen = [];
  const fetchImpl = async candidate => {
    seen.push(candidate);
    // 镜像返回 200 + 错误页（真实事故里 ghfast 就是这么干的）
    if (!candidate.startsWith('https://github.com/')) return responseOf(HTML_BYTES);
    return responseOf(ZIP_BYTES);
  };
  const result = await releaseUpdate.download(url, target, { fetchImpl, mirrors: ['https://mirror.test/'] });
  assert.equal(result.url, url, '最终应当由 GitHub 直连拿到文件');
  assert.equal(seen.length, 2, '镜像失败一次后必须继续试下一个源');
  assert.equal(fs.existsSync(target), true);
  assert.equal(await looksLikeZip(target), true);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('写盘失败（磁盘满/只读）不能让进程崩，要变成一次普通下载失败', async () => {
  const dir = await tempDir('coa-write-');
  const target = path.join(dir, 'no-such-dir', 'x.zip'); // 目录不存在 → open 失败
  await assert.rejects(() => releaseUpdate.downloadOnce('https://x.test/a.zip', target, { fetchImpl: async () => responseOf(ZIP_BYTES) }));
  await fsp.rm(dir, { recursive: true, force: true });
});

test('包结构不对（什么都没有）必须当场失败，不能空跑记成功', async () => {
  const root = await tempDir('coa-root-');
  const world = path.join(root, 'extracted');
  await writeFiles(world, { 'readme.txt': 'this is not an update package', '说明/readme.md': 'hello' });
  const serverRoot = path.join(root, 'Server');
  const clientRoot = path.join(root, 'Client');
  await fsp.mkdir(serverRoot, { recursive: true });
  await fsp.mkdir(clientRoot, { recursive: true });
  await assert.rejects(
    () => releaseUpdate.applyUpdate({ root, world, serverRoot, clientRoot, importSqlFiles: false }),
    /更新包结构不对/,
  );
  // 一条记录都不许留下：失败不能算“装过了”
  assert.equal(fs.existsSync(path.join(root, '.coa-launcher', 'update-history.json')), false);
  await fsp.rm(root, { recursive: true, force: true });
});

test('顶层 configs\\ 覆盖 server\\configs\\ 时，落地核对不能误报大小不一致', async () => {
  const root = await tempDir('coa-verify-');
  const pkg = path.join(root, 'pkg');
  await writeFiles(pkg, {
    'server/worldserver.exe': 'EXE-BYTES',
    'server/configs/worldserver.conf': 'OLD-CONFIG',   // 包里的旧配置
    'configs/worldserver.conf': 'NEW-CONFIG-CONTENT',  // 顶层配置后写、优先
    'configs/extra.conf': 'EXTRA',
  });
  const serverRoot = path.join(root, 'Server');
  // 模拟 applyUpdate 的真实落地结果：先铺 server\，再被顶层 configs\ 盖掉
  await writeFiles(serverRoot, {
    'worldserver.exe': 'EXE-BYTES',
    'configs/worldserver.conf': 'NEW-CONFIG-CONTENT',
    'configs/extra.conf': 'EXTRA',
  });
  const result = await releaseUpdate.verifyInstalled({ folder: pkg, root, serverRoot, clientRoot: path.join(root, 'Client') });
  assert.deepEqual(result.problems, [], `不该有假失败：${result.problems.join('；')}`);
  assert.ok(result.checked >= 3);

  // 真不一致仍然要报（别把 skip 写宽了）
  await fsp.writeFile(path.join(serverRoot, 'worldserver.exe'), 'TAMPERED');
  const broken = await releaseUpdate.verifyInstalled({ folder: pkg, root, serverRoot, clientRoot: path.join(root, 'Client') });
  assert.equal(broken.problems.length, 1);
  assert.match(broken.problems[0], /worldserver\.exe/);
  await fsp.rm(root, { recursive: true, force: true });
});

test('镜像接上后一个字节都不发：看门狗放弃这个源，换下一个（不能无限期卡住）', async () => {
  const dir = await tempDir('coa-stall-');
  const target = path.join(dir, 'update.zip');
  const url = 'https://github.com/owner/repo/releases/download/v1/CoA-Update-2.zip';
  let calls = 0;
  const fetchImpl = async (candidate, options) => {
    calls += 1;
    if (calls === 1) {
      // 真实事故形态：TCP 接上了、200 也回了，但永远不发一个字节
      return {
        ok: true, status: 200, headers: { get: () => '10485760' },
        body: {
          getReader: () => ({
            read: () => new Promise((resolve, reject) => {
              const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
              if (options.signal.aborted) fail(); else options.signal.addEventListener('abort', fail, { once: true });
            }),
            cancel: async () => {},
          }),
        },
      };
    }
    return responseOf(ZIP_BYTES);
  };
  const started = Date.now();
  const result = await releaseUpdate.download(url, target, { fetchImpl, mirrors: ['https://mirror.test/'], timeout: 50 });
  assert.equal(calls, 2, '卡住的源必须被放弃，继续试下一个');
  assert.equal(result.url, url);
  assert.ok(Date.now() - started < 15000, '看门狗要在十几秒内生效，不能等到天荒地老');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('更新前停服复用当前 serverControl（优雅停机管道才在），并确认世界服真退出', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // 关键实现必须在：复用单例 → control.stop('world') 才能往控制台管道写 server shutdown
  assert.match(source, /const reuse = !!\(singleton && serverRoot && path\.resolve\(singleton\.root\)/, '停服要复用单例 serverControl');
  assert.match(source, /worldStillRunning/, '停完要确认世界服真的退出');
  // 两条更新入口（远程队列 / 本地包）都要在“世界服还在跑”时中止
  assert.equal((source.match(/worldStillRunning\)\s*\{\s*\n\s*throw new Error\('世界服还在运行/g) || []).length, 2);
  // 国度还在存角色时也不许带着活库导库
  assert.equal((source.match(/realmsStillSaving\)\s*\{\s*\n\s*throw new Error\('国度还在保存角色/g) || []).length, 2);
});
//End By leewheel
