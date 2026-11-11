'use strict';
// Start-up, the click handler, live events from the main process, and the screenshot tour.

//By leewheel 2026-11-03 日志窗口的"看哪个世界服"下拉：换一个国度就重新拉它的日志
document.addEventListener('change', event => {
  const picker = event.target.closest && event.target.closest('#log-realm');
  if (!picker) return;
  App.state.logRealm = picker.value || '';
  App.state.logFollowed = false;
  if (typeof refreshServerLog === 'function') refreshServerLog();
});

document.addEventListener('click', event => {
  if (!event.target.closest('.split-button')) { const menu = $('#play-menu'); if (menu) menu.hidden = true; }
  //By leewheel 2026年11月11日 「强制关闭占用端口的程序」：点了才杀，杀完统一复查横幅与首页按钮
  const killer = event.target.closest('[data-port-kill]');
  if (killer && !killer.disabled) {
    const port = Number(killer.dataset.portKill);
    killer.disabled = true;
    killer.textContent = '正在关闭…';
    App.api.portsKill(port)
      .then(() => checkPorts({ announce: false }))
      .then(() => {
        if (!App.state.portBlocked) {
          if ($('#dialog[open] [data-port-kill]')) dialog.close();
          toast(`已结束占用端口 ${port} 的程序`, 'success');
        }
      })
      .catch(error => {
        killer.disabled = false;
        killer.textContent = '强制关闭失败，重试';
        console.warn('[启动器] 强制关闭端口失败：', error && error.message ? error.message : error);
        toast(`强制关闭端口 ${port} 失败：${translateError(error?.message || String(error))}`, 'error');
      });
    return;
  }
  //End By leewheel
  const target = event.target.closest('button, [data-action]');
  if (!target || target.disabled) return;
  const data = target.dataset;
  if (data.window) { App.api.window(data.window); return; }
  if (data.tab) { App.go(data.tab); if (data.tab === 'server' && App.state.server) { App.api.serverInfo().then(info => { App.state.server = info; App.refresh('server'); loadServerTab(); }).catch(() => {}); } return; }
  if (data.action === 'dialog-close') { dialog.close(); return; }
  if (data.action && App.actions[data.action]) App.actions[data.action](target, event);
});
$('#dialog').addEventListener('click', event => { if (event.target.id === 'dialog') dialog.close(); });
$('#dialog').addEventListener('close', () => { if (!$('#dialog').open) $('#dialog-body').innerHTML = ''; });

//By leewheel 2026-11-05 目录布局告警（老大指定的两句中文原文）
// 横幅常驻在所有页面之上，启动时再弹一个必须确认的对话框，避免被当成普通提示划过去。
function showLayoutAlert(layout) {
  const problems = [];
  if (layout.chinesePath) problems.push({ text: '本模拟器的目录中不可以出现中文', detail: '请把整个模拟器文件夹移动到纯英文路径下，例如 D:/Games/COA。' });
  if (layout.badFolders?.length) problems.push({ text: '不可以修改本模拟器的默认文件和文件夹布局', detail: `缺失或为空：${layout.badFolders.join('、')}。请保留原始的 Client、Server 文件夹及其内容。` });
  const lines = problems.map(item => `<div class="layout-alert-line"><strong>${esc(item.text)}</strong><small>${esc(item.detail)}</small></div>`).join('');
  const banner = $('#layout-alert');
  if (banner) {
    banner.innerHTML = `${icon('warning')}<div class="layout-alert-lines">${lines}</div>`;
    banner.hidden = false;
    document.body.classList.add('has-layout-alert');
  }
  dialog.open(`${dialog.header('目录布局检查未通过', '本模拟器无法按默认布局运行')}<div class="dialog-content">${lines}<p class="muted small">修正后请重新启动启动器。</p></div><footer class="dialog-foot"><button class="button primary" data-action="dialog-close">我知道了</button></footer>`, 'wide');
}
//End By leewheel

//By leewheel 2026年11月11日 端口体检：原来只在启动那一刻扫一次，之后 8085 才被别的程序占上
// 就再也不会出现「强制关闭」按钮；而且失败被 .catch(() => {}) 静默吞掉，看不见任何线索。
// 现在启动时、服务状态变化时、每 30 秒都复查；横幅与首页各有一个常驻按钮，
// 弹窗只在第一次发现占用时提示一次，不反复打扰。
// 本包残留实例（mine=true 但不在 children 里）也算需要玩家手动清掉的占用。
function blockedPorts(list) {
  return (list || []).filter(item => item.busy && (!item.mine || !item.managed));
}

function showPortAlert(list, { announce = true } = {}) {
  const blocked = blockedPorts(list);
  const signature = blocked.map(item => `${item.port}:${item.pid}:${item.file}`).join('|');
  const changed = signature !== App.state.portBlocked;
  App.state.portBlocked = signature;
  const old = document.getElementById('port-alert-lines');
  if (old) old.remove();
  if (!blocked.length) {
    const banner = $('#layout-alert');
    if (banner && !banner.innerHTML.trim()) { banner.hidden = true; document.body.classList.remove('has-layout-alert'); }
    return;
  }
  const lines = blocked.map(item => `<div class="layout-alert-line"><strong>端口 ${item.port} 被其他程序占用（${esc(item.name)}）</strong><small>${esc(item.file || `PID ${item.pid}`)}</small><button class="button" style="white-space:nowrap" data-port-kill="${item.port}">强制关闭这个程序</button></div>`).join('');
  const banner = $('#layout-alert');
  if (banner) {
    banner.insertAdjacentHTML('beforeend', `<div class="layout-alert-lines" id="port-alert-lines">${lines}</div>`);
    banner.hidden = false;
    document.body.classList.add('has-layout-alert');
  }
  if (announce && changed && !$('#dialog').open) {
    dialog.open(`${dialog.header('端口被其他程序占用', '服务器无法启动')}<div class="dialog-content">${lines}<p class="muted small">点「强制关闭这个程序」会结束占用端口的进程；关掉后会自动复查。也可以自己关掉它，再重新打开启动器。</p></div><footer class="dialog-foot"><button class="button primary" data-action="dialog-close">我知道了</button></footer>`, 'wide');
  }
}

async function checkPorts({ announce = true } = {}) {
  let list;
  try { list = await App.api.portsScan(); }
  catch (error) {
    console.warn('[启动器] 端口体检失败：', error && error.message ? error.message : error);
    return null;
  }
  showPortAlert(list, { announce });
  return list;
}
//End By leewheel

function subscribe() {
  const api = App.api;
  //By leewheel 2026年11月11日 端口复查限频：启动期服务状态推送很密，别每来一条就扫一遍端口
  let portCheckAt = 0;
  //End By leewheel
  api.onClientProgress(progress => {
    App.state.client = { ...App.state.client, progress };
    if (App.state.tab !== 'play' || $('#dialog').open) return;
    const line = $('#status-line');
    const bar = $('.hero .progress span');
    if (line && bar && BUSY.includes(progress.phase)) {
      line.textContent = progressText(progress);
      const { pct } = progressBar(progress);
      bar.dataset.pct = pct ?? 30;
      applyBars($('.hero'));
      const label = $('.hero-progress > span');
      if (label) label.textContent = pct === null ? '' : `${pct}%`;
    } else App.refresh('play');
  });
  api.onServerProgress(progress => { if (App.state.server) { App.state.server.progress = progress; patchServer(); } });
  api.onBotsProgress(progress => { App.state.botsProgress = progress; patchServer(); });
  // Navigation maps built in the background (another process): their progress is read again every 15 s.
  setInterval(() => {
    const asm = App.state.server?.assembly;
    if (!asm?.applies || asm.mmaps?.complete || App.state.tab !== 'home' || $('#dialog').open) return;
    App.api.assembleStatus().then(next => {
      if (!App.state.server || JSON.stringify(next.mmaps) === JSON.stringify(App.state.server.assembly?.mmaps)) return;
      App.state.server.assembly = next;
      App.render();
    }).catch(() => {});
  }, 15000);
  // Assembly of a data-free server (data from the client, database): one event per line of the assembler.
  let assembleDrawn = 0;
  let speedSamples = [];
  api.onAssemble(event => {
    // The preparation is over: what was read on the half-made server (checks, the game card) is read again.
    if (event.event === 'idle') { App.state.assembleProgress = null; App.reloadAll(); return; }
    if (event.event === 'error') { App.state.assembleProgress = null; App.state.assembleError = event.message; App.render(); return; }
    // The line the tool is on: shown under the bar, the step itself does not change.
    if (event.event === 'detail') {
      if (!App.state.assembleProgress) return;
      App.state.assembleProgress.detail = event.text;
      const line = document.getElementById('assemble-detail');
      if (line) line.textContent = event.text;
      else if (App.state.tab === 'home' && !$('#dialog').open) App.render();
      return;
    }
    App.state.assembleError = '';
    // The folder was just installed: the home page switches from the install card to the assembly one.
    if (!App.state.assembleProgress && !App.state.server?.assembly?.applies) App.api.serverInfo().then(info => { App.state.server = info; if (App.state.tab === 'home') App.render(); }).catch(() => {});
    const previous = App.state.assembleProgress || {};
    // The time of a step counts from its start (a new step, or the first news of the run).
    const since = event.step && event.step === previous.step && previous.since ? previous.since : Date.now();
    App.state.assembleProgress = event.event === 'step' ? { step: event.step, text: event.text, since } : event.event === 'progress' ? { ...previous, step: event.step, done: event.done, total: event.total, warning: event.warning || '', since } : previous;
    // Bytes of the navigation maps: speed over the last 8 seconds, and the time left at that speed.
    if (event.event === 'progress' && event.step === 'mmaps' && event.total > 1e6) {
      const now = Date.now();
      speedSamples = [...speedSamples.filter(([at]) => now - at < 8000), [now, event.done]];
      const [firstAt, firstDone] = speedSamples[0];
      const speed = now - firstAt >= 2000 ? ((event.done - firstDone) * 1000) / (now - firstAt) : 0;
      Object.assign(App.state.assembleProgress, { speed, left: speed > 0 ? (event.total - event.done) / speed : 0 });
    } else if (event.event === 'step') speedSamples = [];
    if (Date.now() - assembleDrawn < 400 && event.event === 'progress') return;
    assembleDrawn = Date.now();
    if (App.state.tab === 'home' && !$('#dialog').open) App.render();
  });
  let importDrawn = 0;
  api.onImport(progress => {
    App.state.importProgress = progress.phase === 'idle' ? null : progress;
    if (Date.now() - importDrawn < 250 && progress.phase !== 'idle') return;
    importDrawn = Date.now();
    if (App.state.tab === 'server' && App.state.srvTab === 'install' && !$('#dialog').open) App.refresh('server');
    if (App.state.tab === 'home' && !App.state.server?.path && !$('#dialog').open) App.render();
  });
  api.onServices(services => {
    if (!App.state.server) return;
    const changed = JSON.stringify(services) !== JSON.stringify(App.state.server.services);
    App.state.server.services = services;
    //By leewheel 2026年11月11日 服务状态一变就复查端口：占用经常是启动器开着之后才出现的
    // （另一份服务端、上一次没退干净的世界服），只在开机扫一次就永远等不到那个按钮。
    if (App.state.config?.server && Date.now() - portCheckAt > 5000) {
      portCheckAt = Date.now();
      checkPorts({ announce: false }).catch(() => {});
    }
    //End By leewheel
    //By leewheel 2026年11月9日 那个失败的服务重新跑起来了：首页的红色条自动撤掉（不用玩家手动关）
    if (App.state.serverFail) {
      const back = services.find(item => item.id === App.state.serverFail.id);
      if (back && back.state === 'running') { App.state.serverFail = null; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); }
    }
    if (changed && App.state.srvTab === 'services') patchServer();
    if (changed && App.state.tab === 'home' && !$('#dialog').open) App.render();
  });
  api.onUpgrade(update => {
    const s = App.state;
    if (update.line !== undefined) appendLog(update.line);
    if (update.step) s.upgradeStep = update.step;
    if (UPGRADE_STEPS.some(([id]) => id === update.step)) s.upgradeLastStep = update.step;
    // A reinstall (Verification > Troubleshooting): its step shows there.
    if (update.step && s.reinstallRunning && s.tab === 'verify' && !$('#dialog').open) App.render();
    if (update.running !== undefined) s.upgradeRunning = update.running;
    if (update.step && s.tab === 'server' && s.srvTab === 'upgrade') {
      const current = $('.stepper');
      if (current) current.outerHTML = stepper(); else App.refresh('server');
    }
  });
  api.onServerTask(task => {
    App.state.task = task.phase === 'done' ? null : task;
    const line = $('.task-line span');
    if (line && App.state.task) line.textContent = taskText(App.state.task);
    else if (App.state.srvTab === 'backups' && App.state.tab === 'server' && !$('#dialog').open) App.refresh('server');
  });
  api.onAddonProgress(({ done, total }) => { if (total) toast(t('addon.downloading', 'Downloading addons… {pct}%', { pct: Math.floor((100 * done) / total) })); });
  api.onRepackNotice(notice => toast(t(notice.key, notice.text), 'success'));
  api.onComponents(state => { App.state.components = state; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); });
  api.onUpdateState(state => { App.state.update.state = state; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); });
  api.onUpdateEvent(event => onUpdateEvent(event));
  api.onFeed(feed => { App.state.feed = feed; if (['home', 'server'].includes(App.state.tab) && !$('#dialog').open) App.render(); });
  api.onLauncherUpdate(status => {
    App.state.launcherUpdate = status;
    // Only the bar is redrawn: the page underneath (a form being filled…) is left alone.
    const bar = $('#launcher-banner');
    if (bar) bar.innerHTML = launcherBanner();
    //By leewheel 2026年11月9日 阶段名改了：downloaded → ready（新实现里“已校验落位、可安装”叫 ready）。
    // 另外“倒计时”每秒推一次，只重画横幅就够（横幅在主框架里，任何页都看得到），
    // 不要再整页 App.render —— 那样下载期间每秒重画 5 次首页，按钮会闪、悬停会断。
    if (status.phase === 'ready' && !App.state.launcherReadyNotified) {
      App.state.launcherReadyNotified = true;
      toast(`新版启动器 ${status.version || ''} 已下载完成：马上自动重启安装（服务端不会被停掉）。`, 'success');
    }
    if (status.phase !== 'ready') App.state.launcherReadyNotified = false;
  });
  //By leewheel 2026年11月9日 服务起不来 / 半路自己挂了：首页立刻出现红色条与「为什么起不来」按钮
  if (api.onServerFailed) {
    api.onServerFailed(payload => {
      App.state.serverFail = payload || null;
      if (payload?.message) toast(`服务启动失败：${payload.message}`, 'error');
      if (App.state.tab === 'home' && !$('#dialog').open) App.render();
    });
  }
  api.onGameExit(async () => { App.state.client = await api.clientInfo(); App.refresh('play'); });
}

// The server changed under the launcher (prepared, installed, imported, switched, updated): what the pages show is
// read again, as after a restart of the launcher, so a new player never sees a check taken on a half-made server.
App.reloadAll = async () => {
  try { const boot = await App.api.bootstrap(); Object.assign(App.state, { settings: boot.settings, client: boot.client }); } catch {}
  Object.assign(App.state, { verify: null, serverCheck: null, botsCheck: null, conf: null, backups: null });
  try { App.state.server = await App.api.serverInfo(); } catch {}
  App.render();
  if (App.state.config.edition !== 'server') return;
  if (typeof refreshAddon === 'function') refreshAddon(true);
  App.api.notes().then(notes => { App.state.notes = notes; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); }).catch(() => {});
  App.api.updateRefresh().then(state => { if (state && !App.state.update.run) App.state.update.state = state; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); }).catch(() => {});
  App.api.componentsRefresh().then(state => { App.state.components = state; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); }).catch(() => {});
  if (App.state.server?.path && !App.state.server.assembly?.needed && typeof runVerify === 'function') runVerify(false);
};

// Screenshot tour driven by the main process: tab names, click:<selector>, lang:<code>, dialog:settings, wait.
App.smoke = step => {
  if (step === 'wait') return;
  if (step === 'reload') { App.reloadAll(); return; }
  // Screenshot tours: show the launcher-update bar as if a new launcher were downloading / ready.
  if (step.startsWith('launcher:')) {
    //By leewheel 2026年11月9日 巡检脚本里的旧名字映射到新状态（downloaded → ready），老脚本照旧可用
    const alias = { downloaded: 'ready', downloadedlater: 'ready' };
    const phase = alias[step.slice(9)] || step.slice(9);
    App.state.launcherUpdate = { phase, version: '9.9.9', latest: '9.9.9', percent: 56, newer: true, total: 392000000, done: 219000000 };
    const bar = $('#launcher-banner'); if (bar) bar.innerHTML = launcherBanner();
    return;
  }
  if (step.startsWith('click:')) { $(step.slice(6))?.click(); return; }
  //By leewheel 2026年11月9日 巡检专用：用假数据把“更新进度”那一块单独画出来拍图，
  // 免得为了确认“包名有没有显示”真去跑一次 80MB 的更新。只在 --smoke 巡检时才会走到这里。
  if (step.startsWith('release-preview:')) {
    // 参数用 k=v;k=v 传（巡检步骤本身按逗号切分，不能用 JSON）
    const fake = {};
    for (const pair of step.slice('release-preview:'.length).split(';')) {
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const key = pair.slice(0, at).trim();
      const value = pair.slice(at + 1);
      fake[key] = /^(pct|pkgIndex|pkgTotal|sqlIndex|sqlTotal)$/.test(key) ? Number(value) : value;
    }
    const host = document.createElement('div');
    host.className = 'dialog-content';
    host.style.cssText = 'position:fixed;left:40px;top:40px;width:900px;z-index:9999;background:#1c100a;padding:16px;border:1px solid rgba(224,160,80,.35);border-radius:12px';
    host.innerHTML = releaseRunView({ phase: fake.phase || 'extract', pct: fake.pct || 20, message: fake.message || '', done: false, error: '', pkg: fake.pkg, pkgIndex: fake.pkgIndex, pkgTotal: fake.pkgTotal, pkgVersion: fake.pkgVersion, sqlCurrent: fake.sqlCurrent, sqlIndex: fake.sqlIndex, sqlTotal: fake.sqlTotal });
    document.body.appendChild(host);
    return;
  }
  if (step.startsWith('scroll:')) { $(step.slice(7))?.scrollIntoView({ block: 'center' }); return; }
  if (step.startsWith('fill:')) {
    const [selector, value] = step.slice(5).split('::');
    const input = $(selector);
    if (input) {
      if (input.type === 'checkbox') input.checked = value === '1'; else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if (step.startsWith('submit:')) { $(step.slice(7))?.requestSubmit(); return; }
  if (step.startsWith('lang:')) { loadLocale(step.slice(5)).then(() => App.render()); return; }
  if (step === 'dialog:settings') { showSettings(); return; }
  dialog.close();
  if (step.startsWith('srv:')) { App.state.srvTab = step.slice(4); App.go('server'); loadServerTab(true); return; }
  App.go(step);
};

function showWhatsNew(list) {
  const lang = App.state.settings.language;
  const pick = value => (value?.[lang] ?? value?.en);
  const bullets = items => `<ul>${(pick(items) || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  // A version can come with the server release it goes with: a title and one list per part (core, bots, launcher...).
  const block = entry => `<section class="whats-new"><h3>${esc(pick(entry.title) || t('whatsNew.version', 'Launcher {version}', { version: entry.version }))}</h3>${entry.sections ? entry.sections.map(part => `<h4>${esc(pick(part.title))}</h4>${bullets(part.items)}`).join('') : bullets(entry.items)}</section>`;
  dialog.open(`${dialog.header(t('whatsNew.title', 'What is new'), App.state.config.appName)}<div class="dialog-content">${list.map(block).join('')}</div><footer class="dialog-foot"><button class="button primary" data-action="whats-new-ok">${esc(t('whatsNew.ok', 'Got it'))}</button></footer>`, 'form');
  const element = $('#dialog');
  element.addEventListener('close', () => App.api.whatsNewSeen().catch(() => {}), { once: true });
}
App.actions['whats-new-ok'] = () => dialog.close();

(async function boot() {
  $('#settings-button').innerHTML = icon('settings');
  $('.brand').insertAdjacentHTML('beforeend', LOGO);
  $('#settings-button').title = '设置';
  $('#win-min').innerHTML = icon('minimize');
  $('#win-max').innerHTML = icon('maximize');
  $('#win-close').innerHTML = icon('close');
  const data = await App.api.bootstrap();
  Object.assign(App.state, { config: data.config, settings: data.settings, client: data.client, version: data.version, launcherUpdate: data.launcherUpdate });
  applyTheme(data.settings.theme);
  await loadLocale(data.settings.language);
  $('#settings-button').title = t('settings.title', 'Settings');
  document.documentElement.lang = data.settings.language;
  $('#app-name').textContent = data.config.appName;
  document.body.insertAdjacentHTML('beforeend', `<div class="app-version" aria-hidden="true">v${esc(data.version)}</div>`);
  document.title = data.config.appName;
  Ocean.start($('#ocean'), data.settings.reduceMotion || data.smoke || matchMedia('(prefers-reduced-motion: reduce)').matches);
  //By leewheel 2026-11-03 关闭启动器时先显示停机遮罩：让玩家看见"正在停服"，而不是以为点了没反应
  if (App.api.onClosing) {
    App.api.onClosing(payload => {
      const phase = payload?.phase;
      if (phase === 'stopping') {
        dialog.open(`${dialog.header(t('closing.title', '正在停止服务器'))}<div class="dialog-content"><p class="status-line">${esc(t('closing.body', '关闭启动器会先停掉它启动的所有服务：国度的世界服、登录服、世界服和 MySQL。'))}</p><p class="muted small">${esc(t('closing.wait', '世界服要把角色数据存盘，通常需要 10～60 秒，请稍等，不要重复点击。'))}</p><div class="hero-progress"><div class="progress indeterminate"><span data-pct="30"></span></div></div></div>`);
      } else if (phase === 'forcing') {
        dialog.open(`${dialog.header(t('closing.title', '正在停止服务器'))}<div class="dialog-content"><p class="status-line">${esc(t('closing.forcing', '停止超时，正在强制结束进程…'))}</p></div>`);
      } else if (phase === 'done') {
        dialog.open(`${dialog.header(t('closing.title', '正在停止服务器'))}<div class="dialog-content"><p class="status-line">${esc(t('closing.done', '服务器已停止，正在退出…'))}</p></div>`);
      }
    });
  }
  subscribe();
  App.state.tab = data.config.edition === 'server' ? 'home' : data.settings.startPage === 'server' && data.config.server ? 'server' : 'play';
  App.render();
  document.body.classList.add('ready');
  probeRealm();
  setInterval(probeRealm, 30 * 1000);
  // Once after an update of the launcher: what is new in it (never shown again).
  if (data.whatsNew?.length) showWhatsNew(data.whatsNew);
  //By leewheel 2026-11-05 布局告警最后弹出，避免被"新版本"等启动弹窗覆盖；横幅之后一直常驻
  if (data.layout && (data.layout.chinesePath || data.layout.badFolders?.length)) showLayoutAlert(data.layout);
  //End By leewheel
  //By leewheel 2026年11月11日 启动即体检端口，此后每 30 秒复查一次：
  // 占用常常是启动器开着时才出现的，只在开机扫一次就永远等不到那个「强制关闭」按钮。
  // 复查只更新常驻横幅与首页按钮，不重复弹窗打扰玩家。
  if (data.config.server) {
    checkPorts().catch(() => {});
    setInterval(() => {
      if (document.visibilityState !== 'hidden') checkPorts({ announce: false }).catch(() => {});
    }, 30000);
  }
  //End By leewheel
  if (isClassic() && data.config.edition !== 'server') loadNews();
  // Compare the game with its latest release at start (nothing is downloaded without asking).
  if (data.config.edition === 'server') { refreshAddon(true); App.api.updateRefresh().then(state => { if (state) { App.state.update.state = state; if (App.state.tab === 'home') App.render(); } }).catch(() => {}); App.api.componentsRefresh().then(state => { App.state.components = state; if (App.state.tab === 'home') App.render(); }).catch(() => {}); App.api.notes().then(notes => { App.state.notes = notes; if (App.state.tab === 'home') App.render(); }).catch(() => {}); App.api.updateState().then(state => { if (!App.state.update.state) App.state.update.state = state; if (App.state.tab === 'home') App.render(); }).catch(() => {}); loadNews(); App.api.feed().then(feed => { App.state.feed = feed; if (App.state.tab === 'home') App.render(); }).catch(() => {}); }
  else if (data.client.installed && data.config.game.hasClient) checkClient(false, true).catch(error => { App.state.client.progress = { phase: 'error', message: error.message }; App.refresh('play'); });
  if (data.config.edition !== 'server' && data.config.game.hasAddons && (data.settings.autoCheckAddons || data.client.installed)) loadAddons();
  if (data.config.server) App.api.serverInfo().then(info => { App.state.server = info; if (info.installed) checkServer(false, true).catch(() => {}); refreshUpdates(); }).catch(() => {});
  // New releases are looked for every 30 minutes (only the small signed manifests are read).
  setInterval(refreshUpdates, 30 * 60 * 1000);
})().catch(error => {
  document.body.classList.add('ready');
  $('#view').innerHTML = emptyState('warning', t('boot.failed', 'The launcher could not start'), error.message);
});
