'use strict';
//By leewheel 2026年11月9日 启动器自身的在线更新（不依赖 electron-updater）：
//  为什么不用 electron-updater：本启动器发布的是 **portable 单文件 exe**（不是 NSIS 安装包），
//  electron-updater 的 quitAndInstall 只能装 NSIS 包，portable 下会直接报“不支持”。
//  所以整条链路自己做，分成四步，每步都可单独验证：
//   1) 查版本：国内 CDN（jsDelivr）→ 镜像反代 GitHub API → GitHub API 直连，三条通道，谁先通用谁；
//   2) 下载：镜像前缀优先（gh-proxy / ghfast …），支持断点续传（Range），带“没动静”看门狗；
//   3) 校验：sha256（release 资产的 digest / 发布说明里的 sha256 行 / 同名 .sha256 资产）+ PE 头 + 体积；
//   4) 自替换：落成 <启动器目录>\CoA启动器.new.exe，再由**新 exe 自己**带 --takeover=<旧PID> 等旧进程退出后换名覆盖。
//      （运行中的 exe 在 Windows 上既不能改名也不能覆盖，必须由外部程序做，见 launcher-swap.cjs）
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { mirrorCandidates, parseVersion, compareVersions } = require('./release-update.cjs');

// 仓库与发版规则：老大用 Release title = COA-LAUNCHER-<版本号>，资产名自带版本号。
const DEFAULT_REPO = 'leewheel/squidbots-launcher';
const RELEASE_TITLE_PREFIX = 'COA-LAUNCHER-';
// 版本号形如 1.0.202611091830（1.0.yyyymmddHHMM，精确到分钟，避免同一小时撞号）
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const USER_AGENT = 'CoA-Launcher-SelfUpdate';

// 国内镜像（前缀反代）。顺序 = 尝试顺序，主力在最前。
const DEFAULT_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghfile.geekertao.top/',
  'https://ghproxy.net/',
  'https://github.moeyy.xyz/',
  'https://hub.gitmirror.com/',
  'https://ghproxy.cc/',
  'https://gh.llkk.cc/',
];

// jsDelivr 三个入口（国内各线路速度不同，挨个试）。它读的是仓库里的纯文本清单，几十字节，最快。
const JSDELIVR_HOSTS = ['https://cdn.jsdelivr.net', 'https://fastly.jsdelivr.net', 'https://gcore.jsdelivr.net'];

function repoOf(value) {
  const text = String(value || '').trim();
  return /^[\w.-]+\/[\w.-]+$/.test(text) ? text : DEFAULT_REPO;
}

//By leewheel 2026年11月9日 ⚠️ compareVersions 接受**字符串**（它内部自己 parseVersion）。
// 这里曾经先把 parseVersion 的结果传进去，等于把数组又 "1,0,202611091830,0" 解析了一遍，
// 只会取到开头的 1 → 任何版本都被判成“一样新”，自动更新永远不会触发。回归测试钉住了这条。
function isNewer(candidate, current) {
  const a = cleanVersion(candidate) || String(candidate || '').trim();
  const b = cleanVersion(current) || String(current || '').trim();
  if (!a || !b) return false;
  return compareVersions(a, b) > 0;
}

//By leewheel 2026年11月9日 版本号只认 1.0.yyyymmddHHMM 这种三段数字；带前缀（v、COA-LAUNCHER-）先剥掉。
function cleanVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  return VERSION_RE.test(text) ? text : '';
}

function hostOf(url) {
  try { return new URL(String(url)).host; } catch { return String(url || '').slice(0, 60); }
}

async function fetchText(url, { fetchImpl = fetch, timeout = 15000, headers = {}, signal } = {}) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'follow',
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error('返回内容过大');
  return text;
}

// ---------------------------------------------------------------- 查版本

// 仓库里的纯文本清单（由 scripts/write-launcher-release.cjs 在打包后生成，随仓库推送）：
//   { version, title, asset, size, sha256, notes, at }
// 这是最轻、最稳的一条通道：几十字节，jsDelivr 在国内有节点，且不受 GitHub API 限流影响。
async function fromManifest({ repo, branch = 'main', fetchImpl, signal }) {
  const failures = [];
  for (const host of JSDELIVR_HOSTS) {
    const url = `${host}/gh/${repo}@${branch}/launcher-release.json`;
    try {
      const text = await fetchText(url, { fetchImpl, signal, timeout: 12000 });
      const data = JSON.parse(text);
      const version = cleanVersion(data.version);
      if (!version) throw new Error('清单里的版本号不合法');
      const asset = String(data.asset || '');
      return {
        version, notes: String(data.notes || ''), asset, size: Number(data.size) || 0,
        sha256: String(data.sha256 || '').toLowerCase(),
        title: String(data.title || `${RELEASE_TITLE_PREFIX}${version}`),
        //By leewheel 2026年11月9日 清单原来不带下载地址 —— 而清单是**主力通道**，一命中就直接进下载，
        // 于是每次真更新都报“这个版本没有下载地址”。地址按 GitHub Releases 的固定规律拼，三种写法依次试：
        //   ① tag 就叫版本号（本仓库的发版习惯） ② tag 是 v+版本号 ③ 按资产名取“最新发布”里的同名文件
        // 第 ③ 条是为了 tag 命名换了也能下；SHA-256 会把关，取错文件不会被当成好 exe 顶上去。
        url: String(data.url || (asset ? `https://github.com/${repo}/releases/download/${version}/${asset}` : '')),
        urls: asset ? [
          `https://github.com/${repo}/releases/download/${version}/${asset}`,
          `https://github.com/${repo}/releases/download/v${version}/${asset}`,
          `https://github.com/${repo}/releases/latest/download/${asset}`,
        ] : [],
        source: `清单（${hostOf(url)}）`,
      };
    } catch (error) {
      failures.push(`${hostOf(url)}：${shortError(error)}`);
    }
  }
  throw new Error(failures.join('；'));
}

// GitHub Releases：标题形如 COA-LAUNCHER-1.0.202611091830，资产 = 启动器 exe。
function pickRelease(list) {
  if (!Array.isArray(list)) return null;
  const rows = list.filter(item => item && !item.draft);
  // 先按标题前缀找（老大发版规则），再退回第一个带 exe 资产的正式版
  const titled = rows.find(item => String(item.name || '').toUpperCase().startsWith(RELEASE_TITLE_PREFIX));
  const withExe = rows.find(item => (item.assets || []).some(asset => /\.exe$/i.test(asset.name || '')));
  return titled || withExe || null;
}

function versionFromRelease(release) {
  const fromTitle = cleanVersion(String(release?.name || '').toUpperCase().replace(RELEASE_TITLE_PREFIX, ''));
  if (fromTitle) return fromTitle;
  return cleanVersion(release?.tag_name || '') || '';
}

function sha256FromBody(body, assetName) {
  const text = String(body || '');
  // 认三种写法：`<资产名> sha256=<hex>`、`sha256: <hex>`、裸的 64 位 hex 紧跟在资产名后
  const escaped = assetName ? assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const patterns = [
    escaped ? new RegExp(`${escaped}[^0-9a-f]{0,40}([0-9a-f]{64})`, 'i') : null,
    /sha-?256\s*[:=]\s*([0-9a-f]{64})/i,
    /([0-9a-f]{64})/i,
  ].filter(Boolean);
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) return found[1].toLowerCase();
  }
  return '';
}

function assetOf(release, version) {
  const assets = (release?.assets || []).filter(asset => /\.exe$/i.test(asset.name || ''));
  if (!assets.length) return null;
  // 优先名字里带版本号的，其次最大的那个（启动器约 375MB）
  const named = assets.find(asset => version && asset.name.includes(version));
  const asset = named || assets.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  return {
    name: asset.name,
    size: Number(asset.size) || 0,
    url: String(asset.browser_download_url || ''),
    // GitHub 2024 年起给每个资产算 digest，形如 "sha256:abc..."，拿到了就不必再读发布说明
    sha256: (/^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || '')) || [])[1]?.toLowerCase() || '',
  };
}

async function fromGithubApi({ repo, mirrors, fetchImpl, signal }) {
  const api = `https://api.github.com/repos/${repo}/releases?per_page=10`;
  const candidates = [
    ...mirrors.map(prefix => `${prefix}${api}`), // 国内镜像反代优先
    api,                                          // 直连兜底
  ];
  const failures = [];
  for (const url of candidates) {
    try {
      const text = await fetchText(url, { fetchImpl, signal, timeout: 15000, headers: { Accept: 'application/vnd.github+json' } });
      const list = JSON.parse(text);
      if (!Array.isArray(list) && list?.message) throw new Error(String(list.message).slice(0, 60));
      const release = pickRelease(list);
      if (!release) throw new Error('还没有发布带 exe 的版本');
      const version = versionFromRelease(release);
      if (!version) throw new Error('发布标题里没有可识别的版本号');
      const asset = assetOf(release, version);
      if (!asset?.url) throw new Error('这个版本没有 exe 资产');
      return {
        version,
        notes: String(release.body || ''),
        asset: asset.name,
        size: asset.size,
        sha256: asset.sha256 || sha256FromBody(release.body, asset.name),
        // 资产地址走镜像下载：这里只负责告诉调用方“GitHub 上的原始地址”
        url: asset.url,
        tag: String(release.tag_name || ''),
        source: `GitHub Releases（${hostOf(url)}）`,
      };
    } catch (error) {
      failures.push(`${hostOf(url)}：${shortError(error)}`);
    }
  }
  throw new Error(failures.join('；'));
}

function shortError(error) {
  const text = String(error?.message || error || '');
  if (/aborted|timeout|TimeoutError/i.test(text)) return '超时';
  if (/ENOTFOUND|ERR_NAME|fetch failed|ECONNREFUSED/i.test(text)) return '连不上';
  if (/HTTP 404/.test(text)) return '404 不存在';
  if (/HTTP 5\d\d/.test(text)) return '服务器错误';
  return text.split(/[\r\n]/)[0].slice(0, 60) || '未知错误';
}

/**
 * 查最新版。三通道依次尝试，任一成功即返回。
 * 返回 { newer, current, latest: {version, notes, asset, size, sha256, url}, source, tried }
 */
async function check({ currentVersion, repo, branch = 'main', mirrors = DEFAULT_MIRRORS, fetchImpl = fetch, signal } = {}) {
  const target = repoOf(repo);
  const tried = [];
  let latest = null;
  try {
    const manifest = await fromManifest({ repo: target, branch, fetchImpl, signal });
    tried.push(`清单：${manifest.version}`);
    latest = manifest;
  } catch (error) {
    tried.push(`清单：${shortError(error)}`);
  }
  if (!latest) {
    try {
      latest = await fromGithubApi({ repo: target, mirrors, fetchImpl, signal });
      tried.push(`API：${latest.version}`);
    } catch (error) {
      tried.push(`API：${shortError(error)}`);
    }
  }
  if (!latest) {
    const error = new Error(`查不到启动器的发布信息（${tried.join('；')}）`);
    error.tried = tried;
    throw error;
  }
  const current = cleanVersion(currentVersion) || String(currentVersion || '');
  return { newer: isNewer(latest.version, current), current, latest, source: latest.source, tried };
}

// ---------------------------------------------------------------- 下载

//By leewheel 2026年11月9日 带断点续传的下载器。
// 国内下 375MB 经常中途断：以前整段重来，玩家每次都从 0% 开始看着像死循环。
// 现在保留 .part，换源也接着已有的字节续（GitHub 与主流镜像都支持 Range）。
async function downloadOnce(url, target, { fetchImpl, onProgress = () => {}, signal, timeout = 30000 } = {}) {
  let have = 0;
  try { have = (await fsp.stat(target)).size; } catch { have = 0; }
  let lastActivity = Date.now();
  let gotBytes = false;
  const controller = new AbortController();
  const cancel = () => { try { controller.abort(); } catch { /* 已取消 */ } };
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }
  // 看门狗：还没收到数据 30 秒、已经收到数据 60 秒没有新字节 → 放弃这个源换下一个
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > (gotBytes ? 60000 : timeout)) cancel();
  }, 2000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  let response;
  try {
    const headers = { 'User-Agent': USER_AGENT };
    if (have > 0) headers.Range = `bytes=${have}-`;
    response = await fetchImpl(url, { redirect: 'follow', headers, signal: controller.signal });
  } catch (error) {
    clearInterval(watchdog);
    signal?.removeEventListener?.('abort', cancel);
    throw error;
  }
  try {
    // 416 = 我们要的那段已经在文件末尾了（之前下完过），当成“已完整”，交给 sha256 判真假
    if (response.status === 416 && have > 0) return { file: target, size: have, resumed: true };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // 206 = 续传成功；200 = 这个源不支持 Range（或本来就没有 .part），从头写
    const resumed = response.status === 206;
    if (!resumed && have > 0) { try { await fsp.rm(target, { force: true }); } catch { /* 删不掉就覆盖写 */ } }
    const start = resumed ? have : 0;
    const total = (Number(response.headers.get('content-length')) || 0) + start;
    let done = start;
    const file = fs.createWriteStream(target, { flags: resumed ? 'a' : 'w' });
    // 写盘失败（磁盘满、只读目录、杀软占用）没有 error 监听就是主进程未捕获异常
    let streamError = null;
    file.on('error', error => { streamError = error; });
    const write = async chunk => {
      if (streamError) throw streamError;
      if (!file.write(chunk)) await once(file, 'drain');
    };
    let lastReport = 0;
    const report = () => {
      const stamp = Date.now();
      if (stamp - lastReport >= 150 || (total && done >= total)) { lastReport = stamp; onProgress(done, total); }
    };
    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          const chunk = Buffer.from(value);
          done += chunk.length;
          gotBytes = true;
          lastActivity = Date.now();
          await write(chunk);
          report();
        }
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        done += buffer.length;
        await write(buffer);
        onProgress(done, total || done);
      }
    } finally {
      try { await new Promise(resolve => file.end(() => resolve())); } catch { /* 见 streamError */ }
      if (streamError) throw streamError;
    }
    onProgress(done, total || done);
    if (total && done < total) throw new Error(`下载不完整：${done}/${total} 字节`);
    return { file: target, size: done, resumed };
  } finally {
    clearInterval(watchdog);
    signal?.removeEventListener?.('abort', cancel);
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function looksLikeExe(file) {
  let handle = null;
  try {
    handle = await fsp.open(file, 'r');
    const head = Buffer.alloc(2);
    const { bytesRead } = await handle.read(head, 0, 2, 0);
    return bytesRead === 2 && head[0] === 0x4d && head[1] === 0x5a; // 'MZ'
  } catch { return false; } finally { if (handle) await handle.close().catch(() => {}); }
}

/**
 * 下载并校验新版启动器。目标文件是 <dir>\CoA-Launcher-<版本>.exe，旁边留 .part 支持续传。
 * 返回 { file, size, sha256, resumedFrom }
 */
async function download(info, { dir, onProgress = () => {}, signal, mirrors = DEFAULT_MIRRORS, fetchImpl = fetch } = {}) {
  if (!info?.version) throw new Error('没有可下载的版本信息');
  await fsp.mkdir(dir, { recursive: true });
  const name = `CoA-Launcher-${info.version}.exe`;
  const target = path.join(dir, name);
  const part = `${target}.part`;

  // 已经下好过（同一个版本）：sha256 对得上就直接用，不再浪费流量
  if (await exists(target)) {
    const size = (await fsp.stat(target)).size;
    if ((!info.size || size === info.size) && (!info.sha256 || (await sha256File(target)) === info.sha256)) {
      return { file: target, size, sha256: info.sha256 || '', cached: true };
    }
    await fsp.rm(target, { force: true }).catch(() => {});
  }

  //By leewheel 2026年11月9日 info 可能给一个地址（GitHub API 通道就是原始资产地址），
  // 也可能给一组地址（清单通道不知道 tag 怎么写的，拼了几种写法）。每组地址都过一遍镜像反代，
  // 按“种子”分组保序：第一个种子在第一个镜像上就成的概率最高，不用把镜像×种子全排开。
  const seeds = Array.isArray(info.urls) && info.urls.length ? info.urls.filter(Boolean) : info.url ? [info.url] : [];
  const urls = [];
  for (const seed of seeds) {
    for (const candidate of mirrorCandidates(seed, mirrors)) if (!urls.includes(candidate)) urls.push(candidate);
  }
  if (!urls.length) throw new Error('这个版本没有下载地址');
  const failures = [];
  let lastSize = 0;
  for (const url of urls) {
    if (signal?.aborted) throw new Error('已取消');
    try {
      const result = await downloadOnce(url, part, { fetchImpl, signal, onProgress });
      lastSize = result.size;
      // 体积先判（便宜），再算 sha256（贵）
      if (info.size && result.size !== info.size) throw new Error(`体积不对：${result.size}/${info.size} 字节`);
      if (!(await looksLikeExe(part))) throw new Error('下载到的不是 exe（镜像返回了错误页）');
      if (info.sha256) {
        const actual = await sha256File(part);
        if (actual !== info.sha256) throw new Error(`sha256 不匹配（${actual.slice(0, 12)}…）`);
      }
      await fsp.rename(part, target);
      return { file: target, size: result.size, sha256: info.sha256 || '', resumed: result.resumed };
    } catch (error) {
      if (signal?.aborted) throw new Error('已取消');
      failures.push(`${hostOf(url)}：${shortError(error)}`);
      // 半截文件留着给下一个源续传；但如果是对端内容坏了（非 exe / sha 不符），删掉重来
      if (/不是 exe|sha256 不匹配/.test(String(error.message))) await fsp.rm(part, { force: true }).catch(() => {});
    }
  }
  const detail = failures.length > 4 ? [...failures.slice(0, 4), `等 ${failures.length} 个源`].join('；') : failures.join('；');
  const error = new Error(`下载失败，所有源都不可用（${detail}）${lastSize ? `；已下载 ${Math.round(lastSize / 1048576)} MB，重试会接着下` : ''}`);
  error.failures = failures;
  throw error;
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

// ---------------------------------------------------------------- 落位与自替换

const STAGED_META = 'CoA启动器.new.json';

//By leewheel 2026年11月9日 把下好的 exe 复制成 <root>\CoA启动器.new.exe 并写元数据。
// 为什么要复制而不是直接下载到那个位置：下载中途断掉时不能留下“看起来就绪”的半截文件，
// 否则下次启动的自动替换会把启动器换成坏 exe（直接打不开）。复制前已经过 sha256 校验，安全。
async function stage({ root, file, version, sha256, size }) {
  const staged = path.join(root, 'CoA启动器.new.exe');
  await fsp.copyFile(file, staged);
  const stat = await fsp.stat(staged);
  if (size && stat.size !== size) throw new Error(`落位后的文件大小不对：${stat.size} != ${size}`);
  if (!(await looksLikeExe(staged))) throw new Error('落位后的文件不是有效的 exe');
  await fsp.writeFile(path.join(root, STAGED_META), JSON.stringify({ version, sha256, size: stat.size, at: new Date().toISOString() }, null, 2), 'utf8');
  return staged;
}

// 读已落位的新版信息（没有就返回 null）
function readStaged(root) {
  const metaFile = path.join(root, STAGED_META);
  const exeFile = path.join(root, 'CoA启动器.new.exe');
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const size = fs.statSync(exeFile).size;
    if (meta.size && size !== meta.size) return null; // 半截 / 被改过
    return { ...meta, exeFile, size };
  } catch { return null; }
}

function clearStaged(root) {
  for (const name of ['CoA启动器.new.exe', STAGED_META]) {
    try { fs.rmSync(path.join(root, name), { force: true }); } catch { /* 占用中 */ }
  }
}

module.exports = {
  DEFAULT_REPO, RELEASE_TITLE_PREFIX, DEFAULT_MIRRORS, JSDELIVR_HOSTS, STAGED_META,
  repoOf, cleanVersion, isNewer, check, download, sha256File, looksLikeExe,
  stage, readStaged, clearStaged, shortError,
  // 解析用的内部函数也导出：单测要逐条钉住“怎么认发布、怎么取版本、怎么找 sha256”
  pickRelease, versionFromRelease, sha256FromBody, assetOf, fromManifest, fromGithubApi,
};
