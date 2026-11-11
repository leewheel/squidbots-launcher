'use strict';
//By leewheel 2026-11-10 两条发布相关规则的回归测试：
//  ① SQL 脚本按文件名里的数字大小排序（78 在 100 之前），不能按字典序；
//  ② 累积包：一个包带着前面所有内容时，玩家只下这一个，旧补丁不再排队。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pendingReleases, queueUpTo, naturalCompare, coverageOf, coverageMap } = require('../src/release-update.cjs');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------- ① SQL 排序
test('SQL 排序：78 排在 100 之前（字典序会反过来，实弹 bug）', () => {
  assert.ok(naturalCompare('78_item_description.sql', '100_rev_ptr.sql') < 0);
  assert.ok(naturalCompare('113_fix.sql', '78_fill.sql') > 0);
  assert.ok(naturalCompare('99_last.sql', '100_first.sql') < 0);
});

test('SQL 排序：带日期的老文件名不被当成序号截断', () => {
  // 11.08 包里有 2026_11_08_01_coa_bot_settings.sql，绝不能被读成“序号 2026”而排到最前
  assert.ok(naturalCompare('75_rev_zh_batch2.sql', '2026_11_08_01_coa_bot_settings.sql') < 0);
  assert.ok(naturalCompare('2026_11_08_01_coa_bot_settings.sql', '2026_11_08_02_coa_bot_prefix_default.sql') < 0);
});

test('SQL 排序：11.10 包里的 36 个脚本按编号升序，113 一定在 82 之后', () => {
  const names = [
    '100_rev_ptr_help.sql', '101_a.sql', '109_b.sql', '110_c.sql', '111_d.sql', '112_zh.sql', '113_fix.sql',
    '78_fill.sql', '79_patch.sql', '80_a.sql', '81_b.sql', '82_mokrash.sql', '99_last.sql',
  ];
  const sorted = names.slice().sort(naturalCompare);
  assert.deepEqual(
    sorted,
    ['78_fill.sql', '79_patch.sql', '80_a.sql', '81_b.sql', '82_mokrash.sql', '99_last.sql',
      '100_rev_ptr_help.sql', '101_a.sql', '109_b.sql', '110_c.sql', '111_d.sql', '112_zh.sql', '113_fix.sql'],
  );
  // 这条是本次要防的具体后果：113 把 82 写坏的 spell_proc 归零，113 必须后跑
  assert.ok(sorted.indexOf('82_mokrash.sql') < sorted.indexOf('113_fix.sql'));
});

test('SQL 排序：导入计划确实用的是数字排序（不是字典序）', () => {
  const src = read('src/release-update.cjs');
  assert.match(src, /sort\(\(a, b\) => naturalCompare\(a\.rel, b\.rel\)\)/);
  assert.equal(/localeCompare\(b\.rel, 'en'\)/.test(src), false, '字典序写法必须已经消失');
});

// ---------------------------------------------------------------- ② 累积包
const rel = (day, extra = {}) => ({
  version: `2026.11.${String(day).padStart(2, '0')}`,
  tag: `COA-Update-2026.11.${String(day).padStart(2, '0')}`,
  name: `COA-Update-2026.11.${String(day).padStart(2, '0')}`,
  publishedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  notes: '',
  assets: [{ name: `CoA-Update-2026.11.${String(day).padStart(2, '0')}.zip`, size: 1, url: `https://example.test/${day}.zip` }],
  ...extra,
});

test('累积包识别：说明里写「累计基线」/「cumulative」都认，点分与紧凑写法都认', () => {
  assert.equal(coverageOf({ notes: '累计基线: 20261107', assets: [] }), 20261107);
  assert.equal(coverageOf({ notes: '累计基线：2026.11.07', assets: [] }), 20261107);
  assert.equal(coverageOf({ notes: 'cumulative: 2026-11-07', assets: [] }), 20261107);
  assert.equal(coverageOf({ notes: '普通补充说明，没有标记', assets: [] }), 0);
});

test('累积包识别：资产名带 -full 的老全量包按“涵盖全部历史”处理', () => {
  assert.equal(coverageOf({ notes: '', assets: [{ name: 'CoA-Update-2026.11.08.11-full.zip' }] }), 1);
  assert.equal(coverageOf({ notes: '', assets: [{ name: 'CoA-Update-2026.11.10.zip' }] }), 0);
});

test('累积包：最新那一版带着全部内容，就不再去下 11.08 / 11.09', () => {
  const releases = [
    rel(10, { notes: '累计基线: 20261107' }),
    rel(9), rel(8),
  ];
  const pending = pendingReleases({ releases, history: [], baseline: 'coa-publish-20261107' });
  assert.deepEqual(pending.map(item => item.version), ['2026.11.10'], '只排累积包一个');
});

test('累积包：比它更新的小补丁照装，不越权吞掉后面的', () => {
  const releases = [rel(12), rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8)];
  assert.deepEqual(
    pendingReleases({ releases, history: [], baseline: 'coa-publish-20261107' }).map(item => item.version),
    ['2026.11.10', '2026.11.12'],
  );
});

test('累积包：声明基线之前的砍掉，比基线还老的老补丁留着（包里没带，不能吞）', () => {
  // 累积包只涵盖 11.07 以后的内容，11.06 那版比基线还老、包里没带
  const releases = [rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8), rel(6)];
  assert.deepEqual(
    pendingReleases({ releases, history: [], baseline: '' }).map(item => item.version),
    ['2026.11.06', '2026.11.10'],
  );
});

test('累积包：respectCoverage=false 时退回老语义（强制装旧版要用）', () => {
  const releases = [rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8)];
  assert.deepEqual(
    pendingReleases({ releases, history: [], baseline: '', respectCoverage: false }).map(item => item.version),
    ['2026.11.08', '2026.11.09', '2026.11.10'],
  );
});

test('强制更新到最新：只要累积包一个，不再拖着一串旧补丁', () => {
  const releases = [rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8)];
  const { queue, target } = queueUpTo({ releases, history: [], targetVersion: '' });
  assert.equal(target.version, '2026.11.10');
  assert.deepEqual(queue.map(item => item.version), ['2026.11.10']);
});

test('强制更新点名旧版：仍然把它前面的补丁一起排进去（不能被覆盖率吞掉）', () => {
  const releases = [rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8)];
  const { queue, target } = queueUpTo({ releases, history: [], targetVersion: '2026.11.09' });
  assert.equal(target.version, '2026.11.09');
  assert.deepEqual(queue.map(item => item.version), ['2026.11.08', '2026.11.09']);
});

test('界面：被覆盖的旧版本能标出是谁包含它的', () => {
  const map = coverageMap({ releases: [rel(10, { notes: '累计基线: 20261107' }), rel(9), rel(8)] });
  assert.equal(map['2026.11.08'], '2026.11.10');
  assert.equal(map['2026.11.09'], '2026.11.10');
  assert.equal(map['2026.11.10'], undefined, '累积包自己不算被覆盖');
});

test('界面：没有累积包时一个都不标', () => {
  assert.deepEqual(coverageMap({ releases: [rel(9), rel(8)] }), {});
});
