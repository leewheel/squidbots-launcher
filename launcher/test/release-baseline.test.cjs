'use strict';
//By leewheel 2026年11月8日 基线（整合包“已包含到哪个版本”）的回归测试。
// 这块是“补丁必须依次装”的地基：判据必须是记录，不能是文件时间。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bl = require('../src/release-baseline.cjs');
const { installedVersion, recordBaselineVersions, readHistory, baselineCovered, queueUpTo } = require('../src/release-update.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coa-baseline-'));
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };

test('日期提取：两种写法都要认，占位值必须返回 0', () => {
  assert.equal(bl.dateOf('20261108'), 20261108);
  assert.equal(bl.dateOf('COA-UPDATE-20261108'), 20261108);
  assert.equal(bl.dateOf('coa-publish-20261107'), 20261107);
  assert.equal(bl.dateOf('2026.11.08.11'), 20261108);
  assert.equal(bl.dateOf('2026-11-07'), 20261107);
  assert.equal(bl.dateOf('2026-11-08T06:08:53Z'), 20261108);
  assert.equal(bl.dateOf('9.9'), 0, 'repack.json 的占位版本号不能被当成基线');
  assert.equal(bl.dateOf(''), 0);
  assert.equal(bl.dateOf(undefined), 0);
});

test('基线优先取 baseline.json', () => {
  const root = tmpdir();
  const server = path.join(root, 'Server');
  writeJson(path.join(server, 'RELEASE.json'), { releaseId: 'coa-publish-20261107' });
  writeJson(path.join(root, '.coa-launcher', 'baseline.json'), { version: 'COA-UPDATE-20261108', date: 20261108 });
  const got = bl.readBaseline({ root, serverRoot: server });
  assert.equal(got.date, 20261108);
  assert.equal(got.source, 'baseline.json');
  fs.rmSync(root, { recursive: true, force: true });
});

test('没有 baseline.json 时用整合包 RELEASE.json 声明的版本', () => {
  const root = tmpdir();
  const server = path.join(root, 'Server');
  writeJson(path.join(server, 'RELEASE.json'), { releaseId: 'coa-publish-20261107', releaseDate: '2026-11-07' });
  const got = bl.readBaseline({ root, serverRoot: server });
  assert.equal(got.date, 20261107);
  assert.equal(got.source, 'RELEASE.json');
  fs.rmSync(root, { recursive: true, force: true });
});

test('repack.json 里的占位核心版本（9.9）不算基线', () => {
  const root = tmpdir();
  const server = path.join(root, 'Server');
  writeJson(path.join(server, 'Settings', 'repack.json'), { coreVersion: '9.9' });
  const got = bl.readBaseline({ root, serverRoot: server });
  assert.equal(got.date, 0, '取不到日期就必须当成“没有基线”，此时一个补丁都不跳过');
  assert.equal(got.source, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('基线只许前进：写旧版本不生效（否则已装的补丁会被排回来重装＝降级）', async () => {
  const root = tmpdir();
  await bl.writeBaseline(root, { version: '2026.11.08.11' });
  assert.equal(bl.readBaseline({ root, serverRoot: '' }).date, 20261108);
  const back = await bl.writeBaseline(root, { version: '2026.11.06' });
  assert.equal(back.skipped, true);
  assert.equal(bl.readBaseline({ root, serverRoot: '' }).date, 20261108, '不能后退');
  await bl.writeBaseline(root, { version: '2026.11.09' });
  assert.equal(bl.readBaseline({ root, serverRoot: '' }).date, 20261109, '前进要生效');
  fs.rmSync(root, { recursive: true, force: true });
});

test('基线覆盖的补丁要能识别出来（供一次性补记进 history）', () => {
  const releases = [
    { version: 'COA-UPDATE-20261108', publishedAt: '2026-11-08T06:08:53Z', assets: [{ name: 'CoA-Update-2026.11.08.11-full.zip', url: 'u2' }] },
    { version: 'COA-UPDATE', publishedAt: '2026-11-06T00:45:19Z', assets: [{ name: 'CoA-Update-2026.11.07.zip', url: 'u1' }] },
  ];
  assert.deepEqual(
    baselineCovered({ releases, history: [], baseline: 'coa-publish-20261107' }).map(item => item.version),
    ['COA-UPDATE'],
  );
  // 已经记过的不再重复返回
  assert.deepEqual(baselineCovered({ releases, history: [{ version: 'COA-UPDATE' }], baseline: 'coa-publish-20261107' }), []);
});

test('基线补记只写 history，不能顶掉“已安装版本”', async () => {
  const root = tmpdir();
  await recordBaselineVersions(root, [
    { version: 'COA-UPDATE', asset: 'CoA-Update-2026.11.07.zip' },
    { version: 'COA-OLD-20261001' },
  ]);
  const history = await readHistory(root);
  assert.equal(history.length, 2);
  assert.ok(history.every(item => item.origin === 'baseline'));
  assert.equal(await installedVersion(root), '', '基线补记不算玩家装过的版本');
  assert.equal(fs.existsSync(path.join(root, '.coa-launcher', 'last-update.json')), false, '补记不能写 last-update.json');
  // 幂等：再补一次不会重复
  await recordBaselineVersions(root, [{ version: 'COA-UPDATE' }]);
  assert.equal((await readHistory(root)).length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('装了补丁之后 installedVersion 仍取真正装过的那一条', async () => {
  const root = tmpdir();
  await recordBaselineVersions(root, [{ version: 'COA-UPDATE' }]);
  const { recordVersion } = require('../src/release-update.cjs');
  await recordVersion(root, { version: 'COA-UPDATE-20261108', tag: 'COA-UPDATE-20261108', asset: 'x.zip', files: { server: 2, client: 0 }, dbc: [], sql: [], warnings: [] });
  assert.equal(await installedVersion(root), 'COA-UPDATE-20261108');
  fs.rmSync(root, { recursive: true, force: true });
});

//By leewheel 2026年11月8日 「核心」那栏显示 coa-publish-20261106 原始 ID 的根因：
// 界面和主进程各有一套“版本号变好看”的正则，都不认整合包 releaseId 的 coa-publish- 前缀。
test('界面版本号格式化：整合包 releaseId 也要显示成年月日', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/serverhome.js'), 'utf8');
  const block = /function prettyUpdateVersion\(value\) \{[\s\S]*?\n\}/.exec(src)?.[0];
  assert.ok(block, 'prettyUpdateVersion 必须存在');
  const pretty = new Function(`${block}\nreturn prettyUpdateVersion;`)();
  assert.equal(pretty('coa-publish-20261106'), '2026.11.06');
  assert.equal(pretty('coa-publish-20261107'), '2026.11.07');
  assert.equal(pretty('COA-UPDATE-20261108'), '2026.11.08');
  assert.equal(pretty('2026.11.08.11'), '2026.11.08');
  assert.equal(pretty('20261108'), '2026.11.08');
  assert.equal(pretty(''), '');
  assert.equal(pretty('1.0.202611081341'), '2026.11.08', '启动器版本号里的日期也要认');
});

test('核心卡片必须用主进程算好的版本，不能再直接吐 releaseId', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/serverhome.js'), 'utf8');
  assert.match(src, /prettyUpdateVersion\(info\.version \|\| info\.details\?\.release/, '核心卡片要优先用 info.version');
  assert.equal(
    /shortRelease\(info\.details\?\.release \|\| info\.version\)/.test(src),
    false,
    '不能再把 coa-publish-xxxx 原样显示到核心卡片上',
  );
});

//By leewheel 2026年11月8日 强制更新「装到某一版为止」：目标一定重装、之前的只补没装过的、比目标新的不动
const patch = (n, extra = {}) => ({
  version: `patch-${n}`, tag: `patch-${n}`, name: `patch-${n}`,
  publishedAt: `2026-11-${n}T10:00:00Z`, url: '', notes: '',
  assets: [{ name: `CoA-Update-patch-${n}.zip`, size: 1, url: `https://example.test/${n}.zip` }],
  ...extra,
});
const API_ORDER = [patch('05'), patch('04'), patch('03'), patch('02'), patch('01')];

test('强制更新：不指定版本 = 装最新那一个（已装过也重装）', () => {
  const history = API_ORDER.map(item => ({ version: item.version }));
  const { queue, target } = queueUpTo({ releases: API_ORDER, history });
  assert.equal(target.version, 'patch-05');
  assert.deepEqual(queue.map(item => item.version), ['patch-05'], '全部装过时也要重装最新那一版');
});

test('强制更新：选中间某一版 = 只装它 + 它之前没装过的，顺序旧→新', () => {
  const history = [{ version: 'patch-01' }, { version: 'patch-02' }];
  const { queue, target } = queueUpTo({ releases: API_ORDER, history, targetVersion: 'patch-04' });
  assert.equal(target.version, 'patch-04');
  assert.deepEqual(queue.map(item => item.version), ['patch-03', 'patch-04'], '不能只装 patch-04（会跳过 03）');
});

test('强制更新：选增量包会带上前置补丁，全量包则可以单独装', () => {
  const releases = [patch('01'), patch('02', { assets: [{ name: 'CoA-Update-2026.11.02-full.zip', size: 1, url: 'u' }] })];
  const incremental = queueUpTo({ releases, history: [], targetVersion: 'patch-01' });
  assert.equal(incremental.isFull, false);
  assert.deepEqual(incremental.queue.map(item => item.version), ['patch-01']);
  const full = queueUpTo({ releases, history: [], targetVersion: 'patch-02' });
  assert.equal(full.isFull, true);
  assert.deepEqual(full.queue.map(item => item.version), ['patch-01', 'patch-02'], '全量包前面的补丁仍有未装的，也要补');
});

test('强制更新：找不到版本要给出原因，不能静默返回空队列', () => {
  const got = queueUpTo({ releases: API_ORDER, history: [], targetVersion: 'patch-99' });
  assert.equal(got.target, null);
  assert.ok(/找不到版本/.test(got.reason));
  assert.deepEqual(got.queue, []);
});
