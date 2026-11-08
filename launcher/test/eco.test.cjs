'use strict';
//By leewheel 2026年11月9日 省电模式（eco）的回归测试。
// 这块的风险全在"配置被留在 eco 值上"：断电、强杀、玩家中途自己改过值——每一种都必须还原成玩家的原值。
// 所以规则钉死：原值先进 eco-state.json；已经有更省的值就不动；玩家中途改过的值以玩家为准。
// AiPlayerbot.BotActiveAlone 是百分比（0~100，60 = 六成机器人单独活动，0 = 只有满足强制规则的活跃），
// 省电值因此是 1（1%，玩家附近仍由 AiPlayerbot.BotActiveAloneForceWhenInRadius 强制唤醒）。
process.env.COA_ECO_AFTER_MS = '1';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const eco = require('../src/eco.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coa-eco-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = file => fs.readFileSync(file, 'utf8');

const CONF = 'AiPlayerbot.BotActiveAlone';
const VER = '# AiPlayerbot.Version = 2.9.5 （CoA 机器人版本）';
const mainConf = root => path.join(root, 'configs', 'modules', 'playerbots.conf');
const realmConf = (root, key) => path.join(root, 'Royaumes', key, 'configs', 'modules', 'playerbots.conf');

// 一个最小整合包：主服 + 一个国度，默认两边都开着省电
function bundle({ main = '60', dawnrise = '40', ecoMain = true, ecoRealm = true, version = VER } = {}) {
  const root = tmpdir();
  write(mainConf(root), `${version}\n${CONF} = ${main}\nAiPlayerbot.Enabled = 1\n`);
  write(path.join(root, 'Settings', 'repack.json'), JSON.stringify({ worldPort: 8085, raPort: 3443, eco: ecoMain }));
  write(path.join(root, 'Royaumes', 'dawnrise', 'realm.json'), JSON.stringify({ key: 'dawnrise', worldPort: 8385, raPort: 3743, eco: ecoRealm }));
  write(realmConf(root, 'dawnrise'), `${version}\n${CONF} = ${dawnrise}\n`);
  return root;
}
const running = async () => true;
const nobody = async () => 0;
const someone = async () => 1;
const wait = () => new Promise(resolve => setTimeout(resolve, 10));

test('文本还原：原来的值写回去', () => {
  const text = `${CONF} = 40\nAiPlayerbot.Enabled = 1\n`;
  const ecoText = eco.ecoText(text);
  assert.match(ecoText, new RegExp(`${CONF} = 1`));
  assert.equal(eco.restoreText(ecoText, '40'), `${CONF} = 40\nAiPlayerbot.Enabled = 1\n`);
});

test('文本还原：原来没有这行，就把为 eco 加的那行删掉', () => {
  const text = 'AiPlayerbot.Enabled = 1\n';
  const ecoText = eco.ecoText(text);
  assert.match(ecoText, new RegExp(`${CONF} = 1`));
  assert.equal(eco.restoreText(ecoText, null), text);
});

test('文本还原：保留 CRLF 与行尾注释', () => {
  const text = `${CONF} = 35   # 玩家自己调的\r\n`;
  const ecoText = eco.ecoText(text);
  assert.ok(ecoText.includes('\r\n'), '不能把 CRLF 换成 LF');
  const back = eco.restoreText(ecoText, '35');
  assert.ok(back.startsWith(`${CONF} = 35`), '值要还回去');
});

test('版本判定：2.9.5 支持、2.9.0 不支持、没有版本行按支持', () => {
  assert.equal(eco.supported(bundle()), true);
  assert.equal(eco.supported(bundle({ version: '# AiPlayerbot.Version = 2.9.0' })), false);
  assert.equal(eco.supported(bundle({ version: '' })), true, '读不到版本时不能把开关废掉');
});

test('无人 10 分钟：两个世界都进休眠，原值记进 eco-state.json', async () => {
  const root = bundle();
  // 第一轮只记 lastSeen，第二轮才休眠（ECO_AFTER 被压到 1 毫秒）
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 1`), '主服该睡了');
  assert.match(read(realmConf(root, 'dawnrise')), new RegExp(`${CONF} = 1`), '国度该睡了');
  const state = JSON.parse(read(path.join(root, 'Royaumes', 'eco-state.json')));
  assert.equal(state.coa.original, '60');
  assert.equal(state.dawnrise.original, '40');
  const status = await eco.status(root);
  assert.equal(status.supported, true);
  assert.equal(status.realms.coa.asleep, true);
  assert.equal(status.realms.dawnrise.asleep, true);
});

test('有人进来：立刻还原各世界的原值', async () => {
  const root = bundle();
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 1`));
  await eco.tick(root, { portOpen: running, players: someone });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 60`), '主服要醒回 60');
  assert.match(read(realmConf(root, 'dawnrise')), new RegExp(`${CONF} = 40`), '国度要醒回 40');
  assert.equal(fs.existsSync(path.join(root, 'Royaumes', 'eco-state.json')), false, '没有记录时状态文件要删掉');
});

test('世界没在跑：开服前先把原值还回去（断电/强杀的兜底）', async () => {
  const root = bundle();
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 1`));
  const stopped = async () => false;
  await eco.wakeStopped(root, null, stopped);
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 60`), '停着的世界必须还原');
});

test('玩家本来就关着机器人（0）：不动，也不记状态', async () => {
  const root = bundle({ main: '0' });
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 0`), '不能把 0 改成 1');
  const state = fs.existsSync(path.join(root, 'Royaumes', 'eco-state.json'))
    ? JSON.parse(read(path.join(root, 'Royaumes', 'eco-state.json'))) : {};
  assert.equal(state.coa, undefined);
});

test('玩家在休眠期间自己改了值：以玩家的为准，不覆盖', async () => {
  const root = bundle();
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  // 玩家手动把 conf 改成了 80
  write(mainConf(root), `${VER}\n${CONF} = 80\n`);
  await eco.tick(root, { portOpen: running, players: someone });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 80`), '玩家改过的值不能被 60 盖回去');
  assert.equal(fs.existsSync(path.join(root, 'Royaumes', 'eco-state.json')), false);
});

test('关掉开关：立刻还原，不必等有人进来', async () => {
  const root = bundle();
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 1`));
  await eco.setEnabled(root, 'coa', false);
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 60`));
  const status = await eco.status(root);
  assert.equal(status.realms.coa.on, false);
});

test('机器人版本太老：开关开了也不休眠', async () => {
  const root = bundle({ version: '# AiPlayerbot.Version = 2.8.9' });
  await eco.tick(root, { portOpen: running, players: nobody });
  await wait();
  await eco.tick(root, { portOpen: running, players: nobody });
  assert.match(read(mainConf(root)), new RegExp(`${CONF} = 60`), '2.8.9 不该被写 eco 值');
  const status = await eco.status(root);
  assert.equal(status.supported, false);
});
//End By leewheel
