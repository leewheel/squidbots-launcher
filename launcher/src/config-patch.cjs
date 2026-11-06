'use strict';
//By leewheel 2026年11月6日 配置**增量**更新（老大要求：以后更新包不许整份覆盖 config 文件，只发新参数）。
// 标准格式（configs/configs.patch.json，由打包脚本生成）：
// {
//   "format": 1, "version": "2026.11.06",
//   "files": [
//     { "path": "configs/worldserver.conf",
//       "entries": [
//         { "mode": "set", "key": "Updates.EnableDatabases", "value": "0", "anchor": "Updates.EnableDatabases" },
//         { "mode": "line", "prefix": "# AiPlayerbot.Version =", "value": " 2.9.3 （CoA 机器人版本）" }
//       ] }
//   ]
// }
// 规则：
//  - set：找到 `key = ...` 这一行就只换值（保留行首空白和行内注释）；找不到就插到 anchor 那一行后面，
//         没有 anchor 就追加到文件末尾（并标注由启动器补齐）。
//  - line：找到以 prefix 开头的那一行整行替换。
//  - 玩家自己改过的其它参数一行都不动；每个文件改之前留一份 .bak-时间戳。
const fs = require('node:fs/promises');
const path = require('node:path');

const PATCH_RELATIVE = ['configs', 'configs.patch.json'];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把一行 "key = value  # 注释" 拆开：返回 { head, value, tail } */
function splitAssignment(line, key) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)([^#\\r\\n]*?)(\\s*(?:#.*)?)$`);
  const match = pattern.exec(line);
  if (!match) return null;
  return { head: match[1], value: match[2], tail: match[3] };
}

function applyEntries(text, entries) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  const changed = [];

  for (const entry of entries || []) {
    if (entry.mode === 'line' && entry.prefix) {
      const index = lines.findIndex(line => line.trimStart().startsWith(entry.prefix));
      if (index >= 0) {
        const next = `${entry.prefix}${entry.value ?? ''}`;
        if (lines[index] !== next) { lines[index] = next; changed.push(`${entry.prefix}${entry.value ?? ''}`); }
      }
      continue;
    }
    if (entry.mode !== 'set' || !entry.key) continue;
    const key = String(entry.key);
    const value = String(entry.value ?? '');
    const rowIndex = lines.findIndex(line => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line));
    if (rowIndex >= 0) {
      const parts = splitAssignment(lines[rowIndex], key);
      if (!parts) continue;
      const next = `${parts.head}${value}${parts.tail}`;
      if (lines[rowIndex] !== next) { lines[rowIndex] = next; changed.push(`${key} = ${value}`); }
      continue;
    }
    // 配置里没有这个键：插到 anchor 后面，没有 anchor 就追加到末尾
    const anchor = String(entry.anchor || '');
    const anchorIndex = anchor ? lines.findIndex(line => new RegExp(`^\\s*${escapeRegExp(anchor)}\\s*=`).test(line)) : -1;
    const inserted = `${key} = ${value}`;
    if (anchorIndex >= 0) lines.splice(anchorIndex + 1, 0, inserted);
    else lines.push(eol === '\n' ? '' : '', `# 由启动器补齐：${key}`, inserted);
    changed.push(`${key} = ${value}（新增）`);
  }

  if (!changed.length) return { text, changed };
  return { text: lines.join(eol), changed };
}

/** 应用补丁；返回改了哪些文件/键 */
async function applyConfigPatch(root, patchFile) {
  const file = patchFile || path.join(root, ...PATCH_RELATIVE);
  let patch;
  try {
    patch = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { applied: [], skipped: ['没有 configs.patch.json'] };
  }
  const applied = [];
  for (const entry of patch.files || []) {
    if (!entry?.path || !Array.isArray(entry.entries) || !entry.entries.length) continue;
    const target = path.join(root, ...String(entry.path).split('/'));
    let text;
    try { text = await fs.readFile(target, 'utf8'); } catch { continue; }
    const { text: next, changed } = applyEntries(text, entry.entries);
    if (!changed.length) continue;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(target, `${target}.bak-${stamp}`).catch(() => {});
    await fs.writeFile(target, next, 'utf8');
    applied.push({ path: entry.path, keys: changed });
  }
  return { applied };
}

module.exports = { applyConfigPatch, applyEntries, PATCH_RELATIVE };
