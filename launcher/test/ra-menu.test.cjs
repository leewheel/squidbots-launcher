'use strict';
//By leewheel 2026-11-05 回归测试：RA 控制台开关不能被回退，主页下拉不再出现"创建/添加服务器实例"入口
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const launcher = path.resolve(__dirname, '..');
const repack = path.resolve(launcher, '..', '..', '..', 'COA-PUBLISH-REPACK', 'Server');
const read = file => fs.readFileSync(file, 'utf8');

test('主页下拉只保留服务管理、备份、打开文件夹，不含创建/添加/切换服务器实例', () => {
  const source = read(path.join(launcher, 'public', 'js', 'serverhome.js'));
  const menu = /const menu = \[[\s\S]*?\];/.exec(source)?.[0] || '';
  assert.ok(menu, '菜单定义必须存在');
  for (const action of ['instance-new', 'instance-add', 'instance-pick']) {
    assert.equal(menu.includes(action), false, `下拉里不应再有 ${action}`);
  }
  assert.match(menu, /service-stop-all/);
  assert.match(menu, /server-folder/);
});

test('国度配置强制打开 RA，不会从主服复制到一个 Ra.Enable = 0', () => {
  const source = read(path.join(launcher, 'src', 'realms.cjs'));
  const line = /out\['worldserver\.conf'\] = \{[^}]*'Ra\.Port'[^}]*\};/.exec(source)?.[0] || '';
  assert.match(line, /'Ra\.Enable': '1'/, '国度每次重写配置都要强制开启 RA');
});

test('发布包主服与四份模板的 RA 均为开启且只绑本机', t => {
  if (!fs.existsSync(repack)) return t.skip('发布包目录不在本机');
  const files = [
    'configs/worldserver.conf',
    'configs/worldserver.conf.dist',
    'Royaumes/wildcard/configs/worldserver.conf.dist',
    'Royaumes/reborn/configs/worldserver.conf.dist',
    'Royaumes/dawnrise/configs/worldserver.conf.dist',
  ];
  for (const relative of files) {
    const file = path.join(repack, ...relative.split('/'));
    if (!fs.existsSync(file)) continue;
    const text = read(file);
    assert.match(text, /^Ra\.Enable = 1$/m, `${relative} 必须开启 RA`);
    assert.match(text, /^Ra\.IP = "?127\.0\.0\.1"?$/m, `${relative} 的 RA 只能绑本机回环地址`);
  }
});
//End By leewheel
