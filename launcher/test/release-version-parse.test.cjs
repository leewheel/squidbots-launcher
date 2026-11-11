'use strict';
//By leewheel 2026年11月10日 「版本号必须带得上日期」的回归测试。
// 实弹（老大 2026-11-10 截图退回）：11.10 那次 GitHub release 的 tag 写成 "COA-UPDATE"（没日期），
// 日期只在 name 里。启动器“tag 优先”取到 "COA-UPDATE"，正好与更新历史里 11.07 / 11.08 两条同名记录撞车，
// 于是 11.10 被判成“装过了”——界面拉到更新包却显示「已是最新」，连“开始更新”都不给。
// 这里把几种写法都钉住，以后谁改解析都得先过这几条。
const test = require('node:test');
const assert = require('node:assert');
const { versionOf, normalizeVersion, pendingReleases, dateOf } = require('../src/release-update.cjs');

const GH = (tag, name, pub, assets = []) => ({
  tag_name: tag, name, published_at: pub, draft: false, prerelease: false,
  assets: assets.map(item => ({ name: item, size: 1, browser_download_url: `https://x/${item}` })),
});

test('版本号：tag 不带日期时用 name 里的日期（实弹 bug）', () => {
  assert.equal(versionOf(GH('COA-UPDATE', 'COA-UPDATE-20261110', '2026-11-10T02:19:37Z')), 'COA-UPDATE-20261110');
});

test('版本号：中文年月日要规范成 20YYMMDD', () => {
  assert.equal(versionOf(GH('COA-UPDATE', 'COA-UPDATE-2026年11月10日', '2026-11-10T02:19:37Z')), 'COA-UPDATE-20261110');
  assert.equal(normalizeVersion('COA-UPDATE-2026.11.9'), 'COA-UPDATE-20261109');
  assert.equal(normalizeVersion('2026-11-08'), '20261108');
});

test('版本号：tag 本身带日期时不受影响', () => {
  assert.equal(versionOf(GH('COA-UPDATE-20261109', '随便一个标题', '2026-11-09T00:00:00Z')), 'COA-UPDATE-20261109');
});

test('版本号：文本里都没日期就拿资产名，再没有才用发布时间补', () => {
  assert.equal(
    versionOf(GH('COA-UPDATE', '标题没日期', '2026-11-10T02:19:37Z', ['CoA-Update-2026.11.10-full.zip'])),
    'CoA-Update-20261110-full',
  );
  assert.equal(versionOf(GH('COA-UPDATE', '标题也没', '2026-11-10T02:19:37Z')), 'COA-UPDATE-20261110');
  assert.equal(versionOf(GH('', '', '')), '');
});

test('日期提取：中文写法也要认', () => {
  assert.equal(dateOf('COA-UPDATE-2026年11月10日'), 20261110);
  assert.equal(dateOf('2026年3月5日'), 20260305);
});

test('实弹复现：历史里有同名但无日期的旧记录，不许吞掉带日期的新版本', () => {
  // 真实数据：release 版本规范化后是 COA-UPDATE-20261110；history 里那两条 COA-UPDATE 是 11.07/11.08 的残留
  const releases = [{
    version: 'COA-UPDATE-20261110',
    tag: 'COA-UPDATE',
    name: 'COA-UPDATE-20261110',
    notes: '累计基线: 20261107',
    publishedAt: '2026-11-10T02:19:37Z',
    url: 'https://x',
    assets: [{ name: 'CoA-Update-2026.11.10-full.zip', size: 1, url: 'https://x/a.zip' }],
  }];
  const history = [
    { version: 'COA-UPDATE', at: '2026-11-07T22:49:53.600Z' },
    { version: 'COA-UPDATE', at: '2026-11-08T21:41:59.848Z' },
    { version: 'COA-UPDATE-20261109', at: '2026-11-10T00:32:34.378Z' },
  ];
  const pending = pendingReleases({ releases, history, current: 'COA-UPDATE-20261109', baseline: 'COA-UPDATE-20261109' });
  assert.equal(pending.length, 1, '11.09 装过的机器必须看到 11.10 这一版');
  assert.equal(pending[0].version, 'COA-UPDATE-20261110');
  assert.equal(pending[0].asset.name, 'CoA-Update-2026.11.10-full.zip');
});

test('已经装过同一个带日期的版本仍然算最新（不能反过来一直提示）', () => {
  const releases = [{
    version: 'COA-UPDATE-20261110', publishedAt: '2026-11-10T02:19:37Z',
    notes: '累计基线: 20261107',
    assets: [{ name: 'CoA-Update-2026.11.10-full.zip', size: 1, url: 'https://x/a.zip' }],
  }];
  const history = [{ version: 'COA-UPDATE-20261110', at: '2026-11-10T03:00:00Z' }];
  assert.deepEqual(pendingReleases({ releases, history, current: 'COA-UPDATE-20261110', baseline: 'COA-UPDATE-20261110' }), []);
});
