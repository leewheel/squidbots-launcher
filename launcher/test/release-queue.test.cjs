'use strict';
//By leewheel 2026-11-05 GitHub 补丁队列回归测试：第一次运行装全部、缺几个就补几个，且必须按发布顺序【旧 → 新】
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pendingReleases } = require('../src/release-update.cjs');

const pad = n => String(n).padStart(2, '0');
const release = (n, extra = {}) => ({
  version: `patch-${pad(n)}`, tag: `v-patch-${pad(n)}`, name: `COA-Update-patch-${pad(n)}`,
  publishedAt: `2026-11-${pad(n)}T10:00:00Z`, url: `https://example.test/r${n}`, notes: '',
  assets: [{ name: `CoA-Update-patch-${pad(n)}.zip`, size: 100, url: `https://example.test/a${n}.zip` }],
  ...extra,
});
// GitHub API 的顺序是【最新在前】
const apiOrder = Array.from({ length: 10 }, (_, i) => release(10 - i));
const allVersions = Array.from({ length: 10 }, (_, i) => `patch-${pad(i + 1)}`);

test('第一次运行、没装过任何补丁：10 个补丁按发布顺序依次安装', () => {
  const pending = pendingReleases({ releases: apiOrder, history: [] });
  assert.deepEqual(pending.map(item => item.version), allVersions);
  assert.ok(pending.every(item => item.asset?.url), '每个待装补丁都要带 zip 资源');
});

test('已装 7 个、还缺 3 个：只按旧到新安装最后 3 个', () => {
  const history = allVersions.slice(0, 7).map(version => ({ version }));
  const pending = pendingReleases({ releases: apiOrder, history });
  assert.deepEqual(pending.map(item => item.version), ['patch-08', 'patch-09', 'patch-10']);
});

test('全部装过：队列为空，不再提示更新', () => {
  const history = allVersions.map(version => ({ version }));
  assert.deepEqual(pendingReleases({ releases: apiOrder, history }), []);
});

test('缺的是中间 3 个也只补这 3 个，顺序仍是旧到新', () => {
  const history = allVersions.filter(version => !['patch-04', 'patch-05', 'patch-06'].includes(version)).map(version => ({ version }));
  assert.deepEqual(pendingReleases({ releases: apiOrder, history }).map(item => item.version), ['patch-04', 'patch-05', 'patch-06']);
});

test('没有 zip 更新包的 release 跳过，不占队列位置', () => {
  const releases = [release(2), { ...release(1), assets: [] }];
  assert.deepEqual(pendingReleases({ releases, history: [] }).map(item => item.version), ['patch-02']);
});

test('逐个安装时每成功一个就记进历史，中途失败后重开只补剩下的', () => {
  const history = [];
  const queue = pendingReleases({ releases: apiOrder, history });
  for (const item of queue.slice(0, 4)) history.push({ version: item.version });
  assert.deepEqual(pendingReleases({ releases: apiOrder, history }).map(item => item.version), allVersions.slice(4));
});

test('同一时刻发布时按 GitHub 顺序反转（API 里越靠后越旧，先装）', () => {
  const sameTime = [release(3), release(2), release(1)].map(item => ({ ...item, publishedAt: '2026-11-05T10:00:00Z' }));
  assert.deepEqual(pendingReleases({ releases: sameTime, history: [] }).map(item => item.version), ['patch-01', 'patch-02', 'patch-03']);
});

test('补丁发布时间早于本机核心编译时间：算已内置，不再提示有新版本（老大反馈的误报）', () => {
  // 真实数据：补丁 COA-Update-20261105 于 2026-11-05T00:00Z 上传，本机 worldserver.exe 编译于 2026-11-05T06:53Z
  const builtAt = Date.parse('2026-11-05T06:53:00Z');
  const releases = [release(5, { version: 'COA-Update-20261105', publishedAt: '2026-11-05T00:00:00Z' })];
  assert.deepEqual(pendingReleases({ releases, history: [], current: 'coa-publish-20261105', builtAt }), []);
});

test('补丁发布时间晚于本机核心编译时间：仍然算待装，该提示就提示', () => {
  const builtAt = Date.parse('2026-11-05T06:53:00Z');
  const releases = [release(6, { version: 'COA-Update-20261106', publishedAt: '2026-11-06T00:00:00Z' })];
  assert.deepEqual(pendingReleases({ releases, history: [], current: 'coa-publish-20261105', builtAt }).map(item => item.version), ['COA-Update-20261106']);
});

test('没有编译时间可比时退回版本/日期比较：比当前包旧的不算待装', () => {
  const releases = [release(3, { version: 'COA-Update-20261103', publishedAt: '2026-11-03T00:00:00Z' })];
  assert.deepEqual(pendingReleases({ releases, history: [], current: 'coa-publish-20261105', builtAt: 0 }), []);
});

test('核心版本号里的日期不能被当成 git 哈希截断', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/serverhome.js'), 'utf8');
  // 函数是单行的，直接整行取出来求值（用 [\s\S]*? 会在 {7,40} 的花括号处截断，踩过）
  const line = /function shortRelease\(release\) \{[^\n]*/.exec(src)?.[0];
  assert.ok(line, 'shortRelease 必须存在');
  const shortRelease = new Function(`${line}\nreturn shortRelease;`)();
  assert.equal(shortRelease('coa-publish-20261105'), 'coa-publish-20261105', '日期要完整保留');
  assert.equal(shortRelease('coa-publish-20261105-a1b2c3d'), 'coa-publish-20261105', '真正的提交哈希仍要截掉');
});

test('队列入口与界面改动都在源码里', () => {
  const root = path.join(__dirname, '..');
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(read('src/main.cjs'), /handle\('release:applyAll'/);
  assert.match(read('src/main.cjs'), /for \(let i = 0; i < queue\.length; i\+\+\)/);
  assert.match(read('src/main.cjs'), /await applyOnePatch\(/);
  assert.match(read('src/preload.cjs'), /releaseApplyAll/);
  assert.match(read('public/js/serverhome.js'), /releaseApplyAll\(\{ queue: pending/);
  assert.match(read('public/locales/zh.json'), /"err:The full server is not on the channel yet\.": "请从百度网盘下载完整整合包"/);
  //By leewheel 2026-11-05 误报修复：待装队列必须带上本机核心编译时间，界面徽标只认队列
  assert.match(read('src/main.cjs'), /releaseUpdate\.pendingReleases\(\{ releases, history, current, builtAt/);
  assert.match(read('src/main.cjs'), /const coreBuiltAt = async \(\) =>/);
  assert.match(read('public/js/serverhome.js'), /const newer = \(info\.pending\?\.length \|\| 0\) > 0;/);
  //End By leewheel
  const card = /function directInstallCard\(working, p\) \{[\s\S]*?\n\}/.exec(read('public/js/server.js'))?.[0] || '';
  assert.ok(card, '安装卡片必须存在');
  assert.equal(card.includes('data-action="install-server"'), false, '"安装服务器"按钮已删除');
  assert.equal(card.includes('data-action="server-choose"'), false, '"我已经有服务器文件夹"按钮已删除');
  assert.match(card, /请从百度网盘下载完整整合包/);
  const home = read('public/js/serverhome.js');
  assert.equal(home.includes('data-action="install-server"'), false, '主页也不再有"安装服务器"按钮');
  assert.equal(home.includes('data-action="server-choose"'), false, '主页也不再有"我已经有服务器文件夹"按钮');
});
//End By leewheel
