'use strict';
//By leewheel 2026年11月6日 启动器启动时把游戏分辨率对齐系统分辨率：
// 读 Client\WTF\Config.wtf 里的 `SET gxResolution "宽x高"`，改成主显示器的物理分辨率。
// 规则：
//  - 文件不存在就不动（没装客户端/没进过游戏的玩家不硬造文件）；
//  - 行存在 → 只改这一行的值，保留其它所有设置；
//  - 行不存在 → 追加到文件末尾；
//  - 值没变就不写，避免每次启动都改文件时间；
//  - 写之前留一份 .bak-时间戳（只留最近一次，慢慢攒太多没意义）。
const fs = require('node:fs');
const path = require('node:path');

const RESOLUTION = /^(\s*SET\s+gxResolution\s+")([^"]*)("\s*)$/i;

//By leewheel 2026年11月6日 显示器 API 会给出 3441 这种“带零头”的宽度（缩放比例换算的浮点误差），
// 游戏只认标准分辨率，所以把常见的分辨率做成吸附表：差值 ≤2 就吸附过去，其余取偶数。
const COMMON_WIDTHS = [1280, 1366, 1440, 1600, 1680, 1920, 2048, 2560, 2880, 3200, 3440, 3840, 5120];
const COMMON_HEIGHTS = [720, 768, 800, 900, 960, 1024, 1050, 1080, 1200, 1440, 1600, 2160, 2880];

function snap(value, table) {
  const numeric = Math.round(Number(value));
  if (!(numeric > 0)) return 0;
  const near = table.find(item => Math.abs(item - numeric) <= 2);
  if (near) return near;
  return numeric % 2 === 0 ? numeric : numeric + 1;   // 游戏只认偶数宽高
}

function normalizeResolution(width, height) {
  return { width: snap(width, COMMON_WIDTHS), height: snap(height, COMMON_HEIGHTS) };
}

/** 把文本里的 gxResolution 换成 width x height；返回 {text, changed, previous} */
function applyResolutionText(text, width, height) {
  const wanted = `${width}x${height}`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let previous = '';
  let changed = false;
  let found = false;
  for (let index = 0; index < lines.length; index++) {
    const match = RESOLUTION.exec(lines[index]);
    if (!match) continue;
    found = true;
    previous = match[2];
    if (previous === wanted) break;
    lines[index] = `${match[1]}${wanted}${match[3]}`;
    changed = true;
    break;
  }
  if (!found) {
    lines.push(`SET gxResolution "${wanted}"`);
    changed = true;
  }
  return { text: lines.join(eol), changed, previous, wanted };
}

/**
 * 把系统分辨率写进 Config.wtf。
 * @param {string} clientRoot 整合包的 Client 目录
 * @param {{width: number, height: number}} size 物理分辨率
 * @returns {{changed: boolean, file: string, wanted?: string, previous?: string, reason?: string}}
 */
function syncResolution(clientRoot, size) {
  const file = path.join(clientRoot, 'WTF', 'Config.wtf');
  const { width, height } = normalizeResolution(size?.width, size?.height);
  if (!(width > 0 && height > 0)) return { changed: false, file, reason: '分辨率无效' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { changed: false, file, reason: '没有 Config.wtf' }; }
  const hadBom = text.charCodeAt(0) === 0xFEFF;
  const body = hadBom ? text.slice(1) : text;
  const result = applyResolutionText(body, width, height);
  if (!result.changed) return { changed: false, file, wanted: result.wanted, previous: result.previous, reason: '已经是系统分辨率' };
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, `${file}.bak-${stamp}`);
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (!/^Config\.wtf\.bak-/.test(name)) continue;
      if (name === path.basename(`${file}.bak-${stamp}`)) continue;
      fs.rmSync(path.join(path.dirname(file), name), { force: true });
    }
  } catch { /* 备份失败不影响写入 */ }
  fs.writeFileSync(file, result.text, 'utf8');
  return { changed: true, file, wanted: result.wanted, previous: result.previous };
}

module.exports = { syncResolution, applyResolutionText };
