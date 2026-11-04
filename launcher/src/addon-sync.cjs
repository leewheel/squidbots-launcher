'use strict';
// The SquidBots Lite addon in the player's game: the repack carries it, the launcher copies it into the game
// client chosen once, and again whenever the repack brings a newer version. The bundled addon lives either in
// the official repack's CoA-Bots\Client\Interface\AddOns or, for the COA flat repack, in the sibling
// Client\Interface\AddOns -- addonDir() resolves it relatively so the repack works from any folder.
// What the addon saved (WTF\...\SavedVariables) is never touched; the replaced copy is kept in the launcher's data.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { compareVersions } = require('./repack-update.cjs');

const EXES = ['Ascension.exe', 'Wow.exe', 'WoW.exe'];
const isClient = folder => !!folder && EXES.some(name => fsSync.existsSync(path.join(folder, name)));

//By leewheel 2026年11月4日 SquidBots Lite 插件的位置要相对、可自适配：
//  · 官方整合包：<repack>/CoA-Bots/Client/Interface/AddOns
//  · COA 发布版（扁平布局，没有 CoA-Bots 目录）：随客户端放在 <repack>/../Client/Interface/AddOns
// 这样玩家把整合包解压到任意盘/任意目录都能找到，绝不再写死绝对路径。
const SQUIDBOTS = 'SquidBotsLite';
function addonDir(repack) {
  const official = path.join(repack || '', 'CoA-Bots', 'Client', 'Interface', 'AddOns');
  if (repack && fsSync.existsSync(official)) return official;
  return path.join(repack || '', '..', 'Client', 'Interface', 'AddOns');
}
function squidbotsLite(repack) { return path.join(addonDir(repack), SQUIDBOTS); }

function tocVersion(folder, name) {
  try {
    const toc = fsSync.readFileSync(path.join(folder, `${name}.toc`), 'utf8');
    return /^##\s*Version:\s*(.+)$/m.exec(toc)?.[1].trim() || '';
  } catch { return ''; }
}

// Version strings like 2.3, 2.10.1 or 2.5-beta: number by number, a stable version before its betas.
const newer = (a, b) => compareVersions(a, b) > 0;

// The client the bots installer used last time (CoA-Bots\client.json), offered when none was chosen here.
function suggestedClient(repack) {
  try {
    const client = JSON.parse(fsSync.readFileSync(path.join(repack, 'CoA-Bots', 'client.json'), 'utf8').replace(/^﻿/, '')).client;
    return isClient(client) ? client : '';
  } catch { return ''; }
}

function status(repack, client) {
  const dir = squidbotsLite(repack);
  const available = fsSync.existsSync(dir) ? tocVersion(dir, SQUIDBOTS) : '';
  if (!available) return { state: 'none', addons: [] };
  const installed = isClient(client) ? tocVersion(path.join(client, 'Interface', 'AddOns', SQUIDBOTS), SQUIDBOTS) : '';
  let state = 'current';
  if (!isClient(client)) state = 'noclient';
  else if (!installed) state = 'missing';
  else if (newer(available, installed)) state = 'outdated';
  return { state, client: isClient(client) ? client : '', suggested: isClient(client) ? '' : suggestedClient(repack), addons: [{ name: SQUIDBOTS, available, installed }], version: available, installedVersion: installed };
}

// The game reads its addons at login: copying while it runs is refused, so a half-copied addon is never loaded.
function gameRunning() {
  return new Promise(resolve => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 }, (error, out) => {
    if (error) return resolve(false);
    const lower = out.toLowerCase();
    resolve(EXES.some(name => lower.includes(`"${name.toLowerCase()}"`)));
  }));
}

async function install(repack, client, backupRoot) {
  if (!isClient(client)) throw new Error('This folder has no Ascension.exe or Wow.exe: choose the folder of your game client.');
  if (await gameRunning()) throw new Error('Close the game first: it reads its addons when you log in.');
  const source = squidbotsLite(repack);
  const target = path.join(client, 'Interface', 'AddOns', SQUIDBOTS);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (!fsSync.existsSync(source)) throw new Error('The bundled SquidBots Lite addon was not found in this repack.');
  // Keep the copy it replaces (so a downgrade is possible), then swap atomically so the game never sees half an addon.
  if (fsSync.existsSync(target)) {
    const saved = path.join(backupRoot, `${SQUIDBOTS}-${tocVersion(target, SQUIDBOTS) || 'old'}`);
    await fs.rm(saved, { recursive: true, force: true });
    await fs.cp(target, saved, { recursive: true });
  }
  const fresh = `${target}.new`;
  await fs.rm(fresh, { recursive: true, force: true });
  await fs.cp(source, fresh, { recursive: true });
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(fresh, target);
  return [SQUIDBOTS];
}

module.exports = { status, install, isClient, newer, gameRunning };
