'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tempDir, write } = require('./helpers.cjs');
const { validate } = require('../src/config.cjs');
const support = require('../src/support.cjs');
const { BotsPackage } = require('../src/bots.cjs');
const { sanitize } = require('../src/settings.cjs');

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8'));

// 上游"完整版"配置（带游戏更新、CoA Bots 包与两条更新通道）：本节里测试的是这些逻辑本身，
// 与"本发布版实际发的是什么配置"无关，所以在这里自己拼一份，不依赖随包文件。
function withBots() {
  const config = structuredClone(BASE);
  config.game.manifestUrl = 'https://updates.example.com/game/latest.json';
  config.game.addonCatalogUrl = 'https://updates.example.com/addons/catalog.json';
  config.game.releaseKey = config.server.description ? '' : '';
  config.feedUrl = 'https://updates.example.com/feed.json';
  config.launcherUpdateUrl = 'https://updates.example.com/launcher/';
  Object.assign(config.server, {
    manifestUrl: 'https://updates.example.com/repack/latest.json',
    updatesUrl: 'https://updates.example.com/update.json',
    componentsUrl: 'https://updates.example.com/components/',
    mmapsUrl: 'https://updates.example.com/mmaps/',
    bots: {
      name: 'CoA Bots',
      folder: 'CoA-Bots',
      requiredExecutable: 'Core/worldserver.exe',
      manifestUrl: '',
      install: { script: 'Installer-Bots.ps1', args: ['-Repack', '{root}', '-NoAddon', '-NoDashboard'], timeout: 1200 },
      addon: 'squidbots-lite',
    },
    commands: {
      stopAll: { exe: 'Runtime/python/python.exe', args: ['-B', 'Scripts/manage.py', 'stop-all'], timeout: 240 },
      console: { exe: 'Runtime/python/python.exe', args: ['-B', 'Scripts/manage.py', 'console'], timeout: 60 },
      purgeBots: { exe: 'Runtime/python/python.exe', args: ['-B', 'CoA-Bots/coa_bots.py', 'purge-bots'], timeout: 600 },
    },
  });
  return config;
}

test('the shipped configuration is valid: this repack, offline, three local services', () => {
  const { loadConfig } = require('../src/config.cjs');
  const config = loadConfig(path.join(__dirname, '..', 'launcher.config.json'));
  assert.equal(config.edition, 'server', '本地服务器版');
  assert.equal(config.game.clientExecutable, 'Ascension.exe');
  assert.equal(config.game.realmlists[0].address, '127.0.0.1');
  assert.equal(config.server.requiredExecutable, 'worldserver.exe', '发布版的服务器程序在根目录');
  assert.deepEqual(config.server.services.map(service => [service.id, service.port, service.exe]), [
    ['mysql', 3396, 'mysql/bin/mysqld.exe'],
    ['world', 8085, 'worldserver.exe'],
    ['auth', 3724, 'authserver.exe'],
  ]);
  assert.equal(config.server.services[0].args.includes('--port=3396'), true, 'MySQL 端口写死，避免 my.ini 漂移');
  assert.equal(config.server.services.find(service => service.id === 'world').console, true, '世界控制台走标准输入');
  assert.equal(config.server.services.find(service => service.id === 'world').stopCommand, 'server shutdown 1s 0');
  assert.equal(config.server.bots, null, '机器人编译在核心里，不需要单独的 CoA Bots 包');
  assert.equal(config.feedUrl, '', '离线整合版：不连任何更新地址');
  assert.equal(config.launcherUpdateUrl, '');
  assert.equal(Object.values(config.keys).every(key => key === null), true, '没有任何签名密钥');
});

test('a full edition configuration (updates, bots package) still validates', async () => {
  const { loadConfig } = require('../src/config.cjs');
  const file = path.join(await tempDir(), 'launcher.config.json');
  await fsp.writeFile(file, JSON.stringify(withBots()));
  const config = loadConfig(file);
  assert.equal(config.server.bots.folder, 'CoA-Bots');
  assert.deepEqual(config.server.bots.install.args, ['-Repack', '{root}', '-NoAddon', '-NoDashboard']);
  assert.equal(config.edition, 'server');
});

test('hostile configurations are refused', () => {
  const clone = () => withBots();
  const cases = [
    config => { config.game.manifestUrl = 'http://evil.example.com/latest.json'; },
    config => { config.server.bots.folder = '../../Windows'; },
    config => { config.server.bots.install.script = 'C:/Windows/System32/evil.ps1'; },
    config => { config.server.bots.install.args = ['-Repack', '..\\..']; },
    config => { config.game.clientExecutable = '..\\cmd.exe'; },
    config => { config.game.realmlists = [{ name: 'x', address: 'a b; c' }]; },
    config => { config.server.services[0].exe = 'C:/Windows/System32/evil.exe'; },
    config => { config.server.services[0].args = ['..\\..\\evil']; },
  ];
  for (const change of cases) { const config = clone(); change(config); assert.throws(() => validate(config)); }
  const discord = clone();
  discord.discordUrl = 'https://evil.example.com/';
  assert.equal(validate(discord).discordUrl, '', 'only discord.gg invites are kept');
});

test('settings keep a valid realmlist only', () => {
  assert.equal(sanitize({ realmlist: '192.168.1.20' }).realmlist, '192.168.1.20');
  assert.equal(sanitize({ realmlist: 'play.example.org:3725' }).realmlist, 'play.example.org:3725');
  assert.equal(sanitize({ realmlist: 'x"; del C:' }).realmlist, '');
  assert.deepEqual(sanitize({ installPaths: { game: 'C:\\Games\\CoA', 'bad key': 'C:\\x', server: 'relative' } }).installPaths, { game: path.normalize('C:\\Games\\CoA') });
});

test('the support report is a real zip and holds no password', async () => {
  const root = await tempDir();
  const game = path.join(root, 'game');
  const server = path.join(root, 'server');
  await write(game, { 'Errors/crash-1.txt': 'Crash at 0x1234', 'WTF/Config.wtf': 'SET accountName "ME"' });
  await write(server, { 'logs/launcher-world.log': 'started\nLoginDatabaseInfo = "127.0.0.1;3307;acore;SECRETPASS;acore_auth"\nready', 'Core/Logs/Errors.log': 'error one', 'mysql/admin-client.ini': 'password=SECRETPASS' });
  const zip = await support.buildReport({ summary: 'Launcher 0.1.0\nToken: abc123', gameRoot: game, serverRoot: server });
  const file = path.join(root, 'report.zip');
  await fsp.writeFile(file, zip);
  const listing = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-tf', file], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(listing.sort(), ['client/Errors/crash-1.txt', 'report.txt', 'server/Core/Logs/Errors.log', 'server/launcher/launcher-world.log'].sort());
  const out = path.join(root, 'out');
  await fsp.mkdir(out);
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', out]);
  const world = await fsp.readFile(path.join(out, 'server/launcher/launcher-world.log'), 'utf8');
  assert.match(world, /LoginDatabaseInfo = \[removed\]/);
  assert.equal(world.includes('SECRETPASS'), false);
  assert.match(await fsp.readFile(path.join(out, 'report.txt'), 'utf8'), /Token: \[removed\]/);
});

test('the bot installer runs from the package folder and its output is streamed', async () => {
  const root = await tempDir();
  await write(root, { 'CoA-Bots/Installer-Bots.ps1': 'param([string]$Repack)\nWrite-Host "==> Checking the repack"\nWrite-Host "repack: $Repack"\nexit 0\n', 'CoA-Bots/Fail.ps1': 'Write-Host "Not a CoA repack"\nexit 1\n' });
  const lines = [];
  const bots = new BotsPackage({ bots: { folder: 'CoA-Bots', manifestUrl: 'http://127.0.0.1:1/latest.json', requiredExecutable: 'Core/worldserver.exe', install: { script: 'Installer-Bots.ps1', args: ['-Repack', '{root}'], timeout: 60 } }, key: null, onLine: line => lines.push(line) });
  const result = await bots.runInstaller(root);
  assert.ok(result.ok);
  assert.ok(lines.includes('==> Checking the repack'));
  assert.ok(lines.some(line => line === `repack: ${path.resolve(root)}`));
  assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-bots-install.log'), 'utf8'), /Checking the repack/);
  bots.bots.install.script = 'Fail.ps1';
  await assert.rejects(bots.runInstaller(root), /Not a CoA repack/);
  bots.bots.install.script = '../outside.ps1';
  await assert.rejects(bots.runInstaller(root), /missing/);
});

test('stopping retries once when the repack script fails the first time', async () => {
  const { ServerControl } = require('../src/server-control.cjs');
  const root = await tempDir();
  await fsp.copyFile(process.execPath, path.join(root, 'runner.exe'));
  await write(root, { 'stop.js': "const fs=require('fs');const p=__dirname+'/tried';if(!fs.existsSync(p)){fs.writeFileSync(p,'1');console.log('ERROR: connection reset');process.exit(1)}console.log('All services stopped.')" });
  const control = new ServerControl({ root, services: [{ id: 'mysql', name: 'MySQL', port: 1, start: null }], commands: { stopAll: { exe: 'runner.exe', args: ['stop.js'], timeout: 30 } } });
  control.retryDelay = 50;
  await control.stopAll();
  assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-stop-all.log'), 'utf8'), /connection reset[\s\S]*All services stopped/);
  assert.equal(control.states.size, 0);
});

test('the red dot only lights up for a newer published core or bots release', async () => {
  const { isNewer, peekUpdates } = require('../src/updates.cjs');
  assert.equal(isNewer({ version: 'r5', publishedAt: '2026-09-29T10:00:00Z' }, { version: 'r6', publishedAt: '2026-09-30T10:00:00Z' }), true);
  assert.equal(isNewer({ version: 'r6', publishedAt: '2026-09-30T10:00:00Z' }, { version: 'r5', publishedAt: '2026-09-29T10:00:00Z' }), false, 'an older release is not an update');
  assert.equal(isNewer({ version: 'r5' }, { version: 'r5' }), false);
  assert.equal(isNewer(null, { version: 'r6' }), false, 'a folder the launcher never installed raises no flag');
  const updater = (installed, release) => ({ installedState: async () => installed, peek: async () => release });
  const repack = updater({ version: 'r5', publishedAt: '1' }, { version: 'r6', publishedAt: '2' });
  const bots = { info: async () => ({ installed: true }), folder: root => root + '/CoA-Bots', updater: updater({ version: 'b1', publishedAt: '1' }, { version: 'b1', publishedAt: '1' }) };
  assert.deepEqual(await peekUpdates({ folder: 'C:/x', repack, bots }), { core: 'r6', bots: null });
  const offline = { installedState: async () => ({ version: 'r5' }), peek: async () => { throw new Error('offline'); } };
  assert.deepEqual(await peekUpdates({ folder: 'C:/x', repack: offline, bots: null }), { core: null, bots: null });
  assert.deepEqual(await peekUpdates({ folder: '', repack, bots }), { core: null, bots: null });
});

test('two looks on the classic skin: abyss (default) and amber', () => {
  assert.equal(sanitize({}).theme, 'abyss');
  assert.equal(sanitize({ theme: 'classic' }).theme, 'classic');
  assert.equal(sanitize({ theme: 'abyss' }).theme, 'abyss');
  assert.equal(sanitize({ theme: 'forge' }).theme, 'abyss');
  assert.equal(sanitize({ theme: '../evil' }).theme, 'abyss');
});

test('updates-only mode: the base game link must be HTTPS', () => {
  const config = structuredClone(BASE);
  config.game.updatesOnly = true;
  config.game.baseClient = { url: 'https://drive.proton.me/urls/EXAMPLE', note: { fr: 'Client de base' } };
  const valid = validate(config);
  assert.equal(valid.game.updatesOnly, true);
  assert.equal(valid.game.baseClient.url, 'https://drive.proton.me/urls/EXAMPLE');
  config.game.baseClient.url = 'http://127.0.0.1/client.zip';
  assert.throws(() => validate(config), /HTTPS/);
  assert.equal(validate(BASE).game.updatesOnly, false);
});

test('stable and test channels: optional test addresses, validated like the others', () => {
  const config = withBots();
  config.server.testManifestUrl = 'https://updates.example.com/test/repack/latest.json';
  config.server.bots.testManifestUrl = 'https://updates.example.com/test/bots/latest.json';
  delete config.game.testManifestUrl;
  const valid = validate(config);
  assert.equal(valid.server.testManifestUrl, config.server.testManifestUrl);
  assert.equal(valid.server.bots.testManifestUrl, config.server.bots.testManifestUrl);
  assert.equal(valid.game.testManifestUrl, '');
  config.game.testManifestUrl = 'http://evil.example.com/latest.json';
  assert.throws(() => validate(config), /HTTPS/);
  assert.equal(sanitize({}).channel, 'stable');
  assert.equal(sanitize({ channel: 'test' }).channel, 'test');
  assert.equal(sanitize({ channel: 'nightly' }).channel, 'stable');
});

test('the server edition starts without a bots channel (bots come with the core)', () => {
  const { loadConfig } = require('../src/config.cjs');
  const { BotsPackage } = require('../src/bots.cjs');
  const config = loadConfig(require('node:path').join(__dirname, '../editions/server/launcher.config.json'));
  assert.equal(config.server.bots, null, '发布版没有单独的 CoA Bots 包');
  assert.equal(config.server.commands.console, null, '没有 Python 控制台脚本');
  const bots = new BotsPackage({ bots: { folder: 'CoA-Bots', manifestUrl: '', requiredExecutable: 'Core/worldserver.exe', install: { script: 'x.ps1', args: [] } }, key: config.keys.bots });
  assert.equal(bots.updater.busy, false);
});

test('the bot installer is run again when MySQL refuses a connection for a moment', async () => {
  const root = await tempDir();
  const marker = path.join(root, 'tries.txt');
  await write(root, { 'CoA-Bots/Flaky.ps1': `$f = '${marker}'\nif (-not (Test-Path $f)) { Set-Content $f 1; Write-Host "ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:3306' (10048)"; exit 1 }\nWrite-Host "imported"\nexit 0\n`, 'CoA-Bots/Broken.ps1': 'Write-Host "ERROR 1045: Access denied"\nexit 1\n' });
  const lines = [];
  const bots = new BotsPackage({ bots: { folder: 'CoA-Bots', manifestUrl: 'http://127.0.0.1:1/latest.json', requiredExecutable: 'Core/worldserver.exe', install: { script: 'Flaky.ps1', args: [], timeout: 60 } }, key: null, onLine: line => lines.push(line) });
  bots.retryDelay = 10;
  assert.ok((await bots.runInstaller(root)).ok);
  assert.ok(lines.includes('imported'));
  assert.ok(lines.some(line => /trying again/.test(line)));
  bots.bots.install.script = 'Broken.ps1';
  lines.length = 0;
  await assert.rejects(bots.runInstaller(root), /Access denied/);
  assert.equal(lines.some(line => /trying again/.test(line)), false);
});

test('the player config keeps its own values and gets the new keys of the bundled one', () => {
  const { mergeConfig } = require('../src/config.cjs');
  const bundled = { appName: 'SquidBots Server', newOption: 5, server: { description: 'new', services: [{ id: 'mysql' }, { id: 'world' }], bots: { name: 'CoA Bots', fresh: true } } };
  const own = { appName: 'My server', server: { services: [{ id: 'mysql' }], bots: { name: 'Mine' } } };
  const merged = mergeConfig(bundled, own);
  assert.equal(merged.appName, 'My server');
  assert.equal(merged.newOption, 5);
  assert.equal(merged.server.description, 'new');
  assert.deepEqual(merged.server.services, [{ id: 'mysql' }]);
  assert.deepEqual(merged.server.bots, { name: 'Mine', fresh: true });
  assert.equal(bundled.server.bots.name, 'CoA Bots');
});

test('a database build that was cut is not taken as done', async () => {
  const assembler = require('../src/assembler.cjs');
  const root = await tempDir();
  const steps = Object.fromEntries(['dbc', 'maps', 'vmaps', 'sql'].map(step => [step, { at: 1 }]));
  await write(root, { 'Assembler/coa_assemble.py': '', 'mysql/data/mysql/user.ibd': '', '.state/assemble.json': JSON.stringify({ steps }), '.state/assemble-db-started': '1' });
  assert.deepEqual(assembler.state(root).missing, ['db']);
  await fsp.rm(path.join(root, '.state', 'assemble-db-started'));
  assert.deepEqual(assembler.state(root).missing, []);
});
