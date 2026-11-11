'use strict';
//By leewheel 2026年11月11日 安装目录完整性检查（老大要求）
// 玩家没按规定的目录放文件时，启动器会去错的地方找 mysqld / worldserver，报出来的错还看不懂。
// 这里只用「主要特征」判定（几个必须有的大件），不扫全目录：几百毫秒内出结果，也不会误伤自己改过的文件。
//
//   Server\ 必须有：authserver.exe、worldserver.exe、configs\worldserver.conf、configs\authserver.conf、
//                  my.ini、mysql\bin\{mysqld,mysql,mysqladmin}.exe、mysql\Data、mysql\share\english
//   Client\ 必须有：客户端主程序、Data\{common,common-2,expansion,lichking}.MPQ、至少一个 patch-*.MPQ、
//                  Data\ 下的语言目录、Interface\
// severity: bad = 缺了就一定跑不起来（拦启动/拦更新）；warn = 只提示，不拦。
const fs = require('node:fs');
const path = require('node:path');

const file = (rel, label, severity = 'bad') => ({ rel, label, kind: 'file', severity });
const dir = (rel, label, severity = 'bad') => ({ rel, label, kind: 'dir', severity });

const SERVER_REQUIRED = [
  file('authserver.exe', '登录服程序 authserver.exe'),
  file('worldserver.exe', '世界服程序 worldserver.exe'),
  file('configs/worldserver.conf', '世界服配置 configs\\worldserver.conf'),
  file('configs/authserver.conf', '登录服配置 configs\\authserver.conf'),
  file('mysql/bin/mysqld.exe', '数据库程序 mysql\\bin\\mysqld.exe'),
  file('mysql/bin/mysql.exe', '数据库客户端 mysql\\bin\\mysql.exe'),
  file('mysql/bin/mysqladmin.exe', '数据库管理 mysql\\bin\\mysqladmin.exe'),
  dir('mysql/Data', '数据库数据目录 mysql\\Data'),
  dir('mysql/share/english', '数据库语言包 mysql\\share\\english'),
];
const MYSQL_RULES = SERVER_REQUIRED.filter(rule => rule.rel.startsWith('mysql/'));

// 客户端主程序允许的写法（发布版是 Ascension.exe，老客户端是 Wow.exe）
const CLIENT_EXES = ['Ascension.exe', 'Wow.exe'];
const CLIENT_MAPS = ['common.MPQ', 'common-2.MPQ', 'expansion.MPQ', 'lichking.MPQ'];

const exists = target => fs.existsSync(target);
function isDir(target) { try { return fs.statSync(target).isDirectory(); } catch { return false; } }
function isFile(target) { try { return fs.statSync(target).isFile(); } catch { return false; } }

// 把规则套到一个目录上；返回缺的东西（相对路径 + 中文说明）
function missingFrom(root, rules) {
  const base = path.resolve(String(root || ''));
  const out = [];
  for (const rule of rules) {
    const target = path.join(base, ...rule.rel.split('/'));
    const ok = rule.kind === 'dir' ? isDir(target) : isFile(target);
    if (!ok) out.push({ rel: rule.rel.replace(/\//g, '\\'), label: rule.label, severity: rule.severity, abs: target });
  }
  return out;
}

// Server 目录：整块 mysql 都没有时只报一条“缺整个 mysql 目录”，不刷九条子文件。
// 发布版与官方整合包两种布局都认（worldserver.exe 在根目录 / 在 Core\ 下），相对路径一律问 layout 要。
function checkServer(root) {
  const base = path.resolve(String(root || ''));
  if (!isDir(base)) {
    return { ok: false, root: base, problems: [{ rel: 'Server', label: '服务端目录本身（Server\\）', severity: 'bad', abs: base }] };
  }
  const layout = require('./layout.cjs').serverLayout(base);
  const slash = rel => String(rel).replace(/\//g, '\\');
  const rules = [
    file(layout.auth, `登录服程序 ${slash(layout.auth)}`),
    file(layout.world, `世界服程序 ${slash(layout.world)}`),
    file(`${layout.configs}/worldserver.conf`, `世界服配置 ${slash(layout.configs)}\\worldserver.conf`),
    file(`${layout.configs}/authserver.conf`, `登录服配置 ${slash(layout.configs)}\\authserver.conf`),
    dir(layout.data, `服务端数据目录（dbc/maps/vmaps）${slash(layout.data)}`, 'warn'),
  ];
  const problems = [];
  // my.ini：启动脚本读 Server\my.ini，老包也可能只有 mysql\my.ini，两者有一个就不算缺
  if (!isFile(path.join(base, 'my.ini')) && !isFile(path.join(base, 'mysql', 'my.ini'))) {
    problems.push({ rel: 'my.ini', label: '数据库参数 my.ini（Server\\my.ini）', severity: 'bad', abs: path.join(base, 'my.ini') });
  }
  if (!isDir(path.join(base, 'mysql'))) {
    problems.push({ rel: 'mysql', label: '整个数据库目录 mysql\\', severity: 'bad', abs: path.join(base, 'mysql') });
  } else {
    problems.push(...missingFrom(base, MYSQL_RULES));
  }
  problems.push(...missingFrom(base, rules));
  return { ok: !problems.some(item => item.severity === 'bad'), root: base, problems };
}

// Client 目录：主程序 + 四个基础 MPQ + 至少一个补丁 MPQ + 语言目录 + Interface
function checkClient(root, { executable = '' } = {}) {
  const base = path.resolve(String(root || ''));
  if (!isDir(base)) {
    return { ok: false, root: base, problems: [{ rel: 'Client', label: '客户端目录本身（Client\\）', severity: 'bad', abs: base }] };
  }
  const problems = [];
  const exes = [...new Set([executable, ...CLIENT_EXES].filter(Boolean))];
  if (!exes.some(name => isFile(path.join(base, name)))) {
    problems.push({ rel: exes[0], label: `客户端主程序（${exes.join(' 或 ')}）`, severity: 'bad', abs: path.join(base, exes[0]) });
  }
  const data = path.join(base, 'Data');
  if (!isDir(data)) {
    problems.push({ rel: 'Data', label: '客户端数据目录 Data\\', severity: 'bad', abs: data });
  } else {
    for (const mpq of CLIENT_MAPS) {
      if (!isFile(path.join(data, mpq))) problems.push({ rel: `Data\\${mpq}`, label: `客户端数据 Data\\${mpq}`, severity: 'bad', abs: path.join(data, mpq) });
    }
    let patches = [];
    try { patches = fs.readdirSync(data).filter(name => /^patch-.*\.mpq$/i.test(name)); } catch { patches = []; }
    if (!patches.length) problems.push({ rel: 'Data\\patch-*.MPQ', label: '客户端补丁包 Data\\patch-*.MPQ（至少一个）', severity: 'bad', abs: path.join(data, 'patch-M.MPQ') });
  }
  const locales = ['enUS', 'zhCN', 'zhTW', 'enGB', 'koKR', 'frFR', 'deDE', 'esES', 'ruRU'];
  if (!locales.some(name => isDir(path.join(base, 'Data', name)))) {
    problems.push({ rel: 'Data\\enUS', label: '客户端语言目录 Data\\enUS（或 zhCN 等）', severity: 'bad', abs: path.join(base, 'Data', 'enUS') });
  }
  if (!isDir(path.join(base, 'Interface'))) problems.push({ rel: 'Interface', label: '插件目录 Interface\\', severity: 'warn', abs: path.join(base, 'Interface') });
  if (!isDir(path.join(base, 'WTF'))) problems.push({ rel: 'WTF', label: '存档与设置目录 WTF\\', severity: 'warn', abs: path.join(base, 'WTF') });
  return { ok: !problems.some(item => item.severity === 'bad'), root: base, problems };
}

const bullet = list => list.filter(item => item.severity === 'bad').map(item => `· ${item.label}（${item.rel}）`).join('\n');

// 给玩家看的一段话：缺什么、该放哪、下一步做什么
function describe(server, client) {
  const lines = [];
  const badServer = (server?.problems || []).filter(item => item.severity === 'bad');
  const badClient = (client?.problems || []).filter(item => item.severity === 'bad');
  if (badServer.length) {
    lines.push(`服务端目录 ${server.root} 不完整，缺少：`);
    lines.push(bullet(badServer));
    lines.push('完整的整合包里，Server\\ 与 Client\\ 必须和启动器并排放：Server\\ 里要有 authserver.exe、worldserver.exe 和整个 mysql、configs 目录。');
  }
  if (badClient.length) {
    lines.push(`客户端目录 ${client.root} 不完整，缺少：`);
    lines.push(bullet(badClient));
    lines.push('客户端必须是完整的一份游戏目录（含 Ascension.exe、Data\\ 里的 common/common-2/expansion/lichking.MPQ 与补丁 MPQ）。');
  }
  return lines.join('\n');
}

// 一次检查服务端 + 客户端；两边都合格才算 ok
function checkIntegrity({ server = '', client = '', executable = '' } = {}) {
  const serverResult = server ? checkServer(server) : null;
  const clientResult = client ? checkClient(client, { executable }) : null;
  const ok = (!serverResult || serverResult.ok) && (!clientResult || clientResult.ok);
  return { ok, server: serverResult, client: clientResult, text: describe(serverResult, clientResult) };
}

// 启动服务端前用：只认 server，缺关键件直接抛中文错误（不带相对路径的谜语）
function assertServerReady(root) {
  const result = checkServer(root);
  if (result.ok) return result;
  throw new Error(`${describe(result, null)}  更新或重新解压一份完整的整合包，把 Server\\ 整个替换掉再试。`);
}

module.exports = { SERVER_REQUIRED, CLIENT_EXES, CLIENT_MAPS, checkServer, checkClient, checkIntegrity, describe, assertServerReady };
