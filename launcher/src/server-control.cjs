'use strict';
// Starts, stops and watches the services of a local repack (MySQL, authserver, worldserver,
// launcher API). A service is "running" when its port answers; only programs that live inside
// the repack folder can be started or stopped.
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const exec = promisify(execFile);
const SERVICE_ID = /^[a-z][a-z0-9-]{1,20}$/;
const ACCOUNT = /^[A-Za-z0-9]{3,17}$/;
const PASSWORD = /^[\x21-\x7E]{6,16}$/;

//By leewheel 2026-11-05 启动世界服前自动修复远程控制台（RA）配置
// 发布版主服 worldserver.conf 把 Ra.Enable 留成了 0，3443 端口根本没有监听：
// 启动器控制台每条命令都报 "The world console is not reachable"，主页也取不到 server info，
// 上一轮"卡住了"误报的真正源头同样在这里。国度服每次启动又从主服 configs 复制配置，会被一起关掉。
// 这里在 worldserver 读取配置之前，把 Ra.Enable / Ra.Port / Ra.IP 对齐 Settings/repack.json：
// 只改不一致的键、改前留一份备份，玩家已经装好的旧目录重启一次即可恢复，不必手动改配置。
async function ensureWorldConsole(root) {
  const layout = require('./layout.cjs');
  const L = layout.serverLayout(root);
  const file = L.path(`${L.configs}/worldserver.conf`);
  let text;
  try { text = await fsp.readFile(file, 'utf8'); } catch { return; }
  const settings = layout.readJson(L.path('Settings/repack.json')) || {};
  const port = Number(settings.raPort) > 0 ? String(Number(settings.raPort)) : '3443';
  // RA 只给本机启动器用：绑回环地址，不对局域网开放
  const wanted = { 'Ra.Enable': '1', 'Ra.Port': port, 'Ra.IP': '"127.0.0.1"' };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let next = text;
  let changed = false;
  for (const [key, value] of Object.entries(wanted)) {
    const pattern = new RegExp(`^([ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*)(.*)$`, 'm');
    const match = pattern.exec(next);
    const plain = value.replace(/"/g, '');
    if (match) {
      if (String(match[2]).trim().replace(/"/g, '') === plain) continue;
      next = next.replace(pattern, (_, head) => `${head}${value}`);
    } else {
      // 配置里缺这个键（被注释或旧版模板）：补在文件末尾，位置不影响核心读取
      next = `${next.replace(/\s*$/, '')}${eol}${eol}# 由启动器补齐：远程控制台（仅本机）${eol}${key} = ${value}${eol}`;
    }
    changed = true;
  }
  if (!changed) return;
  await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.writeFile(file, next);
}
//End By leewheel

// A command is a program inside the repack plus its arguments, e.g. a repack's own manager script.
function validateCommand(value, label) {
  if (!value) return null;
  if (typeof value.exe !== 'string' || path.isAbsolute(value.exe) || value.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(value.exe)) throw new Error(`${label}: exe must be a relative path inside the repack.`);
  const args = (value.args || []).map(String);
  if (args.some(arg => arg.includes('..'))) throw new Error(`${label}: arguments cannot leave the repack folder.`);
  //By leewheel 2026年11月9日 上限从 600 秒放宽到 1800 秒：慢磁盘上首次导入 500MB 的 world 库
  // （老大那台机械盘）本来就是十几分钟的事，600 秒会被判成“启动失败”。
  return { exe: value.exe, args, timeout: Math.min(1800, Math.max(5, Number(value.timeout) || 180)) };
}

function validateServices(list) {
  if (!Array.isArray(list) || !list.length || list.length > 8) throw new Error('A local realm needs a list of services.');
  const ids = new Set();
  return list.map(service => {
    if (!SERVICE_ID.test(service.id) || ids.has(service.id)) throw new Error(`Invalid service id: ${service.id}`);
    ids.add(service.id);
    const start = validateCommand(service.start, `${service.id} start`);
    // Another way to start the same service when a file is there (the bot-enabled worldserver of
    // CoA Bots when it is installed): the first match wins, the plain start otherwise.
    const alternatives = (service.alternatives || []).slice(0, 4).map((item, index) => {
      if (typeof item.exists !== 'string' || path.isAbsolute(item.exists) || item.exists.split(/[\\/]/).includes('..')) throw new Error(`${service.id}: alternatives need a relative "exists" path.`);
      return { exists: item.exists, label: String(item.label || '').slice(0, 40), start: validateCommand(item.start, `${service.id} alternative ${index + 1}`) };
    });
    const stop = validateCommand(service.stop, `${service.id} stop`);
    if (!start && (typeof service.exe !== 'string' || path.isAbsolute(service.exe) || service.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(service.exe))) throw new Error(`${service.id}: exe must be a relative path inside the repack.`);
    const port = Number(service.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${service.id}: invalid port.`);
    const args = (service.args || []).map(String);
    if (args.some(arg => arg.includes('..'))) throw new Error(`${service.id}: arguments cannot leave the repack folder.`);
    return {
      id: service.id, name: String(service.name || service.id).slice(0, 30), exe: service.exe || '', args, port, start, stop, alternatives,
      cwd: typeof service.cwd === 'string' && !path.isAbsolute(service.cwd) && !service.cwd.includes('..') ? service.cwd : path.dirname(service.exe || '.'),
      console: service.console === true,
      stopCommand: typeof service.stopCommand === 'string' ? service.stopCommand.slice(0, 80) : '',
      stopExe: typeof service.stopExe === 'string' && !path.isAbsolute(service.stopExe) && !service.stopExe.includes('..') ? service.stopExe : '',
      stopArgs: (service.stopArgs || []).map(String),
      startTimeout: Math.min(1800, Math.max(10, Number(service.startTimeout) || 120)),
    };
  });
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

class ServerControl {
  constructor({ root, services, commands = {}, notify = () => {}, onAuthStarted = null }) {
    this.onAuthStarted = onAuthStarted;
    this.root = path.resolve(root);
    this.services = services;
    this.commands = commands;
    this.notify = notify;
    this.children = new Map();
    this.states = new Map();
    //By leewheel 2026年11月9日 记住每个服务「上一次是怎么退出的」（退出码 + 时间）。
    // 服务起不来时这比日志更早能说明问题：0xC0000135 = 缺运行库、0xC0000005 = 崩溃，
    // 玩家看到“程序闪一下就没了、日志是空的”时，只有退出码能解释。
    this.lastExits = new Map();
  }

  //By leewheel 2026年11月9日 把一个服务失败的原因翻成一句玩家能懂、能照着做的中文。
  // 直接复用 diagnostics 的那套规则（端口占用 / 连不上库 / 缺表 / 缺运行库 / 崩溃 …），
  // 这样「点启动弹出的提示」和「主页那个按钮里弹窗的内容」永远是同一套判据，不会两处说法打架。
  async explainFailure(id) {
    try {
      const diagnosis = await require('./diagnostics.cjs').diagnoseAll(this, { lastExits: this.lastExits });
      const entry = diagnosis.services.find(item => item.id === id);
      if (!entry) return '';
      const head = entry.reason || entry.headline || '';
      return entry.hint ? `${head}（${entry.hint}）` : head;
    } catch { return ''; }
  }

  // Runs a repack command to completion, logging its output; stdin lines are sent then closed.
  async run(command, logId, input = [], secrets = []) {
    const exe = this.resolve(command.exe);
    if (!fs.existsSync(exe)) throw new Error(`${command.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(logId)), { recursive: true });
    return new Promise((resolve, reject) => {
      const child = spawn(exe, command.args.map(arg => arg.replace(/\{root\}/g, this.root)), { cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const collect = chunk => { output += chunk.toString(); if (output.length > 200000) output = output.slice(-100000); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      for (const line of input) { try { child.stdin.write(`${line}\r\n`); } catch (error) { if (error.code !== 'EPIPE') throw error; } }
      try { child.stdin.end(); } catch {}
      const timer = setTimeout(() => { exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill()); reject(new Error(`${command.exe} took too long.`)); }, command.timeout * 1000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        for (const secret of secrets) output = output.split(secret).join('********');
        fs.appendFileSync(this.logFile(logId), `\n==== ${new Date().toISOString()} ${path.basename(command.exe)} ${command.args.join(' ')} (exit ${code}) ====\n${output}`);
        if (code === 0) resolve(output);
        else reject(new Error(output.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `${command.exe} failed (exit ${code}).`));
      });
    });
  }

  resolve(relative) {
    const file = path.resolve(this.root, relative);
    //By leewheel 2026-11-02 允许 cwd 就是服务端根目录（"." 时 path.resolve 得到根目录本身，不能要求以 root\ 开头）
    if (file !== this.root && !file.startsWith(this.root + path.sep)) throw new Error('Path outside the repack folder.');
    return file;
  }

  //By leewheel 2026年11月4日 这个服务“自己的 exe”到底是哪几个文件：主 exe + 带机器人等替代 exe。
  // MySQL 只有 Server\mysql\bin\mysqld.exe 一个；系统里、别的项目里装的 mysqld.exe 不在名单上。
  serviceExes(service) {
    const list = [];
    const add = relative => { if (relative) try { list.push(path.resolve(this.root, relative).toLowerCase()); } catch {} };
    add(service.exe);
    for (const alternative of service.alternatives || []) add(alternative.start?.exe);
    return [...new Set(list)];
  }

  // 端口后面的进程是不是本服务自己的 exe（不是“在本包目录里的任意同名程序”）。
  ownsExe(service, file) {
    if (!file) return false;
    const target = path.resolve(file).toLowerCase();
    const exes = this.serviceExes(service);
    if (exes.length) return exes.includes(target);
    // 由管理脚本启动、没有直接 exe 的服务：仍要求在本包目录内。
    return target.startsWith(this.root.toLowerCase() + path.sep);
  }
  //End By leewheel

  logFile(id) { return path.join(this.root, 'logs', `launcher-${id}.log`); }

  // Who listens on a port: { pid, file, inside } (inside = a program of this repack). Several
  // repacks use the same ports, so an answering port is not proof that this server is running.
  async portOwner(port) {
    if (process.platform !== 'win32') return null;
    const stdout = await listening();
    const line = stdout.split(/\r?\n/).find(row => new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+\\d+`).test(row));
    const pid = Number(line?.trim().split(/\s+/).pop());
    if (!pid) return null;
    this.paths ||= new Map();
    if (!this.paths.has(pid)) {
      const { stdout: exePath } = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Path`], { windowsHide: true, timeout: 10000 }).catch(() => ({ stdout: '' }));
      if (this.paths.size > 64) this.paths.clear();
      this.paths.set(pid, exePath.trim());
    }
    const file = this.paths.get(pid);
    if (!file) return { pid, file: '', inside: null };
    return { pid, file, inside: path.resolve(file).toLowerCase().startsWith(this.root.toLowerCase() + path.sep) };
  }

  async processAlive(id) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(this.root, '.state', `${id}.json`), 'utf8'));
      if (!record?.pid || !String(record.exe || '').toLowerCase().startsWith(this.root.toLowerCase())) { this.forget(id); return false; }
      //By leewheel 2026年11月4日 记录里的进程已经没了就是过期记录：当场删掉，
      // 否则下一次启动/关服时还会拿这个死 PID 去问“是不是在加载”。
      try { process.kill(Number(record.pid), 0); } catch { this.forget(id); return false; }
      //End By leewheel
      if (process.platform !== 'win32') return true;
      // Windows gives a number again once its process ended (the launcher itself got MySQL's old one): the process
      // must still be the program the repack started.
      //By leewheel 2026-11-03 光对镜像名还不够：PID 被系统复用给另一个同名 exe 时会误判“启动中”，
      // 灯就一直闪。再核对运行中进程的完整路径必须与记录一致；对不上即过期记录，删掉报停止。
      const { stdout } = await exec('tasklist.exe', ['/FI', `PID eq ${Number(record.pid)}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 });
      const name = /^"([^"]+)"/m.exec(stdout)?.[1] || '';
      if (name.toLowerCase() !== path.basename(String(record.exe)).toLowerCase()) { this.forget(id); return false; }
      const { stdout: exePath } = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(record.pid)}).Path`], { windowsHide: true, timeout: 10000 }).catch(() => ({ stdout: '' }));
      const running = exePath.trim().toLowerCase();
      if (!running || !running.startsWith(this.root.toLowerCase())) { this.forget(id); return false; }
      return true;
    } catch { return false; }
  }

  //By leewheel 2026年11月4日 单一备份：<file> 顶成 <file>.1，同名覆盖，永远只有一份上一次的日志。
  rotateLog(file) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) fs.renameSync(file, `${file}.1`);
      else fs.rmSync(`${file}.1`, { force: true });
    } catch {}
  }
  //End By leewheel

  //By leewheel 2026年11月4日 在整合包目录里找同名 exe 的进程（不管是谁起的），只用于把“加载中”判对：
  // 端口还没开 + 进程已在 ⇒ starting；进程都不在 ⇒ 才是真的 stopped。
  async strayProcess(service) {
    if (!service.exe) return null;
    const rows = await runningInside();
    //By leewheel 2026年11月8日 只认本服务自己的 exe（MySQL 就是 Server\mysql\bin\mysqld.exe），
    // 包内别处的同名程序不再算成“本服务正在加载”；国度自己的世界服进程也要排除（同一个 exe）。
    const others = realmPids(this.root);
    return rows.find(row => this.ownsExe(service, row.file) && !others.has(row.pid)) || null;
    //End By leewheel
  }
  //End By leewheel

  //By leewheel 2026-11-02 三个服务并行查询：原来的串行写法在慢机器上要 5 秒，首页会一直空着
  async status() {
    const results = await Promise.all(this.services.map(async service => {
      const open = await portOpen(service.port);
      const transient = this.states.get(service.id);
      //By leewheel 2026年11月11日 修复「玩家点停止却弹『服务启动失败』」：
      // stop() 从设置 'stopping' 到 finally 清除之间，status() 必须一律报 'stopping'。
      // 原来端口已关且进程已退时直接落 'stopped'，崩溃侦测（noteServiceStates）只看
      // 「上一拍不是 stopping → 这一拍 stopped」，就把玩家的主动停止误判成「服务自己挂了」。
      // 正在加载中点停止时同理：transient 被 stop 覆盖后，状态机必须在 stop 收尾前保持 'stopping'。
      let state;
      if (transient === 'stopping') state = 'stopping';
      else if (transient === 'starting' && !open) state = 'starting';
      else state = open ? 'running' : 'stopped';
      // The repack records the process it started (.state/<service>.json): alive with its port still closed,
      // the service is loading (a first world start with bots takes minutes), not stopped.
      // While it stops, the world closes its port first and saves for a few seconds more: still « stopping ».
      if (state === 'stopped' && await this.processAlive(service.id)) state = 'starting';
      //By leewheel 2026年11月4日 不是启动器拉起的实例（脚本、手动、上一个启动器实例）没有 .state 记录：
      // 加载期端口还没开时会被判成“已停止”，指示灯一直灰——老大实弹（手动起世界服，绿灯前灰了 2 分钟）。
      // 这里按“整合包目录内同名 exe 仍在跑”补判为加载中；端口一开自然变“运行中”。
      if (state === 'stopped' && await this.strayProcess(service)) state = 'starting';
      //End By leewheel
      let other = '';
      if (state === 'running') {
        const owner = await this.portOwner(service.port);
        //By leewheel 2026年11月4日 端口开着不等于本服务在跑：监听者必须是这个服务自己的 exe。
        // 系统装的、别的项目里的 mysqld.exe（不在 Server\mysql\bin）以及读不到路径的进程，一律标成
        // “端口被其他程序占用”，绝不再显示为运行中——老大实弹：别人的 MySQL 被当成自己的数据库。
        if (owner && !this.ownsExe(service, owner.file)) { state = 'foreign'; other = owner.file || `PID ${owner.pid}（读不到程序路径）`; }
        //End By leewheel
      }
      return { id: service.id, name: service.name, port: service.port, state, other, variant: this.variant(service), managed: this.children.has(service.id), console: service.console && this.children.has(service.id) };
    }));
    return results;
  }

  async assertPortFree(service) {
    if (!(await portOpen(service.port))) return false;
    const owner = await this.portOwner(service.port);
    //By leewheel 2026年11月4日 占用端口的只要不是本服务自己的 exe 就报“被其他程序占用”，
    // 不再拿别人的 MySQL 当自己的数据库继续往下跑。
    if (owner && !this.ownsExe(service, owner.file)) throw new Error(`${service.name} 起不来：端口 ${service.port} 被别的程序占着（${owner.file || `PID ${owner.pid}（读不到程序路径）`}）。先关掉它，或者用首页的「强制关闭占用程序」。`);
    return true;
  }

  //By leewheel 2026年11月7日 启动器一开就把所有服务端口扫一遍：谁占着、是不是本包自己的程序。
  // 老大要求：被别的程序占着必须报错，并且界面要给一个「强制关闭占用程序」的按钮。
  async scanPorts() {
    const out = [];
    for (const service of this.services) {
      if (!(await portOpen(service.port))) {
        out.push({ id: service.id, name: service.name, port: service.port, busy: false, mine: false, pid: 0, file: '' });
        continue;
      }
      const owner = await this.portOwner(service.port);
      const mine = !!(owner && this.ownsExe(service, owner.file));
      out.push({ id: service.id, name: service.name, port: service.port, busy: true, mine, pid: owner?.pid || 0, file: owner?.file || '' });
    }
    return out;
  }

  //By leewheel 2026年11月7日 强制关闭占用端口的程序（玩家点了界面按钮才执行）。
  // 本包自己的服务走正常停止（世界服要存档）；外来进程按端口查到的 PID 精确 taskkill，不做进程名通配。
  async killPortOwner(port) {
    const target = Number(port);
    if (!Number.isInteger(target)) throw new Error('端口号不正确');
    const owner = await this.portOwner(target);
    if (!owner?.pid) throw new Error(`端口 ${target} 上没有找到监听进程（可能已经自己退出了）`);
    const service = this.services.find(item => item.port === target);
    if (service && this.ownsExe(service, owner.file)) {
      await this.stop(service.id);
      return { pid: owner.pid, graceful: true };
    }
    await exec('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true })
      .catch(error => { throw new Error(`结束 PID ${owner.pid} 失败：${error.message}`); });
    return { pid: owner.pid, graceful: false };
  }

  async emit() { this.notify(await this.status()); }

  // A second Start of a service already starting (double click, home page and a realm card) waits for the first one.
  start(id) {
    this.pending ||= new Map();
    if (this.pending.has(id)) return this.pending.get(id);
    const job = this.startOnce(id).finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  async startOnce(id) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    //By leewheel 2026年11月7日 中文路径硬拦截：布局体检不通过就一律不启动服务端。
    // 中文路径下 MySQL/世界服会读不到文件或乱码，老大明确要求「有中文就报错」，不能只弹个提示还让他继续点。
    if (require('./layout-check.cjs').checkLayout({ paths: [this.root] }).chinesePath) {
      throw new Error('运行目录包含中文，服务端无法正常工作：请把整个整合包移动到纯英文路径（例如 D:/Games/COA）后重新打开启动器。');
    }
    //End By leewheel
    //By leewheel 2026-11-05 世界服读配置之前修好 RA；修不动也不该挡住服务器启动，只留一条中文告警
    if (/world/i.test(id)) await ensureWorldConsole(this.root).catch(error => console.warn(`[启动器] 远程控制台配置修复失败：${error.message}`));
    //By leewheel 2026年11月6日 世界服/登录服启动前，把数据库端口和“数据库自动更新”两条配置对齐整合包：
    // 老整合包写的是 3395、新包是 3396，端口不对世界服直接连不上库；Updates.EnableDatabases 不关会在启动时自己改库。
    if (/world|auth/i.test(id)) {
      await require('./db-config.cjs').ensureDatabaseConfig(this.root)
        .then(changed => { if (changed.length) console.warn(`[启动器] 已修正服务端配置：${changed.join('；')}`); })
        .catch(error => console.warn(`[启动器] 服务端配置体检失败：${error.message}`));
    }
    //By leewheel 2026年11月6日 关掉数据库自动更新后，新版本的核心会用到新表：缺表时世界服
    // 在 mysql_stmt_prepare 阶段直接退出（老大实测 account_bazaar_token_hourly_cap）。启世界服前先补齐。
    if (/world/i.test(id)) {
      await require('./schema-guard.cjs').ensureDatabaseSchema(this.root)
        .then(result => {
          if (result.ran?.length) console.warn(`[启动器] 已补齐数据库表：${result.ran.join(', ')}`);
          if (result.skipped?.length) console.warn(`[启动器] 建表兜底跳过：${result.skipped.join('；')}`);
        })
        .catch(error => console.warn(`[启动器] 角色库建表兜底失败：${error.message}`));
    }
    //End By leewheel
    if (this.states.get(id) === 'stopping') throw new Error(`${service.name} is stopping: wait until it is stopped.`);
    if (await this.assertPortFree(service)) return;
    const start = this.startCommand(service);
    if (start) {
      // The repack's own manager starts the service (and whatever it depends on) and waits for it.
      this.states.set(id, 'starting');
      await this.emit();
      try { await this.run({ ...start, timeout: Math.max(start.timeout, service.startTimeout) }, id); }
      finally { this.states.delete(id); await this.emit(); }
      if (!(await portOpen(service.port))) throw new Error(`${service.name} did not open port ${service.port}. Look at its log.`);
      if (id === 'auth') await this.onAuthStarted?.().catch(() => {});
      return;
    }
    const exe = this.resolve(service.exe);
    if (!fs.existsSync(exe)) throw new Error(`${service.name}: ${service.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(id)), { recursive: true });
    //By leewheel 2026年11月4日 老大规则：日志只保留“上一次启动的一份”备份，绝不按日期堆文件。
    // 每次启动先把上一次的内容顶到 <日志>.1（同名覆盖），再把当前日志开成空白。
    this.rotateLog(this.logFile(id));
    //By leewheel 2026年11月4日 日志面板在没启动时必须是空白，启动后才开始显示（原来 'a' 追加会把旧内容一直留着）。
    const log = fs.openSync(this.logFile(id), 'w');
    fs.writeSync(log, `\n==== ${new Date().toISOString()} started by the launcher ====\n`);
    //By leewheel 2026-11-03 命令行 --port 必须与状态轮询的端口同源（service.port 是 inspectRepack
    // 覆盖后的实际端口）：以前 config 写 3396、repack.json 存 3395，mysqld 听 3396 而状态查 3395，
    // 灯永远不变绿、240 秒超时——老大实弹。
    const args = service.args.map(arg => arg.replace(/\{root\}/g, this.root)).map(arg => /^--port=/i.test(arg) ? `--port=${service.port}` : arg);
    const child = spawn(exe, args, {
      cwd: this.resolve(service.cwd || '.'), windowsHide: true, detached: false,
      stdio: [service.console ? 'pipe' : 'ignore', log, log],
    });
    fs.closeSync(log);
    //By leewheel 2026-11-02 记录启动的进程（.state/<service>.json）：官网整合包由 manage.py 写，
    // 发布版没有 Python 管理脚本，改由启动器自己写，这样“是不是本目录启动的”“世界在线状态”等功能才能用。
    try {
      fs.mkdirSync(path.join(this.root, '.state'), { recursive: true });
      fs.writeFileSync(path.join(this.root, '.state', `${id}.json`), JSON.stringify({ pid: child.pid, exe, created: (Date.now() + 11644473600000) * 10000, started: new Date().toISOString() }));
    } catch {}
    this.children.set(id, child);
    this.states.set(id, 'starting');
    //By leewheel 2026-11-03 子进程的管道要挂 error：进程自己退出后再往里写会抛 EPIPE，
    // 没接住就是主进程未捕获异常（关闭启动器时弹"JavaScript error occurred in the main process"）。
    for (const stream of [child.stdin, child.stdout, child.stderr]) if (stream) stream.on('error', () => {});
    child.once('exit', (code, signal) => {
      //By leewheel 2026年11月9日 记下退出码：诊断模块靠它区分“缺运行库”“崩溃”“配置错”
      this.lastExits.set(id, { code, signal: signal || '', at: Date.now() });
      this.children.delete(id);
      this.states.delete(id);
      try { fs.rmSync(path.join(this.root, '.state', `${id}.json`), { force: true }); } catch {}
      this.emit().catch(() => {});
    });
    child.once('error', () => { this.children.delete(id); this.states.delete(id); });
    await this.emit();
    const deadline = Date.now() + service.startTimeout * 1000;
    while (Date.now() < deadline) {
      //By leewheel 2026年11月11日 玩家点了「停止」（stop() 把状态置为 stopping）：启动等待立刻让位，
      // 直接返回、不报任何错——正在加载的世界服被叫停时，以前这里会一直等到子进程被 stop
      // 强杀，然后抛「启动过程中退出了 / 没能就绪」，玩家明明在停服务器却收到「服务启动失败」。
      // 注意绝不能在这里动 states（'stopping' 是 stop() 的，由它自己的 finally 清除）。
      if (this.states.get(id) === 'stopping') return;
      //By leewheel 2026年11月9日 起不来时不再只说 “stopped while starting. Look at its log.”：
      // 现场跑一次诊断，把根因（端口被占 / 连不上库 / 缺运行库 / 崩溃）直接写进提示，
      // 玩家点一下就知道该干什么，不用再问“为什么打不开”。
      if (!this.children.has(id)) {
        const why = await this.explainFailure(id);
        throw new Error(why ? `${service.name} 启动失败：${why}` : `${service.name} 启动过程中退出了。日志在 logs\\launcher-${id}.log`);
      }
      if (await portOpen(service.port)) { this.states.delete(id); await this.emit(); if (id === 'auth') await this.onAuthStarted?.().catch(() => {}); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    //By leewheel 2026年11月11日 超时收尾同样要让位给「玩家点了停止」：这不算启动失败。
    if (this.states.get(id) === 'stopping') return;
    this.states.delete(id);
    await this.emit();
    {
      const why = await this.explainFailure(id);
      throw new Error(why ? `${service.name} 没能就绪：${why}` : `${service.name} 在 ${service.startTimeout} 秒内没有打开端口 ${service.port}。日志在 logs\\launcher-${id}.log`);
    }
  }

  startCommand(service) {
    if (this.withBots === false) return service.start;
    const alternative = (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)));
    return alternative?.start || service.start;
  }

  // Which variant a service will start with, for the page ("Worldserver · with CoA Bots").
  variant(service) {
    if (this.withBots === false) return '';
    return (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)))?.label || '';
  }

  // The worldserver applies the updates of the auth database too: the authserver starts once the world is up
  // (an authserver of CoA Bots 2.6 stops at start when its new tables are not there yet).
  async startAll() {
    const order = [...this.services.filter(service => service.id !== 'auth'), ...this.services.filter(service => service.id === 'auth')];
    for (const service of order) await this.start(service.id);
  }

  // Finds the process listening on a port and returns it only when it is this service's own exe
  // （别人的 mysqld/worldserver 绝不返回，免得停服时误杀外来进程）。
  async ownedProcess(service) {
    const owner = await this.portOwner(service.port);
    return owner && this.ownsExe(service, owner.file) ? { pid: owner.pid, file: owner.file } : null;
  }

  async stop(id) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    const wasRunning = await portOpen(service.port);
    const childBefore = this.children.get(id);
    if (!wasRunning && !childBefore) { this.forget(id); return; }
    // A service started by the repack's manager is stopped the way the manager wants: all together, in order.
    if (service.start && !service.stop && this.commands.stopAll) { await this.stopAll(); return; }
    this.states.set(id, 'stopping');
    await this.emit();
    const child = this.children.get(id);
    try {
      if (service.stop) {
        await this.run(service.stop, id);
      } else if (child && service.console && service.stopCommand) {
        //By leewheel 2026-11-03 世界服可能已经自己退出（控制台管道已断）：这时 write 会抛 EPIPE，
        // 以前会把主进程打崩。断开了就当作它已经停了，交给下面的等待/兜底逻辑处理。
        if (child.stdin && child.stdin.writable && !child.killed) {
          try { child.stdin.write(`${service.stopCommand}\r\n`); }
          catch (error) { if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error; }
        }
      } else if (service.stopExe) {
        //By leewheel 2026-11-03 mysqladmin 在数据库忙（刚停完世界服、还在刷盘）时会超时或返回非 0，
        // 以前这里直接抛错 → stopAll 中断 → MySQL 一直留在后台（老大关掉启动器后 3395 还占着就是这个）。
        // 现在只把原因记下来，继续走下面的"等端口关闭 + 兜底 taskkill"，保证它一定被停掉。
        if (wasRunning) await exec(this.resolve(service.stopExe), service.stopArgs, { cwd: this.root, windowsHide: true, timeout: 60000 })
          .catch(error => { console.log(`[stop] ${service.name}: ${error.message}（继续用兜底方式停）`); });
      } else if (child) {
        await exec('taskkill.exe', ['/PID', String(child.pid), '/T'], { windowsHide: true }).catch(() => {});
      } else {
        const owner = await this.ownedProcess(service);
        if (!owner) throw new Error(`${service.name} was not started from this repack; stop it where it was started.`);
        await exec('taskkill.exe', ['/PID', String(owner.pid), '/T'], { windowsHide: true }).catch(() => {});
      }
      //By leewheel 2026年11月2日 等进程真正退出，而不是只等端口关闭：
      // worldserver 停机时先关端口、再花几十秒把角色/机器人的查询写完（数据库池），此时若已停 MySQL 就会丢数据。
      //By leewheel 2026年11月4日 没有优雅停机手段的服务（authserver：既无 stopCommand 也无 stopExe）不能等满 120 秒：
      // 上面 taskkill 不带 /F 只是发 WM_CLOSE，控制台程序根本不理会，以前要白等两分钟才走到兜底强杀
      // —— 老大反馈"停止服务器特别慢"主要就是这里。现在只给它 15 秒收尾，随后立刻 taskkill /F。
      const wait = service.console ? 300 * 1000 : (service.stopExe ? 120 * 1000 : 15 * 1000);
      const deadline = Date.now() + wait;
      //By leewheel 2026-11-03 入口时端口还没开（服务正在启动中）≠ 不用优雅停机：
      // 等待期间端口开了（正好就绪），要补做一次优雅停机，而不是傻等到点强杀——
      // 以前这里跳过 mysqladmin，最后 taskkill /F，数据库连 Normal shutdown 都没写就没了。
      // 入口时已经优雅停过（wasRunning=true 走过 stopExe）就不再重复。
      let gracefulDone = !service.stopExe || wasRunning;
      while (Date.now() < deadline && ((await portOpen(service.port)) || this.children.has(id))) {
        if (!gracefulDone && await portOpen(service.port)) {
          gracefulDone = true;
          await exec(this.resolve(service.stopExe), service.stopArgs, { cwd: this.root, windowsHide: true, timeout: 60000 })
            .catch(error => { console.log(`[stop] ${service.name}: ${error.message}（继续用兜底方式停）`); });
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if ((await portOpen(service.port)) || this.children.has(id)) {
        const owner = child ? { pid: child.pid } : await this.ownedProcess(service);
        if (owner) await exec('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      }
      this.forget(id);
    } finally {
      this.states.delete(id);
      await this.emit();
    }
  }

  // 停机后清掉这个服务的进程记录（.state\<id>.json），避免下次启动看到过期的状态
  forget(id) {
    try { require('node:fs').rmSync(path.join(this.root, '.state', `${id}.json`), { force: true }); } catch {}
  }

  //By leewheel 2026-11-03 兜底强杀：凡可执行文件位于本整合包目录内（含 mysql\）的
  // worldserver.exe / authserver.exe / mysqld.exe 一律结束。老大的规则：关闭启动器 =
  // 关掉它属下的一切，尤其是 Server\mysql 下的数据库进程。
  // 为什么只靠 children 不够：MySQL 可能是【上一个启动器实例】拉起的（关闭时本实例
  // children 为空，start() 又因端口已开而提前返回），优雅停机再一失败，它就永远没人杀
  // （实弹：关掉启动器后 mysqld 还占着端口）。这里按 exe 路径归属判定，不看是谁起的：
  // 只杀 exe 在 root 内的进程，绝不动系统 MySQL、E:\ 其他项目等外来进程。
  async killAllInside() {
    if (process.platform !== 'win32') return [];
    const script = "Get-CimInstance Win32_Process -Filter \"Name='worldserver.exe' OR Name='authserver.exe' OR Name='mysqld.exe'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }";
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 }).catch(() => ({ stdout: '' }));
    const lower = this.root.toLowerCase() + path.sep;
    const killed = [];
    for (const line of String(stdout).split(/\r?\n/)) {
      const separator = line.indexOf('|');
      if (separator <= 0) continue;
      const pid = line.slice(0, separator).trim();
      const file = line.slice(separator + 1).trim();
      if (!/^\d+$/.test(pid) || !file) continue;
      if (!file.toLowerCase().startsWith(lower)) continue;
      await exec('taskkill.exe', ['/PID', pid, '/T', '/F'], { windowsHide: true }).catch(() => {});
      killed.push(`${file} (PID ${pid})`);
    }
    return killed;
  }

  async stopAll() {
    if (this.commands.stopAll) {
      for (const service of this.services) this.states.set(service.id, 'stopping');
      await this.emit();
      try {
        // A worldserver that has only just started may refuse the graceful-shutdown connection:
        // one more try a few seconds later, before reporting a failure.
        try { await this.run(this.commands.stopAll, 'stop-all'); }
        catch {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay ?? 15000));
          await this.run(this.commands.stopAll, 'stop-all');
        }
      } finally { this.states.clear(); await this.emit(); }
      return;
    }
    for (const service of [...this.services].reverse()) await this.stop(service.id);
  }

  // Creates a game account (or gives an existing one a new password) through the repack console command, or the worldserver we started.
  async createAccount(name, password, gm, { change = false } = {}) {
    if (!ACCOUNT.test(name) || !PASSWORD.test(password)) throw new Error('Account names use 3-17 letters or digits; passwords 6-16 characters without spaces.');
    const commands = change ? [`account set password ${name} ${password} ${password}`] : [`account create ${name} ${password}`, ...(gm ? [`account set gmlevel ${name} 3 -1`] : [])];
    if (this.commands.console) {
      const lines = [...commands, 'exit'];
      const output = await this.run(this.commands.console, 'console', lines, [password]);
      // The password went through stdin only; strip it from anything we keep or show.
      // The console echoes its "AC>" prompt around each answer: keep the answers only.
      return output.split(password).join('********').split(/\r?\n/).map(line => line.replace(/AC>\s*/g, '').trim())
        .filter(line => line && !/^World console/i.test(line)).slice(-6).join('\n');
    }
    const world = this.services.find(service => service.console);
    const child = world && this.children.get(world.id);
    if (!child?.stdin?.writable) throw new Error('Start the worldserver from the launcher first.');
    //By leewheel 2026-11-03 世界服可能刚好退出：writable 为真也会抛 EPIPE，这里接住不崩主进程
    for (const command of commands) {
      try { child.stdin.write(`${command}\r\n`); }
      catch (error) { if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') throw new Error('世界服已经退出了，命令没有发出去。'); throw error; }
    }
  }

  async tail(id, lines = 200) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    //By leewheel 2026年11月4日 世界服/登录服/数据库没在跑（也没在加载）时，日志面板必须是空白：
    // 不能把上一次甚至昨天的旧日志当成本次日志显示给玩家。起来之后（含 loading 阶段）才给内容。
    const up = (await portOpen(service.port)) || (await this.processAlive(id)) || !!(await this.strayProcess(service));
    if (!up) return '';
    //End By leewheel
    const file = this.logFile(id);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) return '';
    const size = Math.min(stat.size, 256 * 1024);
    const handle = await fsp.open(file, 'r');
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      return buffer.toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
    } finally { await handle.close(); }
  }

}

//By leewheel 2026年11月8日 国度与主服共用同一个 worldserver.exe：国度在跑时，按 exe 路径归属会把国度进程
// 认成主服“正在加载”，主服卡就永远转圈（8085 一直不开）。这里把国度自己的进程记录
// （Royaumes\<key>\.state.json 里的 pid，且确认还活着）排除掉，主服只认剩下的那些。
function realmPids(root) {
  const out = new Set();
  try {
    for (const entry of fs.readdirSync(path.join(root, 'Royaumes'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const state = JSON.parse(fs.readFileSync(path.join(root, 'Royaumes', entry.name, '.state.json'), 'utf8'));
        const pid = Number(state?.pid);
        if (!pid) continue;
        try { process.kill(pid, 0); out.add(pid); } catch {}
      } catch {}
    }
  } catch {}
  return out;
}

// netstat once for every question of the same tick (status() asks it for each running service).
let netstatCache = { at: 0, job: null };
function listening() {
  if (process.platform !== 'win32') return Promise.resolve('');
  if (netstatCache.job && Date.now() - netstatCache.at < 3000) return netstatCache.job;
  netstatCache = { at: Date.now(), job: exec('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10000 }).then(result => result.stdout).catch(() => '') };
  return netstatCache.job;
}

//By leewheel 2026年11月4日 一次问清“世界服/登录服/数据库进程还在不在”：status() 每 5 秒问一次，
// 逐个 PID 去打 PowerShell 太慢（而且 .state 记录可能根本没有），这里合并成一次查询并缓存 4 秒。
let insideCache = { at: 0, job: null };
function runningInside() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (insideCache.job && Date.now() - insideCache.at < 4000) return insideCache.job;
  const script = "Get-CimInstance Win32_Process -Filter \"Name='worldserver.exe' OR Name='authserver.exe' OR Name='mysqld.exe'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }";
  insideCache = {
    at: Date.now(),
    job: exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 })
      .then(result => String(result.stdout).split(/\r?\n/).map(line => {
        const at = line.indexOf('|');
        return at > 0 ? { pid: Number(line.slice(0, at)), file: line.slice(at + 1).trim() } : null;
      }).filter(row => row && row.pid && row.file))
      .catch(() => []),
  };
  return insideCache.job;
}
//End By leewheel

//By leewheel 2026-11-05 导出 RA 配置自愈函数，供回归测试直接验证
//By leewheel 2026年11月8日 顺带导出进程表与端口表的查询（都带缓存），国度的归属判定复用同一份，
// 免得状态页每隔 5 秒把 PowerShell 和 netstat 各跑两次。
module.exports = { ServerControl, validateServices, validateCommand, portOpen, ensureWorldConsole, listening, runningInside };
//End By leewheel
