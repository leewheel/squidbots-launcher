//By leewheel 2026年11月12日 发版后清理远端历史：GitHub 上**只保留最新一份 Release**（含 tag），其余全删。
// 为什么要清：① 玩家只需要最新版，历史发布堆在页面上反而选错；② 老版本 exe 每份 375MB，白占配额；
// ③ 发版清单只指向最新版，旧资产没有任何下载者。
// 用法：GITHUB_TOKEN=xxx node scripts/prune-releases.cjs [--keep 1.0.yyyymmddHHMM] [--repo 用户/仓库]
//   默认 keep = package.json 里的版本（也就是刚打包出来的那份），默认 repo = leewheel/squidbots-launcher。
// ⚠️ 只在确认新 Release 已经把 exe 资产上传完成后再跑：删完旧版，玩家就只剩这一条下载路径。
const fs = require('node:fs');
const path = require('node:path');

const launcherDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(launcherDir, 'package.json'), 'utf8'));

function arg(name, fallback = '') {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? String(process.argv[at + 1]) : fallback;
}

const keep = arg('keep', String(pkg.version || ''));
const repo = arg('repo', 'leewheel/squidbots-launcher');
const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error(`仓库名不合法：${repo}`); process.exit(1); }
if (!/^\d+\.\d+\.\d+$/.test(keep)) { console.error(`要保留的版本不合法：${keep}（应为 1.0.yyyymmddHHMM）`); process.exit(1); }
if (!token) { console.error('缺少 GITHUB_TOKEN（要有 repo 权限，删发布与 tag 需要它）'); process.exit(1); }

const api = `https://api.github.com/repos/${repo}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CoA-Launcher-Publish' };

async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok && response.status !== 204) {
    throw new Error(`${init.method || 'GET'} ${url.replace(api, '')} → HTTP ${response.status} ${(await response.text()).slice(0, 120)}`);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

(async () => {
  const releases = await call(`${api}/releases?per_page=100`);
  if (!Array.isArray(releases)) throw new Error('读不到发布列表');
  const kept = releases.filter(row => String(row.tag_name) === keep || String(row.name || '') === `COA-LAUNCHER-${keep}`);
  if (!kept.length) throw new Error(`发布列表里找不到 ${keep}，先建好 Release 再清理（避免把唯一一份也删掉）`);
  if (!(kept[0].assets || []).some(asset => /\.exe$/i.test(asset.name || ''))) throw new Error(`${keep} 还没上传 exe 资产，先传完再清理`);

  let removed = 0;
  for (const row of releases) {
    if (kept.some(item => item.id === row.id)) continue;
    await call(`${api}/releases/${row.id}`, { method: 'DELETE' });
    console.log(`已删除发布 ${row.tag_name}（id ${row.id}）`);
    removed += 1;
  }

  // 删了发布，tag 还留着（GitHub 不会跟着删），一并清掉，只留最新那个
  const tags = await call(`${api}/tags?per_page=100`);
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (String(tag.name) === keep) continue;
    await call(`${api}/git/refs/tags/${tag.name}`, { method: 'DELETE' });
    console.log(`已删除 tag ${tag.name}`);
  }

  const left = await call(`${api}/releases?per_page=100`);
  const remaining = (Array.isArray(left) ? left : []).map(row => row.tag_name).join('、') || '（空）';
  console.log(`清理完成：删除 ${removed} 份旧发布，线上现在只剩 ${remaining}`);
})().catch(error => { console.error(`清理失败：${error.message}`); process.exit(1); });
