'use strict';
//By leewheel 2026-11-05 启动器启动时的目录布局体检
// 老大规则：① 模拟器的目录路径里不可以出现中文；② Client\、Server\ 两个目录必须存在且里面真的有文件。
// 这里只做检查，绝不擅自改动玩家的目录；结果由主页用醒目的中文告警显示。
const fs = require('node:fs');
const path = require('node:path');

// CJK 统一汉字 + 扩展 A + 兼容表意文字。只检查目录路径，不检查 exe 文件名：
// 发布版启动器本身就叫 CoA启动器.exe，把文件名算进来会让自己永远误报。
const CHINESE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

// 目录里至少要有一个文件才算完整：只剩空文件夹同样是"默认布局被改坏"。
// 找到第一个文件就立刻返回，Client\ 有几千个文件也不会被整个遍历。
function hasFiles(dir, depth = 0) {
  if (depth > 4) return false;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasFiles(path.join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

// paths：要检查是否含中文的目录（整合包根目录 + 便携版 exe 的真实所在目录）
// folders：{ Client: 绝对路径, Server: 绝对路径 }
function checkLayout({ paths = [], folders = {} } = {}) {
  const chinesePath = paths.some(item => CHINESE.test(String(item || '')));
  const badFolders = Object.entries(folders).filter(([, dir]) => !hasFiles(dir)).map(([name]) => name);
  return { chinesePath, badFolders };
}
//End By leewheel

module.exports = { CHINESE, hasFiles, checkLayout };
