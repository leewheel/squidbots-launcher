'use strict';
//By leewheel 2026-11-03
// 服务端 / 客户端更新（Launch 数据来自 GitHub releases：leewheel/azerothcore-wotlk-coa）
//
// 一次更新的完整流程：
//   1. 读 GitHub releases（api.github.com）→ 最新 tag + 发布说明 + 资产列表；
//   2. 选资产：优先 CoA-Update-<版本>.zip；都能下载（走 electron 的 net.fetch，可带进度）；
//   3. 下载到 <exe 同级>\Update\<版本>\（临时目录，玩家可勾选更新完删除）；
//   4. 解压（Windows 自带 tar.exe，与项目其它地方一致）；
//   5. 按【更新包约定格式】归位（目录名大小写不敏感）：
//        server\**                     → <根>\Server\**
//        configs\**                    → <根>\Server\configs\**（覆盖，晚于 server\ 生效）
//        server\SQL\<库名>\*.sql        → 用项目自带 MySQL 导入【<库名>】这个库（按文件名排序）
//        client\**                     → <根>\Client\**（Ascension.exe / Extensions.dll / Data\*.mpq 都走这里）
//        client\data\dbc\<档名.mpq>\*.dbc       → 注入 Client\Data\<档名.mpq> 的 DBFilesClient\
//        client\data\dbc\<子目录>\<档名.mpq>\*.dbc → 注入 Client\Data\<子目录>\<档名.mpq>（如 enUS\speech-enUS.MPQ）
//        client\data\dbc\*.dbc（平铺）          → 按 dbc-map.json 或自动找含该表的档（老格式，兼容）
//        mpq\*.mpq（老格式）                     → 直接覆盖 Client\Data\
//   6. 记录版本号（.coa-launcher/update-history.json，只追加）与最后更新信息；
//      被覆盖的文件在 .coa-launcher/pre-update\ 留一份【单一】快照（每次更新前清空，不按日期堆）。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const mpq = require('./mpq-inject.cjs');
const { serverLayout } = require('./layout.cjs');

const exec = promisify(execFile);
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const API = 'https://api.github.com/repos/leewheel/azerothcore-wotlk-coa/releases';
const HISTORY = '.coa-launcher/update-history.json';
const LAST = '.coa-launcher/last-update.json';
const SNAPSHOT = '.coa-launcher/pre-update';
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;

// ---------------------------------------------------------------- 版本号
function parseVersion(text) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text || ''));
  if (!match) return null;
  return [1, 2, 3, 4].map(i => Number(match[i] || 0));
}
function compareVersions(a, b) {
  const left = parseVersion(a) || [0, 0, 0, 0];
  const right = parseVersion(b) || [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

//By leewheel 2026年11月5日 老大问：“我的版本比 GitHub 高，为什么还提示更新？”
// 根因：本地版本来自 RELEASE.json 的 releaseId（coa-publish-20261103），GitHub 上是
// COA-Update-20261105——两套命名不能直接按数字比大小（20261103 < 20261105 只是日期，不代表内容旧）。
// 这里改成：① 都是 x.y.z 就按语义版本比；② 否则各取一个 20YYMMDD 日期比；
// ③ 只有一方能取到日期时才退回数字比较。本地日期 ≥ 远端日期 = 不提示更新。
//By leewheel 2026年11月8日 日期提取挪到 release-baseline.cjs（单一实现），
// 那边同时负责“整合包基线”的读写；这里只引用，避免同一套正则存在两份、改一处漏一处。
const { dateOf } = require('./release-baseline.cjs');
function isSemver(text) { return /^\s*v?\d+\.\d+(\.\d+)?([-.+].*)?$/.test(String(text || '')); }
function releaseIsNewer(latest, current) {
  if (!latest) return false;
  if (!current) return true;                         // 本地完全没记录：给玩家看一眼更新包是合理的
  if (String(latest) === String(current)) return false;
  if (isSemver(latest) && isSemver(current)) return compareVersions(latest, current) > 0;
  const left = dateOf(latest);
  const right = dateOf(current);
  if (left && right) return left > right;
  if (left && !right) return true;
  if (!left && right) return compareVersions(latest, current) > 0;
  return compareVersions(latest, current) > 0;
}
const versionOf = release => String(release?.tag_name || release?.name || '').replace(/^v/i, '').trim();

// ---------------------------------------------------------------- GitHub
async function fetchJson(url, { fetchImpl, token = '', timeout = 20000 } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'CoA-Launcher' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}${response.status === 403 ? '（可能是访问频率限制，请稍后再试）' : ''}`);
  return response.json();
}

// 最近若干个正式版本（不含草稿/预发布）
//By leewheel 2026年11月4日 api.github.com 在国内常被墙：允许 launcher.config.json 用 githubApi 指定一个可用地址
// （自建反代/镜像 API），没配置就走官方。下载镜像解决不了“查不到版本”这一步。
async function listReleases({ fetchImpl, token = '', perPage = 10, api = '' } = {}) {
  const base = String(api || API).replace(/\/+$/, '');
  const list = await fetchJson(`${base}?per_page=${Math.min(30, perPage)}`, { fetchImpl, token });
  return (Array.isArray(list) ? list : [])
    .filter(item => !item.draft && !item.prerelease)
    .map(item => ({
      version: versionOf(item),
      tag: String(item.tag_name || ''),
      name: String(item.name || item.tag_name || ''),
      notes: String(item.body || '').slice(0, 60000),
      publishedAt: String(item.published_at || ''),
      url: String(item.html_url || ''),
      assets: (item.assets || []).map(asset => ({
        name: String(asset.name || ''),
        size: Number(asset.size) || 0,
        url: String(asset.browser_download_url || ''),
      })),
    }));
}

// 选更新包：优先 CoA-Update-*.zip，其次任意 .zip
function pickAsset(release) {
  const assets = release?.assets || [];
  const preferred = assets.find(asset => /^coa-?update.*\.zip$/i.test(asset.name));
  if (preferred) return preferred;
  return assets.find(asset => /\.zip$/i.test(asset.name)) || null;
}

//By leewheel 2026-11-05 GitHub 补丁必须按发布顺序【依次】安装，不能只装最新一个
// GitHub API 返回的顺序是"最新在前"；这里翻成【旧 → 新】的安装顺序，并用更新历史跳过已装过的。
// 第一次运行（history 为空）→ 返回全部补丁；装过 7 个还缺 3 个 → 按旧到新只返回那 3 个。
// 没有 zip 更新包的 release 直接跳过（无从安装），同刻发布的按 API 顺序反转（API 里越靠后越旧）。
//By leewheel 2026年11月8日 判定依据换成“记录”，见 release-baseline.cjs 里的说明。
// 老实现拿 Server\worldserver.exe 的修改时间猜“内容已在包里”，会把纯 SQL 补丁误杀、
// 也会在链条中断后重试时吃掉后面的补丁 —— 老大判断得对：跳着装，最后必定跑不起来。
// 现在三条：① history 里记过的不装；② 没有 zip 的跳过；
//  ③ 补丁日期 **严格早于** 整合包基线日期才跳过（同日不跳，宁可多装一个也不漏装）。
// 基线（baseline）由调用方从 release-baseline.cjs 读出来传进来；取不到就传空 = 一个都不跳过。
function pendingReleases({ releases = [], history = [], current = '', baseline = '', limit = 30 } = {}) {
  const done = new Set((Array.isArray(history) ? history : []).map(item => String(item?.version || '')).filter(Boolean));
  const baseDate = dateOf(baseline);
  return releases
    .map((release, index) => ({ ...release, index }))
    .filter(release => {
      const version = String(release?.version || '');
      if (!version || done.has(version) || !pickAsset(release)) return false;
      // 日期优先取发布时间（一定有），取不到再退版本号里的 20YYMMDD
      const patchDate = dateOf(release.publishedAt) || dateOf(version);
      if (baseDate && patchDate && patchDate < baseDate) return false;
      //By leewheel 2026年11月8日 完全没有基线可比时（RELEASE.json 被删、也没跑过一次更新），
      // 才退回和“已安装版本/整合包版本”比。同样只在**严格更旧**时跳过：
      // 同一天发布的一律照装——多装一个是幂等的，漏装一个就是半残，方向不能搞反。
      if (!baseDate && current) {
        const currentDate = dateOf(current);
        if (currentDate && patchDate) { if (patchDate < currentDate) return false; }
        else if (!releaseIsNewer(version, current)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const left = Date.parse(a.publishedAt || '') || 0;
      const right = Date.parse(b.publishedAt || '') || 0;
      return left !== right ? left - right : b.index - a.index;
    })
    .slice(0, Math.max(1, limit))
    .map(({ index, ...release }) => ({
      version: String(release.version || ''), tag: String(release.tag || ''), name: String(release.name || ''),
      notes: String(release.notes || ''), publishedAt: String(release.publishedAt || ''), url: String(release.url || ''),
      asset: pickAsset(release),
    }));
}
//By leewheel 2026年11月8日 被基线覆盖、但 history 里还没记的补丁：一次性补记成 origin=baseline。
// 为什么要记：基线的来源（RELEASE.json）会随下一个整合包变，历史记录才是稳定档；
// 记过之后 done 命中，永远不用再算，界面的“更新记录”也能看见“这一版整合包已自带”。
function baselineCovered({ releases = [], history = [], baseline = '' } = {}) {
  const done = new Set((Array.isArray(history) ? history : []).map(item => String(item?.version || '')).filter(Boolean));
  const baseDate = dateOf(baseline);
  if (!baseDate) return [];
  return releases
    .filter(release => {
      const version = String(release?.version || '');
      if (!version || done.has(version) || !pickAsset(release)) return false;
      const patchDate = dateOf(release.publishedAt) || dateOf(version);
      return Boolean(patchDate && patchDate < baseDate);
    })
    .map(release => ({ version: String(release.version || ''), asset: pickAsset(release) }));
}
//End By leewheel

//By leewheel 2026年11月8日 「强制更新：装到某一版为止」的队列计算（抽出来是为了能单测）。
// 语义（“强制”不能被跳过机制破坏）：
//   ① 目标那一版**一定重装**，哪怕历史里记着装过 —— 强制更新就是用来修坏文件的；
//   ② 目标之前的补丁只补没装过的；
//   ③ 比目标新的不动。
// 返回的 queue 顺序始终是【旧 → 新】，绝不出现“只装中间某一个”的情况。
// targetVersion 为空 = 取最新一版。
function queueUpTo({ releases = [], history = [], targetVersion = '', limit = 30 } = {}) {
  const done = new Set((Array.isArray(history) ? history : []).map(item => String(item?.version || '')).filter(Boolean));
  const all = pendingReleases({ releases, history: [], current: '', baseline: '', limit })
    .map(item => ({ ...item, date: dateOf(item.publishedAt) || dateOf(item.version) }));
  if (!all.length) return { queue: [], target: null, isFull: false, reason: '没有带 zip 更新包的版本' };
  const target = targetVersion ? all.find(item => item.version === targetVersion) : all[all.length - 1];
  if (!target) return { queue: [], target: null, isFull: false, reason: `找不到版本 ${targetVersion}，或者它没有 zip 更新包` };
  const isFull = /(^|[-_.])full([-_.]|$)/i.test(String(target.asset?.name || ''));
  const queue = all.filter(item => {
    if (target.date && item.date && item.date > target.date) return false;
    if (item.version === target.version) return true;
    return !done.has(item.version);
  });
  return { queue, target, isFull, reason: '' };
}
//End By leewheel
// 已安装版本：读历史记录里最后一条「真正装过的」（基线补记的条目不算）
//By leewheel 2026年11月8日 基线补记（origin=baseline）只是“这一版整合包已自带”的存档，
// 不代表玩家装过；拿它当“已安装版本”会让主页版本号跳回旧值。
async function installedVersion(root) {
  try {
    const history = JSON.parse(await fsp.readFile(path.join(root, HISTORY), 'utf8'));
    const list = (Array.isArray(history) ? history : []).filter(item => item && item.origin !== 'baseline');
    return list.length ? String(list[list.length - 1].version || '') : '';
  } catch { return ''; }
}
async function readHistory(root) {
  try {
    const history = JSON.parse(await fsp.readFile(path.join(root, HISTORY), 'utf8'));
    return Array.isArray(history) ? history : [];
  } catch { return []; }
}
async function recordVersion(root, entry) {
  const history = await readHistory(root);
  history.push({ ...entry, at: new Date().toISOString() });
  const file = path.join(root, HISTORY);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(history.slice(-200), null, 2));
  await fsp.writeFile(path.join(root, LAST), JSON.stringify(entry, null, 2));
  return history;
}
//By leewheel 2026年11月8日 基线补记：只往 history 追加，不动 last-update.json（那才是“装了哪一版”）。
// 目的：整合包自带的老补丁记成“已有”，之后不再反复算；RELEASE.json 哪天被改写也不会把补丁全捞回来重装。
async function recordBaselineVersions(root, items = []) {
  if (!items.length) return;
  const history = await readHistory(root);
  const done = new Set(history.map(item => String(item?.version || '')));
  for (const item of items) {
    const version = String(item?.version || '');
    if (!version || done.has(version)) continue;
    history.push({
      version, tag: String(item.tag || version),
      asset: String(item.asset || '(整合包已自带)'),
      origin: 'baseline', at: new Date().toISOString(),
    });
    done.add(version);
  }
  const file = path.join(root, HISTORY);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(history.slice(-200), null, 2));
}

// ---------------------------------------------------------------- 下载 / 解压
//By leewheel 2026年11月4日 老大要求：下载优先走国内镜像，GitHub 原地址排最后。
// 镜像只要在 GitHub 资源地址前拼一个前缀即可（ghproxy 系都是这个规则）；列表可以在 launcher.config.json
// 的 downloadMirrors 里改，留空 "" 表示直连（最后兜底用）。
const DEFAULT_MIRRORS = [
  //By leewheel 2026年11月6日 实测过能用的前缀代理（2026-11-06 用真实资产测速：gh-proxy 101KB/s、ghfast 39KB/s、geekertao 36KB/s）：
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghfile.geekertao.top/',
  // 其余前缀代理保留做兜底（有时超时，网络好时会恢复）
  'https://ghproxy.net/',
  'https://github.moeyy.xyz/',
  'https://hub.gitmirror.com/',
  'https://ghproxy.cc/',
  'https://gh.llkk.cc/',
  //By leewheel 2026年11月6日 清华 / 阿里只能镜像**白名单仓库**（我们的仓库不在名单里，实测固定 404），
  // 放最后：万一哪天进白名单就能用；测速里会把它们的 404 标成“该镜像不收录本仓库”，不误导玩家。
  'https://mirrors.tuna.tsinghua.edu.cn/github-release/{owner}/{repo}/{tag}/{asset}',
  'https://mirrors.aliyun.com/github-release/{owner}/{repo}/{tag}/{asset}',
];
// 这些整站镜像只收白名单仓库，404 属于“不支持”，不是“坏了”
const CURATED_MIRRORS = ['mirrors.tuna.tsinghua.edu.cn', 'mirrors.aliyun.com'];

//By leewheel 2026年11月6日 把探测失败原因翻成玩家能懂的话（界面直接用）
function describeProbeFailure(url, error) {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const text = String(error || '');
  if (CURATED_MIRRORS.some(item => host.includes(item)) && /404/.test(text)) return '该镜像只收录指定仓库（不含本仓库）';
  if (/404/.test(text)) return '文件不存在（版本可能还没上传）';
  if (/aborted|timeout/i.test(text)) return '超时';
  if (/ENOTFOUND|ERR_NAME|fetch failed/i.test(text)) return '域名解析失败 / 连不上';
  if (/不是 zip/.test(text)) return '返回的不是文件（镜像错误页）';
  return text.slice(0, 60) || '不可用';
}

//By leewheel 2026年11月6日 解析 GitHub release 资产地址，供整站镜像套模板用
function parseReleaseUrl(url) {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/i.exec(String(url || ''));
  if (!match) return null;
  return { owner: match[1], repo: match[2], tag: match[3], asset: match[4] };
}

// 生成尝试顺序：镜像（去重、去掉空值）→ GitHub 原地址。已经是 GitHub 直连地址才放最后。
function mirrorCandidates(url, mirrors = DEFAULT_MIRRORS) {
  const list = [];
  const release = parseReleaseUrl(url);
  const usable = (Array.isArray(mirrors) ? mirrors : DEFAULT_MIRRORS).map(item => String(item || '').trim());
  for (const entry of usable) {
    if (!entry) continue;
    let candidate;
    if (entry.includes('{owner}')) {
      // 整站镜像：没有 tag/asset 信息（比如镜像地址不是 release 资产）就跳过
      if (!release) continue;
      candidate = entry
        .replace('{owner}', release.owner)
        .replace('{repo}', release.repo)
        .replace('{tag}', release.tag)
        .replace('{asset}', release.asset);
    } else {
      candidate = `${entry}${url}`;
    }
    if (!list.includes(candidate)) list.push(candidate);
  }
  if (!list.includes(url)) list.push(url);
  return list;
}

async function downloadOnce(url, target, { fetchImpl, onProgress, signal, timeout = 30000 }) {
  // 单次尝试的超时只用来“拿到响应”；已经开始的下载由外层 signal 控制，避免镜像慢一点就被误判
  const response = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'CoA-Launcher' }, signal: signal || AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const file = fs.createWriteStream(target);
  let done = 0;
  //By leewheel 2026年11月8日 进度回调节流到 100ms：每个 chunk 都往界面推一次会让渲染进程
  // 每秒重建几十次进度条（老大反馈“下载过程中 UI 一直在闪烁”）。最后一块照常报，保证 100% 到位。
  let lastReport = 0;
  const report = (now, totalBytes) => {
    const stamp = Date.now();
    if (stamp - lastReport >= 100 || (totalBytes && now === totalBytes)) { lastReport = stamp; onProgress(now, totalBytes); }
  };
  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        done += value.length;
        file.write(Buffer.from(value));
        report(done, total);
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      done = buffer.length;
      file.write(buffer);
      onProgress(done, total || done);
    }
  } finally {
    await new Promise(resolve => file.end(resolve));
  }
  if (total && done !== total) throw new Error(`下载不完整：${done}/${total} 字节`);
  return { file: target, size: done, url };
}

//By leewheel 2026年11月4日 按“镜像优先、GitHub 最后”的顺序逐个试；某个源超时/404/断流就换下一个。
// 全部失败才报错，并把每个源的原因写进错误里，方便判断是镜像挂了还是网络不通。
//By leewheel 2026年11月6日 镜像测速：对每个候选源发一个 256KB 的 Range 请求，量“首字节时间 + 吞吐”。
// 结果按吞吐从高到低排序（吞吐相同看延迟），失败的源排到最后但仍然保留——下载时还会再试一次。
async function probeMirror(url, { fetchImpl = fetch, bytes = 262144, timeout = 8000 } = {}) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'CoA-Launcher', Range: `bytes=0-${bytes - 1}` },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    const firstByte = Date.now() - started;
    let received = 0;
    let head = Buffer.alloc(0);
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value || []);
        if (head.length < 4) head = Buffer.concat([head, chunk.subarray(0, 4 - head.length)]);
        received += chunk.length;
        if (received >= bytes) break;
      }
      await reader.cancel().catch(() => {});
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      received = buffer.length;
      head = buffer.subarray(0, 4);
    }
    //By leewheel 2026年11月6日 只有“真的是 zip”才算这个源可用：镜像挂了常返回 200 + HTML 错误页，
    // 光看状态码会把错误页当成下载成功（实弹：资产还不存在时 ghfast 也回 200）。
    const looksZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4B;
    if (!looksZip && /\.zip($|\?)/i.test(url)) throw new Error('返回的不是 zip（多半是镜像错误页）');
    const spent = Math.max(1, Date.now() - started);
    return { url, ok: true, ms: spent, firstByteMs: firstByte, bytes: received, kbps: Math.round((received / 1024) * 1000 / spent) };
  } catch (error) {
    return { url, ok: false, ms: Date.now() - started, firstByteMs: 0, bytes: 0, kbps: 0, error: String(error?.message || error).split(/\r?\n/)[0] };
  }
}

/** 给一个 release 资产地址测所有候选源（并行，谁先回谁先记），按速度排序返回（失败的排最后） */
async function rankMirrors(url, { fetchImpl = fetch, mirrors = DEFAULT_MIRRORS, onLine = () => {} } = {}) {
  const candidates = mirrorCandidates(url, mirrors);
  const hostOf = candidate => { try { return new URL(candidate).host; } catch { return candidate; } };
  const probes = candidates.map(candidate => probeMirror(candidate, { fetchImpl }).then(result => {
    onLine(result.ok ? `测速：${hostOf(candidate)} ${result.kbps} KB/s（首字节 ${result.firstByteMs}ms）` : `测速：${hostOf(candidate)} 不可用（${result.error}）`);
    return result;
  }));
  const results = await Promise.all(probes);
  results.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || b.kbps - a.kbps || a.firstByteMs - b.firstByteMs);
  return results;
}

/** 下载失败重试顺序：用测速结果里 ok 的源（保持速度排序），最后补 GitHub 直连 */
function mirrorsFromRanking(ranking, fallback = DEFAULT_MIRRORS) {
  const good = (ranking || []).filter(item => item.ok && item.url);
  if (!good.length) return fallback;
  // 排行里存的是“完整镜像地址”，这里还原成镜像前缀/模板，交给 mirrorCandidates 重新拼
  return good.map(item => {
    if (item.url.includes('mirrors.tuna.tsinghua.edu.cn')) return 'https://mirrors.tuna.tsinghua.edu.cn/github-release/{owner}/{repo}/{tag}/{asset}';
    if (item.url.includes('mirrors.aliyun.com')) return 'https://mirrors.aliyun.com/github-release/{owner}/{repo}/{tag}/{asset}';
    const match = /^(https?:\/\/[^/]+\/)/.exec(item.url);
    return match ? match[1] : '';
  }).filter(Boolean);
}

async function download(url, target, { fetchImpl, onProgress = () => {}, signal, mirrors = DEFAULT_MIRRORS } = {}) {  await fsp.mkdir(path.dirname(target), { recursive: true });
  const candidates = mirrorCandidates(url, mirrors);
  const failures = [];
  for (const candidate of candidates) {
    try {
      const result = await downloadOnce(candidate, target, { fetchImpl, onProgress, signal });
      result.mirror = candidate === url ? '' : candidate.slice(0, candidate.length - url.length);
      return result;
    } catch (error) {
      failures.push(`${new URL(candidate).host}：${String(error.message || error).split(/\r?\n/)[0]}`);
      await fsp.rm(target, { force: true }).catch(() => {});
      if (signal?.aborted) break;
    }
  }
  throw new Error(`下载失败，所有源都不可用（${failures.join('；')}）`);
}

async function extractZip(zip, destination, onLine) {
  await fsp.mkdir(destination, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(TAR, ['-xf', zip, '-C', destination], { windowsHide: true });
    let tail = '';
    const read = chunk => { tail = String(chunk).trim().split(/\r?\n/).pop() || tail; onLine?.(String(chunk).trim()); };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`解压失败（tar exit ${code}）：${tail}`))));
  });
}

// 更新包顶层若只有一层目录（如 CoA-Update-1.2.0/），把它剥掉
async function contentRoot(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter(entry => entry.isDirectory());
  const files = entries.filter(entry => entry.isFile());
  if (dirs.length === 1 && !files.length) return path.join(folder, dirs[0].name);
  return folder;
}

// ---------------------------------------------------------------- 目录/文件小工具
//By leewheel 2026年11月4日 更新包里的目录名大小写不固定（Server/server、SQL/sql、Configs/configs），按名字不区分大小写找。
async function findDir(parent, names) {
  const entries = await fsp.readdir(parent, { withFileTypes: true }).catch(() => []);
  const wanted = names.map(name => name.toLowerCase());
  const hit = entries.find(entry => entry.isDirectory() && wanted.includes(entry.name.toLowerCase()));
  return hit ? path.join(parent, hit.name) : '';
}

//By leewheel 2026年11月4日 递归列出文件：{ file: 绝对路径, rel: 相对路径 }
async function walkFiles(dir, base = dir, out = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walkFiles(full, base, out); continue; }
    out.push({ file: full, rel: path.relative(base, full) });
  }
  return out;
}

// ---------------------------------------------------------------- 分发
async function copyTree(from, to, { onFile = () => {}, beforeOverwrite = null, skip = null } = {}) {
  let count = 0;
  async function walk(source, target) {
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(source, entry.name);
      const dst = path.join(target, entry.name);
      //By leewheel 2026年11月4日 有些子树不归位（server\SQL 是要导入数据库的，不能原样拷进 Server\）
      if (skip && skip(path.relative(from, src).split(path.sep).join('/'))) continue;
      if (entry.isDirectory()) { await walk(src, dst); continue; }
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      //By leewheel 2026年11月4日 覆盖前留一份（单一目录，见 snapshotWriter）
      if (beforeOverwrite) await beforeOverwrite(dst);
      await fsp.copyFile(src, dst);
      count++;
      onFile(dst, src);
    }
  }
  await fsp.mkdir(to, { recursive: true });
  await walk(from, to);
  return count;
}

// 客户端 Data 下所有 mpq（用于给 dbc 找归属）
async function clientMpqs(clientRoot) {
  const data = path.join(clientRoot, 'Data');
  const names = await fsp.readdir(data).catch(() => []);
  return names.filter(name => /\.mpq$/i.test(name)).map(name => path.join(data, name));
}

//By leewheel 2026年11月7日 收集 client\data\mpq\ 下的条目补丁，按“目标档”分组。
// 支持多级档路径：data\mpq\patch-ZZN.mpq\X.dbc 与 data\mpq\enUS\locale-enUS.MPQ\Interface\X.lua 都认。
// 旧实现只认一级目录，enUS 这种两级路径会把目录当成档名，注入必然失败后被静默跳过（文件就丢了）。
async function collectMpqPatchGroups(root) {
  const groups = new Map();
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (/\.mpq$/i.test(entry.name)) {
        const archiveRel = path.relative(root, full).split(path.sep).join('/');
        if (!groups.has(archiveRel)) groups.set(archiveRel, { archiveRel, files: [] });
        for (const item of await walkFiles(full)) {
          groups.get(archiveRel).files.push({ file: item.file, arcName: item.rel.split(path.sep).join('\\') });
        }
      } else {
        await walk(full);
      }
    }
  }
  await walk(root);
  return [...groups.values()];
}

// dbc → mpq 映射：更新包里的 dbc-map.json，形如 { "Spell.dbc": "patch-ZZN.mpq", "*.dbc": "patch-M.MPQ" }
async function readDbcMap(world) {
  for (const relative of ['dbc-map.json', 'dbc/dbc-map.json', 'update.json']) {
    try {
      const data = JSON.parse(await fsp.readFile(path.join(world, relative), 'utf8'));
      const map = data.dbcMap || data.dbc || data.map;
      if (map && typeof map === 'object') return map;
    } catch {}
  }
  return null;
}

// 把 dbc 注入客户端补丁档：先按映射，找不到就扫描所有档里含该表的那个
async function injectDbc(clientRoot, dbcFile, { map = null, onLine = () => {} } = {}) {
  const table = path.basename(dbcFile);
  const arcName = `DBFilesClient\\${table}`;
  const wantArchive = map && (map[table] || map['*'] || map[table.toLowerCase()]);
  const archives = await clientMpqs(clientRoot);
  const ordered = wantArchive
    ? archives.filter(file => path.basename(file).toLowerCase() === String(wantArchive).toLowerCase()).concat(archives.filter(file => path.basename(file).toLowerCase() !== String(wantArchive).toLowerCase()))
    : archives;
  const payload = await fsp.readFile(dbcFile);
  for (const archive of ordered) {
    let check;
    try {
      check = mpq.injectFile(archive, arcName, payload, { dryRun: true });
    } catch { continue; }
    if (!check.ok) continue;
    const result = mpq.injectFile(archive, arcName, payload);
    onLine(`已注入 ${table} → ${path.basename(archive)}（${(payload.length / 1024).toFixed(0)} KB）`);
    return { table, archive: path.basename(archive), size: payload.length, ok: result.ok };
  }
  return { table, archive: '', size: payload.length, ok: false, reason: '归档里没有这张表' };
}

//By leewheel 2026年11月4日 按【更新包给的档】注入：client\data\dbc\patch-ZZN.mpq\X.dbc → Client\Data\patch-ZZN.mpq
// 档里没有这张表时记警告，再退回“全档扫描”的老办法，保证更新不会因为一张表停住。
async function injectIntoArchive(clientRoot, archive, dbcFile, { map = null, onLine = () => {}, warnings = [] } = {}) {
  const table = path.basename(dbcFile);
  const arcName = `DBFilesClient\\${table}`;
  const payload = await fsp.readFile(dbcFile);
  if (archive && fs.existsSync(archive)) {
    let check = null;
    try { check = mpq.injectFile(archive, arcName, payload, { dryRun: true }); } catch (error) { warnings.push(`${path.basename(archive)} 读取失败：${error.message}`); }
    if (check?.ok) {
      const result = mpq.injectFile(archive, arcName, payload);
      onLine(`已注入 ${table} → ${path.basename(archive)}（按更新包指定）`);
      return { table, archive: path.basename(archive), size: payload.length, ok: result.ok };
    }
    warnings.push(`${path.basename(archive)} 里没有 ${table}，改按“含该表的档”注入`);
  } else if (archive) {
    warnings.push(`更新包指定的补丁档不存在：${path.relative(clientRoot, archive)}`);
  }
  return injectDbc(clientRoot, dbcFile, { map, onLine });
}

//By leewheel 2026年11月4日 DBC 目录归位：
//   client\data\dbc\patch-ZZN.mpq\*.dbc        → 注入 Client\Data\patch-ZZN.mpq
//   client\data\dbc\enUS\speech-enUS.MPQ\*.dbc → 注入 Client\Data\enUS\speech-enUS.MPQ
//   client\data\dbc\*.dbc（平铺）              → 老格式，按映射/自动找档
// 同时在 Server 的 ClientData\dbc（含子目录）留一份，保证服务端与客户端一致。
async function applyDbcTree({ clientRoot, serverRoot, dbcRoot, map = null, onLine = () => {}, warnings = [] } = {}) {
  const layout = serverLayout(serverRoot);
  const serverDbcDir = path.join(serverRoot, ...String(layout.data || 'ClientData').split('/'));
  const dbcDir = path.join(serverDbcDir, 'dbc');
  const files = (await walkFiles(dbcRoot)).filter(item => /\.dbc$/i.test(item.rel));
  const injected = [];
  for (const item of files) {
    const parts = item.rel.split(path.sep);
    const table = parts[parts.length - 1];
    const mpqAt = parts.findIndex(part => /\.mpq$/i.test(part));
    const sub = mpqAt >= 0 ? parts.slice(0, mpqAt) : [];
    const archiveName = mpqAt >= 0 ? parts[mpqAt] : '';
    const archive = archiveName ? path.join(clientRoot, 'Data', ...sub, archiveName) : '';
    // 服务端留一份：按客户端的子目录镜像（enUS\X.dbc → ClientData\dbc\enUS\X.dbc），不冲掉基础表
    try {
      const target = path.join(dbcDir, ...sub, table);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(item.file, target);
    } catch (error) {
      warnings.push(`服务端 ClientData 拷贝失败：${table}（${error.message}）`);
    }
    const result = await injectIntoArchive(clientRoot, archive, item.file, { map, onLine, warnings });
    injected.push({ ...result, file: item.rel });
    //By leewheel 2026年11月7日 注入失败就是文件没到位，必须中止更新，不能只记警告放过。
    if (!result.ok) throw new Error(`DBC ${table} 没能注入任何补丁档（${result.reason || '归档里没有这张表'}）。更新中止`);
  }
  return injected;
}

// ---------------------------------------------------------------- SQL
function mysqlPaths(serverRoot) {
  const exe = path.join(serverRoot, 'mysql', 'bin', 'mysql.exe');
  const ini = path.join(serverRoot, 'mysql', 'admin-client.ini');
  if (!fs.existsSync(exe)) throw new Error('服务器目录里没有 mysql.exe');
  if (!fs.existsSync(ini)) throw new Error('缺少 mysql/admin-client.ini');
  return { exe, ini };
}

//By leewheel 2026年11月9日 有连接串就不需要 admin-client.ini。
// 原来 mysqlQuery/importSqlFile 无条件调 mysqlPaths，只要整合包里没有 ini 就直接抛
// 「读不到表结构：缺少 mysql/admin-client.ini」——开发机正是这种情况，worldserver.conf 里
// 那三条连接串本来就够用。现在按“有 conn 走 -h/-P/-u/-p，没 conn 才回落到 ini”。
function mysqlClient(serverRoot, conn = null) {
  const exe = path.join(serverRoot, 'mysql', 'bin', 'mysql.exe');
  if (!fs.existsSync(exe)) throw new Error('服务器目录里没有 mysql.exe');
  if (conn) return { exe, args: mysqlArgsFor(conn) };
  const ini = path.join(serverRoot, 'mysql', 'admin-client.ini');
  if (!fs.existsSync(ini)) throw new Error('缺少 mysql/admin-client.ini，且 worldserver.conf 里没有可用的数据库连接串');
  return { exe, args: [`--defaults-file=${ini}`, '--default-character-set=utf8mb4'] };
}
//End By leewheel

//By leewheel 2026年11月5日 连库不猜端口：直接读 worldserver.conf 里那三条连接串
// （LoginDatabaseInfo / WorldDatabaseInfo / CharacterDatabaseInfo）。
// 之前用 mysql/admin-client.ini（3396），但世界服实际连的是 3395——启动器自己拉起的 3396 实例起不来时，
// 更新会卡在“等数据库就绪”要玩家手动开库，这是错的。
function readDbConfig(serverRoot) {
  const conf = path.join(serverRoot, 'configs', 'worldserver.conf');
  let text = '';
  try { text = fs.readFileSync(conf, 'utf8'); } catch { return {}; }
  const parse = (key, fallback) => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
    if (!match) return null;
    const [host, port, user, pass, db] = match[1].split(';');
    return { host: host || '127.0.0.1', port: Number(port) || 3306, user: user || '', pass: pass || '', db: db || fallback };
  };
  const out = {
    auth: parse('LoginDatabaseInfo', 'acore_auth'),
    world: parse('WorldDatabaseInfo', 'acore_world'),
    characters: parse('CharacterDatabaseInfo', 'acore_characters'),
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value));
}

// 按连接串拼 mysql.exe 参数（用 -h/-P/-u/-p 直连，不依赖 admin-client.ini）
function mysqlArgsFor(conn) {
  return ['-h', conn.host, '-P', String(conn.port), '-u', conn.user, `-p${conn.pass}`, '--connect-timeout=5', '--default-character-set=utf8mb4'];
}

//By leewheel 2026年11月9日 把 execFile 的「Command failed: <整条命令行>\n<stderr>」收成一行 MySQL 原文。
// 两个作用：① 界面不再刷一整行 mysql.exe 参数；② 错误分类不会再把命令行里出现的表名当成“表不存在”。
function mysqlFailLine(error) {
  const text = String(error?.message || error || '');
  const line = text.split(/\r?\n/).map(part => part.trim())
    .filter(part => part && !/^Command failed:/i.test(part) && !/Using a password on the command line/i.test(part))
    .pop();
  return line || '连接数据库失败（没有任何输出）';
}

async function mysqlQuery(serverRoot, sql, conn = null) {
  const { exe, args } = mysqlClient(serverRoot, conn);
  try {
    const { stdout } = await exec(exe, [...args, '--batch', '--skip-column-names', '-e', sql], { windowsHide: true, timeout: 30000 });
    return String(stdout).trim();
  } catch (error) {
    //By leewheel 2026年11月9日 只抛 MySQL 的原文，别把整条命令行甩给界面
    throw new Error(mysqlFailLine(error));
  }
}

//By leewheel 2026年11月5日 等 MySQL 真正能连：轮询 SELECT 1，默认最多等 120 秒。
// 传 conn 就按世界服实际的连接串探测；没传就退回 admin-client.ini。
async function waitForMysql(serverRoot, { timeoutMs = 120000, onLine = () => {}, conn = null } = {}) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try { await mysqlQuery(serverRoot, 'SELECT 1', conn); return true; }
    catch (error) { last = String(error.message).split(/\r?\n/).filter(Boolean).pop() || String(error.message); }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  onLine(`等待数据库超时（${Math.round(timeoutMs / 1000)} 秒）：${last}`);
  return false;
}

// 单个 SQL 文件（可指定数据库；conn 为 worldserver.conf 里的连接串）
async function importSqlFile(serverRoot, file, database = '', conn = null) {
  //By leewheel 2026年11月9日 走 mysqlClient：有连接串就不依赖 admin-client.ini（同 mysqlQuery）
  const { exe, args: base } = mysqlClient(serverRoot, conn);
  const args = [...base, '--batch'];
  if (database) args.push(`--database=${database}`);
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(file)} 导入失败：${String(error).trim().split(/\r?\n/).filter(line => !/Using a password/i.test(line)).pop() || `mysql exit ${code}`}`));
    });
    fs.createReadStream(file).pipe(child.stdin);
  });
}

// 库名 → 用哪条连接串（acore_auth / acore_world / acore_characters，以及它们的 *_reborn 变体）
function connForDatabase(conns, database) {
  if (!conns) return null;
  if (/auth/i.test(database)) return conns.auth || conns.world || null;
  if (/characters/i.test(database)) return conns.characters || conns.world || null;
  return conns.world || conns.auth || conns.characters || null;
}

//By leewheel 2026年11月7日 数据库脚本导入的硬规则（老大 2026-11-07 明确要求）：
//  ① 补丁包 server\SQL\<库名>\ 下所有 .sql 必须全部导入，一个都不许漏；
//  ② 任何一份失败、库不存在、目录名非法，立即抛错中止更新，绝不“记警告继续”；
//  ③ 连不上数据库也中止 —— 文件已换完、库没导，等于把服务端弄坏（上一个包就是这么起不来的）。
async function importSqlTree(serverRoot, sqlRoot, { onLine = () => {}, warnings = [], conns = null, waitMs = 120000, onPlan = () => {}, onFileStart = () => {}, onFileDone = () => {} } = {}) {
  const done = [];
  const failures = [];
  const probeConn = conns ? (conns.world || conns.auth || conns.characters) : null;
  const ready = await waitForMysql(serverRoot, { onLine, conn: probeConn, timeoutMs: waitMs });
  if (!ready) {
    let last = '';
    try { await mysqlQuery(serverRoot, 'SELECT 1', probeConn); } catch (error) { last = String(error.message).split(/\r?\n/).filter(Boolean).pop(); }
    const where = probeConn ? `${probeConn.host}:${probeConn.port}（用户 ${probeConn.user}）` : 'admin-client.ini 里的地址';
    throw new Error(`连不上数据库 ${where}：${last}。更新已中止（文件未提交、数据库未改动）`);
  }
  const entries = await fsp.readdir(sqlRoot, { withFileTypes: true }).catch(() => []);
  const databases = entries.filter(entry => entry.isDirectory());
  const loose = entries.filter(entry => entry.isFile() && /\.sql$/i.test(entry.name));

  // 先出清单：这次要导哪些脚本、导进哪个库
  const plan = [];
  //By leewheel 2026年11月7日 如果包里同时给了变体库目录（acore_characters_dawnrise 等），
  // 说明每个库的补丁是分别算出来的，主库目录只导主库，不再自动套到变体库（否则同一份会导两遍）。
  const dbNames = databases.map(entry => entry.name.toLowerCase());
  const hasVariantDir = name => dbNames.some(other => other !== name.toLowerCase() && other.startsWith(name.toLowerCase() + '_'));
  for (const entry of databases) {
    const database = entry.name;
    if (!DATABASE.test(database)) throw new Error(`SQL 目录名不是合法库名：${database}（补丁包结构错误，更新中止）`);
    const conn = connForDatabase(conns, database);
    const targets = [database];
    if (!hasVariantDir(database)) {
      const family = database.replace(/_(auth|characters|world)$/i, '');
      const siblings = await mysqlQuery(serverRoot, `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE '${family}\\_%'`, conn).catch(() => '');
      for (const name of String(siblings).split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
        if (!name.toLowerCase().startsWith(database.toLowerCase())) continue;
        if (name !== database) targets.push(name);
      }
    }
    for (const target of targets) {
      const exists = await mysqlQuery(serverRoot, `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${target}'`, conn).catch(() => '');
      if (!exists) throw new Error(`数据库 ${target} 不存在：${database} 目录下的脚本无处可导（不自动建库，避免导错地方）。更新中止`);
      const files = (await walkFiles(path.join(sqlRoot, database))).filter(item => /\.sql$/i.test(item.rel)).sort((a, b) => a.rel.localeCompare(b.rel, 'en'));
      for (const item of files) plan.push({ database: target, file: item.rel, full: item.file, conn });
    }
  }
  for (const entry of loose.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    plan.push({ database: '', file: entry.name, full: path.join(sqlRoot, entry.name), conn: probeConn });
  }
  //By leewheel 2026年11月7日 完整性核对：包里的每个 .sql 都必须出现在导入计划里，否则更新中止。
  // 这一条就是防“包里有脚本、启动器没导”的静默遗漏。
  const planned = new Set(plan.map(item => path.resolve(item.full).toLowerCase()));
  const onDisk = (await walkFiles(sqlRoot)).filter(item => /\.sql$/i.test(item.rel));
  for (const item of onDisk) {
    if (!planned.has(path.resolve(item.file).toLowerCase())) {
      throw new Error(`补丁包里的数据脚本没被排进导入计划：${path.relative(sqlRoot, item.file)}。更新中止`);
    }
  }
  if (!plan.length && onDisk.length) throw new Error(`补丁包里有 ${onDisk.length} 个数据脚本，但一个都没排进导入计划。更新中止`);
  onPlan(plan.map(item => ({ database: item.database, file: item.file })));

  const total = plan.length;
  for (let index = 0; index < total; index++) {
    const item = plan[index];
    const label = `${item.database ? `${item.database}/` : ''}${item.file}`;
    const started = Date.now();
    onFileStart({ ...item, index: index + 1, total, label });
    onLine(`导入 ${label}（${index + 1}/${total}）`);
    try {
      await importSqlFile(serverRoot, item.full, item.database, item.conn);
    } catch (error) {
      const ms = Date.now() - started;
      const reason = String(error?.message || error).split(/\r?\n/)[0];
      failures.push({ database: item.database, file: item.file, error: reason });
      onFileDone({ database: item.database, file: item.file, label, ok: false, ms, error: reason, index: index + 1, total });
      onLine(`✗ ${label}：${reason}`);
      //By leewheel 2026年11月7日 失败必须中断：继续导后面的只会让库停在半更新状态，服务端起不来。
      const failure = new Error(`数据脚本导入失败：${label} —— ${reason}（本次更新已中止，已导入 ${done.length}/${total} 份）`);
      failure.code = 'SQL_FAILED';
      failure.sqlFailures = failures;
      failure.done = done;
      throw failure;
    }
    const ms = Date.now() - started;
    done.push(label);
    onFileDone({ database: item.database, file: item.file, label, ok: true, ms, index: index + 1, total });
    onLine(`✓ ${label}（${index + 1}/${total}）`);
  }
  done.failures = failures;
  done.plan = plan.map(item => ({ database: item.database, file: item.file }));
  return done;
}

// 兼容旧接口：把一个目录里的 *.sql 依次导入
async function importSql(serverRoot, folder, { onLine = () => {} } = {}) {
  const names = (await fsp.readdir(folder)).filter(name => /\.sql$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en'));
  const done = [];
  for (const name of names) {
    onLine(`导入 ${name} …`);
    await importSqlFile(serverRoot, path.join(folder, name));
    done.push(name);
    onLine(`✓ ${name}`);
  }
  return done;
}

//By leewheel 2026年11月4日 被覆盖文件的【单一】快照：.coa-launcher\pre-update\，每次更新前整目录清空，
// 只保留最近一次更新覆盖掉的东西（不按日期堆，符合老大要求）。
async function clearSnapshot(root) {
  const dir = path.join(root, SNAPSHOT);
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return dir;
}
function snapshotWriter(root, dir) {
  let saved = 0;
  return {
    get saved() { return saved; },
    async beforeOverwrite(file) {
      try {
        const rel = path.relative(root, file);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
        const target = path.join(dir, rel);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.copyFile(file, target);
        saved++;
      } catch {}
    },
  };
}

// ---------------------------------------------------------------- 一次更新的编排
// options: { root, world(解压目录), serverRoot, clientRoot, onPhase, onLine, importSqlFiles, conns, waitMs }
// conns：worldserver.conf 里读出来的三条连接串（readDbConfig），决定 SQL 导到哪个库
//By leewheel 2026年11月8日 装完自检：不核对“文件真的换成包里的了”，就敢写“更新成功”——
// 上一个包把服务端弄坏却没人发现，就是缺这一步（老大 2026-11-08 要求）。
// 规则：包里 Server\ / Configs\ / Client\ / Runtime\ / CoA-Bots\ / mpq\ 的每一个文件，
// 落到目标位置后必须存在且**字节数一致**；worldserver.exe / authserver.exe 再加一道 md5 硬核对。
// 跑完返回 { checked, problems, hashes }：problems 非空 = 这次更新不算成功。
async function fileMd5(file) {
  return new Promise((resolve, reject) => {
    const hash = require('node:crypto').createHash('md5');
    require('node:fs').createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function verifyInstalled({ folder, root, serverRoot, clientRoot }) {
  const content = await contentRoot(folder);
  const problems = [];
  let checked = 0;
  const hashes = {};
  // 每个归位目标照着 applyUpdate 的实际规则来写，规则不一致的核对等于没核对
  const areas = [];
  const serverFrom = await findDir(content, ['Server']);
  if (serverFrom) areas.push({ label: 'Server', from: serverFrom, to: serverRoot, skip: rel => /^sql(\/|$)/i.test(rel) });
  const configsFrom = await findDir(content, ['Configs']);
  if (configsFrom) areas.push({ label: 'Configs', from: configsFrom, to: path.join(serverRoot, 'configs') });
  const clientFrom = await findDir(content, ['Client']);
  if (clientFrom) areas.push({
    label: 'Client', from: clientFrom, to: clientRoot,
    // data\mpq 是“注入进补丁档”的条目、data\dbc 是“注入进 MPQ + 拷进服务端 ClientData”，
    // 这两类在客户端目录里本来就不该出现同名文件，不能按普通文件核对
    skip: rel => /^data\/(mpq|dbc)(\/|$)/i.test(rel),
  });
  for (const name of ['Runtime', 'CoA-Bots']) {
    const from = await findDir(content, [name]);
    if (from) areas.push({ label: name, from, to: path.join(root, name), skip: rel => /(^|\/)dashboard\.json$/i.test(rel) });
  }
  const mpqFrom = await findDir(content, ['mpq']);
  if (mpqFrom) areas.push({ label: 'mpq', from: mpqFrom, to: path.join(clientRoot, 'Data'), only: /\.mpq$/i });

  for (const area of areas) {
    for (const item of await walkFiles(area.from)) {
      const rel = item.rel.split(path.sep).join('/');
      if (area.skip && area.skip(rel)) continue;
      if (area.only && !area.only.test(path.basename(item.file))) continue;
      const target = path.join(area.to, item.rel);
      const src = await fsp.stat(item.file).catch(() => null);
      const dst = await fsp.stat(target).catch(() => null);
      checked++;
      if (!src) { problems.push(`${area.label}/${rel}：包里的源文件读不到`); continue; }
      if (!dst) { problems.push(`${area.label}/${rel}：目标位置没有这个文件`); continue; }
      if (src.size !== dst.size) { problems.push(`${area.label}/${rel}：大小不一致（包内 ${src.size} ≠ 目标 ${dst.size}）`); continue; }
      // 两个服务端可执行文件是“能不能起来”的关键，字节数一样也要再核一次内容
      if (area.label === 'Server' && /^(worldserver|authserver)\.exe$/i.test(rel)) {
        try {
          const [a, b] = [await fileMd5(item.file), await fileMd5(target)];
          hashes[rel.toLowerCase()] = b;
          if (a !== b) problems.push(`${area.label}/${rel}：md5 不一致（包内 ${a.slice(0, 12)}… ≠ 目标 ${b.slice(0, 12)}…）`);
        } catch (error) {
          problems.push(`${area.label}/${rel}：md5 计算失败（${error.message}）`);
        }
      }
    }
  }
  return { checked, problems, hashes };
}

async function applyUpdate({ root, world, serverRoot, clientRoot, onPhase = () => {}, onLine = () => {}, onPhaseProgress = () => {}, onSqlPlan = () => {}, onSqlFileStart = () => {}, onSqlFileDone = () => {}, importSqlFiles = true, conns = null, waitMs = 120000 }) {
  const folder = await contentRoot(world);
  const result = { server: 0, client: 0, dbc: [], mpq: 0, mpqEntries: 0, sql: [], warnings: [], backup: '' };

  // 快照：先清空单一目录，再在每次覆盖前写一份
  const snapshotDir = await clearSnapshot(root);
  const snapshot = snapshotWriter(root, snapshotDir);

  // 1) 服务端整棵树（worldserver.exe / *.dll / configs / ClientData 都在这里）
  const serverFrom = await findDir(folder, ['Server']);
  if (serverFrom) {
    onPhase('server');
    //By leewheel 2026年11月4日 server\SQL\ 只用来导库，不能当成普通文件拷进 Server\
    result.server = await copyTree(serverFrom, serverRoot, { beforeOverwrite: snapshot.beforeOverwrite, skip: rel => /^sql(\/|$)/i.test(rel) });
    onLine(`服务端：${result.server} 个文件已放入 Server\\`);
  }

  // 2) 顶层 configs\ → Server\configs\（晚于 server\ 生效，包里的配置优先）
  const configsFrom = await findDir(folder, ['Configs']);
  if (configsFrom) {
    onPhase('configs');
    const count = await copyTree(configsFrom, path.join(serverRoot, 'configs'), { beforeOverwrite: snapshot.beforeOverwrite });
    onLine(`配置：${count} 个文件已覆盖 Server\\configs\\`);
  }

  // 3) 客户端整棵树（Ascension.exe / Extensions.dll / Data\*.mpq / Interface… 都走这里）
  const clientFrom = await findDir(folder, ['Client']);
  if (clientFrom) {
    onPhase('client');
    //By leewheel 2026年11月5日 client\data\mpq\<档名>\<内部路径> 不是普通文件：要注入进 MPQ，不能照抄进 Client\
    result.client = await copyTree(clientFrom, clientRoot, {
      beforeOverwrite: snapshot.beforeOverwrite,
      skip: rel => /^data\/mpq(\/|$)/i.test(rel),
    });
    onLine(`客户端：${result.client} 个文件已放入 Client\\`);
  }

  // 3d) Runtime / CoA-Bots：机器人仪表盘的两块硬前提。
  //By leewheel 2026年11月8日 老大定（2026-11-08）：仪表盘要求 <根>\Runtime\python\python.exe 与
  // <根>\CoA-Bots\Tools\Dashboard\squidbots.py 同时存在，缺一个主页那张卡都不渲染。
  // 以前这两个目录不在更新包里，从零安装的玩家永远看不到面板 —— 现在随包发到整合包根目录。
  for (const name of ['Runtime', 'CoA-Bots']) {
    const from = await findDir(folder, [name]);
    if (!from) continue;
    onPhase('runtime');
    // dashboard.json 是玩家本地设置（端口、页脚）：已经有的绝不覆盖，只在缺失时补一份默认值
    const count = await copyTree(from, path.join(root, name), {
      beforeOverwrite: snapshot.beforeOverwrite,
      skip: rel => /(^|\/)dashboard\.json$/i.test(rel),
    });
    const settings = path.join(root, name, 'Tools', 'Dashboard', 'dashboard.json');
    if (name === 'CoA-Bots' && !fs.existsSync(settings)) {
      const fallback = path.join(from, 'Tools', 'Dashboard', 'dashboard.json');
      if (fs.existsSync(fallback)) {
        await fsp.mkdir(path.dirname(settings), { recursive: true });
        await fsp.copyFile(fallback, settings);
      }
    }
    result[name.toLowerCase()] = count;
    onLine(`${name}：${count} 个文件已放入 ${name}\\`);
  }

  // 3c) MPQ 内部条目补丁：client\data\mpq\<档名.mpq>\<内部路径> → 注入 Client\Data\<档名.mpq> 的同名条目。
  // 只发变了的那几条（一个 292MB 的 enUS 档，实际改动可能只有一个 0.5MB 的 lua）。
  //By leewheel 2026年11月7日 三条硬规则：① 支持多级档路径（enUS\xxx.MPQ）；
  // ② 母本有、玩家档没有的新条目必须能新增（allowCreate），否则新 DBC/新贴图永远到不了玩家；
  // ③ 任何一条注入失败都中止更新，绝不静默跳过（这就是“包里有文件、玩家却没有”的根因）。
  const mpqPatchRoot = clientFrom ? path.join(clientFrom, 'data', 'mpq') : '';
  //By leewheel 2026年11月8日 老家底清理：v3~v10 曾把地图档 patch-ZZZ.mpq 整档发给玩家，
  // 而 ZZZ 的加载优先级最高，会盖住本包注入到 ZZN / ZZM 的同名条目（地图贴图、AreaTable）。
  // 本包已改成“把 ZZZ 的内容拆进 ZZN / ZZM”，所以玩家那边那份 ZZZ 必须让位：
  // 只改名成 .old（绝不删除，玩家可手动改回来），且仅当本包自己不再提供 ZZZ 时才动手。
  const packageHasZzz = fs.existsSync(path.join(folder, 'mpq', 'patch-ZZZ.mpq'))
    || (clientFrom ? fs.existsSync(path.join(clientFrom, 'data', 'mpq', 'patch-ZZZ.mpq')) : false);
  const legacyZzz = path.join(clientRoot, 'Data', 'patch-ZZZ.mpq');
  if (!packageHasZzz && fs.existsSync(legacyZzz)) {
    try {
      await fsp.rename(legacyZzz, `${legacyZzz}.old`);
      onLine('旧地图档 Data\\patch-ZZZ.mpq 已改名为 .old：避免它盖住本次注入到 ZZN / ZZM 的地图内容（需要恢复就把 .old 去掉）');
    } catch (error) {
      throw new Error(`旧地图档 patch-ZZZ.mpq 改名失败（可能被客户端占用，请先完全退出游戏）：${error.message}。更新中止`);
    }
  }
  if (mpqPatchRoot && fs.existsSync(mpqPatchRoot)) {
    onPhase('mpq-entries');
    const groups = await collectMpqPatchGroups(mpqPatchRoot);
    //By leewheel 2026年11月8日 注入补丁档要“看得见走到哪一条”：原来整个阶段只发一次 phase，
    // 界面进度条从 70% 直接干等到 85%，玩家以为卡死了。这里先数总条数，每注入一条报一次。
    const mpqTotal = groups.reduce((sum, group) => sum + group.files.length, 0);
    let mpqDone = 0;
    onPhaseProgress('mpq-entries', 0, mpqTotal);
    for (const group of groups) {
      const target = path.join(clientRoot, 'Data', ...group.archiveRel.split('/'));
      if (!fs.existsSync(target)) throw new Error(`补丁档不存在，无法注入：${group.archiveRel}。更新中止`);
      const items = [];
      for (const item of group.files) items.push({ arcName: item.arcName, content: await fsp.readFile(item.file) });
      const outcome = mpq.injectMany(target, items, { allowCreate: true, compress: true });
      for (const one of outcome.results) {
        if (!one.ok) throw new Error(`${group.archiveRel} 注入 ${one.arcName} 失败：${one.message || one.reason}。更新中止`);
        result.mpqEntries = (result.mpqEntries || 0) + 1;
        onLine(`注入 ${group.archiveRel} ← ${one.arcName}（${one.created ? '新增' : '替换'}，${(one.size / 1024).toFixed(0)} KB）`);
        mpqDone++;
        onPhaseProgress('mpq-entries', mpqDone, mpqTotal);
      }
      const created = outcome.results.filter(one => one.created).map(one => one.arcName);
      if (created.length) {
        const listed = mpq.appendToListfile(target, created, { compress: true });
        if (!listed.ok) throw new Error(`${group.archiveRel} 的 (listfile) 登记失败：${listed.error}。更新中止`);
        onLine(`${group.archiveRel} 新条目 ${created.length} 条已登记进 (listfile)`);
      }
    }
  }

  // 3b) 老格式：包里单独的 mpq\*.mpq → 覆盖 Client\Data\
  const mpqFolder = await findDir(folder, ['mpq']);
  if (mpqFolder) {
    const files = (await fsp.readdir(mpqFolder)).filter(name => /\.mpq$/i.test(name));
    for (const name of files) {
      await fsp.copyFile(path.join(mpqFolder, name), path.join(clientRoot, 'Data', name));
      result.mpq++;
      onLine(`补丁档覆盖：Data\\${name}`);
    }
  }

  // 4) DBC：按“档名目录”注入客户端补丁档
  //By leewheel 2026年11月4日 Client\Data\dbc 与 Client\data\dbc 在 Windows 上是同一处，必须去重，否则同一张表注入两次。
  const dbcSeen = new Set();
  const dbcCandidates = [
    clientFrom ? path.join(clientFrom, 'Data', 'dbc') : '',
    clientFrom ? path.join(clientFrom, 'data', 'dbc') : '',
    path.join(folder, 'dbc'),
    path.join(folder, 'chsspell'),
  ].filter(dir => dir && fs.existsSync(dir)).filter(dir => {
    const key = path.resolve(dir).toLowerCase();
    if (dbcSeen.has(key)) return false;
    dbcSeen.add(key);
    return true;
  });
  if (dbcCandidates.length) {
    onPhase('dbc');
    const map = await readDbcMap(folder);
    for (const dir of dbcCandidates) {
      const injected = await applyDbcTree({ clientRoot, serverRoot, dbcRoot: dir, map, onLine, warnings: result.warnings });
      result.dbc.push(...injected);
    }
    if (!result.dbc.length) onLine('本包不含 dbc 表');
  }

  // 5) SQL：server\SQL\<库名>\*.sql
  //By leewheel 2026年11月7日 数据库脚本必须全部导入成功；任何失败/库不存在/连不上都让整次更新失败。
  // 旧实现把失败转成“待办 + 警告”，还照样写“更新成功”，结果服务端起不来（老大 2026-11-07 明确要求改掉）。
  const sqlRoot = (serverFrom ? await findDir(serverFrom, ['SQL']) : '') || (await findDir(folder, ['SQL']));
  if (sqlRoot) result.sqlRoot = sqlRoot;
  if (importSqlFiles && sqlRoot) {
    onPhase('sql');
    try {
      result.sql = await importSqlTree(serverRoot, sqlRoot, { onLine, warnings: result.warnings, conns, waitMs, onPlan: onSqlPlan, onFileStart: onSqlFileStart, onFileDone: onSqlFileDone });
      onLine(`SQL：已导入 ${result.sql.length} 个脚本`);
    } catch (error) {
      result.sqlError = String(error?.message || error);
      throw error;
    }
  }

  //By leewheel 2026年11月9日 数据表核对（老大要求）：SQL 导完立刻按包里的 dbcheck 清单核一遍。
  // 清单是打包时从 3395 导出的“每个库有哪些表、每张表有哪些字段”，这里只读、只比、不改库。
  // 缺表/缺字段分两种处理：本包 SQL 声明要建的 → 抛错中止（脚本没生效）；本来不归本包管的 → 记警告 + 写明细。
  {
    const manifest = await require('./db-schema.cjs').readManifest(folder).catch(() => null);
    if (manifest) {
      onPhase('dbcheck');
      const dbSchema = require('./db-schema.cjs');
      const report = await dbSchema.checkSchema({
        query: (sql, database) => mysqlQuery(serverRoot, sql, connForDatabase(conns, database)),
        manifest,
        sqlRoot: result.sqlRoot || '',
        onLine,
      }).catch(error => ({ databases: 0, tables: 0, columns: 0, problems: [], warnings: [`数据表核对没跑起来：${error.message}`], details: [], missingTables: 0, missingColumns: 0, failed: true }));
      result.dbcheck = {
        databases: report.databases, tables: report.tables, columns: report.columns,
        missingTables: report.missingTables, missingColumns: report.missingColumns,
        problems: report.problems, warnings: report.warnings, manifest: manifest.name,
      };
      // 报告落盘：界面只说摘要，具体缺哪张表哪个字段写文件，方便老大直接拿去对账
      try {
        const at = new Date().toISOString();
        const dir = path.join(root, '.coa-launcher', 'dbcheck');
        await fsp.mkdir(path.join(dir, '..'), { recursive: true });
        await fsp.mkdir(dir, { recursive: true });
        const stamp = at.replace(/[:.]/g, '-').slice(0, 19);
        await fsp.writeFile(path.join(dir, `dbcheck-${stamp}.md`), dbSchema.renderReport({ manifest, result: report, at }), 'utf8');
        await fsp.writeFile(path.join(dir, `dbcheck-${stamp}.json`), JSON.stringify({ at, manifest: manifest.name, source: manifest.data.source || '', ...report }, null, 2), 'utf8');
        result.dbcheck.report = path.join(dir, `dbcheck-${stamp}.md`);
        onLine(`数据表核对报告：${path.join('.coa-launcher', 'dbcheck', `dbcheck-${stamp}.md`)}`);
      } catch (error) {
        result.warnings.push(`数据表核对报告没写成：${error.message}`);
      }
      if (report.problems.length) {
        const list = report.problems.slice(0, 4).join('；');
        throw new Error(`数据表核对没通过（缺少 ${report.problems.length} 项，本包 SQL 该建的表/字段没生效）：${list}${report.problems.length > 4 ? ' …' : ''}。详见 .coa-launcher\\dbcheck 下的报告。更新中止`);
      }
      if (report.missingTables || report.missingColumns) {
        result.warnings.push(`数据表核对：目标库比清单少 ${report.missingTables} 张表、${report.missingColumns} 个字段（不是本包负责创建的，只做提示，详见 .coa-launcher\\dbcheck）`);
      }
    }
  }

  //By leewheel 2026年11月6日 启动器自己也能随包更新：
  // 🔴 正在运行的 exe 不能改名也不能覆盖（运行镜像不共享删除权限），会报
  //    EBUSY: resource busy or locked, copyfile ... -> CoA启动器.exe（老大实测）。
  // 所以这里只把新 exe 落成 CoA启动器.new.exe；替换交给主进程 spawn 这个新 exe 当“替换器”
  // （launcher-swap.cjs：等旧进程退出 → 旧 exe 改名 .old.exe → 复制自己到目标位置）。包删不删都不影响。
  const launcherFrom = await findDir(folder, ['launcher']);
  if (launcherFrom) {
    onPhase('launcher');
    const names = await fsp.readdir(launcherFrom).catch(() => []);
    const exeName = names.find(name => /^CoA启动器\.exe$/i.test(name)) || names.find(name => /\.exe$/i.test(name));
    if (exeName) {
      const staged = path.join(root, 'CoA启动器.new.exe');
      await fsp.copyFile(path.join(launcherFrom, exeName), staged);
      // 替换助手（独立小 exe）：由它在旧进程退出后给文件改名，避免 EBUSY
      const helperSource = names.find(name => /^launcher-replace\.exe$/i.test(name));
      if (helperSource) await fsp.copyFile(path.join(launcherFrom, helperSource), path.join(root, 'launcher-replace.exe')).catch(() => {});
      result.launcherPending = true;
      onLine(helperSource ? '启动器新版本已就位：关闭启动器后自动替换' : '启动器新版本已就位：下次打开时替换');
    } else {
      result.warnings.push('包里有 launcher 目录但没找到 exe，启动器未更新');
    }
  }

  //By leewheel 2026年11月6日 配置只按**新参数**写：包里的 configs\configs.patch.json 逐键应用，
  // 不再整份覆盖玩家的 .conf（老大要求；否则玩家自己改的设置每次更新都会被冲掉）。
  const patchFile = path.join(folder, 'configs', 'configs.patch.json');
  if (fs.existsSync(patchFile)) {
    //By leewheel 2026年11月8日 这是收尾的“逐键写参数”，不是前面的整份覆盖配置。
    // 以前借用 'configs'，界面会把已经走完的步骤倒退回“覆盖配置”，看着像卡住了。
    onPhase('config-patch');
    try {
      const patchResult = await require('./config-patch.cjs').applyConfigPatch(path.join(root, 'Server'), patchFile);
      const keys = patchResult.applied.reduce((sum, item) => sum + item.keys.length, 0);
      result.configPatch = { files: patchResult.applied.length, keys };
      onLine(keys ? `配置：已写入 ${keys} 个新参数（只改动值，其他行原样保留）` : '配置：没有需要更新的参数');
    } catch (error) {
      //By leewheel 2026年11月7日 配置参数没写进去，服务端可能因缺参数起不来，必须中止而不是只记警告。
      throw new Error(`配置参数写入失败：${error.message}。更新中止`);
    }
  }

  if (snapshot.saved) { result.backup = snapshotDir; onLine(`被覆盖的 ${snapshot.saved} 个文件已留底：${path.relative(root, snapshotDir)}`); }

  //By leewheel 2026年11月8日 最后一道门：文件是不是真的换成包里的了。
  // 放在 configs.patch.json 之后、return 之前，覆盖所有归位动作（服务端/配置/客户端/Runtime/CoA-Bots/mpq）。
  // 对不上就抛错 → 不记版本、界面报失败，绝不写“更新成功”。
  if (serverFrom || clientFrom || configsFrom) {
    onPhase('verify');
    result.verify = await verifyInstalled({ folder, root, serverRoot, clientRoot });
    onLine(`核对：${result.verify.checked} 个文件已按包内容落地`);
    if (result.verify.problems.length) {
      const list = result.verify.problems.slice(0, 5).join('；');
      throw new Error(`文件落地核对没通过（共 ${result.verify.problems.length} 处）：${list}${result.verify.problems.length > 5 ? ' …' : ''}。更新中止`);
    }
  }
  return result;
}

module.exports = {
  API, HISTORY, LAST, SNAPSHOT, DEFAULT_MIRRORS, mirrorCandidates, parseVersion, compareVersions, releaseIsNewer, versionOf,
  listReleases, pickAsset, pendingReleases, baselineCovered, queueUpTo, installedVersion, readHistory, recordVersion, recordBaselineVersions, dateOf,
  download, downloadOnce, extractZip, contentRoot, copyTree, clientMpqs, readDbcMap, injectDbc, injectIntoArchive,
  //By leewheel 2026年11月8日 装完自检（队列收尾的主进程侧也要用 fileMd5 核世界服 exe）
  verifyInstalled, fileMd5,
  //By leewheel 2026年11月6日 镜像测速：给“下载优先走最快的源”用
  probeMirror, rankMirrors, mirrorsFromRanking, parseReleaseUrl, describeProbeFailure,
  applyDbcTree, mysqlPaths, readDbConfig, mysqlQuery, waitForMysql, importSqlFile, importSqlTree, importSql, applyUpdate, findDir, walkFiles,
};
