'use strict';
//By leewheel 2026年11月4日 发布版配置的可移植性测试：配置文件跟着整合包走、目录一律相对启动器所在目录解析。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const portable = require('../src/portable-config.cjs');

const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); };

test('the portable config folder is only used when the repack really has a Server folder', async () => {
  const root = await tempDir();
  assert.equal(portable.portableDir(root), '', 'a game-only folder is left alone');
  fs.mkdirSync(path.join(root, 'Server'), { recursive: true });
  const dir = portable.portableDir(root);
  assert.equal(dir, path.join(root, 'Server', 'configs'));
  assert.ok(fs.existsSync(dir), 'Server\\configs is created for the launcher files');
});

test('a missing launcher.config.json is generated from the bundled one and never overwritten', async () => {
  const root = await tempDir();
  const dir = path.join(root, 'Server', 'configs');
  fs.mkdirSync(dir, { recursive: true });
  const bundled = path.join(root, 'launcher.config.json');
  fs.writeFileSync(bundled, '{"appName":"内置"}');
  assert.equal(portable.ensureConfigFile(dir, bundled), path.join(dir, 'launcher.config.json'));
  assert.equal(fs.readFileSync(path.join(dir, 'launcher.config.json'), 'utf8'), '{"appName":"内置"}');
  // 玩家/管理员改过的配置保留，不被内置覆盖
  fs.writeFileSync(path.join(dir, 'launcher.config.json'), '{"appName":"我自己改的"}');
  portable.ensureConfigFile(dir, bundled);
  assert.equal(fs.readFileSync(path.join(dir, 'launcher.config.json'), 'utf8'), '{"appName":"我自己改的"}');
});

test('a broken launcher.config.json is kept aside and a default takes its place', async () => {
  const root = await tempDir();
  const dir = path.join(root, 'Server', 'configs');
  fs.mkdirSync(dir, { recursive: true });
  const bundled = path.join(root, 'bundled.json');
  fs.writeFileSync(bundled, '{"appName":"内置"}');
  fs.writeFileSync(path.join(dir, 'launcher.config.json'), '{"appName": 半截');
  const used = portable.ensureConfigFile(dir, bundled);
  assert.equal(used, path.join(dir, 'launcher.config.json'));
  assert.equal(JSON.parse(fs.readFileSync(used, 'utf8')).appName, '内置');
  const kept = fs.readdirSync(dir).filter(name => name.startsWith('launcher.config.json.broken-'));
  assert.equal(kept.length, 1, '坏文件留档，不删除');
});

test('the old settings of %APPDATA% move into the repack once', async () => {
  const root = await tempDir();
  const legacy = path.join(root, 'appdata', 'settings.json');
  touch(legacy);
  fs.writeFileSync(legacy, '{"language":"zh"}');
  const target = path.join(root, 'Server', 'configs', 'launcher-settings.json');
  assert.equal(portable.migrateSettings(target, legacy), true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"language":"zh"}');
  fs.writeFileSync(target, '{"language":"fr"}');
  assert.equal(portable.migrateSettings(target, legacy), false, '已有的便携设置不被老文件盖掉');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"language":"fr"}');
});

test('folders are stored relative to the launcher when they are inside it', async () => {
  const root = path.resolve('D:\\CoA-Publish');
  assert.equal(portable.toStoredPath(path.join(root, 'Client'), root), 'Client');
  assert.equal(portable.toStoredPath(path.join(root, 'Server', 'configs'), root), path.join('Server', 'configs'));
  assert.equal(portable.toStoredPath(path.resolve('E:\\Games\\WoW'), root), path.resolve('E:\\Games\\WoW'), '外部目录保持绝对');
  assert.equal(portable.toStoredPath('', root), '');
});

test('a folder of another drive or an old name falls back to the launcher siblings', () => {
  const root = path.resolve('D:\\CoA-Publish');
  const other = path.resolve('E:\\另一份整合包');
  const has = new Set([path.join(root, 'Client'), path.join(root, 'Server'), path.resolve('E:\\Games\\WoW'), path.join(other, 'Client'), path.join(other, 'Server')].map(p => p.toLowerCase()));
  const exists = folder => has.has(path.resolve(folder).toLowerCase());
  assert.equal(portable.resolveArea('server', 'F:\\COA-PUBLISH-REPACK\\Server', root, exists), path.normalize(path.join(root, 'Server')), '失效的绝对目录回到同级 Server\\');
  assert.equal(portable.resolveArea('game', 'G:\\ascension-live', root, exists), path.normalize(path.join(root, 'Client')), '失效的游戏目录回到同级 Client\\');
  assert.equal(portable.resolveArea('addon', 'Client', root, exists), path.normalize(path.join(root, 'Client')), '相对目录按启动器所在目录展开');
  assert.equal(portable.resolveArea('game', path.resolve('E:\\Games\\WoW'), root, exists), path.normalize(path.resolve('E:\\Games\\WoW')), '玩家手选且存在的目录不动');
  assert.equal(portable.resolveArea('game', path.join(other, 'Client'), root, exists), path.normalize(path.join(root, 'Client')), '另一份整合包的 Client 也回到本包');
  assert.equal(portable.resolveArea('server', path.join(other, 'Server'), root, exists), path.normalize(path.join(root, 'Server')), '另一份整合包的 Server 也回到本包');
  has.delete(path.join(root, 'Server').toLowerCase());
  assert.equal(portable.resolveArea('addon', 'Client', root, exists), path.normalize(path.join(root, 'Client')));
  assert.equal(portable.resolveArea('server', 'Client', root, () => false), path.normalize(path.join(root, 'Client')), '哪儿都不存在时把用过的路径报出来，页面才能提示找不到');
});
