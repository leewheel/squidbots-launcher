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

// A command is a program inside the repack plus its arguments, e.g. a repack's own manager script.
function validateCommand(value, label) {
  if (!value) return null;
  if (typeof value.exe !== 'string' || path.isAbsolute(value.exe) || value.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(value.exe)) throw new Error(`${label}: exe must be a relative path inside the repack.`);
  const args = (value.args || []).map(String);
  if (args.some(arg => arg.includes('..'))) throw new Error(`${label}: arguments cannot leave the repack folder.`);
  return { exe: value.exe, args, timeout: Math.min(600, Math.max(5, Number(value.timeout) || 180)) };
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
      startTimeout: Math.min(600, Math.max(10, Number(service.startTimeout) || 120)),
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
      if (!record?.pid || !String(record.exe || '').toLowerCase().startsWith(this.root.toLowerCase())) return false;
      process.kill(Number(record.pid), 0);
      if (process.platform !== 'win32') return true;
      // Windows gives a number again once its process ended (the launcher itself got MySQL's old one): the process
      // must still be the program the repack started.
      const { stdout } = await exec('tasklist.exe', ['/FI', `PID eq ${Number(record.pid)}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 });
      const name = /^"([^"]+)"/m.exec(stdout)?.[1] || '';
      return name.toLowerCase() === path.basename(String(record.exe)).toLowerCase();
    } catch { return false; }
  }

  //By leewheel 2026-11-02 三个服务并行查询：原来的串行写法在慢机器上要 5 秒，首页会一直空着
  async status() {
    const results = await Promise.all(this.services.map(async service => {
      const open = await portOpen(service.port);
      const transient = this.states.get(service.id);
      let state = transient && (transient === 'starting' ? !open : open) ? transient : open ? 'running' : 'stopped';
      // The repack records the process it started (.state/<service>.json): alive with its port still closed,
      // the service is loading (a first world start with bots takes minutes), not stopped.
      // While it stops, the world closes its port first and saves for a few seconds more: still « stopping ».
      if (state === 'stopped' && await this.processAlive(service.id)) state = transient === 'stopping' ? 'stopping' : 'starting';
      let other = '';
      if (state === 'running') {
        const owner = await this.portOwner(service.port);
        if (owner?.inside === false) { state = 'foreign'; other = owner.file; }
      }
      return { id: service.id, name: service.name, port: service.port, state, other, variant: this.variant(service), managed: this.children.has(service.id), console: service.console && this.children.has(service.id) };
    }));
    return results;
  }

  async assertPortFree(service) {
    if (!(await portOpen(service.port))) return false;
    const owner = await this.portOwner(service.port);
    if (owner?.inside === false) throw new Error(`${service.name}: port ${service.port} is used by another program (${owner.file}). Stop it first.`);
    return true;
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
    const log = fs.openSync(this.logFile(id), 'a');
    fs.writeSync(log, `\n==== ${new Date().toISOString()} started by the launcher ====\n`);
    const child = spawn(exe, service.args.map(arg => arg.replace(/\{root\}/g, this.root)), {
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
    child.once('exit', () => {
      this.children.delete(id);
      this.states.delete(id);
      try { fs.rmSync(path.join(this.root, '.state', `${id}.json`), { force: true }); } catch {}
      this.emit().catch(() => {});
    });
    child.once('error', () => { this.children.delete(id); this.states.delete(id); });
    await this.emit();
    const deadline = Date.now() + service.startTimeout * 1000;
    while (Date.now() < deadline) {
      if (!this.children.has(id)) throw new Error(`${service.name} stopped while starting. Look at its log.`);
      if (await portOpen(service.port)) { this.states.delete(id); await this.emit(); if (id === 'auth') await this.onAuthStarted?.().catch(() => {}); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    this.states.delete(id);
    await this.emit();
    throw new Error(`${service.name} did not open port ${service.port} in time. Look at its log.`);
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

  // Finds the process listening on a port and returns it only if it lives in the repack folder.
  async ownedProcess(port) {
    const owner = await this.portOwner(port);
    return owner?.inside ? { pid: owner.pid, file: owner.file } : null;
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
        const owner = await this.ownedProcess(service.port);
        if (!owner) throw new Error(`${service.name} was not started from this repack; stop it where it was started.`);
        await exec('taskkill.exe', ['/PID', String(owner.pid), '/T'], { windowsHide: true }).catch(() => {});
      }
      //By leewheel 2026-11-02 等进程真正退出，而不是只等端口关闭：
      // worldserver 停机时先关端口、再花几十秒把角色/机器人的查询写完（数据库池），此时若已停 MySQL 就会丢数据。
      const wait = service.console ? 300 * 1000 : 120 * 1000;
      const deadline = Date.now() + wait;
      while (Date.now() < deadline && ((await portOpen(service.port)) || this.children.has(id))) await new Promise(resolve => setTimeout(resolve, 1000));
      if ((await portOpen(service.port)) || this.children.has(id)) {
        const owner = child ? { pid: child.pid } : await this.ownedProcess(service.port);
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
    if (!this.services.some(service => service.id === id)) throw new Error('Unknown service.');
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

// netstat once for every question of the same tick (status() asks it for each running service).
let netstatCache = { at: 0, job: null };
function listening() {
  if (process.platform !== 'win32') return Promise.resolve('');
  if (netstatCache.job && Date.now() - netstatCache.at < 3000) return netstatCache.job;
  netstatCache = { at: Date.now(), job: exec('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10000 }).then(result => result.stdout).catch(() => '') };
  return netstatCache.job;
}

module.exports = { ServerControl, validateServices, validateCommand, portOpen };
