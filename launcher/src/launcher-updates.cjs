'use strict';
//By leewheel 2026年11月9日 启动器自身的在线更新（替换掉原来的 electron-updater 方案）。
//  原方案的问题：electron-updater 只能装 NSIS 安装包，而本启动器发布的是 portable 单文件 exe，
//  它的 quitAndInstall 在 portable 下不可用；而且它要求 launcherUpdateUrl + Ed25519 私钥签名，
//  老大发版时还得额外维护 latest.yml —— 发一次版要折腾三件事，实际一直关着（launcherUpdateUrl 为空）。
//
//  现在的规则（老大 2026-11-09 定）：
//   · 发布地址 https://github.com/leewheel/squidbots-launcher/releases
//   · Release title 固定 COA-LAUNCHER-<版本号>，资产就是 CoA-Launcher-<版本号>.exe
//   · 启动时查一次，有新版就**自动下载**，下载好提示「重启并安装」
//   · 更新连接以国内镜像为主力（jsDelivr 清单 + gh-proxy/ghfast 等反代），GitHub 直连只作兜底
//   · 自替换必须可靠：新 exe 落成 CoA启动器.new.exe，由它自己带 --takeover 等旧进程退出后覆盖
const fs = require('node:fs');
const path = require('node:path');
const selfUpdate = require('./launcher-selfupdate.cjs');
const launcherSwap = require('./launcher-swap.cjs');

function createLauncherUpdates(app, options = {}, notify = () => {}, canRestart = async () => {}) {
  const currentVersion = String(options.currentVersion || app.getVersion() || '');
  const root = String(options.root || '');
  const repo = selfUpdate.repoOf(options.repo);
  const branch = String(options.branch || 'main');
  const mirrors = Array.isArray(options.mirrors) && options.mirrors.length ? options.mirrors : selfUpdate.DEFAULT_MIRRORS;
  const fetchImpl = options.fetchImpl || fetch;
  //By leewheel 2026年11月9日 更新目录放在启动器旁边：<root>\Update\launcher
  // 不能放 %TEMP%：那里会被系统清理，而且玩家换目录后旧包就找不到了。
  const downloadDir = root ? path.join(root, 'Update', 'launcher') : '';

  let status = app.isPackaged && root
    ? { phase: 'idle', message: '', current: currentVersion, newer: null }
    : { phase: 'disabled', message: app.isPackaged ? '没有找到启动器所在目录，无法自行更新。' : '开发模式下不检查启动器更新（打包发布后才生效）。', current: currentVersion, newer: null };
  let checking = false;
  let busy = false;
  let remembered = null;   // 最近一次查到的发布信息
  let controller = null;   // 下载取消用

  //By leewheel 2026年11月9日 newer 是「服务器上是否真的有比本机新的版本」这一个事实，
  // 单独存一份：老大要求“查到新版就不许老启动器再装更新包”，判断必须只看这个事实，
  // 而不是看“当前界面处于哪个阶段”（下载中 / 已就绪 / 已忽略都要拦）。
  const NEWER_PHASES = new Set(['downloading', 'installing', 'ready', 'skipped']);
  const set = (phase, message, extra = {}) => {
    const newer = 'newer' in extra ? extra.newer : NEWER_PHASES.has(phase) ? true : phase === 'uptodate' ? false : (status.newer ?? null);
    //By leewheel 2026年11月9日 latest 也要继承：下载失败后进 error 阶段时，界面与闸门还得知道
    // “新版本是哪个号”，否则提示里那个版本号会变成空（回归测试钉住过这一条）。
    const latest = 'latest' in extra ? extra.latest : status.latest;
    status = { phase, message, current: currentVersion, ...extra, newer, latest };
    try { notify(status); } catch { /* 界面没开也不能影响更新 */ }
    return status;
  };

  async function lookup() {
    const result = await selfUpdate.check({
      currentVersion, repo, branch, mirrors, fetchImpl,
      signal: AbortSignal.timeout(25000),
    });
    return result;
  }

  // 下载 + 校验 + 落位。落位后 writeStaged 的元数据让下次启动的自动替换有据可依。
  async function fetchAndStage(info, { silent = false } = {}) {
    if (!downloadDir) throw new Error('没有启动器目录，无法下载');
    controller = new AbortController();
    const started = Date.now();
    if (!silent) set('downloading', `正在下载新版启动器 ${info.version}…`, { version: info.version, percent: 0 });
    const file = await selfUpdate.download(info, {
      dir: downloadDir,
      mirrors,
      fetchImpl,
      signal: controller.signal,
      onProgress: (done, total) => {
        const percent = total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
        // 每秒最多推 5 次：375MB 的包每 150ms 一次足够顺，再多界面会闪
        if (Date.now() - (fetchAndStage.lastAt || 0) < 200 && percent < 99) return;
        fetchAndStage.lastAt = Date.now();
        set('downloading', `正在下载新版启动器 ${info.version}… ${percent}%`, { version: info.version, percent, done, total, speed: done && Date.now() > started ? Math.round(done / ((Date.now() - started) / 1000)) : 0 });
      },
    });
    set('installing', `正在校验并安装 ${info.version}…`, { version: info.version, percent: 99 });
    const staged = await selfUpdate.stage({ root, file: file.file, version: info.version, sha256: info.sha256, size: file.size });
    return { staged, file, info };
  }

  //By leewheel 2026年11月9日 老大 2026-11-09 明确要求：**启动器更新完毕必须强制重启**，不给“稍后再说”
  // （老启动器继续用会去装坏格式不对的更新包）。强制重启有两条底线，一条都不能破：
  //   ① 不能把玩家正在跑的世界服弄掉线 —— 退出走 app.exit(0)，它**不触发** before-quit（停服逻辑在那里），
  //      但世界服的**控制台管道是启动器开的**：启动器一退管道就 EOF，核心会自己走一遍停机流程
  //      （实测约 90 秒后打印 Halting process，玩家正在打的副本直接被踢）。所以世界服在跑时**不许重启**，
  //      由 canRestart 抛 SERVER_RUNNING 拦下，等它停了再补（见下面 attemptInstall 的 soft 分支）。
  //      数据库与登录服没有这条管道（stdio 是 ignore），重启启动器不影响它们。
  //   ② 正在装更新包 / 准备数据时不能重启（会把写文件的过程砍断）—— 同样改为“等它结束再重启”，
  //      30 秒一轮、最多 30 分钟，期间横幅如实显示在等什么，不假装没发生。
  let installing = false;
  let autoTries = 0;
  let countdownTimer = null;
  let retryTimer = null;

  async function attemptInstall(mode) {
    if (installing) return { scheduled: false };
    if (!['ready', 'skipped'].includes(status.phase)) return { scheduled: false };
    installing = true;
    try {
      if (!selfUpdate.readStaged(root)) {
        if (!remembered) throw new Error('新版文件不见了，请重新检查更新');
        await fetchAndStage(remembered);
      }
      await canRestart();
      const file = path.join(root, launcherSwap.STAGED_NAME);
      if (!fs.existsSync(file)) throw new Error('新版文件不见了，请重新检查更新');
      if (!launcherSwap.spawnTakeover(file, process.pid, { restart: true })) throw new Error('无法启动替换程序');
      set('installing', `正在重启并安装新版启动器 ${status.version || ''}…`, { version: status.version, percent: 100 });
      // 900ms 让替换进程先起来读文件，然后本进程直接退出（不停服、不弹“要关服吗”）
      setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, 900);
      return { scheduled: true };
    } catch (error) {
      if (mode !== 'auto') throw error;
      //By leewheel 2026年11月9日 自动模式下失败基本都是“现在还不能重启”，分两种：
      //  · 世界服在跑（SERVER_RUNNING）：不是错误，是等玩家打完。**不设放弃期限**，每 60 秒看一次，
      //    等他把服停了就自己把升级补完——中途放弃只会留下“明明下好了却永远是老版本”。
      //  · 正在装更新包 / 准备数据：这类通常几十秒内就结束，30 秒一轮、最多 30 分钟。
      const soft = error?.code === 'SERVER_RUNNING';
      autoTries += 1;
      const giveUp = !soft && autoTries > 60;
      const reason = String(error?.message || error).replace(/[。.]$/, '');
      const tail = giveUp ? '自动重启没能完成，请点「立即重启」手动升级' : soft ? '停服后会自动完成升级' : '30 秒后自动重试重启';
      set('ready', `新版启动器 ${status.version || ''} 已下载完成：${reason}；${tail}。`, { version: status.version, latest: status.latest, percent: 100, waiting: !giveUp, waitingOnServer: soft });
      if (!giveUp) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { attemptInstall('auto').catch(() => {}); }, soft ? 60000 : 30000);
        retryTimer.unref?.();
      }
      return { scheduled: false, waiting: !giveUp };
    } finally { installing = false; }
  }

  // 下载完先给玩家看 6 秒倒计时（横幅显示“X 秒后自动重启”），然后自己重启。
  // 没有“取消”按钮：老大要求强制，且老版本留着只会把更新包装坏。
  function startCountdown() {
    clearInterval(countdownTimer);
    let left = Math.max(2, Math.round((Number(options.autoRestartDelay) || 6000) / 1000));
    const tick = () => {
      if (status.phase !== 'ready') { clearInterval(countdownTimer); countdownTimer = null; return; }
      if (left <= 0) { clearInterval(countdownTimer); countdownTimer = null; attemptInstall('auto').catch(() => {}); return; }
      set('ready', `新版启动器 ${status.version || ''} 已下载完成：${left} 秒后自动重启安装…`, { version: status.version, latest: status.latest, percent: 100, secondsLeft: left, auto: true });
      left -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    countdownTimer.unref?.();
  }

  //By leewheel 2026年11月9日 老大要求「有就下载新版」：查到新版自动下，不额外弹窗问。
  async function checkOnce({ force = false } = {}) {
    if (status.phase === 'disabled') return status;
    if (checking || busy) return status;
    if (!force && ['downloading', 'installing', 'ready'].includes(status.phase)) return status;
    checking = true;
    try {
      set('checking', '正在检查启动器更新…');
      const result = await lookup();
      if (!result.newer) {
        remembered = null;
        return set('uptodate', '启动器已是最新版本。', { latest: result.latest.version, source: result.source });
      }
      remembered = result.latest;
      const skipped = String(options.skipVersion?.() || '');
      if (!force && skipped && skipped === result.latest.version) {
        return set('skipped', `已忽略 ${result.latest.version} 这个版本。`, { version: result.latest.version, latest: result.latest.version, notes: result.latest.notes });
      }
      set('downloading', `发现新版启动器 ${result.latest.version}，正在下载…`, { version: result.latest.version, percent: 0, notes: result.latest.notes, latest: result.latest.version, size: result.latest.size, source: result.source });
      busy = true;
      const staged = await fetchAndStage(result.latest);
      set('ready', `新版启动器 ${result.latest.version} 已下载完成，稍后自动重启安装。`, {
        version: result.latest.version, latest: result.latest.version, percent: 100,
        notes: result.latest.notes, source: result.source, canInstall: !!staged.staged,
      });
      //By leewheel 2026年11月9日 强制重启：下载完立刻开始倒计时，不需要玩家点任何按钮。
      // 返回的是**倒计时之后**的 status：startCountdown 第一拍就会把 secondsLeft 推出去，
      // 若返回它之前那个对象，IPC 的返回值里就没有秒数，界面第一秒会显示成“正在自动重启”。
      if (options.autoRestart !== false) startCountdown();
      return status;
    } catch (error) {
      // 玩家主动取消不算失败
      if (/已取消|cancelled|aborted/i.test(String(error?.message || ''))) return set('idle', '已取消下载。', {});
      //By leewheel 2026年11月9日 老大 2026-11-09：**查不到就查不到，不许报错**。
      // 「查不到」和「更新失败」是两件事，以前混在一起，于是仓库还没发版时每个玩家一开启动器
      // 就顶一条红色「新版启动器下载失败：查不到启动器的发布信息（404…）」，纯属吓人：
      //   · 查不到（仓库还没发过版 / 断网 / 被墙）→ 玩家什么都没损失，界面上不该出现任何红条。
      //     按“当前已是最新”处理：newer=false 让装机闸门照常放行，倒计时/下载一概不启动，
      //     30 分钟一轮的定时检查会自己再查，一发布就能收到。
      //   · 查到版本但下载 / 校验 / 落位失败 → 这才是真失败，红色横幅 + 重试按钮。
      // 判据是 error.tried：只有 selfUpdate.check() 把所有通道都试过仍没结果时才带这个字段
      // （见 launcher-selfupdate.cjs 末尾 throw 前那行 error.tried = tried）。
      if (error?.tried) {
        remembered = null;
        return set('uptodate', '暂时查不到启动器的发布信息（可能还没有发布新版本），稍后会自动再查。', {
          newer: false, unknown: true, tried: error.tried,
        });
      }
      return set('error', `启动器更新失败：${selfUpdate.shortError(error)}`, { error: String(error?.message || error) });
    } finally {
      checking = false;
      busy = false;
      controller = null;
    }
  }

  return {
    get status() { return status; },
    get busy() { return busy; },
    check: options => checkOnce(options),

    //By leewheel 2026年11月9日 老大 2026-11-09 要求：GitHub 上已经有新版启动器时，
    // **老启动器不许再装更新包**（更新包按新版启动器的规则生成，老启动器装会把服务端弄坏），
    // 必须先把启动器升上去。所以所有“装包”入口在动手之前都要先过这一关。
    // 三种情况要分清：
    //   · 确认有新版（newer === true）      → 拦住，告诉玩家升到哪个版本
    //   · 确认没有新版（newer === false）    → 放行
    //   · 查不到（网络不通 / error / 还没查） → **放行**：不能因为 GitHub 连不上就把玩家锁死，
    //     否则断网的玩家永远装不了包。这一条是安全性上的刻意取舍。
    async gate() {
      if (status.phase === 'disabled') return { blocked: false };
      if (status.newer === null || ['idle', 'error'].includes(status.phase)) {
        await checkOnce().catch(() => {});
      }
      if (status.newer === true) {
        const version = String(status.latest || status.version || '');
        return {
          blocked: true,
          version,
          current: currentVersion,
          message: `启动器已经发布新版本 ${version}（你的是 ${currentVersion}）：必须先更新启动器，才能继续安装整合包的更新。新版启动器才认识现在的更新包格式，用老版本装会把服务端文件弄坏。首页上有「更新启动器」按钮。`,
        };
      }
      return { blocked: false };
    },

    cancel() {
      try { controller?.abort(); } catch { /* 没在下载 */ }
      set('idle', '已取消下载。', {});
    },

    skip() {
      //By leewheel 2026年11月9日 ready 之后是强制重启，忽略没有意义（老版本不许再装包）：
      // 只有“下载中想先别下”这件事可以忽略，所以这里拦一下。
      if (status.phase === 'ready') return status;
      const version = status.version || remembered?.version || '';
      if (version) options.onSkip?.(version);
      set('skipped', `已忽略 ${version} 这个版本（下次检查仍会提示）。`, { version, latest: version });
    },

    //By leewheel 2026年11月9日 「立即重启」按钮 / 兜底入口：与自动重启走同一条路径。
    async install() {
      clearInterval(countdownTimer);
      countdownTimer = null;
      return attemptInstall('manual');
    },
  };
}

module.exports = { createLauncherUpdates };
