'use strict';
//By leewheel 2026年11月6日 BUG 反馈（格式对齐参考启动器 PlusLauncherGeneralVersion/BugReportManager.cs）：
// 1) 收集环境信息（启动器/服务端/客户端/系统/最近崩溃）
// 2) 生成 zip：BUG信息.txt、环境信息.json、截图/、日志/（日志尾部）
// 3) multipart 上传到 BUG 服务，字段名与服务端约定一致；product 必须是 COA（服务端按产品登记，填别的会被拒）
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DEFAULT_ENDPOINT = 'http://www.shboxi.com.cn:8081/api/bugreport';
const DEFAULT_PRODUCT = 'COA';
const MAX_LOG_TAIL = 2 * 1024 * 1024;      // 每份日志只带最后 2MB
const MAX_SHOT_BYTES = 20 * 1024 * 1024;   // 单张截图上限

const sanitize = (text, max) => String(text || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(0, max || 40) || 'x';

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    const buffer = fs.readFileSync(file);
    return {
      path: file,
      name: path.basename(file),
      exists: true,
      size: stat.size,
      lastWrite: stat.mtime.toISOString().replace('T', ' ').slice(0, 19),
      md5: crypto.createHash('md5').update(buffer).digest('hex'),
      productVersion: '',
    };
  } catch {
    return { path: file, name: path.basename(file), exists: false, size: 0, lastWrite: '', md5: '', productVersion: '' };
  }
}

function collectEnv({ root, serverRoot, clientRoot, launcherVersion, running }) {
  const crashes = [];
  try {
    for (const dir of [path.join(serverRoot, 'Crashes'), path.join(serverRoot, 'logs')]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).filter(item => /\.(txt|dmp)$/i.test(item)).slice(0, 5)) {
        const full = path.join(dir, name);
        crashes.push(`${name}  (${fs.statSync(full).mtime.toISOString().replace('T', ' ').slice(0, 19)})`);
      }
    }
  } catch { /* 列不出来就算了 */ }
  const client = (() => {
    try {
      const exe = path.join(clientRoot, 'Ascension.exe');
      if (!fs.existsSync(exe)) return { exists: false, name: '', version: '' };
      const stat = fs.statSync(exe);
      return { exists: true, name: 'Ascension.exe', version: `${(stat.size / 1048576).toFixed(1)} MB / ${stat.mtime.toISOString().slice(0, 10)}` };
    } catch { return { exists: false, name: '', version: '' }; }
  })();
  return {
    CollectedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    LauncherVersion: String(launcherVersion || ''),
    LauncherExe: process.execPath,
    WorkDir: root,
    OSInfo: `${os.type()} ${os.release()}`,
    Arch: os.arch(),
    DotNetVersion: '',
    NodeVersion: process.versions.node,
    ServerRunning: !!running,
    WorldServer: fileInfo(path.join(serverRoot, 'worldserver.exe')),
    AuthServer: fileInfo(path.join(serverRoot, 'authserver.exe')),
    Client: client,
    RecentCrashes: crashes,
  };
}

function humanText(d, env) {
  const lines = [
    '========== CoA BUG 反馈 ==========',
    `提交时间 : ${env.CollectedAt}`,
    `QQ 号    : ${d.qq}`,
    `标  题   : ${d.title}`,
    `截图数量 : ${d.shotCount}`,
    `附带日志 : ${d.includeLogs ? '是' : '否'}`,
    '',
    '---------- 详细描述 ----------',
    String(d.description || ''),
    '',
    '---------- 运行环境（自动采集，请勿修改） ----------',
    `启动器版本 : ${env.LauncherVersion}`,
    `启动器路径 : ${env.LauncherExe}`,
    `运行目录   : ${env.WorkDir}`,
    `操作系统   : ${env.OSInfo} (${env.Arch})`,
    `Node 版本  : ${env.NodeVersion}`,
    `提交时服务器 : ${env.ServerRunning ? '运行中' : '未运行/启动失败'}`,
    '',
    'worldserver.exe:',
    `  路径      : ${env.WorldServer.path} (存在=${env.WorldServer.exists})`,
    `  文件大小  : ${env.WorldServer.size} 字节`,
    `  文件时间  : ${env.WorldServer.lastWrite}`,
    `  MD5       : ${env.WorldServer.md5}`,
    '',
    'authserver.exe:',
    `  路径      : ${env.AuthServer.path} (存在=${env.AuthServer.exists})`,
    `  文件大小  : ${env.AuthServer.size} 字节`,
    `  MD5       : ${env.AuthServer.md5}`,
    '',
    '客户端:',
    `  ${env.Client.exists ? `${env.Client.name} ${env.Client.version}` : '未找到'}`,
    '',
  ];
  if (env.RecentCrashes.length) {
    lines.push('最近崩溃报告（logs/Crashes）:');
    for (const item of env.RecentCrashes) lines.push(`  ${item}`);
  }
  return lines.join('\r\n');
}

function copyTail(source, target, maxBytes) {
  try {
    const stat = fs.statSync(source);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(source, 'r');
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    fs.writeFileSync(target, buffer);
    return true;
  } catch { return false; }
}

function makeZip(folder, zipPath) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const result = spawnSync(tar, ['-a', '-c', '-f', zipPath, '-C', folder, '.'], { windowsHide: true });
  if (result.status !== 0 || !fs.existsSync(zipPath)) throw new Error('打包 zip 失败（tar）');
  return zipPath;
}

async function buildArchive({ root, serverRoot, clientRoot, launcherVersion, running, options }) {
  const env = collectEnv({ root, serverRoot, clientRoot, launcherVersion, running });
  const tempDir = path.join(os.tmpdir(), `CoA_BugReport_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const shotDir = path.join(tempDir, '截图');
  const logDir = path.join(tempDir, '日志');
  await fsp.mkdir(shotDir, { recursive: true });
  await fsp.mkdir(logDir, { recursive: true });

  const shots = [];
  let index = 0;
  for (const file of options.screenshots || []) {
    try {
      if (!fs.existsSync(file)) continue;
      if (fs.statSync(file).size > MAX_SHOT_BYTES) continue;
      index++;
      const ext = path.extname(file) || '.png';
      const target = path.join(shotDir, `截图${String(index).padStart(2, '0')}_${sanitize(path.basename(file, ext), 40)}${ext}`);
      await fsp.copyFile(file, target);
      shots.push(target);
    } catch { /* 单张失败不影响整包 */ }
  }

  if (options.includeLogs) {
    for (const [name, file] of [
      ['Server.log', path.join(serverRoot, 'logs', 'Server.log')],
      ['Errors.log', path.join(serverRoot, 'logs', 'Errors.log')],
      ['launcher-world.log', path.join(serverRoot, 'logs', 'launcher-world.log')],
      ['Playerbots.log', path.join(serverRoot, 'logs', 'Playerbots.log')],
    ]) copyTail(file, path.join(logDir, name), MAX_LOG_TAIL);
    const crashOut = path.join(logDir, '崩溃报告');
    try {
      const crashDir = path.join(serverRoot, 'logs');
      const today = new Date().toDateString();
      const todayCrashes = fs.existsSync(crashDir)
        ? fs.readdirSync(crashDir).filter(name => /\.(txt|dmp)$/i.test(name) && fs.statSync(path.join(crashDir, name)).mtime.toDateString() === today).slice(0, 2)
        : [];
      if (todayCrashes.length) {
        await fsp.mkdir(crashOut, { recursive: true });
        for (const name of todayCrashes) await fsp.copyFile(path.join(crashDir, name), path.join(crashOut, name)).catch(() => {});
      }
    } catch { /* 崩溃报告可选 */ }
  } else {
    await fsp.rm(logDir, { recursive: true, force: true });
  }

  const payload = {
    qq: String(options.qq || ''),
    title: String(options.title || ''),
    description: String(options.description || ''),
    includeLogs: !!options.includeLogs,
    shotCount: shots.length,
  };
  await fsp.writeFile(path.join(tempDir, 'BUG信息.txt'), humanText(payload, env), 'utf8');
  await fsp.writeFile(path.join(tempDir, '环境信息.json'), JSON.stringify(env, null, 2), 'utf8');

  // 用本机日期（参考项目是 DateTime.Now，别用 UTC，否则凌晨会差一天）
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const zipName = `COA+${sanitize(payload.qq, 20)}+${sanitize(payload.title, 40)}+${date}.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);
  await fsp.rm(zipPath, { force: true });
  makeZip(tempDir, zipPath);
  await fsp.rm(tempDir, { recursive: true, force: true });
  return { env, payload, zipPath, zipName };
}

async function submit({ endpoint, product, zipPath, zipName, env, payload, onProgress }) {
  const form = new FormData();
  const add = (name, value) => form.append(name, String(value ?? ''));
  add('product', product || DEFAULT_PRODUCT);
  add('qq', payload.qq);
  add('title', payload.title);
  add('description', payload.description);
  add('launcher_version', env.LauncherVersion);
  add('server_version', env.WorldServer.productVersion || env.WorldServer.lastWrite || '');
  add('server_build', `文件版本 ${env.WorldServer.md5.slice(0, 12)} / 文件时间 ${env.WorldServer.lastWrite}`);
  add('server_file', env.WorldServer.name || '');
  add('server_size', env.WorldServer.size);
  add('server_hash', env.WorldServer.md5);
  add('client_info', env.Client.exists ? `${env.Client.name} 版本 ${env.Client.version}` : '');
  add('os_info', `${env.OSInfo} (${env.Arch})`);
  add('env_json', JSON.stringify(env));
  add('shot_count', payload.shotCount);
  add('log_included', payload.includeLogs ? '1' : '0');
  add('zip_name', zipName);

  const buffer = fs.readFileSync(zipPath);
  onProgress?.({ phase: 'upload', pct: 5, message: `正在上传（${(buffer.length / 1048576).toFixed(1)} MB）` });
  form.append('zip', new Blob([buffer], { type: 'application/zip' }), zipName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  try {
    onProgress?.({ phase: 'upload', pct: 30, message: '正在上传…' });
    const response = await fetch(endpoint || DEFAULT_ENDPOINT, { method: 'POST', body: form, signal: controller.signal });
    const body = await response.text();
    onProgress?.({ phase: 'upload', pct: 95, message: '等待服务器返回…' });
    if (!response.ok) return { ok: false, message: `服务器返回 ${response.status}：${body.slice(0, 200)}` };
    let id = 0;
    try { id = Number(JSON.parse(body).id) || 0; } catch { /* 不是 JSON 就当成功 */ }
    return { ok: true, id, message: '提交成功' };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  } finally { clearTimeout(timer); }
}

module.exports = { buildArchive, submit, collectEnv, DEFAULT_ENDPOINT, DEFAULT_PRODUCT };
