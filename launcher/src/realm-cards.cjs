'use strict';
// The realm cards of the game's realm list (the Ascension client): for each realm its game mode, background, description
// and the expansion shown, as on the official realms (Vol'jin, Darkmoon, Bronzebeard). The choice is kept in
// Settings/realm-cards.json and written to the authserver's config before every start, like the network choice.
// The client draws a card from "name!expansion!gamemode!image!unlocked!page!index!descriptionSpell".
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const FILE = 'Settings/realm-cards.json';
const VERSION = 1;
//By leewheel 20261118 bug139：Ascension 客户端只把 GameMode 11（Conquest of Azeroth）当作「免费可进入」的模式，
// 其余官方模式（6 Wildcard / 9 Free-Pick / 12 Warcraft Reborn / 4 Draft / 5 Resolute / 7 Felforged / 8 Nightmare /
// 10 Build Draft）一律被判成「需要购买的官方模式」，点「选择服务器」会打开 ascension.gg/shop。
// 实测对照：coa/living 用 11 正常；reborn 12→11 后恢复；wildcard 6、dawnrise 9 都跳商店。
// 因此下拉里只保留 11 —— 卡片的模式名文字由 DescriptionSpell 的描述决定，跟这个数值无关，改了不掉内容。
const GAME_MODES = [
  { id: 11, name: 'Conquest of Azeroth' },
];
// Interface\Glues\RealmList\<image>.blp in the client (patch-A); title: the client draws RealmTitles\<image> as the
// realm's name instead of the text name.
const IMAGES = [
  { id: 'Voljin', title: true }, { id: 'Darkmoon', title: true }, { id: 'Bronzebeard', title: true }, { id: 'Rexxar', title: true },
  { id: 'Area52', title: true }, { id: 'GrizzlyHills', title: true }, { id: 'Dawnrise', title: true }, { id: 'Elune', title: true },
  { id: 'Malfurion', title: true }, { id: 'Default', title: false }, { id: 'Thrall1', title: false }, { id: 'Thrall2', title: false },
  { id: 'Malganis', title: false }, { id: 'Archimonde', title: false }, { id: 'Alar', title: false }, { id: 'Daggerspine', title: false },
  { id: 'Pilgrims', title: false }, { id: 'HallowsEnd', title: false },
];
// Spells of the client whose description is a realm overview (Spell.dbc, read on 24/10); 0 = no text.
const DESCRIPTIONS = [
  { id: 13977864, name: 'Conquest of Azeroth (Vol\'jin / Rexxar)' }, { id: 13977904, name: 'Wildcard (Darkmoon)' },
  { id: 1397607, name: 'Warcraft Reborn (Bronzebeard)' }, { id: 13977920, name: 'Free-Pick (theorycrafting)' },
  { id: 13977862, name: 'Area 52' }, { id: 13977866, name: 'Thrall (Season 8)' }, { id: 1397605, name: 'Elune (Season 9)' }, { id: 0, name: '' },
];
const EXPANSIONS = [0, 1, 2];
//By leewheel 20261118 bug136：Ascension 客户端把图名/文本名 "Bronzebeard"、"Warcraft Reborn" 认成官方付费的
// Warcraft Reborn 国度——玩家点"选择服务器"会被引导去 ascension.gg/shop（Reborn 因此进不去）。
// 默认值改为不含这两个词的 CoaReborn + Thrall1（Thrall1 有卡面、不覆盖文本名）。
//By leewheel 20261118 bug138：真正触发商店的是 GameMode 12 —— 客户端把它当「需要购买的 Alpha 模式」
// （GlueLocalization 的 ALPHA_PURCHASE_REQUIRED = "从 Ascension.gg/shop 商店购买"）
// 默认改成 11（普通模式）；玩法仍由 Royaumes/reborn 的 worldserver.conf（CoA.ClassModel=wcr）决定。
const DEFAULTS = {
  expansion: 0,
  realms: {
    coa: { mode: 11, image: 'Voljin', description: 13977864, name: '', subtitle: '' },
    //By leewheel 20261118 bug139：wildcard 原来是 6（Wildcard 官方付费模式）→ 客户端跳商店，改 11
    wildcard: { mode: 11, image: 'Darkmoon', description: 13977904, name: 'Darkmoon', subtitle: '' },
    reborn: { mode: 11, image: 'Thrall1', description: 1397607, name: 'CoaReborn', subtitle: '' },
    //By leewheel 20261118 bug139：dawnrise 原来是 9（Free-Pick 官方付费模式）→ 客户端跳商店，改 11
    dawnrise: { mode: 11, image: 'Dawnrise', description: 13977920, name: 'Dawnrise', subtitle: 'Free Pick' },
    //By leewheel 20261115 第 5 个国度：Malfurion（3.0 鲜活世界服），卡面用上游二版背景（不再是 Thrall1）
    living: { mode: 11, image: 'Malfurion', description: 13977864, name: '', subtitle: 'New server' },
  },
};
const NAME = /^[\w '().]{0,24}$/;

function clean(value) {
  const out = { expansion: EXPANSIONS.includes(Number(value?.expansion)) ? Number(value.expansion) : DEFAULTS.expansion, realms: {} };
  for (const [key, base] of Object.entries(DEFAULTS.realms)) {
    const realm = value?.realms?.[key] || {};
    out.realms[key] = {
      mode: GAME_MODES.some(item => item.id === Number(realm.mode)) ? Number(realm.mode) : base.mode,
      image: IMAGES.some(item => item.id === realm.image) ? realm.image : base.image,
      description: DESCRIPTIONS.some(item => item.id === Number(realm.description)) ? Number(realm.description) : base.description,
      // The name of the realm list (no "-": the client cuts the name there for its subtitle).
      name: typeof realm.name === 'string' && NAME.test(realm.name.trim()) ? realm.name.trim() : base.name,
      subtitle: typeof realm.subtitle === 'string' && NAME.test(realm.subtitle.trim()) ? realm.subtitle.trim() : base.subtitle,
    };
  }
  return out;
}

//By leewheel 20261118 bug136：老版本的默认卡片用了官方名（Bronzebeard / Warcraft Reborn），已装好的服务器
// 其 Settings/realm-cards.json 里还是旧值，客户端仍会跳商店。这里读一次就把它迁到新默认并写回；
// 玩家自己改成的其它图/名字不受影响（只迁移恰好等于旧默认的那三种取值）。
//By leewheel 20261118 bug139：同时把磁盘上残留的所有非 11 的 GameMode（6 百搭 / 9 自由拍卖 / 12 Reborn 等
// 官方付费模式）统一改成 11 —— 否则玩家点「选择服务器」照样被引导到 ascension.gg/shop。
const OFFICIAL_REBORN = { image: 'Bronzebeard', name: 'Bronzebeard', subtitle: 'Warcraft Reborn' };
const SAFE_REBORN = { image: 'Thrall1', name: 'CoaReborn', subtitle: '' };
const CLIENT_MODE = 11;
async function migrateCards(root, saved, cards) {
  const realms = { ...cards.realms };
  let changed = false;
  // 1) reborn 的官方名迁移：只动恰好等于旧默认的那几个字段，玩家改过的其它字段原样保留。
  const reborn = realms.reborn;
  if (reborn)
  {
    const fixed = { ...reborn };
    if (fixed.image === OFFICIAL_REBORN.image) fixed.image = SAFE_REBORN.image;
    if (fixed.name === OFFICIAL_REBORN.name) fixed.name = SAFE_REBORN.name;
    if (fixed.subtitle === OFFICIAL_REBORN.subtitle) fixed.subtitle = SAFE_REBORN.subtitle;
    if (fixed.image !== reborn.image || fixed.name !== reborn.name || fixed.subtitle !== reborn.subtitle)
    {
      realms.reborn = fixed;
      changed = true;
    }
  }
  // 2) GameMode 迁移：clean() 已把不认识的旧值清成 11，这里比对磁盘上的原始值判断要不要写回文件。
  for (const key of Object.keys(realms))
  {
    const stored = saved?.realms?.[key]?.mode;
    if (stored === undefined || stored === null) continue;
    if (Number(stored) !== CLIENT_MODE)
    {
      realms[key] = { ...realms[key], mode: CLIENT_MODE };
      changed = true;
    }
  }
  if (!changed) return cards;
  const next = { ...cards, realms };
  try
  {
    await fsp.mkdir(path.join(root, 'Settings'), { recursive: true });
    const file = path.join(root, FILE);
    await fsp.writeFile(`${file}.tmp`, JSON.stringify({ version: VERSION, expansion: next.expansion, realms: next.realms }, null, 2));
    await fsp.rename(`${file}.tmp`, file);
  }
  catch { /* 数据库只读或路径不可写时保持内存里的迁移结果，不阻断启动 */ }
  return next;
}

// The choice saved; none yet (first start of a launcher that knows the cards): the defaults, marked as new.
async function read(root) {
  try {
    const saved = JSON.parse(await fsp.readFile(path.join(root, FILE), 'utf8'));
    return await migrateCards(root, saved, { ...clean(saved), version: Number(saved.version) || 0 });
  } catch { return { ...clean(DEFAULTS), version: 0 }; }
}

async function save(root, value) {
  const cards = { version: VERSION, ...clean(value) };
  await fsp.mkdir(path.join(root, 'Settings'), { recursive: true });
  const file = path.join(root, FILE);
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(cards, null, 2));
  await fsp.rename(`${file}.tmp`, file);
  return cards;
}

// The authserver of this repack draws one image and one description per realm only from the core that reads
// RealmCards.Realm.<id>.Image / .DescriptionSpell (looked for in authserver.exe); before it, every card gets the
// realm's game mode and the expansion, with the default background and no text.
function perRealmSupported(root) {
  //By leewheel 2026-11-02 登录程序位置按布局取
  const layout = require('./layout.cjs').serverLayout(root);
  try { return fs.readFileSync(path.join(root, ...String(layout.auth).split('/'))).includes(Buffer.from('.DescriptionSpell')); } catch { return false; }
}

// The lines written to the authserver's config: the global ones, then one block per realm id.
function configLines(cards, ids, { perRealm }) {
  const lines = { 'RealmCards.Expansion': String(cards.expansion), 'RealmCards.Image': '"Default"' };
  for (const [key, id] of Object.entries(ids)) {
    const realm = cards.realms[key];
    if (!realm || !id) continue;
    lines[`RealmCards.Realm.${id}.GameMode`] = String(realm.mode);
    if (perRealm) {
      lines[`RealmCards.Realm.${id}.Image`] = `"${realm.image}"`;
      lines[`RealmCards.Realm.${id}.DescriptionSpell`] = String(realm.description);
    }
  }
  return lines;
}

// Rewrites the RealmCards lines of a config text: the global keys in place, every per-realm line replaced by ours
// (written after RealmCards.Image).
function rewrite(text, lines) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text.replace(/^RealmCards\.Realm\.\d+\.\w+[ \t]*=.*(\r?\n|$)/gm, '');
  const realmLines = [];
  for (const [key, value] of Object.entries(lines)) {
    if (key.startsWith('RealmCards.Realm.')) { realmLines.push(`${key} = ${value}`); continue; }
    const pattern = new RegExp(`^(${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*).*$`, 'm');
    out = pattern.test(out) ? out.replace(pattern, (_, head) => `${head}${value}`) : `${out.replace(/\s*$/, '')}${eol}${key} = ${value}${eol}`;
  }
  if (realmLines.length) out = out.replace(/^(RealmCards\.Image[ \t]*=.*)$/m, `$1${eol}${realmLines.join(eol)}`);
  return out;
}

// Applied before every start: the authserver's template and its live config (a running authserver reads them
// at its next start). Returns the files changed.
async function apply(root, ids) {
  const cards = await read(root);
  if (!cards.version) return [];
  const lines = configLines(cards, ids, { perRealm: perRealmSupported(root) });
  const changed = [];
  //By leewheel 2026-11-02 配置位置按布局取（发布版是 configs/authserver.conf）
  const layout = require('./layout.cjs').serverLayout(root);
  for (const relative of ['Settings/authserver.conf.template', `${layout.configs}/authserver.conf`]) {
    const file = path.join(root, relative);
    const text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null || !/^RealmCards\.Enable/m.test(text)) continue;
    const next = rewrite(text, lines);
    if (next === text) continue;
    await fsp.writeFile(`${file}.tmp-${process.pid}`, next);
    await fsp.rename(`${file}.tmp-${process.pid}`, file);
    changed.push(relative);
  }
  return changed;
}

// The full name shown in the realm list: "Bronzebeard - Warcraft Reborn" (the client shows the part after " - "
// under the title).
const listName = realm => (realm.subtitle ? `${realm.name} - ${realm.subtitle}` : realm.name);

module.exports = { read, save, apply, clean, rewrite, configLines, perRealmSupported, listName, DEFAULTS, GAME_MODES, IMAGES, DESCRIPTIONS, EXPANSIONS, VERSION, FILE };
