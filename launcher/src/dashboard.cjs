'use strict';
// The SquidBots dashboard (CoA-Bots/Dashboard/squidbots.py): started with the repack's own Python,
// local only (it listens on localhost), shown inside the launcher, stopped with it.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const portOpen = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.setTimeout(800);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});

class Dashboard {
  constructor({ botsFolder = 'CoA-Bots' } = {}) {
    this.botsFolder = botsFolder;
    this.child = null;
    this.root = '';
  }

  paths(root) {
    // CoA Bots 2.x keeps it in Tools\Dashboard, older ones in Dashboard.
    const tools = path.join(root, this.botsFolder, 'Tools', 'Dashboard');
    const folder = fs.existsSync(path.join(tools, 'squidbots.py')) ? tools : path.join(root, this.botsFolder, 'Dashboard');
    return { folder, script: path.join(folder, 'squidbots.py'), python: path.join(root, 'Runtime', 'python', 'python.exe'), settings: path.join(folder, 'dashboard.json') };
  }

  async port(root) {
    try { return Number(JSON.parse(await fsp.readFile(this.paths(root).settings, 'utf8')).port) || 8088; } catch { return 8088; }
  }

  async status(root) {
    if (!root) return { available: false };
    const { script, python } = this.paths(root);
    const available = fs.existsSync(script) && fs.existsSync(python);
    const port = await this.port(root);
    const running = available && await portOpen(port);
    let version = '';
    try { version = /^##\s*([\d.]+)/m.exec(fs.readFileSync(path.join(this.paths(root).folder, 'CHANGELOG.md'), 'utf8'))?.[1] || ''; } catch {}
    return { available, running, managed: !!this.child && this.root === root, port, url: `http://localhost:${port}/`, version };
  }

  //By leewheel 2026年11月8日 仪表盘必须连「这个整合包自己的」数据库和配置：
  // squidbots.py 默认只认 <repack>\Settings\database.json、<repack>\mysql\bin\mysql.exe、
  // <repack>\(CoA-Bots\)Core\configs\modules，而本整合包是 Server\configs\worldserver.conf、
  // Server\mysql\bin\mysql.exe、Server\configs\modules —— 对不上就既连不上库、也读不到机器人设置，
  // 面板起来也是空的。这里在启动前把实际路径与连接参数写进 dashboard.json（玩家原有的
  // port / footer 等键一律保留），玩家换安装目录、换数据库端口都不用自己改配置。
  dbInfo(root) {
    try {
      const text = fs.readFileSync(path.join(root, 'Server', 'configs', 'worldserver.conf'), 'utf8');
      const line = /^WorldDatabaseInfo\s*=\s*"([^"]+)"/m.exec(text);
      if (!line) return null;
      const [host, port, user, password] = line[1].split(';');
      return { host: host || '127.0.0.1', port: port || '3306', user: user || 'acore', password: password || '' };
    } catch { return null; }
  }

  syncSettings(root) {
    const { settings } = this.paths(root);
    let current = {};
    try { current = JSON.parse(fs.readFileSync(settings, 'utf8')); } catch {}
    const next = { ...current, repack: root };
    const modules = path.join(root, 'Server', 'configs', 'modules');
    if (fs.existsSync(modules)) next.configDir = modules;
    const mysqlExe = path.join(root, 'Server', 'mysql', 'bin', 'mysql.exe');
    if (fs.existsSync(mysqlExe)) next.mysqlExe = mysqlExe;
    const info = this.dbInfo(root);
    if (info) {
      // --password= 即使为空也要写成等号形式，否则 mysql.exe 会停在键盘上等输入
      next.mysqlArgs = [`-h${info.host}`, `-P${info.port}`, `-u${info.user}`, `--password=${info.password}`, '--default-character-set=utf8mb4'];
    }
    //By leewheel 2026年11月8日 仪表盘 2.9.x 新增健康页 / 拍卖行 / 国度页 / 装备库，
    // 它们默认按上游整合包的 Core\... 结构去找程序、日志、崩溃目录和 dbc，本包是 Server\...，
    // 缺了这些路径就只有空面板。这里把本包的真实位置一并写进去（存在才写，不猜）。
    const at = (rel) => path.join(root, ...rel.split('/'));
    if (fs.existsSync(at('Server/worldserver.exe'))) next.worldserverPath = at('Server/worldserver.exe');
    if (fs.existsSync(at('Server/logs'))) {
      // coaLog 的所在目录同时决定 Chat.log / BotLoot.log / bot-status.json 的位置
      next.coaLog = at('Server/logs/Playerbots.log');
    }
    if (fs.existsSync(at('Server/Crashes'))) next.crashesDir = at('Server/Crashes');
    if (fs.existsSync(at('Server/ClientData/dbc/AreaTable.dbc'))) next.dbcDir = at('Server/ClientData/dbc');
    if (fs.existsSync(at('Client/Data/common.MPQ'))) next.gameClient = at('Client');
    // 设置由启动器统一写 .conf（每次启服都会重写），仪表盘只读，不重复提供编辑页
    next.settingsPage = false;
    try { fs.writeFileSync(settings, `${JSON.stringify(next, null, 2)}\n`, 'utf8'); } catch { return false; }
    return true;
  }
  //End By leewheel

  async start(root) {
    const { folder, script, python } = this.paths(root);
    if (!fs.existsSync(script)) throw new Error('The bots dashboard is not installed with this server (install the bots).');
    if (!fs.existsSync(python)) throw new Error('This repack has no Python (Runtime/python).');
    //By leewheel 2026年11月8日 先把实际路径/连接参数同步进 dashboard.json，再拉起 python
    this.syncSettings(root);
    const port = await this.port(root);
    if (await portOpen(port)) return this.status(root);
    if (this.child) this.stop();
    await fsp.mkdir(path.join(root, 'logs'), { recursive: true });
    const log = fs.createWriteStream(path.join(root, 'logs', 'launcher-dashboard.log'), { flags: 'a' });
    log.write(`\n==== ${new Date().toISOString()} squidbots.py ====\n`);
    const child = spawn(python, ['-B', script], { cwd: folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    this.child = child;
    this.root = root;
    let exited = null;
    child.once('exit', code => { exited = code; if (this.child === child) this.child = null; });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await portOpen(port)) return this.status(root);
      if (exited !== null) throw new Error(`The dashboard stopped at once (code ${exited}). See logs/launcher-dashboard.log.`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error('The dashboard did not answer in 30 seconds. See logs/launcher-dashboard.log.');
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    // The dashboard runs a few threads: end the whole process tree.
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}

module.exports = { Dashboard, portOpen };
