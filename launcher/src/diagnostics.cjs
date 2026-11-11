'use strict';
//By leewheel 2026年11月9日 服务启动失败的原因诊断（老大要求：主页要能醒目提示，并弹窗说清「为什么起不来」）。
// 以前的毛病：起不来只弹一句英文 “xxx stopped while starting. Look at its log.”，玩家完全不知道该干什么，
// 只会来问“为什么打不开”。这里把「现象的根因」逐条对上号：
//   · 端口被别的程序占（谁占的、在哪个路径）
//   · 数据库连不上（MySQL 没起 / 账号密码不对 / 库不存在 / 缺表）
//   · 缺运行库 / 32 位 64 位不匹配（Windows 退出码 0xC0000135 / 0xC000007B）
//   · 崩溃（0xC0000005，附日志最后几行）
//   · data 目录 / 配置文件 / exe 缺失，路径含中文，磁盘满
// 判定优先级：先看**结构性事实**（文件在不在、端口谁占着），再看**退出码**，最后才从日志里找特征行。
// 日志一律按 GBK 兜底解码：worldserver / mysqld 在中文 Windows 上写的是 GBK，按 UTF-8 读会全是乱码。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------- 文本读取

function decode(buffer) {
  if (!buffer?.length) return '';
  // BOM 优先
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  // 先按 UTF-8 严格解：成功就是 UTF-8
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { /* 不是 UTF-8 */ }
  // 退回 GBK（中文 Windows 上 MySQL / 核心日志都是这个）
  try { return new TextDecoder('gbk').decode(buffer); } catch { return buffer.toString('latin1'); }
}

/** 读文件末尾 N 行（大文件只读最后 256KB，别把 200MB 的 Server.log 全读进内存） */
function tail(file, lines = 60) {
  let handle = null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { file, lines: [], truncated: false };
    const size = stat.size;
    const want = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(want);
    handle = fs.openSync(file, 'r');
    fs.readSync(handle, buffer, 0, want, size - want);
    const text = decode(buffer);
    const all = text.split(/\r?\n/).filter(row => row.trim());
    return { file, lines: all.slice(-lines), truncated: size > want, size, at: stat.mtime.toISOString() };
  } catch {
    return { file, lines: [], truncated: false };
  } finally { if (handle !== null) try { fs.closeSync(handle); } catch { /* 已关闭 */ } }
}

// ---------------------------------------------------------------- 退出码

// Windows 常见的“程序根本起不来”退出码。都是无符号 32 位，Node 报出来是负数。
const EXIT_CODES = {
  '-1073741515': '缺少运行库（0xC0000135：系统找不到 vcruntime140.dll 之类的依赖）',
  '-1073741701': '程序位数不匹配或缺依赖 DLL（0xC000007B）',
  '-1073741819': '程序崩溃（0xC0000005 访问违例）',
  '-1073741795': '程序初始化失败（0xC000001D 非法指令：CPU 不支持或文件损坏）',
  '-1073741571': '栈溢出（0xC00000FD）',
  '-1073740791': '触发了系统的数据执行保护（0xC0000409）',
  '-1': '被强制结束',
  '1': '程序自己报错退出（配置或数据问题，见日志）',
  '2': '程序自己报错退出（配置或数据问题，见日志）',
  '255': '程序自己报错退出',
  '3221225781': '缺少运行库（0xC0000135）',
  '3221225595': '程序位数不匹配或缺依赖 DLL（0xC000007B）',
  '3221225477': '程序崩溃（0xC0000005 访问违例）',
};

function exitText(code) {
  if (code === null || code === undefined) return '';
  const hex = code < 0 ? (code >>> 0).toString(16).toUpperCase().padStart(8, '0') : '';
  const known = EXIT_CODES[String(code)] || '';
  return known ? `${known}` : (hex ? `退出码 0x${hex}` : `退出码 ${code}`);
}

// ---------------------------------------------------------------- 规则表

// 每条规则：match 命中即采用；reason 是"为什么"，hint 是"怎么办"。
// 顺序有意义：越前面越具体，命中就停。
const MYSQL_RULES = [
  { match: /Do you already have another mysqld server running on port|only one usage of each socket address|Bind on TCP\/IP port/i, reason: '数据库端口已经被另一个程序占用（多半是另一份 MySQL 还在跑）', hint: '在任务管理器里结束那个 mysqld.exe，或者用首页服务卡片上的「强制关闭占用程序」。' },
  { match: /Unable to lock \.\/(ibdata1|aria_log)/i, reason: '数据库文件被另一个 MySQL 进程锁着（同一份数据被两份程序打开了）', hint: '关掉另一个 MySQL 实例；如果它是别的整合包里的，两份不能同时开。' },
  { match: /(Cannot create\/write to file|Operating system error number 13|Permission denied|Errcode: 13)/i, reason: '没有权限写数据库文件（目录被设成只读，或被杀毒软件锁住）', hint: '把整个整合包放到 D:\\Games 这类普通目录（不要放 C:\\Program Files），并给杀毒软件加白名单。' },
  { match: /(Operating system error number 2|Errcode: 2|Can't change dir to|No such file or directory)/i, reason: '数据库目录不存在或路径读不到（my.ini 里的 datadir 指向了不存在的位置）', hint: '检查 Server\\my.ini 里的 datadir；如果换过目录名/盘符，改回正确路径。' },
  { match: /(unknown variable|Aborting|\[ERROR\] Fatal error|Can't open and lock privilege tables|Table 'mysql\.)/i, reason: '数据目录里的系统表缺失或损坏，或者 my.ini 里有这个版本不认识的配置项', hint: '先用备份恢复数据库（首页「备份」里最近的一份）；没有备份就只能重装整合包的服务端部分。' },
  { match: /(Multiple files found for the same tablespace ID|tablespace ID)/i, reason: '两套整合包的数据文件被混到同一个 mysql\\Data 里了', hint: '不要把一个整合包解压覆盖到另一个上；把旧包整个移除，用备份恢复。' },
  { match: /(read-only|--read-only)/i, reason: '数据库以只读方式启动，无法写入', hint: '检查 my.ini 里是否有 read-only 相关配置，删掉后重试。' },
];

const WORLD_RULES = [
  { match: /(Could not connect to MySQL|Can't connect to MySQL server|Lost connection to MySQL server at .* while connecting|Failed to connect to database)/i, reason: '世界服连不上数据库（多半是 MySQL 还没起来，或端口/地址不对）', hint: '先单独启动「数据库」，等它的灯变绿；看首页数据库那一行的状态。' },
  { match: /Access denied for user .* \(using password/i, reason: '数据库账号或密码不对（configs\\worldserver.conf 里的 WorldDatabaseInfo）', hint: '把 WorldDatabaseInfo / LoginDatabaseInfo 的账号密码改回 acore / acore。' },
  { match: /Unknown database '([^']+)'/i, reason: '数据库里没有这个名字的库', hint: '先用备份恢复数据库，或者重新安装整合包的服务端部分。' },
  { match: /(Table '[^']+' doesn't exist|Could not prepare statements of the (World|Playerbots|Character|Login) database|Table '([^']+)' doesn't exist)/i, reason: '数据库缺少这张表（核心版本比库新，或建库脚本没跑完）', hint: '点首页「体检」里的「补齐数据库表」，或装一次最新的更新包。' },
  { match: /(Map file .* does not exist|VMap file .* does not exist|MMAP.*(does not exist|not found)|Could not open .*\.map)/i, reason: '服务端缺地图数据（ClientData\\maps、vmaps、mmaps 不全）', hint: '用「更新数据」重新从游戏客户端生成，或者重装服务端的数据部分。' },
  { match: /(Wrong passphrase|DataDir .* (is|does) not|Cannot find DataDir|Unable to open .*dbc)/i, reason: '数据目录（ClientData）路径不对或内容不全', hint: '检查 configs\\worldserver.conf 里的 DataDir，确认 ClientData\\dbc、maps、vmaps 都在。' },
  { match: /(WorldServerPort|port .* is already in use|Address already in use)/i, reason: '世界服端口被占用（多半是上一次的服务端还没退干净）', hint: '用首页的「强制关闭占用程序」，然后重新启动。' },
  { match: /(Can't find .*\.conf|Could not find configuration file|Missing property)/i, reason: '服务端配置文件缺失或不全', hint: '点首页「体检」里的修复，或装一次最新更新包（会补齐 configs）。' },
  { match: /(Unknown column|Field '[^']+' doesn't have a default value)/i, reason: '数据库表结构比核心旧（缺字段）', hint: '点「体检 → 补齐数据库表」，或装最新更新包。' },
];

const AUTH_RULES = [
  { match: /(Could not connect to MySQL|Can't connect to MySQL server|Access denied for user)/i, reason: '登录服连不上数据库，或账号密码不对（configs\\authserver.conf 里的 LoginDatabaseInfo）', hint: '先启动数据库；账号密码必须是 acore / acore。' },
  { match: /Unknown database '([^']+)'/i, reason: '数据库里没有 acore_auth 这个库', hint: '用备份恢复数据库。' },
  { match: /(Realm server port|already in use|Address already in use)/i, reason: '登录服端口（3724）被占用', hint: '用「强制关闭占用程序」后再启动。' },
];

function rulesOf(id) {
  if (/mysql|database|数据库/i.test(id)) return MYSQL_RULES;
  if (/auth|login|登录/i.test(id)) return AUTH_RULES;
  return WORLD_RULES;
}

// 从日志尾部找第一条命中的规则；顺便把命中的那一行原文带出来（玩家发给老大时最有用）
function matchRule(lines, rules) {
  for (const rule of rules) {
    for (const line of lines) {
      if (rule.match.test(line)) return { reason: rule.reason, hint: rule.hint, quote: line.trim().slice(0, 300), pattern: String(rule.match) };
    }
  }
  return null;
}

// 日志里挑出「值得给玩家看的行」：报错/致命/失败/端口/数据库
function interestingLines(lines) {
  const hit = lines.filter(line => /\[error\]|\[fatal\]|fatal|error|failed|failure|cannot|can't|could not|denied|exception|does not exist|不存在|错误|失败|端口|占用/i.test(line));
  return (hit.length ? hit : lines).slice(-12);
}

// ---------------------------------------------------------------- 通用事实检查

function freeSpace(dir) {
  try {
    const stat = fs.statfsSync(dir);
    return stat.bavail * stat.bsize;
  } catch { return -1; }
}

async function diagnoseAll(control, { lastExits = new Map(), now = Date.now() } = {}) {
  const root = control?.root || '';
  const layout = root ? require('./layout.cjs').serverLayout(root) : null;
  const statuses = control ? await control.status().catch(() => []) : [];
  const logDir = layout ? path.join(root, layout.logs) : '';
  const out = [];
  const tips = [];

  // 全局前置：路径含中文、磁盘空间——这两条会让任何服务都起不来，先说
  let globalBlock = '';
  try {
    if (root && require('./layout-check.cjs').checkLayout({ paths: [root] }).chinesePath) {
      globalBlock = '整合包放在中文路径下，MySQL 与世界服都可能读不到文件。请把整个文件夹移到纯英文路径（例如 D:\\Games\\COA）。';
      tips.push(globalBlock);
    }
  } catch { /* 体检模块不可用时跳过 */ }
  const free = root ? freeSpace(root) : -1;
  if (free >= 0 && free < 2 * 1024 ** 3) {
    tips.push(`启动器所在磁盘只剩 ${(free / 1024 ** 3).toFixed(1)} GB：数据库要写日志和存档，空间不足会直接起不来。`);
  }

  for (const status of statuses) {
    const service = (control.services || []).find(item => item.id === status.id) || {};
    const exeRel = String(service.exe || '');
    const exeAbs = exeRel ? path.join(root, ...exeRel.split('/')) : '';
    const exit = lastExits.get(status.id) || null;
    const checks = [];
    const entry = {
      id: status.id,
      name: status.name || status.id,
      port: status.port,
      state: status.state,
      severity: 'ok',
      headline: '',
      reason: '',
      hint: '',
      quote: '',
      exit: exit ? { code: exit.code, at: exit.at, text: exitText(exit.code) } : null,
      log: { file: '', lines: [] },
      checks,
    };

    // 1) 结构性事实：exe 在不在
    if (exeAbs) {
      const exists = fs.existsSync(exeAbs);
      checks.push({ ok: exists, text: exists ? `程序文件在：${exeRel}` : `缺少程序文件：${exeRel}` });
      if (!exists) {
        entry.severity = 'critical';
        entry.headline = `${entry.name} 起不来：程序文件不见了`;
        entry.reason = `找不到 ${exeRel}（应该在这个位置：${exeAbs}）`;
        entry.hint = '整合包不完整：重新解压一次服务端部分，或者用「体检 → 修复」补回文件。';
        out.push(entry);
        continue;
      }
    }
    // 2) MySQL 专属：数据目录与 my.ini
    if (/mysql|database|数据库/i.test(status.id)) {
      const dataDir = path.join(root, 'mysql', 'Data');
      const iniFile = path.join(root, 'my.ini');
      const dataOk = fs.existsSync(dataDir);
      const iniOk = fs.existsSync(iniFile);
      checks.push({ ok: dataOk, text: dataOk ? '数据库文件在：mysql\\Data' : '缺少数据库文件：mysql\\Data' });
      if (iniOk) checks.push({ ok: true, text: '配置在：my.ini' });
      if (!dataOk) {
        entry.severity = 'critical';
        entry.headline = `${entry.name} 起不来：数据库文件不见了`;
        entry.reason = `mysql\\Data 目录不存在（${dataDir}）`;
        entry.hint = '这是整套角色数据的存放处，必须用备份恢复或重装服务端的数据库部分，不能空着启动。';
        out.push(entry);
        continue;
      }
      if (!iniOk) {
        entry.severity = 'critical';
        entry.headline = `${entry.name} 起不来：缺少 my.ini`;
        entry.reason = '服务端根目录下没有 my.ini（MySQL 的端口与数据目录都写在这个文件里）';
        entry.hint = '用「体检 → 修复」生成一份，或者从备份/更新包里拷回来。';
        out.push(entry);
        continue;
      }
    }
    // 3) 端口被别的程序占着
    if (status.state === 'foreign') {
      entry.severity = 'critical';
      entry.headline = `${entry.name} 起不来：端口 ${status.port} 被别的程序占着`;
      entry.reason = `占用者：${status.other || '未知程序'}`;
      entry.hint = '点下面的「强制关闭占用程序」把它结束掉，再启动。若那是你自己装的 MySQL，请先手动停掉它。';
      out.push(entry);
      continue;
    }
    // 4) 数据库没起来时，世界服/登录服的失败原因就是它
    const mysqlStatus = statuses.find(item => /mysql|database|数据库/i.test(item.id));
    if (!/mysql|database|数据库/i.test(status.id) && mysqlStatus && mysqlStatus.state !== 'running' && ['stopped', 'foreign'].includes(status.state) && exit) {
      entry.severity = 'critical';
      entry.headline = `${entry.name} 起不来：数据库没在运行`;
      entry.reason = '世界服/登录服启动时要连数据库，数据库没起来它们会立刻退出。';
      entry.hint = '先单独启动「数据库」，等它的灯变绿，再启动世界服。';
      out.push(entry);
      continue;
    }
    // 5) 读日志 + 规则匹配
    const logFile = path.join(logDir || root, `launcher-${status.id}.log`);
    const tailData = tail(logFile, 400);
    entry.log = { file: tailData.file, lines: interestingLines(tailData.lines), at: tailData.at || '' };
    // 世界服真正的报错在 Server.log / Errors.log 里（launcher-world.log 只有控制台输出）
    if (/world/i.test(status.id) && logDir) {
      for (const name of ['Errors.log', 'Server.log']) {
        const extra = tail(path.join(logDir, name), 400);
        if (!extra.lines.length) continue;
        const hit = matchRule(extra.lines, WORLD_RULES);
        if (hit && !entry.reason) {
          Object.assign(entry, { severity: 'critical', headline: `${entry.name} 起不来：${hit.reason.split('（')[0]}`, reason: hit.reason, hint: hit.hint, quote: hit.quote });
          entry.log = { file: extra.file, lines: interestingLines(extra.lines), at: extra.at || '' };
          break;
        }
      }
    }
    if (!entry.reason) {
      const hit = matchRule(tailData.lines, rulesOf(status.id));
      if (hit) Object.assign(entry, { severity: 'critical', headline: `${entry.name} 起不来：${hit.reason.split('（')[0]}`, reason: hit.reason, hint: hit.hint, quote: hit.quote });
    }
    // 6) 还没定位到原因：按退出码说话
    if (!entry.reason && exit) {
      const text = exitText(exit.code);
      entry.severity = 'critical';
      entry.headline = `${entry.name} 启动时退出了`;
      entry.reason = `${text}${exit.at ? `（${new Date(exit.at).toLocaleString('zh-CN')}）` : ''}`;
      entry.hint = /缺少运行库/.test(text)
        ? '装一遍微软 VC++ 2015-2022 x64 运行库（vc_redist.x64.exe），然后重启启动器。'
        : /崩溃/.test(text)
          ? '这是程序崩溃：把下面的日志最后几行发给老大，同时先试一次「体检 → 修复」。'
          : '看下面的日志。如果日志是空的，说明程序在打印任何东西之前就退出了（多半是缺运行库或文件损坏）。';
    }
    // 7) 超时仍未开端口
    if (!entry.reason && ['starting', 'stopped'].includes(status.state) && entry.log.lines.length) {
      entry.severity = 'warning';
      entry.headline = `${entry.name} 一直没有就绪`;
      entry.reason = `等了很久，端口 ${status.port} 还没打开，日志也没有明确的错误。`;
      entry.hint = '第一次启动要加载地图和机器人，慢机器可能要 5~10 分钟。若超过 15 分钟还是这样，点「体检 → 修复」。';
    }
    if (!entry.reason) {
      // 没毛病就是没毛病：运行中给 ok（弹窗里是绿的），没运行给 info（不算错）
      entry.severity = status.state === 'running' ? 'ok' : 'info';
      entry.headline = status.state === 'running' ? `${entry.name} 正在运行` : `${entry.name} 没有在运行`;
      entry.reason = '';
    }
    out.push(entry);
  }

  const failed = out.filter(item => item.severity === 'critical');
  return {
    at: new Date(now).toISOString(),
    root,
    blocked: globalBlock,
    free,
    services: out,
    failed: failed.length,
    headline: failed.length ? `${failed.length} 个服务起不来：${failed.map(item => item.name).join('、')}` : '',
    tips,
  };
}

//By leewheel 2026年11月9日 给「启动失败」那一刻用的一句话：直接进界面横幅，不用再展开就知道大概。
function quickLine(diagnosis) {
  if (!diagnosis) return '';
  if (diagnosis.blocked) return diagnosis.blocked;
  const first = (diagnosis.services || []).find(item => item.severity === 'critical');
  if (!first) return '';
  return first.reason ? `${first.name}：${first.reason}` : first.headline;
}

module.exports = { diagnoseAll, quickLine, tail, decode, exitText, interestingLines, matchRule, rulesOf };
