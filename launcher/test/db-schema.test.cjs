'use strict';
//By leewheel 2026年11月9日 数据表清单核对的回归测试。
// 这块的意义：更新完必须能说清“缺哪张表、缺哪个字段”，而且不能因为发布库本来就比开发库旧就把玩家卡死。
// 所以规则要死死钉住：本包 SQL 声明要建的没建 → 失败；不归本包管的缺 → 只提示；bak_* 备份表 → 完全不管。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../src/db-schema.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coa-dbcheck-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// 假 MySQL：按 “库名 → 表 → 字段” 的固定结构回答 information_schema 查询
const fakeQuery = schema => async (sql, database) => {
  const db = schema[database];
  if (!db) return '';
  if (/information_schema\.TABLES/.test(sql)) return Object.keys(db).join('\n');
  // COLUMNS 查询是“一行一个字段”（--batch 多列用 Tab 分隔）
  return Object.entries(db).flatMap(([table, columns]) => columns.map(column => `${table}\t${column}`)).join('\n');
};

test('清单目录：包根的 dbcheck/schema-*.json 能被读到', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema-2026.11.09.json'), JSON.stringify({ schema: 1, source: '127.0.0.1:3395', databases: { acore_auth: { tables: { account: { columns: ['id'] } } } } }));
  const found = await db.readManifest(root);
  assert.ok(found, '必须能找到清单');
  assert.equal(found.name, 'schema-2026.11.09.json');
  assert.equal(found.data.source, '127.0.0.1:3395');
});

test('清单目录：没有 dbcheck 就是 null，不能抛错', async () => {
  assert.equal(await db.readManifest(tmpdir()), null);
});

test('表与字段全齐：没有任何问题', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_world: { tables: { creature: { columns: ['guid', 'name'] }, item: { columns: ['entry'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({
    query: fakeQuery({ acore_world: { creature: ['guid', 'name'], item: ['entry'] } }),
    manifest,
    sqlRoot: '',
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.tables, 2);
  assert.equal(result.columns, 3);
});

test('本包 SQL 要建的表没建出来：硬失败，并写明是哪张表', async () => {
  const root = tmpdir();
  const sqlRoot = path.join(root, 'sql');
  write(path.join(sqlRoot, 'acore_world', '01_missing.sql'), 'CREATE TABLE IF NOT EXISTS `coa_boss_leash` (`id` int);\n');
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_world: { tables: { coa_boss_leash: { columns: ['id'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: fakeQuery({ acore_world: { creature: ['guid'] } }), manifest, sqlRoot });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /acore_world\.coa_boss_leash/);
  assert.match(result.problems[0], /脚本没生效/);
  assert.equal(result.missingTables, 1);
});

test('不归本包管的表缺了：只提示，不算失败（发布库本来就可能比开发库旧）', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_world: { tables: { ascension_class_stats: { columns: ['id'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: fakeQuery({ acore_world: { creature: ['guid'] } }), manifest, sqlRoot: '' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /ascension_class_stats/);
});

test('bak_ 备份表缺了：一句话都不记，也不算进缺表数', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_world: { tables: { bak_item_20261031: { columns: ['entry'] }, creature: { columns: ['guid'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: fakeQuery({ acore_world: { creature: ['guid'] } }), manifest, sqlRoot: '' });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.missingTables, 0);
});

test('整库不存在：本包不往里建表就只提示', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_playerbots: { tables: { playerbot: { columns: ['guid'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: fakeQuery({ acore_world: { creature: ['guid'] } }), manifest, sqlRoot: '' });
  assert.deepEqual(result.problems, []);
  assert.match(result.warnings[0], /acore_playerbots 不存在/);
});

test('整库不存在但本包往里建表：硬失败', async () => {
  const root = tmpdir();
  const sqlRoot = path.join(root, 'sql');
  write(path.join(sqlRoot, 'acore_playerbots', '01.sql'), 'CREATE TABLE `playerbot` (`guid` int);\n');
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_playerbots: { tables: { playerbot: { columns: ['guid'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: fakeQuery({ acore_world: {} }), manifest, sqlRoot });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /本包 SQL 就是往这个库建表/);
});

test('字段缺失：本包有 ALTER TABLE ADD 才算失败，否则只提示', async () => {
  const root = tmpdir();
  const sqlRoot = path.join(root, 'sql');
  write(path.join(sqlRoot, 'acore_characters', '01.sql'), 'ALTER TABLE `characters` ADD COLUMN `coa_note` varchar(64) NULL;\n');
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({
    databases: { acore_characters: { tables: { characters: { columns: ['guid', 'coa_note', 'totem_note'] } } } },
  }));
  const manifest = await db.readManifest(root);
  const result = await db.checkSchema({ query: async () => 'characters\tguid', manifest, sqlRoot });
  assert.equal(result.problems.length, 1, 'coa_note 本包负责补，没补上必须报错');
  assert.match(result.problems[0], /characters\.characters\.coa_note/);
  assert.equal(result.warnings.length, 1, 'totem_note 不归本包管，只提示');
  assert.match(result.warnings[0], /totem_note/);
  assert.equal(result.missingColumns, 2);
});

test('报告：把“必须修”和“只做提示”分开写，能直接拿去对账', async () => {
  const root = tmpdir();
  write(path.join(root, 'dbcheck', 'schema.json'), JSON.stringify({ source: '127.0.0.1:3395', databases: {} }));
  const manifest = await db.readManifest(root);
  const text = db.renderReport({
    manifest,
    result: { databases: 1, tables: 2, columns: 3, missingTables: 1, missingColumns: 0, problems: ['acore_world.x：表不存在'], warnings: ['acore_world.y：表不存在'] },
    at: '2026-11-09T00:00:00Z',
  });
  assert.match(text, /必须修的（1）/);
  assert.match(text, /只做提示的（1）/);
  assert.match(text, /acore_world\.x：表不存在/);
});
