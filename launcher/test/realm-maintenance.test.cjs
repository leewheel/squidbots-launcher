'use strict';
//By leewheel 2026年11月19日 国度维护（备份 / 恢复 / 重置世界）的纯逻辑测试：
// 库名规则、备份列表过滤与排序、重置的二次确认与「运行中不许动」。
// 真正读写数据库的部分不在这里跑（要活的 MySQL），只钉住不碰库的那些判据。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const maintenance = require('../src/realm-maintenance.cjs');

test('库名规则：主服是 acore_characters / acore_playerbots，其它国度各带后缀', () => {
  assert.deepEqual(maintenance.databasesOf('coa'), ['acore_characters', 'acore_playerbots']);
  assert.deepEqual(maintenance.databasesOf('living'), ['acore_characters_living', 'acore_playerbots_living']);
  assert.deepEqual(maintenance.databasesOf('dawnrise'), ['acore_characters_dawnrise', 'acore_playerbots_dawnrise']);
});

test('库名规则：非法标识直接拒绝（防拼接进 SQL）', () => {
  assert.throws(() => maintenance.databasesOf('living; DROP DATABASE acore_world'), /不合法/);
  assert.throws(() => maintenance.databasesOf(''), /不合法/);
});

test('重置必须输入国度名，输错一个字都不动（也不会先备份）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-reset-'));
  try {
    await assert.rejects(
      () => maintenance.reset(root, 'living', { typedName: 'Malfurio', expectName: 'Malfurion', stopped: true }),
      /国度名不对/,
    );
    // 名字不对时连 Backups 目录都不该出现（说明没走到备份/清库那一步）
    assert.equal(fs.existsSync(path.join(root, 'Backups')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('国度还在运行时拒绝重置（运行中清库会写坏数据）', async () => {
  await assert.rejects(
    () => maintenance.reset(os.tmpdir(), 'living', { typedName: 'Malfurion', expectName: 'Malfurion', stopped: false }),
    /还在运行/,
  );
});

test('恢复备份同样要求国度先停下', async () => {
  await assert.rejects(
    () => maintenance.restore(os.tmpdir(), 'living', 'x.sql.gz', { stopped: false }),
    /还在运行/,
  );
});

test('备份列表只列这个国度的、按时间倒序', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-list-'));
  try {
    const dir = path.join(root, 'Backups');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of [
      'realm-living-20261118-101010.sql.gz',
      'realm-living-20261119-090909.sql.gz',
      'realm-dawnrise-20261119-090909.sql.gz',
      'realm-living-20261119-090909.sql',      // 不带 .gz，不算
      'other-20261119-090909.sql.gz',          // 不是国度备份，不算
    ]) fs.writeFileSync(path.join(dir, name), 'x');
    const list = await maintenance.list(root, 'living');
    assert.deepEqual(list.map(item => item.name), ['realm-living-20261119-090909.sql.gz', 'realm-living-20261118-101010.sql.gz']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('恢复时拒绝不存在的文件与不合规的文件名', async () => {
  await assert.rejects(() => maintenance.restore(os.tmpdir(), 'living', 'C:\\none\\nope.sql.gz', { stopped: true }), /找不到/);
  await assert.rejects(() => maintenance.restore(os.tmpdir(), 'living', 'whatever.sql.gz', { stopped: true }), /找不到/);
});
