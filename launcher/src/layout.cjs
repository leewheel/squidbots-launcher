'use strict';
//By leewheel 2026-11-02
// 服务端目录布局适配（中文发射版新增）
//
// 本启动器原本只认 SquidBots 的官方整合包布局：
//   <服务端>/Core/worldserver.exe、<服务端>/Core/configs、<服务端>/Core/Logs、
//   <服务端>/Data/{dbc,maps,vmaps,mmaps}、<服务端>/mysql、<服务端>/Runtime/python、<服务端>/Settings/repack.json
//
// 本项目的发布版把 AzerothCore 编译产物（RelWithDebInfo）直接放在服务端根目录：
//   <服务端>/worldserver.exe、<服务端>/authserver.exe、<服务端>/configs、<服务端>/configs/modules、
//   <服务端>/logs、<服务端>/ClientData/{dbc,maps,vmaps,mmaps}、<服务端>/mysql
//
// 两种布局都在这里集中识别，其余模块只问本文件要路径，不再各自硬编码。
const fs = require('node:fs');
const path = require('node:path');

const readText = file => { try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const readJson = file => { try { return JSON.parse(readText(file)); } catch { return null; } };
// 读取 conf 里的键值（忽略注释，允许值带引号）
const confValue = (text, key) => new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'mi').exec(text || '')?.[1]?.trim();
// 读取 ini 某个小节里的键（my.ini 的 [mysqld] port=3395）
function iniValue(text, section, key) {
  const part = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i').exec(text || '')?.[1] || '';
  return confValue(part, key);
}
const positive = value => (Number(value) > 0 && Number(value) < 65536 ? Number(value) : 0);

// 识别一个服务端目录。root 为空或不认识的目录时 kind 为空。
function serverLayout(rootInput) {
  const root = path.resolve(String(rootInput || ''));
  const joined = (...parts) => path.join(root, ...parts);
  const has = relative => !!relative && fs.existsSync(joined(...relative.split('/')));
  const flat = !has('Core/worldserver.exe') && has('worldserver.exe');
  const repack = has('Core/worldserver.exe');
  const kind = flat ? 'flat' : repack ? 'repack' : '';
  //By leewheel 2026-11-02 世界与登录程序的位置
  // 国度功能用的是“带机器人的那个世界程序”：官方整合包在 CoA-Bots\Core\ 下，没有它才退回 Core\；
  // 发布版就是根目录的 worldserver.exe。目录还没装齐全（kind 为空）时也按官方整合包的老位置找。
  const botsWorld = has('CoA-Bots/Core/worldserver.exe') ? 'CoA-Bots/Core/worldserver.exe' : '';
  const world = flat ? 'worldserver.exe' : botsWorld || 'Core/worldserver.exe';
  const auth = kind === 'flat' ? 'authserver.exe' : 'Core/authserver.exe';
  const configs = kind === 'flat' ? 'configs' : 'Core/configs';
  const modules = `${configs}/modules`;
  // 日志目录：发布版 worldserver.conf 里 LogsDir = "logs"，官方整合包为 Core/Logs
  let logs = 'Core/Logs';
  if (kind === 'flat') logs = confValue(readText(joined('configs', 'worldserver.conf')), 'LogsDir') || 'logs';
  // 数据目录：发布版 DataDir = "ClientData"，官方整合包为 Data
  let data = 'Data';
  if (kind === 'flat') data = confValue(readText(joined('configs', 'worldserver.conf')), 'DataDir') || 'ClientData';
  // 机器人版世界程序的配置文件（官方整合包里是 CoA-Bots 自己的那份），发布版就是 configs 本身
  const botsConfigs = kind === 'flat' ? configs : 'CoA-Bots/Core/configs';
  const python = has('Runtime/python/python.exe') ? 'Runtime/python/python.exe' : '';
  // 端口：先从 Settings/repack.json 读，没有就从 conf / my.ini 里读
  const settings = readJson(joined('Settings', 'repack.json')) || {};
  const worldConf = readText(joined(...`${configs}/worldserver.conf`.split('/')));
  const authConf = readText(joined(...`${configs}/authserver.conf`.split('/')));
  //By leewheel 2026-11-02 端口的 my.ini：优先用服务端根目录的那份（启动脚本用的就是它），其次 mysql/my.ini
  const myIni = readText(joined('my.ini')) || readText(joined('mysql', 'my.ini'));
  const ports = {
    mysql: positive(settings.mysqlPort) || positive(iniValue(myIni, 'mysqld', 'port')) || 3306,
    auth: positive(settings.authPort) || positive(confValue(authConf, 'RealmServerPort')) || 3724,
    world: positive(settings.worldPort) || positive(confValue(worldConf, 'WorldServerPort')) || 8085,
    ra: positive(settings.raPort) || positive(confValue(worldConf, 'Ra.Port')) || 3443,
  };
  return {
    root, kind,
    //By leewheel 2026-11-02 一个目录是否算“装好的服务器”
    repack: kind !== '' && has('mysql/bin/mysqld.exe'),
    world, auth, configs, modules, logs, data, botsConfigs, botsWorld, python,
    mysqlDir: 'mysql', mysqlBin: 'mysql/bin', mysqlData: 'mysql/Data', mysqlClientIni: 'mysql/admin-client.ini',
    // 官方整合包自带的设置模板（发布版没有，直接改 configs 里的 .conf）
    templates: has('Settings/worldserver.conf.template'),
    settings: has('Settings/repack.json'), ports,
    hasData: ['dbc', 'maps', 'vmaps'].every(folder => has(`${data}/${folder}`)),
    path: absolute => path.join(root, ...String(absolute).split('/')),
    exists: relative => has(relative),
  };
}

// 日志文件按候选顺序找（官方布局与发布版布局都覆盖）
function logCandidates(root) {
  const layout = serverLayout(root);
  return [
    `${layout.logs}/Server.log`, `${layout.logs}/Errors.log`, `${layout.logs}/Auth.log`, 'Server.log', 'Errors.log',
  ];
}

module.exports = { serverLayout, logCandidates, confValue, iniValue, readText, readJson };
