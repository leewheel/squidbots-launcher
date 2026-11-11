'use strict';
//By leewheel 2026年11月8日
// 基线（baseline）= 本机整合包“已经包含到哪个版本”的**记录**，用来决定哪些 GitHub 补丁还需要装。
//
// 为什么要有这个模块（老大 2026-11-08 定）：补丁必须按发布顺序依次装，跳过中间任何一个，
// 最后装完必定跑不起来。旧实现用 Server\worldserver.exe 的修改时间去猜“这个补丁的内容已经在包里了”，
// 那是猜、不是记录，两条实弹：
//   ① 纯 SQL 补丁不改 exe，发布时间早于 exe 就被判“已包含”直接跳过，库缺表/缺数据 → 服务端起不来；
//   ② 队列中途失败后重试时，第一包已经把 exe 换成新时间，后面发布时间更早的补丁全被吃掉 → 永久半残，
//      界面还显示“已是最新”。
// 现在只认记录，优先级（越靠前越权威）：
//   1) .coa-launcher\baseline.json —— 本模块维护，每次整轮更新成功后推进到最后一个补丁的版本；
//   2) Server\RELEASE.json 的 releaseId / releaseDate —— 整合包发布时自己声明的版本；
//   3) Server\Settings\repack.json 的 coreVersion —— 仅当能解析出日期才算数（"9.9" 这种占位值不算）。
// 三条都取不到 → 基线为空 = 一个补丁都不跳过，按旧→新全装一遍。
// 全装是安全的：补丁幂等，且按顺序装完最终留下的一定是“最近一次带该文件的那版”内容，即最新状态。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const BASELINE = '.coa-launcher/baseline.json';

// 日期提取必须同时认两种写法，库里两套命名并存：
//   紧凑：20261108 / COA-Update-20261108 / coa-publish-20261107
//   点分：2026.11.08 / 2026-11-07 / 2026-11-08T06:08:53Z
function dateOf(text) {
  const s = String(text || '');
  //By leewheel 2026年11月10日 中文写法（2026年11月10日）也要认：发布时版本号/标题里可能带中文，
  // 认不出来就等于“没有日期”，更新判定会退化成一串字符比大小 —— 11.10 那次就是这么被误判成“已是最新”的。
  const cn = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/.exec(s);
  if (cn) return Number(`${cn[1]}${String(cn[2]).padStart(2, '0')}${String(cn[3]).padStart(2, '0')}`);
  const compact = /20(\d{2})(\d{2})(\d{2})/.exec(s);
  if (compact) return Number(`20${compact[1]}${compact[2]}${compact[3]}`);
  const split = /(20\d{2})[.\-_/](\d{1,2})[.\-_/](\d{1,2})/.exec(s);
  if (split) return Number(`${split[1]}${String(split[2]).padStart(2, '0')}${String(split[3]).padStart(2, '0')}`);
  return 0;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// 读基线。serverRoot 允许为空（启动器还没选服务器目录时）。
// 返回 { version, date, source }：date=0 表示“没有可信基线”，调用方应按“不跳过任何补丁”处理。
function readBaseline({ root = '', serverRoot = '' } = {}) {
  if (root) {
    const saved = readJson(path.join(root, BASELINE));
    if (saved) {
      const version = String(saved.version || '').trim();
      const date = Number(saved.date) || dateOf(version);
      if (version || date) return { version, date, at: String(saved.at || ''), source: 'baseline.json' };
    }
  }
  if (serverRoot) {
    const release = readJson(path.join(serverRoot, 'RELEASE.json'));
    if (release) {
      // releaseId 最准（coa-publish-20261107）；没有再退 releaseDate（2026-11-07）
      const version = String(release.releaseId || release.releaseDate || '').trim();
      const date = dateOf(release.releaseId) || dateOf(release.releaseDate);
      if (date) return { version, date, at: '', source: 'RELEASE.json' };
    }
    const repack = readJson(path.join(serverRoot, 'Settings', 'repack.json'));
    if (repack) {
      const version = String(repack.coreVersion || '').trim();
      const date = dateOf(version);
      // 只有能解析出 20YYMMDD 才算数：repack.json 里常放 "9.9" 这类占位值
      if (date) return { version, date, at: '', source: 'repack.json' };
    }
  }
  return { version: '', date: 0, at: '', source: '' };
}

// 整轮更新成功后推进基线：下次检查不会再算这些已经装过的补丁。
//By leewheel 2026年11月8日 只许前进不许后退：本地包重装了个旧版本、或者包里版本号写错，
// 都不能把基线拉回去 —— 一拉回去，之前装过的补丁会全部重新排进队列，等于把服务端往回降级。
async function writeBaseline(root, { version = '', at = '' } = {}) {
  const date = dateOf(version);
  if (!root || !date) return null;
  const current = readBaseline({ root, serverRoot: path.join(root, 'Server') });
  if (current.date && date < current.date) {
    return { version: current.version, date: current.date, at: current.at || '', skipped: true, reason: '比现有基线旧，不后退' };
  }
  const entry = { version: String(version), date, at: at || new Date().toISOString() };
  const file = path.join(root, BASELINE);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(entry, null, 2), 'utf8');
  return entry;
}

module.exports = { BASELINE, dateOf, readBaseline, writeBaseline };
