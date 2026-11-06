'use strict';
//By leewheel 2026-11-05 启动目录体检回归测试：中文路径、Client/Server 缺失或空目录，以及两句醒目文案
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const { checkLayout, hasFiles, CHINESE } = require('../src/layout-check.cjs');

// 造一份完整的发布布局：Client\、Server\ 都至少有一个文件
async function repack(root) {
  for (const name of ['Client', 'Server']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'marker.bin'), 'x');
  }
  return { paths: [root], folders: { Client: path.join(root, 'Client'), Server: path.join(root, 'Server') } };
}

test('纯英文路径且 Client/Server 都有文件：不报警', async () => {
  const root = await tempDir('coa-layout-');
  assert.deepEqual(checkLayout(await repack(root)), { chinesePath: false, badFolders: [] });
});

test('目录路径含中文：报警；只查目录不查 exe 文件名，避免自己误报', async () => {
  const root = await tempDir('coa-layout-');
  const chinese = path.join(root, '征服艾泽拉斯');
  const layout = await repack(chinese);
  const result = checkLayout(layout);
  assert.equal(result.chinesePath, true);
  assert.deepEqual(result.badFolders, []);
  assert.equal(CHINESE.test('COA-Launcher'), false);
  assert.equal(CHINESE.test('CoA启动器.exe'), true, '文件名确实含中文，但检查只针对目录路径');
  assert.equal(checkLayout({ paths: [root], folders: layout.folders }).chinesePath, false);
});

test('Client/Server 缺失、空目录、只有空子目录都算布局被破坏', async () => {
  const root = await tempDir('coa-layout-');
  const folders = { Client: path.join(root, 'Client'), Server: path.join(root, 'Server') };
  const check = () => checkLayout({ paths: [root], folders });
  assert.deepEqual(check().badFolders, ['Client', 'Server'], '两个目录都不存在');
  fs.mkdirSync(folders.Client, { recursive: true });
  fs.mkdirSync(path.join(folders.Server, '空文件夹'), { recursive: true });
  assert.deepEqual(check().badFolders, ['Client', 'Server'], '空目录与只有空子目录一样算空');
  assert.equal(hasFiles(folders.Client), false);
  fs.writeFileSync(path.join(folders.Client, 'Ascension.exe'), 'x');
  assert.equal(hasFiles(folders.Client), true);
  assert.deepEqual(check().badFolders, ['Server'], '补上文件后 Client 不再报警');
  fs.writeFileSync(path.join(folders.Server, '空文件夹', 'worldserver.exe'), 'x');
  assert.deepEqual(check().badFolders, [], '子目录里有文件也算完整');
});

test('中文路径与文件夹缺失可以同时报出来', async () => {
  const root = await tempDir('coa-layout-');
  const chinese = path.join(root, '模拟器');
  const result = checkLayout({ paths: [chinese], folders: { Client: path.join(chinese, 'Client'), Server: path.join(chinese, 'Server') } });
  assert.equal(result.chinesePath, true);
  assert.deepEqual(result.badFolders, ['Client', 'Server']);
});

test('醒目提示的两句中文原文与常驻横幅必须保留', () => {
  const pub = path.join(__dirname, '..', 'public');
  const boot = fs.readFileSync(path.join(pub, 'js', 'boot.js'), 'utf8');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(pub, 'css', 'coa.css'), 'utf8');
  assert.match(boot, /本模拟器的目录中不可以出现中文/);
  assert.match(boot, /不可以修改本模拟器的默认文件和文件夹布局/);
  assert.match(boot, /showLayoutAlert\(data\.layout\)/);
  assert.match(html, /id="layout-alert"/);
  assert.match(css, /#layout-alert/);
});

test('告警会真的渲染成常驻横幅和启动弹窗，不只是源码里的字符串', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'boot.js'), 'utf8');
  const fn = /function showLayoutAlert\(layout\) \{[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(fn, '渲染函数必须存在');
  const banner = { innerHTML: '', hidden: true };
  const body = { classList: { add: () => {} } };
  let dialogHtml = '';
  const context = {
    esc: value => String(value),
    icon: () => '<svg></svg>',
    $: () => banner,
    document: { body },
    dialog: { header: title => `<h2>${title}</h2>`, open: html => { dialogHtml = html; } },
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\nshowLayoutAlert({ chinesePath: true, badFolders: ['Client'] });`, context);
  assert.equal(banner.hidden, false, '横幅必须显示');
  assert.match(banner.innerHTML, /本模拟器的目录中不可以出现中文/);
  assert.match(banner.innerHTML, /不可以修改本模拟器的默认文件和文件夹布局/);
  assert.match(dialogHtml, /本模拟器的目录中不可以出现中文/);
  assert.match(dialogHtml, /我知道了/);
});
//End By leewheel
