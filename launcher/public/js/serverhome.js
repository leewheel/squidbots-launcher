'use strict';
// Server edition: the Home page (state of the server, start / stop, core and bots at a glance) and the
// Verification page (every check on the core, the bots, the services, the database and the files).

const isServerEdition = () => App.state.config?.edition === 'server';

function newsCards(list) {
  const areaInfo = { client: ['play', t('classic.newsGame', 'Game')], server: ['layers', t('classic.newsServer', 'Server')], bots: ['bot', t('classic.newsBots', 'Bots')] };
  return list.map(item => `<article class="news-card ${esc(item.area)}" data-action="news-open" data-area="${esc(item.area)}" tabindex="0" role="button"><div class="news-art">${icon(areaInfo[item.area]?.[0] || 'info')}</div><div class="news-text"><small>${item.publishedAt ? esc(new Date(item.publishedAt).toLocaleDateString(I18N.lang)) : ''} · ${esc(areaInfo[item.area]?.[1] || item.area)}</small><strong>${esc(item.version)}</strong><p>${esc(item.notes.join(' · ') || t('classic.noNotes', 'No notes for this release.'))}</p></div></article>`).join('');
}

// ---------------------------------------------------------------- the checks, in words
const CHECK_TEXT = {
  'core.installed': {
    ok: ['Core installed', 'Release {version}.'],
    bad: ['This folder is not a complete repack', 'Missing: {missing}. Install the server or choose its folder.'],
  },
  'core.update': {
    ok: ['Core up to date', 'Release {installed}.'],
    warn: ['New core available', '{latest} (installed: {installed}). Move to it from New version, or update in place.'],
    info: ['Core release not checked', '{error}{latest}'],
  },
  'core.files': {
    ok: ['Core files intact', 'Every file matches the signed release.'],
    warn: ['Core files changed or missing', '{files} file(s) differ from the release. Repair puts them back (your database and settings are kept).'],
    info: ['Core files not checked', '{error}'],
  },
  'bots.installed': {
    ok: ['CoA Bots installed', 'Version {version}, built for {builtFor}.'],
    info: ['CoA Bots not installed', 'The server runs without bots. Install them from Management.'],
  },
  //By leewheel 2026-11-03 机器人版本（核心内置版，从 playerbots.conf 固定行读出）
  'bots.version': {
    ok: ['机器人版本 v{version}', '机器人模块随核心内置（mod-playerbots），版本号写在 configs\\modules\\playerbots.conf 首行，由打包工具从核心源码同步。'],
  },
  'bots.update': {
    ok: ['Bots up to date', 'Release {installed}.'],
    warn: ['New bots available', '{latest} (installed: {installed}).'],
    info: ['Bots release not checked', '{error}'],
  },
  'bots.match': {
    ok: ['Bots made for this core', 'The bot worldserver was built from this very core ({release}).'],
    bad: ['Bots made for another core', 'The bots were built for {release}, not for the core installed here. Update the bots, or the core, so both match.'],
    info: ['Bots and core not compared', 'This bots package does not say which core it was built for.'],
  },
  'bots.files': {
    ok: ['Bot files intact', 'Every file matches the signed release.'],
    warn: ['Bot files changed or missing', '{files} file(s) differ. Updating the bots puts them back (your bot settings are kept).'],
    info: ['Bot files not checked', '{error}'],
  },
  'service.running': { ok: ['{name} running', 'Port {port}{variant}.'] },
  'service.stopped': { info: ['{name} stopped', 'Port {port}.'] },
  'service.foreign': { bad: ['{name}: port {port} taken by another program', '{other}. Another repack (or program) uses this port: stop it, then start this server.'] },
  'db.own': {
    ok: ['MySQL is this server\'s own', 'The database answering on this port is the one of this folder.'],
    bad: ['MySQL of another folder', '{error}'],
  },
  'db.updates': {
    ok: ['Database updates applied', '{applied} update(s) applied at the last start, none failed.'],
    bad: ['Database updates failed', '{failed}'],
  },
  crashes: {
    ok: ['No crash this week', 'No crash report in the last 7 days.'],
    warn: ['Crashes this week', '{count} crash(es) in the last 7 days. "Put away" moves their reports to Crashes\\archive.'],
  },
  'backup.age': {
    ok: ['Recent backup', 'Last backup {days} day(s) ago.'],
    warn: ['No recent backup', 'Make a backup before any update: one click, a few seconds.'],
  },
  disk: {
    ok: ['Enough disk space', '{free} free.'],
    warn: ['Little disk space left', 'Only {free} free: updates and backups need room.'],
  },
  // ---- known problems of the repacks
  'path.ok': { ok: ['Good place for the server', '{path}'] },
  'path.protected': { warn: ['Server in a protected folder', '{path}: Windows may stop the server writing its logs and database there. Move it to C:\\Games or similar.'] },
  'path.ascii': { warn: ['Accents or special letters in the path', '{path}: MySQL may refuse a data folder with such letters. A plain path is safer.'] },
  'data.maps': {
    ok: ['Maps and game data present', 'Data\\maps, vmaps, mmaps and dbc are there.'],
    bad: ['Game data missing', 'Empty or missing: {missing}. The world cannot start without them: repair the core.'],
    warn: ['Navigation maps of the bots on the way', 'Data\mmaps is being built from your client (home page). The server already runs; until then, bots may walk in straight lines.'],
  },
  'runtime.python': { ok: ['Python of the repack present', 'Runtime\\python runs the repack scripts.'], bad: ['Python of the repack missing', 'Runtime\\python\\python.exe is missing: repair the core.'] },
  //By leewheel 2026-11-02 发布版布局：检查的是 worldserver.exe 与 configs 是否在服务器根目录
  'core.binaries': { ok: ['Server programs present', 'worldserver.exe and the configs folder are in the server folder.'], bad: ['Server programs missing', 'worldserver.exe or the configs folder is missing: the server cannot start. Repair the server folder.'] },
  'conf.updates': {
    ok: ['The server updates its databases', 'Updates.EnableDatabases = 7 and the SQL of this core are found at each start.'],
    bad: ['Database updates are off', 'Updates.EnableDatabases = {value}: the SQL of this core is never applied (errors, crashes). The fix sets 7 in the template.'],
  },
  'conf.dist': {
    ok: ['Every module has its settings', 'No module runs on missing settings.'],
    bad: ['Module settings missing', '{count} module(s) with only a .conf.dist: {files}. Without coa.conf the client is disconnected. The fix copies each .dist (nothing is overwritten).'],
  },
  'conf.glued': {
    ok: ['Every setting on its own line', 'No setting is stuck to the line above it.'],
    bad: ['Settings stuck to a comment', '{count} file(s) with a setting stuck to the comment above it, so the server ignores it ("Missing property"): {files}. Stop the server, then the fix puts each one back on its own line, keeps your values and a copy of each file.'],
  },
  'bots.dbupdates': {
    ok: ['Bots database left to the installer', 'Playerbots.Updates.EnableDatabases = 0, as it must be.'],
    bad: ['The server would update the bots database', 'Playerbots.Updates.EnableDatabases = {value}: the server with bots does not start. The fix sets 0.'],
  },
  'bots.conf': {
    ok: ['Bots connected to this database', 'playerbots.conf has the port and password of this server.'],
    bad: ['Bot settings not filled in', 'playerbots.conf still has <MYSQL_PORT> or <APP_PASSWORD>: run the bots installer again.'],
  },
  'bots.whisper': { warn: ['Bots whisper every quest step', 'AiPlayerbot.BotsWhisperPublic = 1 (old default of 1.2/1.3). The fix sets 0.'] },
  'bots.leftover': { bad: ['A 1.5 file left in the 1.6 bots', 'Database\\world\\updates of 1.5 makes the 1.6 installer stop ("Replace … oldValue"). The fix removes that folder; then install the bots again.'] },
  'bots.ram': {
    ok: ['Enough memory for the bots', '{bots} bots need about {neededText} of {totalText}.'],
    warn: ['Too many bots for this PC', '{bots} bots need about {neededText} and this PC has {totalText}: lower MinRandomBots and MaxRandomBots in the server settings.'],
  },
  'bots.accounts': {
    ok: ['Bot accounts as expected', '{accounts} RNDBOT accounts.'],
    warn: ['Bot accounts out of step', '{accounts} RNDBOT accounts for {expected} expected: old bots are left. Recreate the bots (your characters stay).'],
  },
  'bots.outland': {
    ok: ['No level-60 bot in Outland', ''],
    warn: ['Level-60 bots in Outland', '{count} bot(s) under level 61 in Outland. Nothing to do: they go back to a zone of their level at their next teleport.'],
    info: ['A few low-level bots in Outland', '{count} bot(s) under level 61 in Outland. Nothing to do: they go back to a zone of their level at their next teleport.'],
  },
  'bots.tables': {
    ok: ['Bot database complete', '{count} playerbots tables.'],
    bad: ['Bot database empty', 'acore_playerbots has none of its playerbots tables: the world with bots stops at "Could not prepare statements of the Playerbots database". Install the bots again (server stopped); your characters are not touched.'],
  },
  'mysql.folders': {
    ok: ['Database folder clean', 'Only the server databases in mysql\\data.'],
    bad: ['Foreign folder in the database', '{folders} in mysql\\data can stop MySQL. Move it out of the server folder.'],
  },
  'mysql.tablespace': { bad: ['Database files of two installs mixed', '"Multiple files found for the same tablespace ID": a full repack was unpacked over an old one. Install in an empty folder and bring the players over.'] },
  'world.bots': { ok: ['The world runs with the bots', ''], info: ['The world runs without the bots', 'Started from Core\\ instead of CoA-Bots\\Core\\: no bots, .playerbots unknown. Stop and start from the launcher.'] },
  'process.old': { bad: ['{name} from before the update still runs', 'Players reach the old program (black screen, realm list loop). Restart it.'] },
  'firewall.block': {
    bad: ['Windows Firewall blocks the server', 'Block rule(s) on {programs}: Windows made them when its "allow access" window was cancelled, and they win over the opened ports, so other PCs cannot join. The fix removes them and allows our programs on their ports only (Windows asks for the administrator).'],
    warn: ['Windows Firewall blocks the server', 'Block rule(s) on {programs}: harmless while only this PC plays, but other PCs could not join. The fix removes them and allows our programs on their ports only (Windows asks for the administrator).'],
  },
  'client.kept': { warn: ['Game files modified, server data not refreshed', 'You chose to keep your modified game files: the server data do not match them, and things can go wrong in game. Update the data to match again (about 30 minutes, server stopped).'] },
  ra: { ok: ['Remote console answers', 'Port {port}.'], warn: ['Remote console silent', 'Port {port} is not answering while the world runs: accounts cannot be made from the launcher.'] },
  'realm.flag': {
    ok: ['Realm shown online', ''],
    bad: ['Realm shown offline', 'realmlist.flag = {flag}. The fix sets 0.'],
  },
  'bots.which': { warn: ['Two playerbots.conf, only one is read', 'With the bots the server reads CoA-Bots\\Core\\configs\\modules\\playerbots.conf. The one in Core\\configs\\modules is ignored: change the bot settings from the Server settings page.'] },
  'bots.missingkeys': {
    ok: ['Bot settings complete', 'playerbots.conf has every key of this version.'],
    warn: ['Bot settings of an older version', '{count} key(s) of this version are missing ({keys}…): they run at their defaults. The fix adds them with their default values (a copy is kept).'],
  },
  'coa.remote': { info: ['Only this PC can play', 'CoA.AllowRemoteClients = 0: players on other PCs are refused even with the right address.'] },
  'bots.mmapsUpdate': { info: ['Newer navigation maps are published ({version})', 'Download them (about 1.9 GB, a few minutes) to replace the maps of this server. Only the maps that match your game are taken; the others are built here.'] },
  'bots.mmaps': { info: ['Navigation maps of the bots: {done} of {total} maps', 'Built once from your game and kept. Bots walking through walls, stuck or going in straight lines? Rebuild them (about an hour, in the background; the server can keep running).'] },
  'data.refresh': {
    info: ['Map data of the server', 'Taken from your game at install time. Your game got a patch with a new zone? Update them so the server knows it (about 30 minutes; the server is stopped first).'],
    warn: ['Your game was updated: update the map data', 'The server still has the map data of your game before its patch: a new zone is missing. Update them (about 30 minutes; the server is stopped first).'],
  },
  'logs.size': {
    ok: ['Logs of a normal size', ''],
    warn: ['Very large logs', '{files}. Stop the server, then delete or move them. Logger.playerbots = {level} in the settings.'],
  },
  'conf.missing': {
    info: ['{count} setting(s) not in the files, no effect', '{keys}…: the server uses its defaults, the same as in the modules. Only the logs mention it.'],
    warn: ['{count} missing setting(s) fill the log', '{keys}…: one of them is asked for up to {repeats} times, so Server.log keeps growing. Module settings files are not where the server reads them: "Fix" (when shown) copies the ones this repack has; the others come with the next update. Nothing changes in game: the defaults already apply.'],
  },
  'mysql.foreign': { warn: ['MySQL of another folder running', '{file}: it may hold the port or the database files. Stop that server before starting, updating or moving players.'] },
  'realm.address': { info: ['Realm address: {address}', 'Players on another PC need the LAN or public address (and the firewall open on 3724 and 8085).'] },
};

const ACTIONS = {
  install: ['srv-tab', 'install', 'Install'],
  check: ['verify-run-in', 'install:server-check', 'Check'],
  upgrade: ['srv-tab', 'upgrade', 'New version'],
  repair: ['verify-run-in', 'install:server-repair', 'Repair'],
  'bots-install': ['verify-run-in', 'install:bots-install', 'Update'],
  start: ['service-start-all', '', 'Start'],
  //By leewheel 2026年11月8日 服务卡片每行的「启动」只启动这一项（数据库/登录/世界），不再等同于“启动全部”
  'service-start': ['service-start', '', 'Start'],
  restart: ['srv-tab', 'services', 'Services'],
  backup: ['backup-create', '', 'Back up now'],
  'crashes-archive': ['crashes-archive', '', 'Put away'],
  'logs-clean': ['logs-clean', '', 'Clean the logs'],
  'mmaps-rebuild': ['mmaps-rebuild', '', 'Rebuild'],
  'mmaps-update': ['mmaps-update', '', 'Download'],
  'assemble-refresh': ['assemble-refresh', '', 'Update the data'],
};

function checkText(check) {
  const entry = CHECK_TEXT[check.id]?.[check.state] || [check.id, ''];
  const data = { ...check.data };
  if (data.variant) data.variant = ` · ${data.variant}`;
  if (typeof data.free === 'number') data.free = formatBytes(data.free);
  if (typeof data.needed === 'number') { data.neededText = formatBytes(data.needed); data.totalText = formatBytes(data.total); }
  for (const key of ['error', 'latest']) if (data[key] === undefined) data[key] = '';
  return [t(`check.${check.id}.${check.state}.title`, entry[0], data), t(`check.${check.id}.${check.state}.text`, entry[1], data)];
}

const GROUPS = [['core', 'layers', 'Core'], ['bots', 'bot', 'Bots'], ['services', 'play', 'Services'], ['settings', 'settings', 'Settings'], ['database', 'database', 'Database'], ['setup', 'folder', 'Install'], ['health', 'shield', 'Health']];

function verifyView() {
  const v = App.state.verify;
  const running = App.state.verifying;
  const head = `<div class="verify-head"><div class="verify-score ${v ? (v.summary.bad ? 'bad' : v.summary.warn ? 'warn' : 'ok') : ''}">${v ? (v.summary.bad ? icon('warning') : v.summary.warn ? icon('info') : icon('check')) : icon('shield')}<div><strong>${esc(!v ? t('verify.never', 'Not checked yet') : v.summary.bad ? t('verify.bad', '{n} problem(s) to fix', { n: v.summary.bad }) : v.summary.warn ? t('verify.warn', '{n} point(s) to look at', { n: v.summary.warn }) : t('verify.ok', 'All good'))}</strong><small>${esc(v ? t('verify.when', 'Checked at {time}{deep}', { time: new Date(v.at).toLocaleTimeString(I18N.lang), deep: v.deep ? t('verify.withFiles', ', files included') : '' }) : t('verify.hint', 'A quick check reads the versions, the services and the logs.'))}</small></div></div>
    <div class="button-row"><button class="button ghost" data-action="verify-copy" title="${esc(t('verify.copyHint', 'For the support Discord: the versions of the core and the bots'))}">${icon('book')}${esc(t('verify.copy', 'Copy the versions'))}</button><button class="button ghost" data-action="verify-update" title="${esc(t('verify.updateHint', '检查启动器与服务器是否有新版本'))}">${icon('download')}${esc(t('verify.update', '检查更新'))}</button><button class="button ghost" data-action="verify-run" ${running ? 'disabled' : ''}>${icon('refresh')}${esc(t('verify.quick', 'Check again'))}</button><button class="button primary" data-action="verify-deep" ${running ? 'disabled' : ''}>${icon('shield')}${esc(t('verify.deep', 'Check every file'))}</button></div></div>`;
  if (!v) return `<div class="page verify">${head}${running ? `<div class="task-line">${icon('refresh')}<span>${esc(t('verify.running', 'Checking…'))}</span></div>` : ''}</div>`;
  // Two columns, each group going under the shorter one: no hole under a short group.
  const cols = [{ html: '', size: 0 }, { html: '', size: 0 }];
  GROUPS.forEach(([id, iconName, label]) => {
    const list = v.checks.filter(check => check.group === id);
    if (!list.length) return;
    const col = cols[0].size <= cols[1].size ? cols[0] : cols[1];
    col.size += 2 + list.reduce((sum, check) => sum + (check.state === 'ok' ? 1 : 2), 0);
    col.html += `<section class="panel verify-group"><header><h2>${icon(iconName)}${esc(t(`verify.group.${id}`, label))}</h2></header>${list.map(check => {
      const [title, text] = checkText(check);
      const fix = check.action?.startsWith('fix:') ? check.action.slice(4) : '';
      //By leewheel 2026年11月8日 action 可以带参数："start:mysql" → ACTIONS['service-start'] + data-id=mysql
      const raw = String(check.action || '');
      const cut = raw.indexOf(':');
      const actionKey = cut > 0 && !raw.startsWith('fix:') ? raw.slice(0, cut) : raw;
      const actionArg = cut > 0 && !raw.startsWith('fix:') ? raw.slice(cut + 1) : '';
      const action = !fix && actionKey && check.state !== 'ok' ? ACTIONS[actionKey] : null;
      const button = fix ? `<button class="button primary small" data-action="verify-fix" data-id="${esc(fix)}">${icon('check')}${esc(t('verify.fix', 'Fix'))}</button>`
        : action ? (() => { const id = action[1] || actionArg; return `<button class="button ${check.state === 'ok' || check.state === 'info' ? 'ghost' : 'primary'} small" data-action="${action[0]}" ${id ? `data-id="${esc(id)}"` : ''}>${esc(check.id === 'bots.installed' ? t('verify.action.bots-new', 'Install the bots') : t(`verify.action.${actionKey === 'service-start' ? 'start' : actionKey}`, action[2]))}</button>`; })() : '';
      return `<div class="check ${check.state}"><span class="check-light"></span><div><strong>${esc(title)}</strong>${text ? `<small>${esc(text)}</small>` : ''}</div>${button}</div>`;
    }).join('')}</section>`;
  });
  const groups = cols.map(col => `<div class="verify-col">${col.html}</div>`).join('');
  return `<div class="page verify">${head}${running ? `<div class="task-line">${icon('refresh')}<span>${esc(t('verify.running', 'Checking…'))}</span></div>` : ''}<div class="verify-cols">${groups}</div>${troubleshootView()}</div>`;
}

// Troubleshooting (folded): reinstall CoA + Bots next to the current server, then delete the old one.
const REINSTALL_STEPS = { backup: 'Backup of the databases', stop: 'Stopping the server', install: 'Downloading a fresh server', prepare: 'Preparing it from your game, bots, navigation maps', migrate: 'Copying accounts, characters, bots and realms', settings: 'Carrying your settings over', test: 'Test start', done: 'Done', failed: 'Stopped' };
function troubleshootView() {
  const s = App.state;
  const r = s.reinstall;
  const running = s.upgradeRunning && s.reinstallRunning;
  const step = REINSTALL_STEPS[s.upgradeStep] ? t(`reinstall.step.${s.upgradeStep}`, REINSTALL_STEPS[s.upgradeStep]) : '';
  const log = s.reinstallRunning || s.reinstallDone ? `<pre class="log" id="upgrade-log">${esc(s.upgradeLog.join(String.fromCharCode(10)))}</pre>` : '';
  const old = r?.previous ? `<div class="line-action">${icon('folder')}<span>${esc(t('reinstall.previous', 'Previous server kept in {path} ({size})', { path: r.previous.path, size: formatBytes(r.previous.bytes) }))}</span><button class="button ghost small" data-action="upgrade-revert" ${running ? 'disabled' : ''}>${esc(t('reinstall.back', 'Go back to it'))}</button><button class="button ghost small" data-action="reinstall-remove-old" ${running ? 'disabled' : ''}>${icon('trash')}${esc(t('reinstall.removeOld', 'Delete it'))}</button></div>` : '';
  return `<details class="panel troubleshoot" ${s.troubleshootOpen !== false ? 'open' : ''}><summary data-action="troubleshoot-toggle">${icon('shield')}${esc(t('verify.troubleshoot', 'Troubleshooting'))}</summary>
    <p class="muted">${esc(t('reinstall.what', 'When nothing else fixes the server: everything is installed again from scratch in a new folder next to this one. Your accounts, characters, bots, realms and settings are copied in. The current server stays untouched until the new one has started.'))}</p>
    <div class="button-row"><button class="button ghost" data-action="reinstall-run" ${running || s.upgradeRunning || r?.available === false ? 'disabled' : ''}>${icon('refresh')}${esc(t('reinstall.run', 'Reinstall CoA + Bots completely'))}</button>${running ? `<span class="pill warn">${esc(step)}</span>` : ''}</div>
    ${old}${log}</details>`;
}

async function runVerify(deep = false) {
  if (App.state.verifying) return;
  App.state.verifying = true;
  if (['verify', 'home'].includes(App.state.tab)) App.render();
  try { App.state.verify = await App.api.verify(deep); }
  catch (error) { toast(translateError(error.message), 'error'); }
  finally { App.state.verifying = false; if (['verify', 'home'].includes(App.state.tab)) App.render(); }
}

// ---------------------------------------------------------------- dashboard
function dashView() {
  const s = App.state;
  const dash = s.dashboard;
  const world = (s.server?.services || []).find(service => /world/i.test(service.name || service.id || ''));
  if (!dash) return `<div class="page classic">${skeleton(3)}</div>`;
  if (!dash.available) return `<div class="page classic">${emptyState('chart', t('dash.missing', 'No dashboard in this server'), t('dash.missingText', 'It comes with CoA Bots: install or update the bots.'))}</div>`;
  const state = dash.running ? t('dash.running', 'Running on localhost:{port}', { port: dash.port }) : t('dash.stopped', 'Stopped');
  return `<div class="page classic"><section class="hero classic-hero dash-hero">
    <div class="classic-main">
      <h1>${esc(t('tab.dash', 'Dashboard'))}</h1>
      <p class="status-line">${esc(t('dash.what', 'The live map of your bots, their levels, classes, groups, chat and server load. It runs on this PC only.'))}</p>
      <div class="mini-services"><span class="mini-service"><span class="light ${dash.running ? 'on' : 'off'}"></span>${esc(state)}</span>${dash.version ? `<span class="mini-service">${esc(t('dash.version', 'Version {version}', { version: dash.version }))}</span>` : ''}</div>
      <div class="button-row">
        ${dash.running
          ? `<button class="button primary" data-action="dashboard-open">${icon('chart')}${esc(t('dash.open', 'Open the dashboard'))}</button><button class="button ghost" data-action="dashboard-stop">${icon('pause')}${esc(t('dash.stop', 'Stop it'))}</button>`
          : `<button class="button primary" data-action="dashboard-launch">${icon('play')}${esc(t('dash.launch', 'Launch the dashboard'))}</button>`}
      </div>
      ${world && world.state !== 'running' ? `<p class="muted small">${icon('info')}${esc(t('dash.serverOff', 'Your server is stopped: the dashboard opens, but shows bots only while the server runs.'))}</p>` : ''}
    </div>
  </section></div>`;
}

App.pages.dash = {
  render: dashView,
  // render() calls mount() again: the status is read once per visit of the tab, not at every render.
  async mount() {
    if (App.state.dashLoading || App.state.dashFresh) return;
    App.state.dashLoading = true;
    try { App.state.dashboard = await App.api.dashboardStatus(); } catch { App.state.dashboard = { available: false }; }
    App.state.dashLoading = false;
    App.state.dashFresh = true;
    if (App.state.tab === 'dash') App.render();
  },
};

App.pages.verify = {
  render: verifyView,
  mount() {
    if (!App.state.verify && !App.state.verifying && App.state.server?.path && !App.state.server.assembly?.needed) runVerify(false);
    if (!App.state.reinstall && !App.state.reinstallLoading && App.state.server?.path) {
      App.state.reinstallLoading = true;
      App.api.reinstallPrepare().then(info => { App.state.reinstall = info; if (App.state.tab === 'verify') App.render(); }).catch(() => {}).finally(() => { App.state.reinstallLoading = false; });
    }
  },
};

// ---------------------------------------------------------------- home
//By leewheel 2026年11月9日 首页标题下面一行小字：显示启动器版本号（与右下角那个 v 是同一个数）
// 老大报问题时先说版本，一眼就能对上是哪一个构建。
function launcherVersionLine() {
  const version = String(App.state.version || '').trim();
  if (!version) return '';
  return `<p class="launcher-ver">${esc(t('home.launcherVersion', '启动器版本 v{version}', { version }))}</p>`;
}
function homeView() {
  const s = App.state;
  const info = s.server;
  if (!info) return `<div class="page">${skeleton(5)}</div>`;
  // The server folder changed (imported, chosen): the update and addon states were read for the old one.
  if (info.installed && s.updateFor !== info.path) {
    s.updateFor = info.path;
    setTimeout(() => {
      App.api.updateRefresh().then(state => { if (state) { s.update.state = state; if (s.tab === 'home' && !$('#dialog').open) App.render(); } }).catch(() => {});
      refreshAddon(true);
    }, 0);
  }
  // No server yet, or a folder kept in the settings that holds none (deleted, or a reinstall from scratch).
  if (!info.path || !info.installed) {
    const repack = s.feed?.repack;
    const p = s.importProgress;
    const pct = p?.total ? Math.floor((100 * p.done) / p.total) : null;
    const progress = p ? `<div class="hero-progress"><div class="progress${pct === null ? ' indeterminate' : ''}"><span data-pct="${pct ?? 30}"></span></div><span>${pct === null ? '' : `${pct}%`}</span></div><p class="muted small">${esc(p.phase === 'download' ? t('install.downloading', 'Downloading the server… {done} / {total}', { done: formatBytes(p.done), total: formatBytes(p.total) }) : p.phase === 'hash' ? t('import.hashing', 'Checking the zip…') : t('import.unpacking', 'Unpacking the repack… ({done}/{total} files)', { done: formatNumber(p.done), total: formatNumber(p.total) }))}</p>${p.phase === 'download' ? `<button class="button ghost small" data-action="install-cancel">${esc(t('update.cancel', 'Cancel'))}</button>` : ''}` : '';
    // The signed feed gives the server's sha256 and size: the launcher downloads and installs it itself.
    const direct = repack?.sha256 && repack?.bytes;
    const gameOk = !!s.client?.path;
    const packageVersion = (/\d+\.\d+(?:\.\d+)?/.exec(repack?.name || '') || [])[0] || repack?.release || '';
    //By leewheel 2026-11-05 老大要求：删除"安装服务器"和"我已经有服务器文件夹"两个按钮，
    // 完整整合包只从百度网盘下载；这里改成常驻引导文案，不再给在线安装/导入入口。
    const first = `<p class="status-line warn">请从百度网盘下载完整整合包</p><p class="muted small">解压后请保持 Client 与 Server 两个文件夹原样，再重新启动启动器。</p>`;
    //End By leewheel
    return `<div class="page classic home-page">${releaseBanner()}<section class="hero classic-hero"><div class="classic-main"><h1>${esc(t('home.title', 'My server'))}</h1><p class="status-line">${esc(direct ? t('assemble.noServer', 'No server yet: the launcher downloads our server (about 150 MB, without any game data), then takes the game data from your own client.') : t('home.noServer', 'No server yet: install the CoA repack with its bots in a few clicks, or show the folder of the one you have.'))}</p>
      ${direct ? `<ol class="setup-steps">
        <li class="${gameOk ? 'done' : 'current'}"><span class="step-num">${gameOk ? icon('check') : '1'}</span><div class="step-body"><strong>${esc(t('setup.game', 'Your game'))}</strong><small>${esc(gameOk ? s.client.path : t('setup.gameHint', 'The server takes its game data from your own CoA client.'))}</small></div><button class="button ${gameOk ? 'ghost small' : 'primary'}" data-action="client-locate">${icon('folder')}${esc(gameOk ? t('setup.change', 'Change') : t('setup.pickGame', 'Choose the game folder'))}</button></li>
        <li class="${gameOk ? 'current' : 'locked'}"><span class="step-num">2</span><div class="step-body">${first}${gameOk ? '' : `<small class="muted">${esc(t('setup.gameFirst', 'Choose your game folder first.'))}</small>`}</div></li>
      </ol>` : `<div class="button-row">${first}</div>`}
      </div></section><div class="fresh-extras">${feedNewsRow()}</div></div>`;
  }
  // A server without game data: prepared from the player's own client before anything else.
  const asm = info.assembly;
  if (asm?.applies && asm.needed) return `<div class="page classic home-page">${releaseBanner()}<section class="hero classic-hero"><div class="classic-main"><h1>${esc(t('home.title', 'My server'))}</h1>${assemblyCard(asm)}</div></section></div>`;
  const services = info.services || [];
  // CoA world stopped, one or more realms running on MySQL and the login: the server runs, with them.
  const realmsOn = (info.realmsOn || []).filter(realm => realm.state === 'running');
  const baseOn = ['mysql', 'auth'].every(id => services.find(service => service.id === id)?.state === 'running');
  const realmsOnly = realmsOn.length > 0 && baseOn && services.find(service => /world/i.test(service.id))?.state !== 'running';
  const running = services.filter(service => service.state === 'running').length;
  const moving = App.state.stoppingAll ? { state: 'stopping' } : App.state.startingAll ? { state: 'starting' } : services.find(service => service.state === 'starting' || service.state === 'stopping');
  const all = (services.length && running === services.length) || realmsOnly;
  const worldOn = services.some(service => /world/i.test(service.id) && service.state === 'running');
  const foreign = services.find(service => service.state === 'foreign');
  //By leewheel 2026-11-05 卡死由后端综合判定（RA 探测失败 + 世界日志停刷 + 持续 20 分钟）
  // 只要机器人日志还在刷，世界主循环就活着：控制台无应答只是 RA 通道的问题，
  // 既不能显示"它卡住了"，也不能禁用正常的"停止服务器"按钮。
  const busy = all && !realmsOnly && s.live?.running && s.live.consoleBusy;
  const stuck = busy && s.live.stuck;
  const waiting = busy && !s.live.worldAlive && !stuck;
  //End By leewheel
  const button = moving ? ['refresh', moving.state === 'starting' ? t('server.startingAll', 'Starting the server…') : t('server.stoppingAll', 'Stopping the server…'), '', 'busy']
    : stuck ? ['warning', t('home.forceStop', 'Force the world to stop'), 'world-force-stop', 'ready']
    : waiting ? ['refresh', t('home.botsCreating', 'Bots on the way…'), '', 'busy']
    // The big button follows the world: MySQL alone (a crash of the world, a database task) still offers to start.
    : worldOn || realmsOnly ? ['pause', t('home.stop', 'Stop the server'), 'service-stop-all', 'ready'] : ['play', t('home.start', 'Start the server'), 'service-start-all', 'update'];
  const status = App.state.stoppingAll ? t('server.stoppingAll', 'Stopping the server…') : App.state.startingAll ? t('server.startingAll', 'Starting the server…') : stuck ? t('home.stuckText', 'The world has not answered for {n} minutes: it is stuck. Force it to stop, then start the server again.', { n: Math.round((s.live.stuckFor || s.live.busyFor || 0) / 60000) })
    : waiting ? t('home.botsCreatingText', 'The server is creating its bots (about 10 minutes at a first start). Do not close it: it can be stopped as soon as it answers again.')
    : foreign ? t('home.foreign', '{name}: port {port} is taken by another program.', { name: foreign.name, port: foreign.port })
    // The address the players use: this PC, or the one given in "Who can join" when the server is open.
    : all ? t(realmsOnly ? 'home.runningRealms' : 'home.runningAt', realmsOnly ? 'Your server is running ({realms}). Players connect to {address}.' : 'Your server is running. Players connect to {address}.', { realms: realmsOn.map(realm => realmTitle(realm.key)).join(', '), address: `${s.network?.mode === 'open' ? s.network.address : '127.0.0.1'}${info.ports?.auth && info.ports.auth !== 3724 ? `:${info.ports.auth}` : ''}` }) : running ? t('server.partial', '{n} of {total} services running', { n: running, total: services.length }) : t('server.allStopped', 'The server is stopped');
  const v = s.verify;
  const verifyText = s.verifying ? t('verify.running', 'Checking…') : !v ? t('verify.never', 'Not checked yet') : v.summary.bad ? t('verify.bad', '{n} problem(s) to fix', { n: v.summary.bad }) : v.summary.warn ? t('verify.warn', '{n} point(s) to look at', { n: v.summary.warn }) : t('verify.ok', 'All good');
  const verifyState = !v ? '' : v.summary.bad ? 'bad' : v.summary.warn ? 'warn' : 'ok';
  const dash = s.dashboard;
  const lights = services.map(service => `<span class="mini-service"><span class="light ${service.state === 'running' ? 'on' : service.state === 'starting' || service.state === 'stopping' ? 'busy' : 'off'}"></span>${esc(/world/i.test(service.id) && App.state.realms?.available ? realmShort('coa') : service.name)}</span>`).join('')
    // A light for each realm whose world runs or starts.
    + (info.realmsOn || []).map(realm => `<span class="mini-service"><span class="light ${realm.state === 'running' && !App.state.stoppingAll ? 'on' : 'busy'}"></span>${esc(realmShort(realm.key))}</span>`).join('');
  // Something runs without the world (MySQL alone...): it can be stopped from here.
  //By leewheel 2026-11-05 老大要求：单机整合包不需要"创建/添加/切换服务器实例"入口，
  // 下拉只保留服务管理、备份和打开文件夹，删掉"创建新服务器""添加整合包文件夹""我的服务器"三项。
  const menu = [...(running && !worldOn && !realmsOnly ? [['service-stop-all', '', t('home.menuStopRest', 'Stop what is running ({n} of {total})', { n: running, total: services.length })]] : []), ['srv-tab', 'services', t('home.menuServices', 'Services one by one')], ['srv-tab', 'backups', t('srv.tab.backups', 'Backups')], ['server-folder', '', t('home.menuFolder', 'Open the server folder')]];
  //End By leewheel
  return `<div class="page classic home-page">${releaseBanner()}${asm?.applies ? clientBanner(asm) + mmapsBanner(asm.mmaps) : ''}${info.mmapsRestart ? `<div class="update-banner"><i class="dot"></i><span>${esc(t('assemble.mmapsRestart', 'The navigation maps of the bots are ready. Restart the server so it uses all of them.'))}</span><button class="button primary small" data-action="server-restart">${icon('refresh')}${esc(t('assemble.restart', 'Restart the server'))}</button></div>` : ''}
    <section class="hero classic-hero server-hero">${homeLinks()}
      <div class="classic-main">
        <h1>${esc(t('home.heroTitle', 'My server'))}</h1>
        ${launcherVersionLine()}
        <p class="status-line ${foreign ? 'bad' : ''}">${esc(status)}</p>
        ${startupFailView()}
        <div class="mini-services">${lights}</div>
        <div class="play-row"><div class="split-button ${button[3]}">
          <button class="split-main" data-action="${button[2]}" ${button[2] ? '' : 'disabled'} title="${esc(info.bots?.installed || info.botsBuiltIn ? t('home.withBots', 'Database, login, world and bots') : t('home.withoutBots', 'Database, login and world'))}">${icon(button[0])}<span><strong>${esc(button[1])}</strong><small>${esc(info.bots?.installed || info.botsBuiltIn ? t('home.withBots', 'Database, login, world and bots') : t('home.withoutBots', 'Database, login and world'))}</small></span></button>
          <button class="split-more" data-action="play-menu" aria-label="${esc(t('classic.more', 'More'))}">${icon('chevron')}</button>
          <div class="split-menu" id="play-menu" hidden>${menu.map(([action, id, label]) => `<button data-action="${action}" ${id ? `data-id="${id}"` : ''}>${esc(label)}</button>`).join('')}</div>
        </div>
        ${playButton()}
        ${registerButton()}
      </div>${App.state.addon?.clientTooNew ? `<p class="client-old">${icon('warning')}<span>${esc(t('home.clientTooNew', 'Your Ascension client is newer than this server handles ({file}): {note}', { file: App.state.addon.clientTooNew.file, note: App.state.addon.clientTooNew.note?.[App.state.settings.language] || App.state.addon.clientTooNew.note?.en || '' }))}</span></p>` : ''}${App.state.addon?.clientOutdated ? `<p class="client-old">${icon('warning')}<span>${esc(t('home.clientOld', 'Your Ascension client is not up to date ({file} is missing or old): open the official Ascension launcher once to update it (Manastorm needs it).', { file: App.state.addon.clientOutdated }))}</span></p>` : ''}
        <span class="chip classic-folder" title="${esc(info.path)}">${icon('folder')}<span>${esc(info.path)}</span></span>
      </div>
      <aside class="classic-side">${updateCard()}${componentCards()}
        <button class="side-card" ${s.update?.state?.state === 'available' ? 'data-action="update-open"' : 'data-tab="verify"'}>${icon('layers')}<span><strong>${esc(t('home.core', 'Core'))}</strong><small>${esc(info.lastUpdate?.version ? t('home.updatedTo', '已更新 {v}', { v: prettyUpdateVersion(info.version || info.lastUpdate.version) }) : (prettyUpdateVersion(info.version || info.details?.release || '') || '—'))}</small></span>${s.config.hasUpdates ? `<span class="card-tool" role="button" data-action="update-check" title="${esc(t('settings.checkRepack', 'Check for a repack and bots update'))}">${icon('refresh')}</span>` : ''}${s.updates.core || s.update?.state?.state === 'available' ? '<i class="dot"></i>' : icon('next')}</button>
        <button class="side-card" data-tab="verify">${icon('bot')}<span><strong>${esc(t('home.botsCard', 'Bots'))}</strong><small>${esc(info.bots?.installed ? `${info.bots.version}${info.bots.builtFor ? ` · ${shortRelease(info.bots.builtFor)}` : ''}` : info.botsBuiltIn ? `${t('bots.builtin', 'Built into the core')}${info.botVersion ? ` · v${info.botVersion}` : ''}` : t('bots.notInstalled', 'Not installed'))}</small></span><span class="card-tool" role="button" data-action="srv-tab" data-id="settings" title="${esc(t('srv.tab.settings', 'Server settings'))}">${icon('settings')}</span>${s.updates.bots ? '<i class="dot"></i>' : icon('next')}</button>
        <button class="side-card verify-card ${verifyState}" data-tab="verify">${icon('shield')}<span><strong>${esc(t('tab.verify', 'Verification'))}</strong><small>${esc(verifyText)}</small></span>${icon('next')}</button>
        ${addonCard()}
        <button class="side-card" ${dash?.available ? `data-action="${dash.running ? 'dashboard-open' : 'dashboard-start'}"` : 'disabled'}>${icon('chart')}<span><strong>${esc(t('home.dashboard', 'Bots dashboard'))}</strong><small>${esc(!dash?.available ? t('home.dashboardMissing', '需要 Runtime\\python 与 CoA-Bots：更新一次就会出现') : dash.running ? t('home.dashboardOpen', 'Running on localhost:{port}: open it', { port: dash.port }) : t('home.dashboardStart', 'Map, bots, stats, chat: start it'))}</small></span>${icon('next')}</button>
        <button class="side-card" data-action="network-open">${icon('globe')}<span><strong>${esc(t('net.card', 'Who can join'))}</strong><small>${esc(s.network?.mode === 'open' ? t('net.cardOpen', 'Other PCs: {address}', { address: s.network.address }) : t('net.cardLocal', 'This PC only'))}</small></span>${icon('next')}</button>
      </aside>
    </section>
    ${feedNewsRow(false)}
    ${!App.state.feed?.news?.length && (s.news || []).filter(item => item.area !== 'client').length ? `<section class="news-row"><h2>${esc(t('classic.news', 'Latest news'))}</h2><div class="news-grid">${newsCards((s.news || []).filter(item => item.area !== 'client'))}</div></section>` : ''}
    ${freeBannerView()}
    ${logPanelView()}
  </div>`;
}

//By leewheel 2026-11-04 主页 hero 与日志窗口之间的空档：一条免费声明横幅。
// 视觉走 HUD 风：网格底纹 + 扫描光带 + 四角括号 + 霓虹辉光，样式在 css/coa.css 的 .free-banner 段。
//By leewheel 2026年11月6日 老大要求：不要文本，但要把文字**渲染**出来。
// 所以文案彻底退出代码——现在只有两张透明 PNG（assets/notice-free.png、assets/notice-meta.png），
// 源码里搜不到任何字样；canvas 只负责把图片按画布高度缩放后绘制，再叠杂波特效。
// 说明：图片当然能被人看见，但改它需要重新打包 asar，而 asar 有完整性校验——改过的启动器起不来。
//By leewheel 2026年11月7日 老大改了免费声明文案，并且要求**字体放大、杂波干扰的大小也随机**。
// 文案不进源码明文：仍是 base64，运行时解码后用 canvas 画字（不再用固定 PNG，字号才能放大、才能按宽度自适应）。
//By leewheel 2026年11月10日 老大再改文案：去掉原来的“来自虚空风暴的信息：”抬头，并追加“倒卖狗天天踩狗屎！”。
const FREE_NOTICE_B64 = '5pys5qih5ouf5Zmo5a6M5YWo5YWN6LS577yM6Iqx6ZKx6LSt5Lmw55qE6YO95piv5YK76YC8IeWAkuWNlueLl+WkqeWkqei4qeeLl+Wxju+8gQ==';
let freeNoticeTextCache = '';
function freeNoticeText() {
  if (freeNoticeTextCache) return freeNoticeTextCache;
  try {
    const bytes = Uint8Array.from(atob(FREE_NOTICE_B64), char => char.charCodeAt(0));
    freeNoticeTextCache = new TextDecoder('utf-8').decode(bytes);
  } catch { freeNoticeTextCache = ''; }
  return freeNoticeTextCache;
}
const freeNoticeArt = { text: null, meta: null };
// 保留旧的图片加载函数签名（别的地方可能引用），实际不再用它画字
function loadFreeNoticeArt() {
  if (!freeNoticeArt.meta) freeNoticeArt.meta = 'assets/notice-meta.png';
}
function drawFreeNotice() {
  const canvas = document.getElementById('free-notice-canvas');
  const holder = canvas?.parentElement;
  if (!canvas || !holder) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(240, holder.clientWidth || 640);
  //By leewheel 2026年11月7日 字号放大：横幅高 40，字高按高度 56% 取（比原来的 26px 图大一档）
  const height = 40;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paintFreeNotice(ctx, ratio, width, height, performance.now());
  startFreeNoticeGlitch();
}

//By leewheel 2026年11月10日 右侧“设备铭牌”原来是一张写死的 PNG（assets/notice-meta.png：
// “OFFLINE 无授权校验 禁止倒卖”），老大要求换成「只有用爱发电的可以这样说，阴阳怪气把用爱发电理所当然的人没资格」，
// 并且允许排成两行。改法跟左侧一致：文案 base64 解码后用 canvas 画字（源码里不留明文），
// 换行由文案里的 \n 决定，字号按容器实际宽度自动收缩，绝不越过左边那条竖线。
// 注意：文案里必须自带 \n，canvas 的 fillText 不认换行符，这里按行拆开逐行画。
//By leewheel 2026年11月10日 文案改成「只有用爱发电的可以这样说／阴阳怪气把用爱发电／理所当然的人没资格」三行：
// 这一句比原来长得多，铭牌只有 200px 宽（扣掉左边竖线的 padding 剩 184），
// 所以除了按宽度缩字号，还得按**高度**缩 —— 40px 高的版面放三行，13px 会顶出上下边界。
// 断句按语义切（“只有用爱发电的可以这样说”／“阴阳怪气把用爱发电”／“理所当然的人没资格”），不是硬按字数折。
const FREE_META_B64 = '5Y+q5pyJ55So54ix5Y+R55S155qE5Y+v5Lul6L+Z5qC36K+0CumYtOmYs+aAquawlOaKiueUqOeIseWPkeeUtQrnkIbmiYDlvZPnhLbnmoTkurrmsqHotYTmoLw=';
let freeMetaTextCache = '';
function freeMetaText() {
  if (freeMetaTextCache) return freeMetaTextCache;
  try {
    const bytes = Uint8Array.from(atob(FREE_META_B64), char => char.charCodeAt(0));
    freeMetaTextCache = new TextDecoder('utf-8').decode(bytes);
  } catch { freeMetaTextCache = ''; }
  return freeMetaTextCache;
}
function drawFreeMeta() {
  const canvas = document.getElementById('free-notice-meta-canvas');
  if (!canvas?.parentElement) return;
  const ratio = window.devicePixelRatio || 1;
  const height = 40;
  // 宽度取画布在版面上的真实宽度（CSS 给了 100%），拿不到就退回默认铭牌宽 184
  const width = Math.max(120, Math.round(canvas.getBoundingClientRect().width) || 184);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const text = freeMetaText();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!text) return;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return;
  const fontOf = size => `600 ${size}px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`;
  const widest = size => {
    ctx.font = fontOf(size);
    return Math.max(...lines.map(line => ctx.measureText(line).width));
  };
  // 字号 13 起试，最宽那行放不下就按比例缩（最小 9px，再小在 100% 缩放下会糊）
  let fontSize = 13;
  const limit = width - 2;
  const measured = widest(fontSize);
  if (measured > limit) fontSize = Math.max(9, Math.floor(fontSize * (limit / measured)));
  //By leewheel 2026年11月10日 竖向也得放得下：行数 × 行高不能超过 40px 的版面，
  // 否则第一行/最后一行会被裁掉一半（3 行 13px 就是 51px）。按可用高度一档一档回缩，最低 9px。
  const fitsHeight = size => Math.floor(height / (size * 1.28)) >= lines.length;
  while (fontSize > 9 && !fitsHeight(fontSize)) fontSize -= 1;
  ctx.font = fontOf(fontSize);
  const lineHeight = Math.round(fontSize * 1.28);
  const start = (height - lineHeight * lines.length) / 2 + lineHeight / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 229, 255, .55)';
  ctx.shadowBlur = 6;
  lines.forEach((line, index) => {
    // 第一行稍亮、第二行略淡：两行文字不至于糊成一坨
    ctx.fillStyle = index === 0 ? 'rgba(126, 243, 255, .88)' : 'rgba(126, 243, 255, .74)';
    ctx.fillText(line, width / 2, start + index * lineHeight);
  });
  ctx.shadowBlur = 0;
}

//By leewheel 2026年11月6日 老大要求保留“杂波干扰”特效：canvas 里按帧重画——随机色散重影、
// 横向切片错位、扫描噪点、亮度闪烁，节奏沿用原来 CSS 的两组 glitch（3.7s / 4.3s）+ 6.5s 闪一下。
//By leewheel 2026年11月7日 干扰大小也要随机：切片厚度/位移、噪点块尺寸、色散偏移全部 rand 化，不再是固定像素。
// 关掉系统动画偏好（prefers-reduced-motion）时只画一帧静态。
let freeNoticeRaf = 0;
let freeNoticeStatic = false;
function paintFreeNotice(ctx, ratio, width, height, now) {
  const text = freeNoticeText();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!text) return;
  const clock = now / 1000;
  const flicker = !reduced && clock % 6.5 > 6.34;
  const middle = height / 2;
  // 字号：先按高度定，再按可用宽度收缩，保证长文案放得下
  let fontSize = Math.max(16, Math.round(height * 0.56));
  const fontOf = size => `700 ${size}px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`;
  ctx.font = fontOf(fontSize);
  const limit = width - 28;
  const measured = ctx.measureText(text).width;
  if (measured > limit) {
    fontSize = Math.max(11, Math.floor(fontSize * (limit / measured)));
    ctx.font = fontOf(fontSize);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 两组独立的 glitch 节奏：各自每 period 触发一次，持续 duration；幅度随机
  const burst = (period, duration, range) => {
    const phase = clock % period;
    if (reduced || phase > duration) return 0;
    return (Math.random() * 2 - 1) * range;
  };
  const shiftA = burst(3.7, 0.16, 1.6 + Math.random() * 3.4);
  const shiftB = burst(4.3, 0.13, 1.2 + Math.random() * 2.8);
  const centerX = width / 2 + shiftA * 0.6;
  // 色散重影：红/青各一层（偏移量随机）
  const chroma = 1 + Math.random() * 2.2;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = 'rgba(255,60,120,.9)';
  ctx.fillText(text, centerX + chroma + shiftA, middle + 0.4 + shiftB * 0.3);
  ctx.fillStyle = 'rgba(0,229,255,.9)';
  ctx.fillText(text, centerX - chroma - shiftB, middle - 0.4 - shiftA * 0.3);
  // 主体：霓虹辉光 + 每 6.5 秒一次亮度跳动
  ctx.globalAlpha = flicker ? 0.55 : 1;
  ctx.shadowColor = 'rgba(0,229,255,.8)';
  ctx.shadowBlur = 12 + Math.random() * 8;
  ctx.fillStyle = '#eafcff';
  ctx.fillText(text, centerX, middle);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  if (reduced) return;
  // 横向切片错位：厚度与位移都随机（1~14px 厚、最多 ±14px 位移）
  const slices = 1 + Math.floor(Math.random() * 3);
  for (let index = 0; index < slices; index++) {
    if (Math.random() > 0.42) continue;
    const top = Math.random() * height;
    const band = 1 + Math.random() * 13;
    const dx = (Math.random() * 2 - 1) * 14;
    try {
      ctx.drawImage(ctx.canvas, 0, top * ratio, width * ratio, band * ratio, dx, top, width, band);
    } catch { /* 画布还没准备好就跳过这一条 */ }
  }
  // 扫描噪点：块尺寸随机（1~6px 高、4~60px 宽），数量也随机
  const specks = 4 + Math.floor(Math.random() * 14);
  for (let index = 0; index < specks; index++) {
    const y = Math.random() * height;
    const x = Math.random() * width;
    const w = 4 + Math.random() * 56;
    const h = 1 + Math.random() * 5;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(126,243,255,.32)' : 'rgba(255,60,120,.22)';
    ctx.fillRect(x, y, w, h);
  }
}
function startFreeNoticeGlitch() {
  freeNoticeStatic = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (freeNoticeStatic || freeNoticeRaf) return;
  let lastPaint = 0;
  const step = now => {
    const canvas = document.getElementById('free-notice-canvas');
    if (!canvas) { freeNoticeRaf = 0; return; }           // 离开主页就停，别留后台循环
    // 约 20 帧/秒就够了：像老电视的干扰，也不用一直吃 GPU
    if (now - lastPaint >= 48) {
      lastPaint = now;
      const ratio = window.devicePixelRatio || 1;
      const ctx = canvas.getContext('2d');
      if (ctx) paintFreeNotice(ctx, ratio, canvas.width / ratio, canvas.height / ratio, now);
    }
    freeNoticeRaf = requestAnimationFrame(step);
  };
  freeNoticeRaf = requestAnimationFrame(step);
}

function freeBannerView() {
  return `<section class="free-banner" id="free-banner" role="note" aria-label="free">
    <span class="fb-scan" aria-hidden="true"></span>
    <span class="fb-corner tl" aria-hidden="true"></span>
    <span class="fb-corner tr" aria-hidden="true"></span>
    <span class="fb-corner bl" aria-hidden="true"></span>
    <span class="fb-corner br" aria-hidden="true"></span>
    <span class="fb-badge" aria-hidden="true"><b>FREE</b><small>¥0.00</small></span>
    <span class="fb-text"><canvas id="free-notice-canvas" class="fb-canvas" aria-hidden="true"></canvas></span>
    <span class="fb-meta" id="free-notice-meta" aria-hidden="true"><canvas id="free-notice-meta-canvas" class="fb-meta-canvas"></canvas></span>
  </section>`;
}

//By leewheel 2026-11-03 主页下半部分的半透明日志窗口：直接看 worldserver 在干什么（加载数据、生成机器人、报错）。
// 世界服是最后才开端口的，加载/生成机器人要好几分钟，只靠状态灯分不清"在忙"还是"卡死"。
function logPanelView() {
  const log = App.state.serverLog;
  const lines = log?.lines || [];
  const stamp = log?.mtime ? new Date(log.mtime).toLocaleTimeString('zh-CN', { hour12: false }) : '';
  const size = log?.size ? `${(log.size / 1024).toFixed(0)} KB` : '';
  const staleText = log && (log.lines || []).length && !log.running
    ? t('log.stale', '服务器当前没有在运行：下面是上一次运行留下的日志（最后写入 {time}）。启动服务器后才会继续更新。', { time: stamp })
    : '';
  const body = lines.length ? esc(lines.join('\n')) : esc(t('log.empty', '（还没有日志：服务器没启动，或者日志文件是空的）'));
  //By leewheel 2026-11-03 日志窗口可以切换：主服 + 每个已经建好的国度
  const realmList = (App.state.realms?.realms || []).filter(realm => realm.state !== 'absent');
  const current = App.state.logRealm || '';
  const picker = realmList.length
    ? `<select class="log-picker" id="log-realm" title="${esc(t('log.pick', '看哪个世界服的日志'))}">
        <option value=""${current === '' ? ' selected' : ''}>${esc(t('log.main', 'CoA（主服）'))}</option>
        ${realmList.map(realm => `<option value="${esc(realm.key)}"${current === realm.key ? ' selected' : ''}>${esc(realmShort(realm.key))}${realm.state === 'running' ? ' ●' : ''}</option>`).join('')}
      </select>`
    : '';
  return `<section class="log-panel" id="log-panel">
    <header class="log-head">
      <span class="log-title">${icon('terminal')}${esc(t('log.title', '世界服日志'))}</span>
      ${picker}
      <span class="log-meta">${esc(t('log.meta', '{file} · {size} · 更新于 {time}', { file: 'Server.log', size, time: stamp }))}</span>
      <span class="spacer"></span>
      <button class="button ghost small" data-action="log-refresh">${icon('refresh')}${esc(t('log.refresh', '刷新'))}</button>
      <button class="button ghost small" data-action="log-toggle">${esc(t('log.toggle', '收起'))}</button>
    </header>
    <p class="log-stale" id="log-stale" ${staleText ? '' : 'hidden'}>${icon('info')}<span id="log-stale-text">${esc(staleText)}</span></p>
    <pre class="log-body" id="server-log-body">${body}</pre>
  </section>`;
}

let logTimer = 0;
async function refreshServerLog() {
  if (App.state.tab !== 'home' || !App.state.server?.path) return;
  let data = null;
  try { data = await App.api.serverLog(App.state.logRealm || '', 240); } catch { return; }
  App.state.serverLog = data;
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const head = panel.querySelector('.log-meta');
  if (head && data) {
    const stamp = data.mtime ? new Date(data.mtime).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    head.textContent = t('log.meta', '{file} · {size} · 更新于 {time}', { file: 'Server.log', size: data.size ? `${(data.size / 1024).toFixed(0)} KB` : '', time: stamp });
  }
  const body = document.getElementById('server-log-body');
  if (body) {
    //By leewheel 2026-11-03 滚动修复（滚动条不再上下闪烁跳跃）：
    // 旧循环 = 整页 App.render() 每 5~15 秒重建一次面板（scrollTop 归零＝跳上去）→
    // mount→startServerLog 无条件 logFollowed=false → 下一次 refresh 判定"首次"又拉回底部
    // （跳下去）→ 循环往复。现在改为：
    // 1) 跟随状态由 scroll 事件实时维护：在底部（gap<32px）=跟随，往上翻=不跟随；
    // 2) 重渲染重建面板后，跟随状态下立即吸底，非跟随状态恢复用户上次的位置，两头都不跳；
    // 3) 只在切换国度时重置跟随状态，不再随每次 mount 重置。
    if (!body.dataset.scrollBound) {
      body.dataset.scrollBound = '1';
      body.addEventListener('scroll', () => {
        const gap = body.scrollHeight - body.scrollTop - body.clientHeight;
        App.state.logFollowed = gap < 32;
        if (!App.state.logFollowed) App.state.logScrollTop = body.scrollTop;
      });
    }
    if ((App.state.logFollowedRealm || '') !== (App.state.logRealm || '')) { App.state.logFollowed = false; App.state.logFollowedRealm = App.state.logRealm || ''; }
    const firstTime = App.state.logFollowed === undefined;
    const text = (data?.lines || []).length ? data.lines.join('\n') : t('log.empty', '（还没有日志：服务器没启动，或者日志文件是空的）');
    body.textContent = text;
    if (App.state.logFollowed || firstTime) { body.scrollTop = body.scrollHeight; if (firstTime) App.state.logFollowed = true; }
    else if (App.state.logScrollTop) body.scrollTop = Math.min(App.state.logScrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
  }
  //By leewheel 2026-11-03 服务器没在跑时要说明"这是上次的日志"，否则玩家以为日志在自己动
  const stale = document.getElementById('log-stale');
  if (stale && data) {
    const stampText = data.mtime ? new Date(data.mtime).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    const text = (data.lines || []).length && !data.running
      ? t('log.stale', '服务器当前没有在运行：下面是上一次运行留下的日志（最后写入 {time}）。启动服务器后才会继续更新。', { time: stampText })
      : '';
    stale.hidden = !text;
    const span = document.getElementById('log-stale-text');
    if (span) span.textContent = text;
  }
}
function startServerLog() {
  stopServerLog();
  //By leewheel 2026-11-03 只在切换国度时重置跟随状态：mount 会随整页重渲染反复执行，
  // 原来这里无条件 logFollowed=false，配合重渲染就是"跳上去又拉到底"的闪烁循环。
  // 面板重建后内容还在（logPanelView 用 App.state.serverLog 渲染），跟随状态先立即吸底，等 refresh 接手。
  if ((App.state.logFollowedRealm || '') !== (App.state.logRealm || '')) { App.state.logFollowed = false; App.state.logFollowedRealm = App.state.logRealm || ''; }
  const body = document.getElementById('server-log-body');
  if (body && (App.state.logFollowed || App.state.logFollowed === undefined)) body.scrollTop = body.scrollHeight;
  refreshServerLog();
  logTimer = setInterval(refreshServerLog, 2500);
}
function stopServerLog() { if (logTimer) { clearInterval(logTimer); logTimer = 0; } }

// The feed announces a repack whose release differs from the one installed here.
// Play: the game client of this PC. Dimmed while no game folder is known; a click then asks for it.
function playButton() {
  const client = App.state.addon?.client;
  return `<button class="play-game${client ? '' : ' unset'}" data-action="game-play" title="${esc(client ? t('home.playIn', 'Start the game: {path}', { path: client }) : t('home.playPick', 'Choose your game folder (the one with Ascension.exe), then play'))}">${icon('play')}<span>${esc(t('home.play', 'Play'))}</span></button>`;
}
App.actions['game-play'] = button => guard(async () => {
  const info = App.state.server;
  const world = info?.services?.find(service => /world/i.test(service.id));
  const startServer = !!info?.installed && !!world && world.state !== 'running' && !(info.realmsOn || []).length;
  if (startServer) toast(t('home.playStarting', 'The server starts first; the game opens as soon as the world is ready (a few minutes).'));
  const result = await App.api.gamePlay({ startServer });
  if (!result?.started) return;
  toast(t('home.playStarted', 'The game is starting.'), 'success');
  if (typeof refreshAddon === 'function') refreshAddon(true);
}, button);

//By leewheel 2026年11月10日 老大要求：主页加「注册账号」按钮，一点就跳到注册页。
// 本机服务器的「注册」就是创建进游戏用的账号（世界控制台的 account create），
// 所以做成弹窗：不用离开主页，也不用翻进「本机服务器 → 设置」里找那个表单。
function registerButton() {
  return `<button class="button ghost register-account" data-action="account-register" title="${esc(t('home.registerHint', 'Create the account you log in with'))}">${icon('user')}<span>${esc(t('home.register', 'Register'))}</span></button>`;
}

// 注册页：账号名 + 密码 + 可选 GM。建号要写数据库，world 必须先在跑。
function registerFormHtml(running) {
  if (!running) {
    return `<p class="status-line">${icon('warning')}<span>${esc(t('register.needServer', 'The server has to run to create an account: the account is written into its database.'))}</span></p>
      <p class="muted small">${esc(t('register.needServerHint', 'Use the "Start the server" button below, then open this page again once it runs (a first start takes a few minutes).'))}</p>`;
  }
  return `<form id="register-form" class="form-grid register-form" autocomplete="off">
    <input id="rg-name" maxlength="17" autocomplete="off" spellcheck="false" placeholder="${esc(t('register.namePh', 'Account name, 3 to 17 characters'))}">
    <input id="rg-password" type="password" maxlength="16" autocomplete="new-password" placeholder="${esc(t('register.passwordPh', 'Password'))}">
    <label class="check"><input type="checkbox" id="rg-gm" class="ga-gm"><span>${esc(t('server.gm', 'Game master'))}</span></label>
    <button class="button primary" type="submit">${icon('check')}${esc(t('server.create', 'Create'))}</button>
  </form>`;
}

function showAccountRegister() {
  const running = !!App.state.live?.running;
  dialog.open(`${dialog.header(t('register.title', 'Create an account'), t('register.subtitle', 'This is the account you log in with, in the game.'))}
    <div class="dialog-content register-dialog">${registerFormHtml(running)}</div>
    <footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.close', 'Close'))}</button>${running ? '' : `<button class="button primary" data-action="account-register-start">${icon('play')}${esc(t('register.startServer', 'Start the server'))}</button>`}</footer>`, 'form');
  const form = $('#register-form');
  if (form) form.addEventListener('submit', event => { event.preventDefault(); createGameAccountFromForm(form); });
  setTimeout(() => $('#rg-name')?.focus(), 30);
}

async function createGameAccountFromForm(form) {
  const button = form.querySelector('[type=submit]');
  const name = String($('#rg-name')?.value || '').trim();
  const password = String($('#rg-password')?.value || '');
  if (!/^\S{3,17}$/.test(name)) { toast(t('register.badName', 'The account name is 3 to 17 characters, without spaces.'), 'warning'); $('#rg-name')?.focus(); return; }
  if (!password) { toast(t('register.badPassword', 'Type a password.'), 'warning'); $('#rg-password')?.focus(); return; }
  await guard(async () => {
    // 世界控制台满载（几百个机器人）时要十几秒才回话：先说一声，别让人以为点了没反应。
    toast(t('register.creating', 'Creating the account…'));
    const output = await App.api.createGameAccount(name, password, !!$('#rg-gm')?.checked);
    dialog.close();
    toast(output || t('server.accountCreated', 'Account {name} created.', { name: name.toUpperCase() }), 'success');
  }, button);
}

App.actions['account-register'] = () => guard(async () => {
  // 主页的读数每 10 秒刷一次：可能还没读到，点开前先取一次，免得明明在跑却说没运行。
  if (!App.state.live) { try { App.state.live = await App.api.liveStats(); } catch { App.state.live = null; } }
  showAccountRegister();
});
App.actions['account-register-start'] = () => { dialog.close(); App.actions['service-start-all']?.(); };

// News written by the realm owner in the feed (feed.json on the download server).
//By leewheel 2026年11月5日 “机器人帮助”已挪到“检查”页的“机器人”标题旁（内容内嵌），这里不再放入口。
function homeLinks() {
  return `<span class="news-links">${App.state.feed?.discord?.invite ? `<button class="link-button" data-action="feed-open" data-kind="discord">${icon('discord')}${esc(t('home.discordJoin', 'Join the Discord'))}</button>` : ''}</span>`;
}

function feedNewsRow(links = true) {
  const notes = App.state.notes || [];
  const news = notes.length ? notes : App.state.feed?.news || [];
  if (!news.length) return '';
  const title = esc(notes.length ? t('home.lastPatch', 'Last patch note') : t('home.announcements', 'News'));
  const discord = links ? homeLinks() : '';
  return `<section class="news-row">${discord}<div class="news-live"><div class="news-grid one">${news.slice(0, 1).map((item, index) => `<article class="news-card ${notes.length ? 'bots' : 'news'}" data-action="${notes.length ? 'note-open' : 'feed-news'}" data-index="${index}" tabindex="0" role="button"><div class="news-art"><h2>${title}</h2>${icon(notes.length ? 'bot' : 'book')}</div><div class="news-text"><small>${esc(item.date)}</small><strong>${esc(item.title)}</strong><p>${esc(item.summary || item.text)}</p></div></article>`).join('')}</div>${liveView()}</div></section>`;
}

// ---------------------------------------------------------------- live state of the server (home)
function liveView() {
  const l = App.state.live;
  if (!App.state.server?.installed) return '';
  // The server info arrived after the first reading: read now rather than in 10 s.
  if (l === undefined) setTimeout(refreshLive, 0);
  const tile = (iconName, label, value, hint = '') => `<div class="live-tile">${icon(iconName)}<span><small>${esc(label)}</small><strong>${esc(value)}</strong>${hint ? `<em>${esc(hint)}</em>` : ''}</span></div>`;
  if (!l?.running) return `<section class="live"><h3>${esc(t('live.title', 'Server live'))}</h3><p class="muted">${esc(t('live.stopped', 'The figures appear here while the server runs: players, bots, tick and memory.'))}</p></section>`;
  const dash = value => (value === null || value === undefined ? '—' : value);
  const tick = l.tickMean ?? l.tick;
  // Bots still logging in (fewer than the number set): the server is slower meanwhile, and that is expected.
  const arriving = l.bots?.target && l.bots.count < Math.floor(l.bots.target * 0.95);
  if (!arriving) App.state.waitClosed = false;
  return `<section class="live"><h3>${esc(t('live.title', 'Server live'))}${l.realmOnly && !l.realms ? `<span class="live-realms">${realmEmblem(l.realmOnly, 16)}${esc(realmTitle(l.realmOnly))}</span>` : ''}${l.realms ? `<span class="live-realms">${icon('globe')}${esc(t('live.allRealms', 'All {n} realms: {players} players · {bots} bots in game', { n: l.realms.count, players: l.realms.players, bots: l.realms.bots }))}</span>` : ''}${arriving ? `<span class="live-arriving" title="${esc(t('live.arrivingHint', 'While they log in, the server is slower (high tick): this is normal. Wait a few minutes until all of them are there.'))}">${icon('bot')}${esc(t('live.arrivingTitle', 'The bots are arriving in your realm: {count} / {target}', { count: l.bots.count, target: l.bots.target }))}${progressBar({ total: l.bots.target, completed: l.bots.count }).html}</span>` : ''}</h3><div class="live-body"><div class="live-grid">
    ${tile('user', t('live.players', 'Players'), dash(l.players))}
    ${tile('bot', t('live.bots', 'Bots in game'), l.bots ? String(l.bots.count) : '—', l.bots && Number.isFinite(l.bots.inCombat) ? t('live.inCombat', '{n} in combat', { n: l.bots.inCombat }) : '')}
    ${tile('refresh', t('live.tick', 'Tick'), tick === null || tick === undefined ? '—' : `${tick} ms`, arriving && tick > 150 ? t('live.tickLoading', 'bots arriving') : tick > 150 ? t('live.tickSlow', 'slow') : tick !== null && tick !== undefined ? t('live.tickOk', 'smooth') : '')}
    ${tile('database', t('live.memory', 'Memory'), l.memory ? formatBytes(l.memory) : '—')}
    ${tile('play', t('live.uptime', 'Up for'), uptimeSeconds(l.uptime) ? formatCompactDuration(uptimeSeconds(l.uptime)) : '—')}
    ${tile('bug', t('live.crashes', 'Crashes (7 days)'), l.crashes ? String(l.crashes.count) : '—', l.crashes?.last ? t('live.lastCrash', 'last: {date}', { date: formatDate(l.crashes.last, true) }) : l.crashes ? t('live.noCrash', 'none') : '')}
  </div>${homeAccount()}</div>${arriving && !App.state.waitClosed ? `<p class="live-wait live-toast">${icon('info')}<span>${esc(t('live.waitLogin', 'Wait a little before logging in: the server is bringing its bots into the world. The game is slower until they are all there.'))}</span><button class="icon-button" data-action="live-wait-close" title="${esc(t('common.close', 'Close'))}">${icon('close')}</button></p>` : ''}</section>`;
}

// "Server uptime: 1 Day(s) 2 Hour(s) 5 Minute(s) 3 Second(s)" from the world console, in seconds.
function uptimeSeconds(text) {
  const units = { day: 86400, hour: 3600, minute: 60, second: 1 };
  let total = 0;
  for (const [, n, unit] of String(text || '').matchAll(/(\d+)\s*(day|hour|minute|second)/gi)) total += Number(n) * units[unit.toLowerCase()];
  return total;
}

// Read every 10 s while the home page is shown, and at once when it opens.
let liveBusy = false;
// The first login, on the home page: the account to create, then where to log in (the full form stays in Management).
function homeAccount() {
  return `<div class="live-account"><strong>${icon('user')}${esc(t('server.account', 'Game account'))}</strong>
    <p class="muted small">${esc(t('home.accountHint', 'Create your game accounts here.'))}</p>
    <form id="home-account" class="home-account-form"><input id="ha-name" maxlength="17" placeholder="${esc(t('server.accountName', 'Account name'))}" autocomplete="off"><input id="ha-password" type="password" maxlength="16" placeholder="${esc(t('server.password', 'Password'))}" autocomplete="new-password"><label class="check"><input type="checkbox" class="ga-gm"><span>${esc(t('server.gm', 'Game master'))}</span></label><button class="button primary small" type="submit">${esc(t('server.create', 'Create'))}</button></form></div>`;
}

App.actions['live-wait-close'] = () => { App.state.waitClosed = true; document.querySelector('.live-toast')?.remove(); };

async function refreshLive() {
  if (liveBusy || App.state.tab !== 'home' || !App.state.server?.installed || document.hidden) return;
  liveBusy = true;
  try { App.state.live = await App.api.liveStats(); } catch { App.state.live = null; }
  liveBusy = false;
  if (App.state.tab !== 'home' || $('#dialog').open || document.querySelector('.split-menu:not([hidden])')) return;
  // An account being typed is kept: only the figures are redrawn.
  const form = $('#home-account');
  // (A checkbox always has a value: only the text fields count.)
  const typing = form && (form.contains(document.activeElement) || [...form.querySelectorAll('input:not([type=checkbox])')].some(input => input.value));
  const live = $('section.live');
  if (typing && live && App.state.live?.running) {
    // The figures, the title with the bots arriving and the wait notice are redrawn; the account card stays.
    const fresh = document.createElement('div');
    fresh.innerHTML = liveView();
    for (const part of ['h3', '.live-grid']) { const next = fresh.querySelector(`section.live ${part}`); const now = live.querySelector(part); if (next && now) now.replaceWith(next); }
    const toast = fresh.querySelector('.live-toast');
    live.querySelector('.live-toast')?.remove();
    if (toast) live.append(toast);
    if (typeof applyBars === 'function') applyBars(live);
  } else App.render();
}
setInterval(refreshLive, 10000);
setTimeout(refreshLive, 1500);

// ---------------------------------------------------------------- console
App.state.consoleLog = [];
const CONSOLE_QUICK = ['server info', 'account onlinelist', 'saveall', 'playerbots rndbot stats'];
// The console page: the server commands, or SQL on the repack databases (for what the support asks).
function consoleTabs() {
  const mode = App.state.consoleMode || 'commands';
  return `<nav class="subtabs console-modes">${[['commands', 'terminal', t('console.modeCommands', 'Server commands')], ['sql', 'database', t('console.modeSql', 'SQL')]].map(([id, iconName, label]) => `<button class="subtab${mode === id ? ' active' : ''}" data-action="console-mode" data-id="${id}">${icon(iconName)}<span>${esc(label)}</span></button>`).join('')}</nav>`;
}
App.state.sql = { query: '', allow: false, results: null, error: '', busy: false };
const SQL_QUICK = [
  ['console.sqlManastorm', 'Check Manastorm', 'SELECT guid, id, map FROM acore_world.gameobject WHERE guid IN (6901535, 6901536);\nSELECT * FROM acore_world.manastorm_hub_return;'],
  ['console.sqlRealms', 'Realms', 'SELECT id, name, address, port, flag FROM acore_auth.realmlist;'],
  ['console.sqlAccounts', 'Accounts', 'SELECT id, username, last_login FROM acore_auth.account WHERE username NOT LIKE \'RNDBOT%\' ORDER BY id;'],
];
function sqlView() {
  const q = App.state.sql;
  const table = result => `<div class="sql-result"><code class="console-cmd">${esc(result.statement.slice(0, 160))}</code>${result.columns.length ? `<div class="sql-table-wrap"><table class="sql-table"><thead><tr>${result.columns.map(col => `<th>${esc(col)}</th>`).join('')}</tr></thead><tbody>${result.rows.map(row => `<tr>${row.map(cell => `<td class="${cell === null ? 'null' : ''}">${esc(cell === null ? 'NULL' : cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><small class="muted">${esc(t('console.sqlRows', '{n} row(s)', { n: result.total }))}${result.total > result.rows.length ? ` · ${esc(t('console.sqlFirst', 'first {n} shown', { n: result.rows.length }))}` : ''}</small>` : `<small class="muted">${esc(result.changed === null || result.changed === undefined ? t('console.sqlDone', 'Done (no rows returned).') : t('console.sqlChanged', 'Done: {n} row(s) changed.', { n: result.changed }))}</small>`}</div>`;
  const results = q.error ? `<pre class="bad">${esc(q.error)}</pre>` : q.results ? `${q.results.backup ? `<p class="muted small">${icon('database')}${esc(t('console.sqlBackup', 'A backup was made first: {name} (Management > Backups).', { name: q.results.backup }))}</p>` : ''}${q.results.results.map(table).join('')}<div class="button-row"><button class="button ghost small" data-action="sql-copy">${icon('copy')}${esc(t('console.sqlCopy', 'Copy the result'))}</button></div>` : `<p class="muted">${esc(t('console.sqlEmpty', 'Type a query, for example one the support sent you, then Run.'))}</p>`;
  return `<section class="panel console-panel sql-panel"><header><h2>${icon('database')}${esc(t('console.sqlTitle', 'SQL'))}</h2><div class="button-row">${SQL_QUICK.map(([key, label], index) => `<button class="button ghost small" data-action="sql-quick" data-index="${index}">${esc(t(key, label))}</button>`).join('')}</div></header>
    <p class="muted small">${esc(t('console.sqlHint', 'Queries on the databases of this server (acore_auth, acore_characters, acore_world, acore_playerbots). Reading only (SELECT, SHOW, DESCRIBE) unless you allow changes below. MySQL is started if needed.'))}</p>
    <textarea id="sql-input" class="sql-input" spellcheck="false" rows="5" placeholder="SELECT * FROM acore_auth.realmlist;">${esc(q.query)}</textarea>
    <div class="sql-bar"><label class="check"><input type="checkbox" id="sql-allow" ${q.allow ? 'checked' : ''}><span>${esc(t('console.sqlAllow', 'Allow changes (a backup is made first)'))}</span></label><span class="spacer"></span><button class="button primary small" data-action="sql-run" ${q.busy ? 'disabled' : ''}>${icon('play')}${esc(q.busy ? t('console.sqlRunning', 'Running…') : t('console.sqlRun', 'Run'))}</button></div>
    <div class="sql-results">${results}</div>
  </section>`;
}

function consoleView() {
  if ((App.state.consoleMode || 'commands') === 'sql') return `<div class="page classic">${consoleTabs()}${sqlView()}</div>`;
  const log = App.state.consoleLog.map(entry => `<div class="console-entry"><code class="console-cmd">${entry.realm ? realmEmblem(entry.realm, 16) : ''}AC&gt; ${esc(entry.command)}</code><pre class="${entry.error ? 'bad' : ''}">${esc(entry.output)}</pre></div>`).join('');
  const realm = App.state.consoleRealm || 'coa';
  if (!App.state.realms && App.state.server?.path) loadRealms();
  return `<div class="page classic"><div class="srv-tabs-row console-row">${consoleTabs()}${realmPicker(realm, 'console-realm')}</div>${createdRealms().length > 1 ? realmBanner(realm, t('realms.consoleOn', 'The commands go to this realm only.')) : ''}<section class="panel console-panel">
    <header><h2>${icon('terminal')}${esc(t('console.title', 'World console'))}</h2><div class="button-row">${CONSOLE_QUICK.map(command => `<button class="button ghost small" data-action="console-quick" data-command="${esc(command)}">${esc(command)}</button>`).join('')}<button class="button ghost small" data-action="chars-dialog">${icon('download')}${esc(t('chars.title', 'Export / import a character'))}</button></div></header>
    <p class="muted small">${esc(t('console.hint', 'The server commands, as in World_Console.bat (the worldserver must run). Up and down arrows bring back the last commands.'))}</p>
    <div class="console-log" id="console-log">${log || `<p class="muted">${esc(t('console.empty', 'Type a command below, for example server info.'))}</p>`}</div>
    <form class="console-form" id="console-form"><span>AC&gt;</span><input id="console-input" autocomplete="off" spellcheck="false" maxlength="500" placeholder="server info"><button class="button primary small" type="submit">${esc(t('console.send', 'Send'))}</button></form>
  </section></div>`;
}
let consoleHistory = [];
let consoleIndex = -1;
async function consoleSend(command) {
  command = String(command || '').trim();
  if (!command) return;
  if (/^\.?server (shutdown|restart)/i.test(command) && !(await confirmDialog({ title: t('console.stopTitle', 'Stop the server?'), body: esc(t('console.stopBody', 'This command stops the worldserver for everyone connected.')), confirm: t('console.stopConfirm', 'Send it'), danger: true }))) return;
  consoleHistory = [command, ...consoleHistory.filter(item => item !== command)].slice(0, 30);
  consoleIndex = -1;
  const realm = App.state.consoleRealm && App.state.consoleRealm !== 'coa' ? App.state.consoleRealm : '';
  const entry = { command, output: t('console.waiting', '…'), realm: realm || 'coa' };
  App.state.consoleLog = [...App.state.consoleLog, entry].slice(-60);
  App.render();
  try { entry.output = (await App.api.consoleRun(command, realm)) || t('console.noOutput', '(no answer)'); }
  catch (error) { entry.output = translateError(error.message); entry.error = true; }
  if (App.state.tab === 'console') App.render();
}
Object.assign(App.actions, {
  'console-mode': button => { App.state.consoleMode = button.dataset.id; App.render(); },
  'sql-quick': button => { const item = SQL_QUICK[Number(button.dataset.index)]; if (item) { App.state.sql.query = item[2]; App.render(); } },
  'sql-run': button => guard(async () => {
    const q = App.state.sql;
    q.query = $('#sql-input')?.value || q.query;
    q.allow = !!$('#sql-allow')?.checked;
    if (q.allow && !(await confirmDialog({ title: t('console.sqlConfirmTitle', 'Run with changes allowed?'), body: esc(t('console.sqlConfirmBody', 'A query that changes the databases cannot be undone by itself: a backup of the databases is made first, restore it from Management > Backups if needed.')), confirm: t('console.sqlRun', 'Run') }))) return;
    q.busy = true; q.error = ''; App.render();
    try { q.results = await App.api.sqlRun(q.query, q.allow); }
    catch (error) { q.results = null; q.error = translateError(error.message); }
    finally { q.busy = false; if (App.state.tab === 'console') App.render(); }
  }, button),
  'sql-copy': () => {
    const r = App.state.sql.results;
    if (!r) return;
    const text = r.results.map(item => [item.statement, item.columns.join('\t'), ...item.rows.map(row => row.map(cell => cell === null ? 'NULL' : cell).join('\t'))].join('\n')).join('\n\n');
    navigator.clipboard.writeText(text).then(() => toast(t('console.sqlCopied', 'Copied: paste it on Discord.'), 'success')).catch(() => {});
  },
});
App.pages.console = {
  render: consoleView,
  mount() {
    const log = $('#console-log');
    if (log) log.scrollTop = log.scrollHeight;
    const input = $('#console-input');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    // The page stays at its top (the SQL / commands switch), the cursor goes in the field.
    input.focus({ preventScroll: true });
    $('#view')?.scrollTo({ top: 0 });
    $('#console-form').addEventListener('submit', event => { event.preventDefault(); const value = input.value; input.value = ''; consoleSend(value); });
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      consoleIndex = Math.max(-1, Math.min(consoleHistory.length - 1, consoleIndex + (event.key === 'ArrowUp' ? 1 : -1)));
      input.value = consoleIndex >= 0 ? consoleHistory[consoleIndex] : '';
    });
  },
};
Object.assign(App.actions, { 'console-quick': button => consoleSend(button.dataset.command) });

// One character to another PC or server: the world console writes it to a file (pdump), or reads one into an account.
async function charsDialog() {
  // The lists of the server (characters of the players, game accounts); typed by hand when MySQL cannot be read.
  const list = await App.api.charsList().catch(() => null);
  const pick = `<input id="chars-name" maxlength="24" list="chars-names" autocomplete="off" placeholder="${esc(t('chars.name', 'Character name'))}"><datalist id="chars-names">${(list?.characters || []).map(item => `<option value="${esc(item.name)}">${esc(t('chars.level', 'level {n}', { n: item.level }))} · ${esc(item.account)}</option>`).join('')}</datalist>`;
  const account = `<input id="chars-account" maxlength="20" list="chars-accounts" autocomplete="off" placeholder="${esc(t('chars.account', 'Game account'))}"><datalist id="chars-accounts">${(list?.accounts || []).map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
  dialog.open(`${dialog.header(t('chars.title', 'Export / import a character'))}<div class="dialog-content">
    <p class="muted small">${esc(t('chars.hint', 'The world must run. The file (.sql) goes to the Characters folder of the server: copy it to the other PC, then import it there into a game account.'))}</p>
    <h3>${icon('download')}${esc(t('chars.export', 'Export'))}</h3>
    <label class="chars-label">${esc(t('chars.which', 'The character to export'))}</label>
    <div class="button-row">${pick}<button class="button primary small" data-action="chars-export">${esc(t('chars.exportButton', 'Export to a file'))}</button></div>
    <h3>${icon('folder')}${esc(t('chars.import', 'Import'))}</h3>
    <label class="chars-label">${esc(t('chars.into', 'The game account that receives it'))}</label>
    <div class="button-row">${account}<button class="button primary small" data-action="chars-import">${esc(t('chars.importButton', 'Choose the file and import'))}</button></div>
    <p class="muted small">${esc(t('chars.importHint', 'The account must exist (Game account card) and have a free character slot. A character of the same name gets a rename at its next login.'))}</p>
  </div>`);
}
Object.assign(App.actions, {
  'chars-dialog': button => guard(() => charsDialog(), button),
  'chars-export': button => guard(async () => { const result = await App.api.charsExport($('#chars-name').value.trim()); toast(t('chars.exported', 'Character written: {file}', { file: result.file }), 'success'); }, button),
  'chars-import': button => guard(async () => { const result = await App.api.charsImport($('#chars-account').value.trim()); if (result) toast(t('chars.imported', 'Character imported. Log in to see it.'), 'success'); }, button),
});

// The community server beside the news: who is online when its widget is public, and a join button.
function discordPanel() {
  const discord = App.state.feed?.discord;
  if (!discord) return '';
  const live = discord.live;
  const members = (live?.members || []).map(member => `<li><i class="presence ${esc(member.status)}"></i>${esc(member.name)}</li>`).join('');
  return `<aside class="discord-card">
    <header>${icon('discord')}<div><strong>${esc(discord.name || live?.name || 'Discord')}</strong><small>${live ? `<i class="presence online"></i>${esc(t('home.discordOnline', '{n} online', { n: live.online }))}` : esc(t('home.discordCommunity', 'Community'))}</small></div></header>
    ${members ? `<ul class="discord-members">${members}</ul>` : `<p>${esc(discord.text || t('home.discordText', 'Help, news, bug reports and ideas: join the players of the realm.'))}</p>`}
    ${discord.invite || live?.invite ? `<button class="button primary" data-action="feed-open" data-kind="discord">${icon('external')}${esc(t('home.discordJoin', 'Join the Discord'))}</button>` : ''}
  </aside>`;
}

// A new launcher downloaded and verified: one click restarts into it.
const ASSEMBLE_STEPS = { dbc: ['Game tables (DBC)', '~1 min'], maps: ['Terrain and cameras', '~3 min'], vmaps: ['Buildings and objects (vmaps)', '~10 min'], sql: ['Public SQL of the core', '~2 min'], db: ['Database', '~9 min'], bots: ['CoA Bots', '~2 min'], mmaps: ['Navigation maps of the bots (download)', '~10 min'] };
// « 1,1 / 1,9 Go · 12 Mo/s · ~1 min left » while the navigation maps download.
function downloadLine(p) {
  const parts = [`${formatBytes(p.done)} / ${formatBytes(p.total)}`];
  if (p.speed > 0) parts.push(`${formatBytes(p.speed)}/s`);
  if (p.left > 0) parts.push(p.left < 60 ? t('assemble.leftSeconds', '~{n} s left', { n: Math.max(5, Math.round(p.left / 5) * 5) }) : t('assemble.leftMinutes', '~{n} min left', { n: Math.ceil(p.left / 60) }));
  return parts.join(' · ');
}
// « Still working (1 min 05 s) » on the step in progress: a long step does not look frozen.
function stepElapsed() {
  const since = App.state.assembleProgress?.since;
  if (!since) return '';
  const seconds = Math.floor((Date.now() - since) / 1000);
  return t('assemble.still', 'Still working ({time})', { time: seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s` });
}
setInterval(() => { const line = document.getElementById('assemble-elapsed'); if (line) line.textContent = stepElapsed(); }, 1000);
function assemblyCard(asm) {
  const p = App.state.assembleProgress;
  const pct = p?.total ? Math.floor((100 * p.done) / p.total) : null;
  // The steps run in this order: those before the current one are done (the server info is read before the run).
  const order = Object.keys(ASSEMBLE_STEPS);
  // Without the game folder nothing can start: the card says so instead of looking at work.
  const noGame = !(App.state.client?.path || asm.client);
  // The download of the navigation maps only with a launcher that has their address.
  const rows = Object.entries(ASSEMBLE_STEPS).filter(([id]) => id !== 'mmaps' || App.state.config.hasMmaps).map(([id, [label, time]]) => {
    const now = p?.step === id;
    const finished = id === 'bots' ? !asm.needed : id === 'mmaps' ? (asm.mmaps?.done || 0) > 0 : !asm.missing.includes(id);
    const done = !now && (finished || (p?.step && order.indexOf(id) < order.indexOf(p.step)));
    return `<li class="${done ? 'ok' : now ? 'busy' : 'todo'}">${icon(done ? 'check' : now ? 'refresh' : 'chevron')}<span>${esc(t(`assemble.${id}`, label))}</span><small class="muted">${esc(done ? t('assemble.done', 'done') : now && pct !== null ? `${pct}%` : !p && noGame ? t('assemble.waiting', 'waiting') : time)}</small></li>`;
  }).join('');
  const progress = p ? `<div class="hero-progress"><div class="progress${pct === null ? ' indeterminate' : ''}"><span data-pct="${pct ?? 30}"></span></div><span>${pct === null ? '' : `${pct}%`}</span></div><p class="muted small" title="${esc(p.text || '')}">${esc(ASSEMBLE_STEPS[p.step] ? t(`assemble.${p.step}`, ASSEMBLE_STEPS[p.step][0]) : t('assemble.starting', 'Starting…'))}${p.step === 'db' && p.text ? ` · ${esc(p.text)}` : ''} · ${p.step === 'mmaps' && p.total > 1e6 ? esc(downloadLine(p)) : `<span id="assemble-elapsed">${esc(stepElapsed())}</span>`}</p>${p.warning ? `<p class="status-line bad">${icon('warning')}${esc(t('assemble.stuck', p.warning))}</p>` : ''}` : '';
  const detail = p?.detail && !['mmaps', 'mmaps-fetch'].includes(p.step) ? `<p class="muted small assemble-detail" id="assemble-detail">${esc(p.detail)}</p>` : '';
  const error = App.state.assembleError ? `<p class="status-line bad">${icon('warning')}${esc(translateError(App.state.assembleError))}</p>` : '';
  return `<p class="status-line">${esc(App.state.config.hasMmaps ? t('assemble.intro2', 'This server comes without any game data: the launcher takes it from your own Conquest of Azeroth client (about 30 minutes), installs the bots, then downloads their navigation maps (about 1.9 GB).') : t('assemble.intro', 'This server comes without any game data: the launcher takes it from your own Conquest of Azeroth client (about 30 minutes), then installs the bots and builds the navigation maps of the bots in the background (about an hour, you can already play).'))}</p>
    ${App.state.server?.driveBus === 'USB' ? `<p class="status-line bad">${icon('warning')}${esc(t('assemble.usbDrive', 'This server is on an external (USB) drive: MySQL can freeze there while the database is built. An internal disk is safer.'))}</p>` : ''}
    <ol class="assemble-steps">${rows}</ol>${progress}${detail}${error}
    ${noGame && !p ? `<p class="status-line warn">${icon('warning')}${esc(t('assemble.waitGame', 'Waiting for your game folder: choose it and the preparation starts.'))}</p><div class="button-row"><button class="button primary" data-action="assemble-locate">${icon('folder')}${esc(t('setup.pickGame', 'Choose the game folder'))}</button></div>` : ''}
    ${p ? '' : `<div class="button-row"><button class="split-button update" data-action="assemble-run" ${noGame ? 'disabled' : ''}><span class="split-main">${icon('download')}<span><strong>${esc(t('assemble.run', 'Prepare the data from my game'))}</strong><small class="muted">${esc(t('assemble.client', 'Game folder: {path}', { path: App.state.client?.path || asm.client || t('assemble.noClient', 'not chosen yet (Play tab)') }))}</small></span></span></button></div>`}`;
}
// The game was patched since the server's data were taken from it: they are taken again (about 30 minutes).
function clientBanner(asm) {
  if (!asm.clientChanged) return '';
  return `<div class="update-banner"><i class="dot"></i><span>${esc(t('assemble.clientChanged', 'Your game was updated since the server data were taken from it. Take them again (about 30 minutes, server stopped) so the server matches your game.'))}</span><button class="button ghost small" data-action="assemble-refresh">${esc(t('assemble.refresh', 'Update the data'))}</button><button class="button ghost small subtle" data-action="assemble-keep-client">${esc(t('assemble.keepClient', 'Keep my modified files'))}</button></div>`;
}
function mmapsBanner(mm) {
  if (!mm || mm.complete) return '';
  const pct = mm.tilesTotal ? Math.min(99, Math.floor((100 * mm.tiles) / mm.tilesTotal)) : mm.total ? Math.floor((100 * mm.done) / mm.total) : 0;
  if (!mm.running && Date.now() - (App.state.mmapsAsked || 0) < 60000) mm = { ...mm, running: true };
  if (mm.paused && !mm.running) return `<div class="update-banner"><i class="dot"></i><span>${esc(t('assemble.mmapsPausedText', 'Navigation maps of the bots: paused at {done} of {total} maps. Resume when you like; the maps already built are kept.', { done: mm.done, total: mm.total || '…' }))}</span><button class="button ghost small" data-action="assemble-mmaps">${esc(t('assemble.mmapsContinue', 'Resume'))}</button></div>`;
  return `<div class="update-banner"><i class="dot"></i><span>${esc(mm.running ? t('assemble.mmapsRunning2', 'Navigation maps of the bots: {pct}% of the work done ({done} of {total} maps, the large continents come last), built in the background.', { done: mm.done, total: mm.total || '…', pct }) : t('assemble.mmapsPaused', 'Navigation maps of the bots: {done} of {total} maps. Until they are all built, bots may walk in straight lines.', { done: mm.done, total: mm.total || '…' }))}</span>${mm.running ? `<button class="button ghost small" data-action="assemble-mmaps-pause">${esc(t('assemble.mmapsPause', 'Pause'))}</button>` : `<button class="button ghost small" data-action="assemble-mmaps">${esc(mm.paused ? t('assemble.mmapsContinue', 'Resume') : t('assemble.mmapsResume', 'Build them now'))}</button>`}</div>`;
}

//By leewheel 2026年11月9日 服务起不来时的醒目提示（老大要求：主页出现一个按钮，点开弹窗说清具体错误）。
// 事件来源有两处：① 玩家点「启动」失败即时推；② 运行中服务自己挂了（serverWatch 侦测）也推。
// 只要有失败记录就常驻显示，直到玩家点开看明白（或服务重新起来）。
function startupFailView() {
  const fail = App.state.serverFail;
  if (!fail) return '';
  const name = (App.state.server?.services || []).find(item => item.id === fail.id)?.name || '';
  const when = fail.at ? new Date(fail.at).toLocaleTimeString('zh-CN') : '';
  return `<div class="startup-fail" role="alert">
    <span class="startup-fail-icon">${icon('warning')}</span>
    <div class="startup-fail-text"><strong>服务没能启动${name ? `：${esc(name)}` : ''}</strong><small>${esc(fail.message || '点右边看具体原因与解决办法')}${when ? ` · ${esc(when)}` : ''}</small></div>
    <button class="button danger small" data-action="server-diagnose">为什么起不来？查看原因</button>
  </div>`;
}

// 诊断结果弹窗：一条一条说清「现象 → 原因 → 怎么办」，附日志最后几行与退出码。
function diagnoseView(d) {
  if (!d) return '';
  const severityText = { critical: '关键', warning: '注意', info: '正常', ok: '正常' };
  const pillClass = { critical: 'bad', warning: 'warn', info: 'ok', ok: 'ok' };
  const items = (d.services || []).map(item => {
    const lines = item.log?.lines || [];
    const logBlock = lines.length ? `<details class="diag-log"><summary>日志最后 ${lines.length} 行${item.log.file ? `（${esc(item.log.file.split(/[\\/]/).pop())}）` : ''}</summary><pre>${esc(lines.join('\n'))}</pre></details>` : '';
    const exitBlock = item.exit?.text ? `<p class="diag-exit">${esc(item.exit.text)}</p>` : '';
    return `<section class="diag-item ${esc(item.severity)}">
      <header><strong>${esc(item.name)}</strong><span class="pill ${pillClass[item.severity] || 'ok'}">${esc(severityText[item.severity] || '')}</span>${item.port ? `<span class="muted small">端口 ${item.port}</span>` : ''}</header>
      <p class="diag-headline">${esc(item.headline || '')}</p>
      ${item.reason ? `<p class="diag-reason"><b>原因：</b>${esc(item.reason)}</p>` : ''}
      ${item.hint ? `<p class="diag-hint"><b>怎么办：</b>${esc(item.hint)}</p>` : ''}
      ${item.quote ? `<pre class="diag-quote">${esc(item.quote)}</pre>` : ''}
      ${exitBlock}${logBlock}
    </section>`;
  }).join('');
  const head = d.failed
    ? `<p class="diag-summary bad">${esc(d.headline || `${d.failed} 个服务起不来`)}</p><p class="muted small">检查时间 ${esc(new Date(d.at).toLocaleString('zh-CN'))} · 只读检查，不会改动任何文件</p>`
    : `<p class="diag-summary ok">所有服务都没发现问题。</p><p class="muted small">检查时间 ${esc(new Date(d.at).toLocaleString('zh-CN'))}</p>`;
  const tips = (d.tips || []).length ? `<ul class="diag-tips">${d.tips.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
  return `${head}${tips}<div class="diag-list">${items}</div>`;
}

async function showDiagnose() {
  dialog.open(`${dialog.header('为什么起不来', '启动器只读检查：程序文件、端口归属、日志尾部、退出码')}<div class="dialog-content"><div class="task-line">${icon('refresh')}<span>正在检查…</span></div></div>`, 'wide');
  let d = null;
  try { d = await App.api.serverDiagnose(); }
  catch (error) {
    dialog.open(`${dialog.header('为什么起不来')}<div class="dialog-content"><p>${esc(translateError(error.message))}</p></div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">关闭</button></footer>`, 'wide');
    return;
  }
  // 一切正常就把首页那条红条撤掉
  if (!d?.failed) App.state.serverFail = null;
  else App.state.serverFail = { ...(App.state.serverFail || {}), message: d.services.find(item => item.severity === 'critical')?.reason || App.state.serverFail?.message || '' };
  const text = (d?.services || []).filter(item => item.severity === 'critical').map(item => [`【${item.name}】`, item.headline, item.reason && `原因：${item.reason}`, item.hint && `怎么办：${item.hint}`, item.exit?.text && `退出：${item.exit.text}`, ...(item.log?.lines || []).slice(-8)].filter(Boolean).join('\n')).join('\n\n');
  dialog.open(`${dialog.header('为什么起不来', d?.failed ? d.headline : '所有服务都没发现问题')}<div class="dialog-content">${diagnoseView(d)}</div>
    <footer class="dialog-foot">
      <button class="button ghost" data-action="diag-copy" data-payload="${esc(encodeURIComponent(text))}">${icon('book')}复制诊断</button>
      <button class="button ghost" data-action="srv-tab" data-id="services">服务管理</button>
      <button class="button primary" data-action="dialog-close">知道了</button>
    </footer>`, 'wide');
  App.render();
}

//By leewheel 2026年11月9日 启动器自身更新的横幅（全中文，五个状态）：
//   downloading 下载中（带百分比、速度、已下载/总大小、可取消）
//   installing  校验落位中 / 正在重启
//   ready       **强制重启**：下载完自动倒计时重启，不给“稍后再说”
//   error       失败（带原因 + 重试）
//   skipped     玩家忽略了这个版本（仍保留「还是更新」入口：不更新就装不了更新包）
// 老大要求「有新版就自动下载」「更新完毕必须强制重启」，所以这里没有“要不要下”、也没有“忽略”，
// 只有进度和倒计时。唯一会推迟重启的情况是“正在装更新包/准备数据”，那时如实显示在等待。
function launcherBanner() {
  const update = App.state.launcherUpdate;
  if (!update || !update.phase) return '';
  const version = String(update.version || update.latest || '最新版');
  const pct = Math.round(Number(update.percent) || 0);
  if (update.phase === 'downloading' || update.phase === 'installing') {
    const speed = update.speed > 0 ? ` · ${formatBytes(update.speed)}/s` : '';
    const done = update.total > 0 ? ` · ${formatBytes(update.done || 0)} / ${formatBytes(update.total)}` : '';
    const restarting = update.phase === 'installing' && pct >= 100;
    const label = restarting ? '正在重启并安装新版启动器' : update.phase === 'installing' ? '正在校验并安装新版启动器' : '正在下载新版启动器';
    const tail = restarting ? ' · 启动器会自己关掉再打开，服务端进程不受影响' : ` · ${pct}%${esc(speed)}${esc(done)}`;
    return `<div class="update-banner launcher-banner" role="status">
      <i class="dot"></i>
      <span><strong>${label} ${esc(version)}</strong>${esc(tail)}</span>
      ${update.phase === 'downloading' ? `<button class="button ghost small" data-action="launcher-cancel">取消</button>` : ''}
    </div>`;
  }
  if (update.phase === 'ready') {
    //By leewheel 2026年11月9日 强制重启的三种画面，一种比一种“更不许玩家动手”：
    //  ① waiting   —— 主进程试过重启但被拦下（世界服在跑 / 正在装包 / 准备数据），横幅如实说在等什么
    //  ② secondsLeft —— 正常倒计时，读主进程每秒推下来的秒数，不在前端自己算（关了再开也不会跳）
    //  ③ 其他      —— 刚落位、倒计时还没开始的那一瞬
    // ⚠️ 别在文案里承诺“服务端不会被停掉”：世界服的控制台管道是启动器开的，启动器一退它就掉线，
    // 所以世界服在跑时根本不重启（见 waiting 分支），等它停了才补。
    const busy = !!App.state.assembleProgress;
    if (update.waiting) {
      const why = String(update.message || '').replace(/^新版启动器[^：]*：/, '');
      // 等世界服停下来时**不给按钮**：那条路拦的就是“现在重启会让世界服掉线”，
      // 摆一个按了也没用的按钮只会让人以为坏了。等它停，横幅自己会把升级补完。
      const action = update.waitingOnServer
        ? '<span class="muted small">世界服停了会自动完成升级</span>'
        : `<button class="button primary small" data-action="launcher-install" ${busy ? 'disabled' : ''}>${busy ? '任务结束后自动重启' : '立即重启'}</button>`;
      return `<div class="update-banner launcher-banner ready" role="status">
        <i class="dot"></i>
        <span><strong>新版启动器 ${esc(version)} 已下载完成</strong> · ${esc(why || '当前有任务在跑，等它结束后自动重启')}</span>
        ${action}
      </div>`;
    }
    const left = Number(update.secondsLeft) || 0;
    const hint = left > 0 ? ` · <strong>${left} 秒后自动重启安装</strong>` : ' · 正在自动重启安装';
    return `<div class="update-banner launcher-banner ready" role="status">
      <i class="dot"></i>
      <span><strong>新版启动器 ${esc(version)} 已下载完成</strong>${hint}（只重启启动器窗口）</span>
      <button class="button ghost small" data-action="launcher-install" ${busy ? 'disabled' : ''}>立即重启</button>
    </div>`;
  }
  if (update.phase === 'error') {
    return `<div class="update-banner bad launcher-banner">${icon('warning')}<span>新版启动器下载失败：${esc(String(update.message || '').replace(/^启动器更新失败：/, '') || '未知原因')}</span><button class="button ghost small" data-action="launcher-check" data-force="1">重试</button></div>`;
  }
  if (update.phase === 'skipped') {
    return `<div class="update-banner bad launcher-banner">${icon('warning')}<span>已跳过启动器版本 ${esc(version)}：<strong>不升级启动器就无法安装更新包</strong>，仍然建议现在就更新。</span><button class="button primary small" data-action="launcher-check" data-force="1">还是更新</button></div>`;
  }
  return '';
}

//By leewheel 2026-11-03 服务端 / 客户端更新窗口（从 GitHub releases 读取；含下载进度、dbc 注入、SQL 导入）
App.state.releaseInfo = null;
//By leewheel 2026年11月5日 进度订阅改成全局单例（ensureReleaseProgressWatch），不再按弹窗维护 unsubscribe

function releaseVersionsHtml(info) {
  const current = info.current || t('update.none', '未知');
  const latest = info.latest?.version || '';
  //By leewheel 2026-11-05 是否有新版本只认主进程算好的「待装队列」：队列为空就是已是最新，
  // 不再拿两个命名体系不同的版本号硬比大小（会有“补丁早编进包里还提示更新”的误报）。
  const newer = (info.pending?.length || 0) > 0;
  const badge = newer
    ? `<span class="pill warn">${esc(t('release.newer', '有新版本'))}</span>`
    : `<span class="pill ok">${esc(t('release.current', '已是最新'))}</span>`;
  return `<div class="realm-badge"><div><strong>${esc(t('release.currentVersion', '当前版本'))}：${esc(current)}</strong><small>${esc(t('release.latestVersion', '最新版本'))}：${latest || esc(t('release.none', '上游还没有发布版本'))}${info.latest?.publishedAt ? ` · ${esc(formatDate(info.latest.publishedAt))}` : ''}</small></div>${badge}</div>`;
}

function showReleaseUpdate() {
  dialog.open(`${dialog.header(t('verify.update', '检查更新'))}<div class="dialog-content">${skeleton(3)}</div>`);
  //By leewheel 2026年11月5日 以主进程状态为准：正在更新/已更新完时，不再显示“开始更新”按钮
  const statePromise = App.api.releaseState ? App.api.releaseState().catch(() => null) : Promise.resolve(null);
  Promise.all([App.api.releaseCheck(), statePromise]).then(([info, state]) => {
    App.state.releaseInfo = info;
    if (state && (state.busy || state.done || state.error)) {
      App.state.releaseRun = { phase: state.phase, pct: state.pct, message: state.message, done: !!state.done, error: state.error || '', version: state.version, errorLog: state.errorLog || '', pkg: state.pkg || '', pkgIndex: state.pkgIndex, pkgTotal: state.pkgTotal, pkgVersion: state.pkgVersion || '' };
    }
    const asset = info.asset;
    //By leewheel 2026-11-05 "开始更新"按待装补丁队列依次执行，不再只装最新一个；
    // 弹窗列出待装数量与顺序（旧 → 新），按钮也只在队列非空时出现。
    const pending = info.pending || [];
    const order = pending.slice(0, 8).map(item => item.version).join(' → ') + (pending.length > 8 ? ' → …' : '');
    const pendingHtml = pending.length > 1
      ? `<p class="status-line">${icon('info')}共 ${pending.length} 个补丁待安装，将按发布顺序依次安装：${esc(order)}</p>`
      : '';
    //End By leewheel
    //By leewheel 2026年11月5日 老大反馈：关掉再打开，按钮又能按、能重复下载。
    // 现在整段更新状态存在 App.state.releaseRun 里，重开弹窗时按状态渲染：进行中→只显示进度，已完成→不再给“开始更新”。
    const run = App.state.releaseRun;
    const running = !!(run && run.phase && !run.done && !run.error);
    const finished = !!(run && run.done);
    const failed = !!(run && run.error && !finished);
    // 保证整个进程有且只有一个进度订阅（关窗也不断，状态与横幅一直更新）
    ensureReleaseProgressWatch();
    const notes = String(info.latest?.notes || '').slice(0, 4000);
    const history = (info.history || []).slice(-3).reverse();
    const historyHtml = history.length
      ? `<h3>${esc(t('release.history', '更新记录'))}</h3><ul class="notes">${history.map(item => `<li><strong>${esc(item.version || '?')}</strong> · ${esc(formatDate(item.at, true))} · ${esc(t('release.files', '服务端 {s} 个 / 客户端 {c} 个', { s: item.files?.server ?? 0, c: item.files?.client ?? 0 }))}</li>`).join('')}</ul>`
      : '';
    const body = info.error
      ? `<p class="conf-warn">${icon('warning')}<span>${esc(info.error)}</span></p>`
      : running
        ? `<div id="release-progress">${releaseRunView(run)}</div><p class="muted small">更新正在进行，请等它跑完；关闭这个窗口不会中断更新。</p>`
        : finished
          ? `<div class="release-finished"><p><strong>已更新到 ${esc(run.version || info.latest?.version || '')}</strong></p><p class="muted small">服务器现在是停止状态，回首页点“启动”即可。</p></div>${notes ? `<h3>${esc(t('release.notes', '更新说明'))}</h3><div class="patch-notes release-notes">${markdownLite(notes)}</div>` : ''}`
          : failed
            ? `<div id="release-progress">${releaseRunView(run)}</div><p class="muted small">上面的错误信息可以直接选中复制，也可以点「复制错误信息」；带日志的话点「打开日志」把文件发出来。</p>`
            : !info.latest
            ? `<p class="status-line">${esc(t('release.empty', '上游仓库还没有发布任何版本（releases 为空），发布后这里就会显示更新。'))}</p><p class="muted small">${esc(t('release.scope', '这里检查的是服务端与客户端的内容更新，不是启动器自身的版本。'))}</p>`
            : `${releaseVersionsHtml(info)}
          ${pendingHtml}
          ${notes ? `<h3>${esc(t('release.notes', '更新说明'))}</h3><div class="patch-notes release-notes">${markdownLite(notes)}</div>` : ''}
          ${asset ? `<p class="muted small">${esc(t('release.asset', '更新包'))}：${esc(asset.name)} · ${esc(formatBytes(asset.size))}</p>` : `<p class="conf-warn">${icon('warning')}<span>${esc(t('release.noAsset', '这个版本没有附带 zip 更新包。'))}</span></p>`}
          <div id="release-progress"></div>
          <label class="check"><input type="checkbox" id="release-delete" checked><span>${esc(t('release.deleteAfter', '更新完成后自动删除 Update 临时目录'))}</span></label>
          <p class="muted small">${esc(t('release.how', '更新包按 Server\\ 与 Client\\ 目录归位；dbc 注入客户端补丁档（按 dbc-map.json 的映射，没有映射就自动找含该表的档）；sql\\ 里的脚本会用项目自带的 MySQL 依次导入。'))}</p>`;
    const footer = `<footer class="dialog-foot">
      ${info.latest?.url ? `<button class="button ghost" data-action="release-page">${icon('external')}${esc(t('release.page', '发布页'))}</button>` : ''}
      <button class="button ghost" data-action="release-history">${esc(t('release.history', '更新记录'))}</button>
      ${!running ? `<button class="button ghost" data-action="release-sql-log" title="${esc('逐条查看这次（以及历次）数据脚本的导入结果')}">${icon('book')}导入日志</button>` : ''}
      <button class="button ghost" data-action="dialog-close">${esc(t('common.close', '关闭'))}</button>
      ${finished ? `<button class="button ghost" data-action="release-recheck">${icon('refresh')}${esc(t('release.recheck', '重新检查'))}</button>` : ''}
      ${failed ? `<button class="button ghost" data-action="release-recheck">${icon('refresh')}重新检查</button>` : ''}
      ${pending.length && !running && !finished && !failed ? `<button class="button primary" data-action="release-apply">${icon('download')}${esc(pending.length > 1 ? `开始更新（${pending.length} 个补丁）` : t('release.start', '开始更新'))}</button>` : ''}
      ${!running ? `<button class="button ghost" data-action="release-force-remote" title="${esc('从 GitHub 重新下载更新包并覆盖安装（已经是最新版本也会重装，用来修坏掉的文件）。可以选择装到哪一版')}">${icon('refresh')}强制更新（从 GitHub 下载）</button>` : ''}
      ${!running ? `<button class="button ghost" data-action="release-speedtest" title="${esc('给所有下载镜像测速，下载时自动用最快的那个')}">${icon('chart')}镜像测速</button>` : ''}
      ${!running ? `<button class="button ghost" data-action="release-local" title="${esc('GitHub 上没有 zip 资产时，用本地的 CoA-Update-*.zip 覆盖安装')}">${icon('download')}从本地包更新</button>` : ''}
    </footer>`;
    dialog.open(`${dialog.header(t('verify.update', '检查更新'))}<div class="dialog-content">${body}${running || finished || failed ? '' : historyHtml}</div>${footer}`, 'xwide');
    //By leewheel 2026年11月8日 重开时按当前状态画一次（走统一入口，带结构指纹，避免重复重建）
    if (running) paintReleaseProgress(run);
  }).catch(error => {
    dialog.open(`${dialog.header(t('verify.update', '检查更新'))}<div class="dialog-content"><p class="conf-warn">${icon('warning')}<span>${esc(translateError(error.message))}</span></p></div><footer class="dialog-foot"><button class="button primary" data-action="dialog-close">${esc(t('common.close', '关闭'))}</button></footer>`);
  });
}

//By leewheel 2026年11月5日 更新进度：老大要求“看得见完成没完成”。原来只有下载/完成两个阶段画进度条，
// 中间停服、替换文件、注入 MPQ、导库几分钟里界面毫无反应。现在：整段都有百分比 + 每一步的状态清单。
//By leewheel 2026年11月8日 步骤表必须与后端 onPhase 的真实顺序一一对应，否则指示灯会整排熄灭：
// 后端实际顺序是 server → configs → client → runtime → mpq-entries → dbc → sql → launcher → config-patch → verify → done。
// 这次补上“更新启动器”和“写入新配置参数”两步（以前它们不在表里，一到这两步 9 个灯全灭）。
const RELEASE_STEPS = [
  ['download', '下载更新包', 0, 40],
  ['extract', '解压更新包', 40, 45],
  ['apply', '停止服务器（保存角色）', 45, 50],
  ['server', '写入服务端文件', 50, 58],
  ['configs', '覆盖配置', 58, 61],
  ['client', '写入客户端文件', 61, 66],
  ['runtime', '分发机器人面板（Runtime / CoA-Bots）', 66, 68],
  ['mpq-entries', '注入客户端补丁档', 68, 80],
  ['dbc', '处理 DBC', 80, 86],
  ['sql', '导入数据库', 86, 96],
  //By leewheel 2026年11月9日 导完库按包里的表清单核一遍：缺哪张表、缺哪个字段都要能说出来
  ['dbcheck', '核对数据表', 96, 98],
  ['launcher', '更新启动器', 98, 99],
  ['config-patch', '写入新配置参数', 99, 99],
  //By leewheel 2026年11月8日 最后一步核对：文件大小 + 两个 exe 的 md5，对不上就不算更新成功
  ['verify', '核对文件落地', 99, 99],
  ['done', '完成', 100, 100],
];
function releaseStepLabel(phase) {
  if (phase === 'next') return '当前补丁完成，继续下一个';
  const step = RELEASE_STEPS.find(item => item[0] === phase);
  return step ? step[1] : String(phase || '');
}
function releasePkgLine(run) {
  //By leewheel 2026年11月9日 老大要求：强制更新与自动更新都必须明确显示“当前下载/执行的是哪一个压缩包”。
  // 以前只有“解压更新包 · 正在解压”，队列里换了包也看不出来装的是哪一版，出问题对不上账。
  if (!run.pkg) return '';
  const order = typeof run.pkgIndex === 'number' && run.pkgTotal > 1 ? `第 ${run.pkgIndex}/${run.pkgTotal} 个 · ` : '';
  const version = run.pkgVersion ? `（${run.pkgVersion}）` : '';
  return `<p class="release-pkg">${icon('layers')}<span>${esc(t('release.package', '更新包'))}：${esc(order)}${esc(run.pkg)}${esc(version)}</span></p>`;
}
function releaseRunView(run) {
  const pct = Math.max(0, Math.min(100, Math.round(run.pct || 0)));
  //By leewheel 2026年11月8日 allDone = 队列里的中间态（第 n 个补丁装完、还在装下一个）：
  // 步骤全部算完成，但整体不算“更新完成”，进度条停在 99%。
  // phase 直接是 'next' 也要认（关掉弹窗再打开时，状态是从主进程 releaseState 里读回来的）。
  const allDone = !!run.allDone || run.phase === 'next';
  const currentIndex = allDone ? RELEASE_STEPS.length : RELEASE_STEPS.findIndex(item => item[0] === run.phase);
  const steps = RELEASE_STEPS.filter(item => item[0] !== 'done').map((item, index) => {
    const state = run.error ? (item[0] === run.phase ? 'bad' : '') : (currentIndex > index || run.done || allDone ? 'done' : item[0] === run.phase ? 'doing' : '');
    return `<li class="${state}">${item[1]}</li>`;
  }).join('');
  //By leewheel 2026年11月6日 导入数据库时把“当前正在导哪个文件”显示出来（老大要求）
  const sqlLine = run.phase === 'sql' && run.sqlCurrent
    ? `<p class="release-sql">${esc(t('release.sql', '正在导入'))} ${typeof run.sqlIndex === 'number' ? `${run.sqlIndex}/${run.sqlTotal} · ` : ''}${esc(run.sqlCurrent)}</p>`
    : '';
  const speedText = releaseSpeedLine(run);
  const speedLine = speedText ? `<p class="release-speed">${esc(speedText)}</p>` : '';
  const status = run.error
    ? `<p class="release-status bad">${icon('warning')}<span>更新失败：${esc(run.error)}</span></p>`
    : run.done
      ? `<p class="release-status ok">${icon('check')}<span>更新完成，可以重新启动服务器了。</span></p>`
      : allDone
        ? `<p class="release-status">${esc(run.message || '当前补丁完成，继续下一个')}</p>`
        : `<p class="release-status">${esc(releaseStepLabel(run.phase))}${run.message ? ` · ${esc(run.message)}` : ''}</p>`;
  //By leewheel 2026年11月5日 失败原因要能复制：单独一块可选中的文本 + 复制按钮 + 打开日志
  const errorBlock = run.error ? `<div class="error-wrap">
      <pre class="error-box" id="update-error-text">${esc(run.error)}</pre>
      <div class="error-actions">
        <button class="button small" data-action="release-copy-error">${icon('copy')}复制错误信息</button>
        ${run.errorLog ? `<button class="button ghost small" data-action="release-error-log">${icon('folder')}打开日志</button>` : ''}
        <button class="button ghost small" data-action="release-retry">重试</button>
      </div>
    </div>` : '';
  return `<div class="release-run">
    <div class="release-bar"><span data-pct="${pct}"></span></div>
    <div class="release-pct">${pct}%</div>
    ${releasePkgLine(run)}
    ${sqlLine}
    ${speedLine}
    ${status}
    <ol class="release-steps">${steps}</ol>
    ${errorBlock}
  </div>`;
}
//By leewheel 2026年11月5日 老大反馈：关掉更新窗口再打开，进度条和百分比不动。
// 根因：老代码一找不到 #release-progress 就 return，连 App.state.releaseRun 都不更新；
// 重开后的“进行中”视图又没有这个容器 → 永远冻结。现在：先更新状态，再刷新所有正在显示的视图。
//By leewheel 2026年11月9日 更新装完立刻把首页右侧那六张卡的数据重新读一遍：
// 核心（已更新到哪天）、机器人（内置版本）、检查、你的游戏（插件版本 / realmlist）、
// 机器人仪表盘、谁可以加入。此前只把 run.done 置真，卡片还挂着更新前的值 ——
// 装完看到「核心 已更新 2026.11.08」会让人以为白装了。
const RELOAD_AFTER_UPDATE_KEYS = ['server', 'verify', 'dashboard', 'network'];
function refreshHomeAfterUpdate() {
  if (!App.api?.serverInfo) return;
  const pull = attempt => {
    App.api.serverInfo().then(info => {
      if (!info) return;
      // server 直接换新值；其余四项都是懒加载缓存，清空后 mount 会按下新装的东西重读
      App.state.server = info;
      for (const key of RELOAD_AFTER_UPDATE_KEYS) if (key !== 'server') App.state[key] = null;
      if (typeof refreshAddon === 'function') refreshAddon(true);
      if (App.state.tab === 'home') App.render();
    }).catch(() => { if (attempt < 3) setTimeout(() => pull(attempt + 1), 800); });
  };
  // 主进程这一刻可能还在写 last-update.json、或按更新结果重启世界：稍等一拍再读，失败最多重试 3 次
  setTimeout(() => pull(0), 700);
}

function releaseProgress(payload) {
  const run = App.state.releaseRun || (App.state.releaseRun = { phase: '', pct: 0, message: '', done: false, error: '' });
  //By leewheel 2026年11月8日 队列中间态（第 n 个补丁装完、还在装下一个）：步骤全绿，整体不算完成
  if (payload.phase === 'next') {
    run.allDone = true;
    run.done = false;
    run.error = '';
    run.message = payload.message || '';
    // 显式钉在 99%：绝不能出现“100% 但还没装完”的假完成
    run.pct = 99;
    paintReleaseProgress(run);
    return;
  }
  run.allDone = false;
  //By leewheel 2026年11月8日 队列换包（reset）：进度归零重来，避免灯在“下载”而条还停在 99%
  if (payload.reset) { run.pct = 0; run.done = false; run.error = ''; run.allDone = false; run.sqlCurrent = ''; run.pkg = ''; run.pkgIndex = 0; run.pkgTotal = 0; }
  //By leewheel 2026年11月9日 当前压缩包（包名 / 队列序号 / 版本号）：换包时立刻跟着变
  if (payload.pkg) {
    run.pkg = String(payload.pkg);
    run.pkgIndex = typeof payload.pkgIndex === 'number' ? payload.pkgIndex : run.pkgIndex;
    run.pkgTotal = typeof payload.pkgTotal === 'number' ? payload.pkgTotal : run.pkgTotal;
    run.pkgVersion = payload.pkgVersion || run.pkgVersion || '';
  }
  //By leewheel 2026年11月8日 只认步骤表里的阶段：以后后端即使新增阶段，也不至于把已经点亮的灯全灭
  // （unknown 阶段只更新文案，灯保持在上一个已知阶段）。
  if (payload.phase && RELEASE_STEPS.some(item => item[0] === payload.phase)) run.phase = payload.phase;
  else if (!run.phase) run.phase = payload.phase || '';
  run.message = payload.message || '';
  //By leewheel 2026年11月6日 下载速度 / 剩余时间：主进程每秒推一次，展示成 “12.3 MB/s · 剩余 1 分 20 秒”
  if (typeof payload.kbps === 'number') run.kbps = payload.kbps;
  if (typeof payload.left === 'number') run.left = payload.left;
  //By leewheel 2026年11月6日 记录“当前正在导入哪个 SQL 文件”，弹窗里显示成 “正在导入 3/13 · acore_world/xxx.sql”
  if (payload.sqlCurrent) { run.sqlCurrent = String(payload.sqlCurrent); run.sqlIndex = payload.sqlIndex; run.sqlTotal = payload.sqlTotal; }
  if (payload.phase === 'done') run.sqlCurrent = '';
  // 主进程推来的失败信息与日志路径也要记住（否则重开窗口就只剩一句话）
  if (payload.error) { run.error = String(payload.error); run.done = false; }
  if (payload.errorLog) run.errorLog = payload.errorLog;
  //By leewheel 2026年11月7日 更新完成：清掉“有新版本”的缓存，保证首页提示条立刻消失（即使马上重画首页也不会再冒出来）
  if (payload.phase === 'done') { run.done = true; run.pct = 100; run.error = ''; App.state.releaseAvailable = null; refreshHomeAfterUpdate(); }
  const step = RELEASE_STEPS.find(item => item[0] === run.phase);
  if (step) {
    //By leewheel 2026年11月8日 阶段内按真实进度推进（注入补丁档 66→80%、导库 86→96%），
    // 而不是只跳到阶段起点就干等。老实现里进度条在 70% 卡到整个 MPQ 阶段结束。
    if (run.phase === 'download' && typeof payload.pct === 'number') {
      run.pct = Math.max(run.pct || 0, Math.min(step[3], step[2] + (step[3] - step[2]) * (payload.pct / 100)));
    } else if (typeof payload.pct === 'number') {
      run.pct = Math.max(run.pct || 0, Math.max(step[2], Math.min(step[3], payload.pct)));
    } else {
      run.pct = Math.max(run.pct || 0, step[2]);
    }
  }
  paintReleaseProgress(run);
}
//By leewheel 2026年11月8日 统一刷新入口：更新弹窗（含关掉再打开）与首页横幅都用它
//By leewheel 2026年11月8日 不再整块重建 DOM：下载时每秒几十次进度回调，原来每次都
// `innerHTML = releaseRunView(run)`，进度条过渡动画与步骤列表被反复重置 —— 老大反馈
// “下载过程中 UI 一直在闪烁”。现在结构指纹不变（同一阶段、没出错、没完成）就只改数字与文案。
function releaseSpeedLine(run) {
  if (run.phase !== 'download' || typeof run.kbps !== 'number' || run.kbps <= 0) return '';
  const speed = run.kbps >= 1024 ? `${(run.kbps / 1024).toFixed(1)} MB/s` : `${Math.round(run.kbps)} KB/s`;
  const left = typeof run.left === 'number'
    ? ` · 剩余 ${run.left < 60 ? `${Math.round(run.left)} 秒` : `${Math.floor(run.left / 60)} 分 ${Math.round(run.left % 60)} 秒`}`
    : '';
  return `${t('release.speed', '下载速度')} ${speed}${left}`;
}
function releaseStatusLine(run) {
  //By leewheel 2026年11月9日 玩家自己取消的，不要写成“更新失败”（它确实没改任何文件）
  if (run.error) return /取消/.test(run.error) ? run.error : `更新失败：${run.error}`;
  if (run.done) return '更新完成，可以重新启动服务器了。';
  const allDone = !!run.allDone || run.phase === 'next';
  if (allDone) return run.message || '当前补丁完成，继续下一个';
  return `${releaseStepLabel(run.phase)}${run.message ? ` · ${run.message}` : ''}`;
}
function paintReleaseProgress(run) {
  const box = document.getElementById('release-progress');
  if (box) {
    // 结构指纹：阶段 / 完成 / 出错 / 当前 SQL 文件变了才重建，其余只改数字
    const key = [run.phase, run.done ? 1 : 0, run.allDone ? 1 : 0, run.error ? 1 : 0, run.sqlCurrent || '', run.pkg || ''].join('|');
    if (box.dataset.paintKey !== key) {
      box.innerHTML = releaseRunView(run);
      box.dataset.paintKey = key;
      applyBars(box);
    } else {
      const pct = Math.max(0, Math.min(100, Math.round(run.pct || 0)));
      const bar = box.querySelector('.release-bar > span');
      if (bar) { bar.setAttribute('data-pct', String(pct)); bar.style.width = `${pct}%`; }
      const pctText = box.querySelector('.release-pct');
      if (pctText) pctText.textContent = `${pct}%`;
      const speed = box.querySelector('.release-speed');
      if (speed) speed.textContent = releaseSpeedLine(run);
      // 只有“进行中”才用纯文本刷新状态（失败/完成带图标，走上面的重建分支）
      const status = box.querySelector('.release-status');
      if (status && !run.error && !run.done) status.textContent = releaseStatusLine(run);
    }
  }
  // 首页横幅的百分比
  const label = document.getElementById('release-banner-progress');
  if (label) label.textContent = `${Math.round(run.pct || 0)}%`;
}

// 全进程只订阅一次进度事件：窗口关着也照样记状态、更新首页横幅
let releaseWatchReady = false;
function ensureReleaseProgressWatch() {
  if (releaseWatchReady || !App.api.onReleaseProgress) return;
  releaseWatchReady = true;
  App.api.onReleaseProgress(payload => releaseProgress(payload));
}

function applyReleaseUpdate(button) {
  const info = App.state.releaseInfo;
  //By leewheel 2026-11-05 一次调用把缺失补丁按发布顺序全部装完；队列为空就不给开始
  const pending = info?.pending || [];
  if (!pending.length) { toast('没有需要安装的补丁。'); return; }
  //End By leewheel
  //By leewheel 2026年11月5日 双保险：界面自己记住“已经在跑”，再加上主进程的 releaseBusy 拦截
  if (App.state.releaseBusyNow) { toast(t('release.busy', '更新正在进行中，请等它完成。')); return; }
  App.state.releaseBusyNow = true;
  const deleteAfter = document.getElementById('release-delete')?.checked !== false;
  App.state.releaseRun = { phase: 'download', pct: 0, message: '准备中', done: false, error: '' };
  // 单例订阅：关窗、重开都用同一个，不重复、不断链
  ensureReleaseProgressWatch();
  const box = document.getElementById('release-progress');
  if (box) { box.innerHTML = releaseRunView(App.state.releaseRun); applyBars(box); }
  if (button) { button.disabled = true; button.dataset.busy = '1'; }
  releaseProgress({ phase: 'download', pct: 0, message: '准备中' });
  guard(async () => {
    try {
      //By leewheel 2026-11-05 队列一次装齐：第一次运行装全部，缺 3 个就只装那 3 个（旧 → 新）
      const result = await App.api.releaseApplyAll({ queue: pending, deleteAfter });
      //End By leewheel
      App.state.releaseRun = { ...(App.state.releaseRun || {}), phase: 'done', pct: 100, done: true, error: '', version: result.version || info.latest.version };
      releaseProgress({ phase: 'done', pct: 100, message: '更新完成' });
      toast(`已按发布顺序依次安装 ${result.total || pending.length} 个补丁，更新完成`, 'success');
      const done = document.getElementById('release-progress');
      if (done) {
        done.insertAdjacentHTML('beforeend', `<div class="release-finished">
          <p><strong>已更新到 ${esc(result.version || info.latest.version)}</strong></p>
          <p class="muted small">共 ${result.total || pending.length} 个补丁已按发布顺序依次安装完成${result.files ? ` · 最后一个补丁：服务端 ${result.files.server ?? 0} 个文件 / 客户端 ${result.files.client ?? 0} 个` : ''}</p>
          <p class="muted small">服务器现在是停止状态，回首页点“启动”即可。</p>
        </div>`);
      }
      App.reloadAll();
      return result;
    } catch (error) {
      const run = App.state.releaseRun || { phase: 'download', pct: 0 };
      run.error = String(error?.message || error);
      run.done = false;
      App.state.releaseRun = run;
      // 主进程会把完整堆栈写进日志文件，这里补上路径供“打开日志”使用
      try { const state = await App.api.releaseState(); if (state?.errorLog) run.errorLog = state.errorLog; } catch {}
      releaseProgress({ phase: run.phase, message: '' });
      throw error;
    } finally {
      App.state.releaseBusyNow = false;
      if (button) { button.disabled = false; delete button.dataset.busy; }
    }
  }, button);
}

//By leewheel 2026年11月8日 强制更新执行体：version 为空 = 装到最新版；否则“装到这一版为止”。
// 主进程会把它展开成【旧 → 新】的队列，同样走逐补丁下载 → 归位 → 落地核对 → 记版本那一套。
function forceRemote(version) {
  guard(async () => {
    App.state.releaseRun = { phase: 'download', pct: 0, message: version ? `准备重装到 ${version}` : '准备从 GitHub 重装', done: false, error: '' };
    ensureReleaseProgressWatch();
    const box = document.getElementById('release-progress');
    if (box) { box.innerHTML = releaseRunView(App.state.releaseRun); applyBars(box); }
    try {
      const result = await App.api.releaseForceRemote({ version: version || '', deleteAfter: true, importSql: true });
      toast(`强制更新完成：已按顺序安装 ${result?.total || 1} 个补丁，当前 ${result?.version || version || ''}`, 'success');
      App.state.releaseRun = null;
      showReleaseUpdate();
    } catch (error) {
      toast(`强制更新失败：${String(error?.message || error)}`, 'warning');
    }
  });
}

function showReleaseHistory() {
  App.api.releaseHistory().then(history => {
    const list = (history || []).slice().reverse();
    const body = list.length
      ? `<ul class="notes">${list.map(item => `<li><strong>${esc(item.version || '?')}</strong> · ${esc(formatDate(item.at, true))} · ${esc(t('release.files', '服务端 {s} 个 / 客户端 {c} 个', { s: item.files?.server ?? 0, c: item.files?.client ?? 0 }))}${item.sql?.length ? ` · SQL ${item.sql.length} 个` : ''}${item.dbc?.length ? ` · DBC ${item.dbc.length} 张` : ''}</li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('release.noHistory', '还没有更新记录。'))}</p>`;
    dialog.open(`${dialog.header(t('release.history', '更新记录'))}<div class="dialog-content">${body}</div><footer class="dialog-foot"><button class="button primary" data-action="dialog-close">${esc(t('common.close', '关闭'))}</button></footer>`);
  }).catch(() => toast(t('release.noHistory', '还没有更新记录。')));
}

//By leewheel 2026年11月8日 更新记录里的版本号有两套写法（在线更新记 release tag 全名
// COA-UPDATE-20261108，本地包更新记 2026.11.08.11），主页卡片上一律规整成 2026.11.08
//By leewheel 2026年11月8日 版本号显示：凡是串里带日期的，一律显示成年月日。
// 原来只认「COA-UPDATE-数字」和「纯数字」，整合包 RELEASE.json 的 releaseId
// （coa-publish-20261106）匹配不上就原样吐出来 —— 老大截图里「核心」那栏显示的就是这条原始 ID。
// 现在和主进程 release-baseline.dateOf 同一套规则：先找连续 8 位日期，再找带分隔符的日期。
function prettyUpdateVersion(value) {
  const text = String(value || '').trim();
  const compact = /20(\d{2})(\d{2})(\d{2})/.exec(text);
  if (compact) return `20${compact[1]}.${compact[2]}.${compact[3]}`;
  const split = /(20\d{2})[.\-_/](\d{1,2})[.\-_/](\d{1,2})/.exec(text);
  if (split) return `${split[1]}.${String(split[2]).padStart(2, '0')}.${String(split[3]).padStart(2, '0')}`;
  return text;
}

//By leewheel 2026年11月8日 首页最上方的“有新版本”横幅：启动器每次打开都会自动查一次，
// 查到就推给页面（不自动下载）。点“开始更新”进入同一个更新弹窗，玩家不用自己翻菜单。
function releaseBanner() {
  //By leewheel 2026年11月5日 更新进行中 / 已完成也要在首页看得见（关掉更新窗口也不丢信息）
  const run = App.state.releaseRun;
  if (run && run.phase && !run.done && !run.error) {
    return `<div class="update-banner release-banner release-running" role="status" data-action="release-open">
      <i class="dot"></i>
      <span><strong>正在更新${run.version ? ` ${esc(run.version)}` : ''}</strong> · <span id="release-banner-progress">${Math.round(run.pct || 0)}%</span> · ${esc(releaseStepLabel(run.phase))}</span>
      <button class="button primary small" data-action="release-open">查看进度</button>
    </div>`;
  }
  if (run && run.done) {
    //By leewheel 2026年11月7日 老大要求：更新完成后首页的更新提示条直接隐藏，不再挂“已更新到…”这条
    return '';
  }
  const info = App.state.releaseAvailable;
  if (!info || !info.version) return '';
  return `<div class="update-banner release-banner" role="status">
    <i class="dot"></i>
    <span><strong>${esc(t('release.newer', '有新版本'))} ${esc(info.version)}</strong> · ${esc(t('release.currentVersion', '当前版本'))} ${esc(info.current || '—')}${info.publishedAt ? ` · ${esc(formatDate(info.publishedAt))}` : ''}${info.pendingCount > 1 ? ` · 共 ${info.pendingCount} 个补丁待依次安装` : ''}</span>
    <button class="button primary small" data-action="release-open">${icon('download')}${esc(t('release.start', '开始更新'))}</button>
    <button class="button ghost small" data-action="release-ignore" data-version="${esc(info.version)}" title="${esc(t('release.ignoreHint', '不再提示这个版本（版本号命名不一致时用来关掉横幅）'))}">${esc(t('release.ignore', '忽略'))}</button>
  </div>`;
}

App.pages.home = {
  render: homeView,
  mount() {
    //By leewheel 2026年11月4日 启动器启动时会自动查更新（main 进程），结果从这里接住：
    // 有新版本就记到 state 里，让首页横幅出现；查失败就静默，不打扰玩家。
    if (App.api.onReleaseAvailable && !App.state.releaseWatch) {
      App.state.releaseWatch = App.api.onReleaseAvailable(payload => {
        App.state.releaseAvailable = payload?.found && payload.info?.version ? payload.info : null;
        if (App.state.tab === 'home') App.refresh('home');
      });
    }
    //By leewheel 2026年11月5日 进度订阅统一走 ensureReleaseProgressWatch()：
    // 它同时更新 App.state.releaseRun、更新弹窗里的进度条、首页横幅百分比（关窗也不断）。
    ensureReleaseProgressWatch();
    // 界面重载后从主进程补一次状态（防止“重开又能点开始更新”）
    if (App.api.releaseState && !App.state.releaseStateRead) {
      App.state.releaseStateRead = true;
      App.api.releaseState().then(state => {
        if (state && (state.busy || state.done || state.error)) {
          App.state.releaseRun = { phase: state.phase, pct: state.pct, message: state.message, done: !!state.done, error: state.error || '', version: state.version, pkg: state.pkg || '', pkgIndex: state.pkgIndex, pkgTotal: state.pkgTotal, pkgVersion: state.pkgVersion || '' };
          if (App.state.tab === 'home') App.refresh('home');
        }
      }).catch(() => {});
    }
    if (!App.state.server) App.api.serverInfo().then(info => { App.state.server = info; App.refresh('home'); }).catch(() => {});
    //By leewheel 2026年11月6日 免费声明画在 canvas 上（源码里没有明文），每次进主页重画一遍，改窗口大小也跟着重画
    //By leewheel 2026年11月10日 右侧铭牌同样改成 canvas（两行文案），与左侧一起重画
    drawFreeNotice();
    drawFreeMeta();
    if (!App.state.freeNoticeResize) {
      App.state.freeNoticeResize = true;
      window.addEventListener('resize', () => { if (App.state.tab === 'home') { drawFreeNotice(); drawFreeMeta(); } });
    }
    if (!App.state.dashboard) refreshDashboard();
    if (!App.state.network && App.state.server?.path) App.api.networkInfo().then(data => { App.state.network = data.network; if (App.state.tab === 'home') App.render(); }).catch(() => {});
    if (!App.state.verify && !App.state.verifying && App.state.server?.path && !App.state.server.assembly?.needed) runVerify(false);
    //By leewheel 2026-11-03 主页的日志窗口每 2.5 秒刷一次（离开主页自动停）
    if (App.state.server?.path) startServerLog();
  },
};

// A very small Markdown reader: headings, bullets, ordered lists, tables, code fences, bold, inline code.
//By leewheel 2026年11月5日 机器人帮助要用表格和代码块，这里补齐（表格/``` 代码块/有序列表/分隔线），
// 其余仍是纯文本；所有内容先 esc()，不执行任何 HTML。
function markdownLite(text) {
  const inline = line => esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let list = null;         // 'ul' | 'ol'
  let paragraph = false;
  let fence = null;        // 代码块缓冲
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const line = raw.trimEnd();
    // 代码块
    if (/^\s*```/.test(line)) {
      if (fence) { out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`); fence = null; }
      else { closeList(); fence = []; }
      paragraph = false;
      continue;
    }
    if (fence) { fence.push(raw); continue; }
    // 表格：当前行有 |，下一行是 |---|
    if (/\|/.test(line) && index + 1 < lines.length && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[index + 1]) && /-/.test(lines[index + 1])) {
      closeList();
      const cells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim());
      const head = cells(line);
      const body = [];
      index += 2;
      while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim()) { body.push(cells(lines[index])); index++; }
      index--;
      out.push(`<table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      paragraph = false;
      continue;
    }
    const bullet = line.match(/^\s*[-*] (.*)$/);
    const ordered = line.match(/^\s*\d+[.)] (.*)$/);
    if (list === 'ul' && !bullet && !/^\s{2,}\S/.test(line)) closeList();
    if (list === 'ol' && !ordered && !/^\s{2,}\S/.test(line)) closeList();
    if (/^#{1,2} /.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^#+ /, ''))}</h3>`); }
    else if (/^#{3,} /.test(line)) { closeList(); out.push(`<h4>${inline(line.replace(/^#+ /, ''))}</h4>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { closeList(); out.push('<hr>'); }
    else if (bullet) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(bullet[1])}</li>`); }
    else if (ordered) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(ordered[1])}</li>`); }
    else if (list && /^\s{2,}\S/.test(line)) out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    // Lines of the same paragraph (wrapped in the file) are joined back.
    else if (line.trim() && paragraph) out[out.length - 1] = out[out.length - 1].replace(/<\/p>$/, ` ${inline(line.trim())}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    paragraph = !!line.trim() && !bullet && !ordered && !/^#/.test(line) && !list;
  }
  if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  closeList();
  return out.join('');
}

function showNews(area) {
  const item = (App.state.news || []).find(entry => entry.area === area);
  if (!item) return;
  const label = { client: t('classic.newsGame', 'Game'), server: t('classic.newsServer', 'Server'), bots: t('classic.newsBots', 'Bots') }[area] || area;
  const date = item.publishedAt ? new Date(item.publishedAt).toLocaleString(I18N.lang, { dateStyle: 'long', timeStyle: 'short' }) : '';
  const facts = item.files ? t('news.facts', '{files} files, {size} in all (only the changed ones are downloaded)', { files: formatNumber(item.files), size: formatBytes(item.bytes) }) : '';
  dialog.open(`${dialog.header(item.version, `${label}${date ? ` · ${date}` : ''}`)}<div class="dialog-content patch-notes">
    ${item.notes.length ? `<h3>${esc(t('news.notes', 'In this release'))}</h3><ul>${item.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('classic.noNotes', 'No notes for this release.'))}</p>`}
    ${facts ? `<p class="muted small">${esc(facts)}</p>` : ''}
    ${item.changelog ? `<div class="changelog"><p class="eyebrow">${esc(t('news.changelog', 'Changelog of the installed bots'))}</p>${markdownLite(item.changelog)}</div>` : ''}
  </div>`, 'wide');
}

async function refreshDashboard() {
  try { App.state.dashboard = await App.api.dashboardStatus(); } catch { App.state.dashboard = { available: false }; }
  if (App.state.tab === 'home') App.render();
}

Object.assign(App.actions, {
  'verify-run': () => runVerify(false),
  'install-server': button => guard(async () => {
    const info = await App.api.downloadInstall();
    if (!info) return;
    App.state.server = info;
    toast(t('install.done', 'The server is installed. Start it from the home page.'), 'success');
    await App.reloadAll();
  }, button),
  'install-cancel': () => App.api.downloadCancel(),
  // The game folder chosen from the preparation card: the preparation starts at once.
  'assemble-locate': button => guard(async () => {
    const info = await App.api.locateClient();
    if (!info) return;
    App.state.client = info;
    App.render();
    refreshAddon(true);
    App.actions['assemble-run']();
  }, button),
  'assemble-run': button => guard(async () => {
    App.state.assembleError = '';
    App.state.assembleProgress = { step: 'dbc', text: t('assemble.starting', 'Starting…') };
    App.render();
    App.state.server = await App.api.assembleRun();
    toast(t('assemble.ready', 'The server is ready. Start it from the home page.'), 'success');
    App.render();
  }, button),
  'server-restart': button => guard(async () => {
    App.state.server = await App.api.restartServer();
    toast(t('assemble.restarted', 'The server started again with the new navigation maps.'), 'success');
    App.render();
  }, button),
  'assemble-refresh': button => guard(async () => {
    if (!await confirmDialog({ title: t('assemble.refreshTitle', 'Update the map data?'), body: esc(t('assemble.refreshBody', 'The game tables, terrain and vmaps are taken again from your game (about 30 minutes). The server is stopped first if it runs; your characters, the bots and the database stay.')), confirm: t('assemble.refresh', 'Update the data') })) return;
    App.state.assembleError = '';
    App.state.assembleProgress = { step: 'dbc', text: t('assemble.starting', 'Starting…') };
    if (App.state.server?.assembly) Object.assign(App.state.server.assembly, { needed: true, running: true, clientChanged: false });
    App.render();
    try { App.state.server = await App.api.assembleRefresh({ stop: true }); } finally { if (App.state.server?.assembly?.running) App.state.server = await App.api.serverInfo(); }
    toast(t('assemble.ready', 'The server is ready. Start it from the home page.'), 'success');
    App.render();
  }, button),
  'assemble-mmaps-pause': button => guard(async () => {
    App.state.mmapsAsked = 0;
    const asm = await App.api.assembleMmapsPause();
    if (App.state.server) App.state.server.assembly = asm;
    App.render();
  }, button),
  'assemble-mmaps': button => guard(async () => {
    // Shown as running at once: the build takes a few seconds to say so itself.
    App.state.mmapsAsked = Date.now();
    App.render();
    await App.api.assembleMmaps();
    App.state.server = await App.api.serverInfo();
    App.render();
  }, button),
  'feed-open': target => guard(async () => {
    const result = await App.api.openFeedLink(target.dataset.kind);
    toast(result?.copied ? t('feed.copied', 'Your browser could not be opened: the link is copied, paste it in your browser.') : t('feed.opened', 'Opened in your browser.'), 'success');
  }, target),
  'launcher-install': button => guard(() => App.api.installLauncher(), button),
  'world-force-stop': button => guard(async () => {
    if (!await confirmDialog({ title: t('home.forceStop', 'Force the world to stop'), body: esc(t('home.forceStopBody', 'Only the worldserver of this server is ended; the database keeps everything saved. What players did since the last save may be lost. The rest of the server is then stopped normally.')), confirm: t('home.forceStop', 'Force the world to stop'), danger: true })) return;
    App.state.server = await App.api.forceStopWorld();
    App.state.live = null;
    toast(t('home.forceStopped', 'The server is stopped. You can start it again.'), 'success');
    App.render();
  }, button),
  // Settings > About: look for a new launcher now (the result also shows on the home page banner).
  // The folded section stays as the player left it when the page is drawn again.
  'troubleshoot-toggle': (summary, event) => { event.preventDefault(); App.state.troubleshootOpen = !summary.parentElement.open; summary.parentElement.open = App.state.troubleshootOpen; },
  'reinstall-run': button => guard(async () => {
    const info = App.state.reinstall || await App.api.reinstallPrepare();
    if (!info.game) { toast(t('reinstall.noGame', 'Show the launcher your game folder first (Play tab): the new server is prepared from it.'), 'error'); return; }
    if (info.free < info.need) { toast(t('reinstall.space', 'Free at least {size} more on this disk first.', { size: formatBytes(info.need - info.free) }), 'error'); return; }
    if (!await confirmDialog({ title: t('reinstall.title', 'Reinstall CoA + Bots completely?'), body: esc(t('reinstall.body', 'Everything is installed again from scratch in a new folder ({folder}). Your accounts, characters, bots, realms and settings are copied into it, and your current server stays untouched as long as the new one has not started. About 40 minutes, {size} of disk space. Close the game; the server is stopped during the reinstall.', { folder: info.folder, size: formatBytes(info.need) })), confirm: t('reinstall.go', 'Reinstall') })) return;
    Object.assign(App.state, { reinstallRunning: true, reinstallDone: false, upgradeLog: [] });
    App.render();
    try {
      await App.api.reinstallRun();
      App.state.reinstallDone = true;
      toast(t('reinstall.done', 'Reinstalled: the launcher now uses the new server. The previous one can be deleted in Troubleshooting.'), 'success');
    } finally {
      App.state.reinstallRunning = false;
      App.state.reinstall = null;
      await App.reloadAll();
    }
  }, button),
  'reinstall-remove-old': button => guard(async () => {
    const old = App.state.reinstall?.previous;
    if (!old) return;
    if (!await confirmDialog({ title: t('reinstall.removeTitle', 'Delete the previous server?'), body: esc(t('reinstall.removeBody', '{path} is deleted for good ({size} freed). Its backups move to the Backups folder of the current server first.', { path: old.path, size: formatBytes(old.bytes) })), confirm: t('reinstall.removeGo', 'Delete'), danger: true })) return;
    App.state.server = await App.api.reinstallRemoveOld();
    App.state.reinstall = null;
    App.state.reinstallDone = false;
    toast(t('reinstall.removed', 'The previous server is deleted.'), 'success');
    App.render();
  }, button),
  // Not safe, and said so: the server data no longer match the game.
  'assemble-keep-client': button => guard(async () => {
    if (!await confirmDialog({ title: t('assemble.keepTitle', 'Keep your modified game files?'), body: esc(t('assemble.keepBody', "The server data won't match your game. Things can go wrong in game (spells, maps, crashes) and we can't support it. Keep anyway?")), confirm: t('assemble.keepGo', 'Keep anyway'), danger: true })) return;
    App.state.server = await App.api.assembleKeepClient();
    App.state.verify = null;
    App.render();
  }, button),
  'mmaps-update': button => guard(async () => {
    if (!await confirmDialog({ title: t('verify.mmapsUpdateTitle', 'Download the navigation maps?'), body: esc(t('verify.mmapsUpdateBody', 'About 1.9 GB. The maps of this server are replaced one by one; the server can keep running.')), confirm: t('verify.mmapsUpdateGo', 'Download') })) return;
    await App.api.assembleMmapsUpdate();
    App.state.server = await App.api.serverInfo();
    toast(t('verify.mmapsUpdated', 'The navigation maps are up to date.'), 'success');
    runVerify(false);
  }, button),
  'mmaps-rebuild': button => guard(async () => {
    if (!await confirmDialog({ title: t('verify.mmapsTitle', 'Rebuild the navigation maps?'), body: esc(t('verify.mmapsBody', 'Every map is built again from your game data, in the background (about an hour). The bots keep the current maps until each new one is ready.')), confirm: t('verify.mmapsGo', 'Rebuild') })) return;
    App.state.mmapsAsked = Date.now();
    await App.api.assembleMmapsRebuild();
    App.state.server = await App.api.serverInfo();
    toast(t('verify.mmapsStarted', 'The navigation maps are being rebuilt in the background: their progress is on the home page.'), 'success');
    runVerify(false);
  }, button),
  'logs-clean': button => guard(async () => {
    if (!await confirmDialog({ title: t('verify.logsCleanTitle', 'Clean the logs?'), body: esc(t('verify.logsCleanBody', 'The old logs (.log.1 …) are deleted, and the big current ones too when the server is stopped. They only matter to look back at a past problem: send a support report first if you need them.')), confirm: t('verify.logsClean', 'Clean the logs') })) return;
    const result = await App.api.cleanLogs();
    toast(t('verify.logsCleaned', '{n} log file(s) deleted, {size} freed.', { n: result.deleted, size: formatBytes(result.freed) }) + (result.kept && result.worldOn ? ` ${t('verify.logsKept', 'Stop the server to clean the {n} big log(s) in use too.', { n: result.kept })}` : ''), 'success');
    runVerify(false);
  }, button),
  'crashes-archive': button => guard(async () => {
    const moved = await App.api.archiveCrashes();
    toast(t('verify.crashesArchived', '{n} crash file(s) put away in Crashes\\archive.', { n: moved }), 'success');
    runVerify(false);
  }, button),
  'launcher-check': button => guard(async () => {
    toast('正在检查启动器更新…');
    //By leewheel 2026年11月9日 带 data-force="1" 的是「重试」：必须强查（否则 ready/skipped 状态会早退）
    const status = await App.api.checkLauncher(button?.dataset?.force === '1');
    App.state.launcherUpdate = status;
    const kind = status?.phase === 'error' ? 'error' : 'success';
    toast(status?.phase === 'downloading' || status?.phase === 'installing' ? '发现新版启动器，正在自动下载：首页会显示进度。' : status?.message || '启动器已是最新版本。', kind);
    App.render();
  }, button),
  //By leewheel 2026年11月9日 自更新两个动作：取消下载 / 忽略这个版本
  //By leewheel 2026年11月9日 打开「为什么起不来」诊断弹窗
  'server-diagnose': button => guard(() => showDiagnose(), button),
  'diag-copy': button => guard(async () => {
    const text = decodeURIComponent(button.dataset.payload || '');
    if (!text) { toast('没有可复制的诊断内容。'); return; }
    try { await navigator.clipboard.writeText(text); toast('诊断内容已复制，可以直接发给老大。', 'success'); }
    catch { toast('复制失败：请手动选中文本复制。', 'error'); }
  }, button),
  'launcher-cancel': button => guard(async () => {
    App.state.launcherUpdate = await App.api.cancelLauncher();
    toast('已取消下载新版启动器。');
    App.render();
  }, button),
  'launcher-skip': button => guard(async () => {
    App.state.launcherUpdate = await App.api.skipLauncher();
    toast('已忽略这个启动器版本（下次发布的新版本仍会提示）。');
    App.render();
  }, button),
  'feed-news': target => {
    const item = App.state.feed?.news?.[Number(target.dataset.index)];
    if (!item) return;
    dialog.open(`${dialog.header(item.title, item.date)}<div class="dialog-content patch-notes">${markdownLite(item.text)}</div>${item.url ? `<footer class="dialog-foot"><button class="button primary" data-action="feed-news-link" data-index="${esc(target.dataset.index)}">${icon('external')}${esc(t('home.readMore', 'Read more'))}</button></footer>` : ''}`, 'wide');
  },
  'note-open': target => {
    const item = App.state.notes?.[Number(target.dataset.index)];
    if (!item) return;
    dialog.open(`${dialog.header(item.title, item.date)}<div class="dialog-content patch-notes">${markdownLite(item.text)}</div>${item.url ? `<footer class="dialog-foot"><button class="button primary" data-action="note-link" data-index="${esc(target.dataset.index)}">${icon('external')}${esc(t('home.readMore', 'Read more'))}</button></footer>` : ''}`, 'wide');
  },
  'note-link': target => guard(() => App.api.openNote(target.dataset.index)),
  'feed-news-link': target => guard(() => App.api.openFeedLink(`news:${target.dataset.index}`)),
  'news-open': target => showNews(target.dataset.area),
  // "install:bots-install": open Management > Installation, then run that action there.
  'verify-run-in': button => {
    const [tab, action] = button.dataset.id.split(':');
    App.state.srvTab = tab;
    App.go('server');
    loadServerTab(true);
    const target = document.createElement('button');
    App.actions[action]?.(target);
  },
  'verify-deep': () => runVerify(true),
  //By leewheel 2026-11-03 日志窗口的两个按钮
  'log-refresh': () => refreshServerLog(),
  'log-toggle': () => { const body = document.getElementById('server-log-body'); if (body) body.hidden = !body.hidden; },
  //By leewheel 2026-11-03 「检查更新」= 检查【服务端与客户端】的新版本（GitHub releases），并可直接下载安装
  'verify-update': () => showReleaseUpdate(),
  //By leewheel 2026年11月4日 首页横幅上的“立即更新”：直接打开同一个更新弹窗
  'release-open': () => showReleaseUpdate(),
  //By leewheel 2026年11月8日 横幅上的「忽略」：立刻隐藏横幅，并把版本记进设置，之后不再提示这一个版本
  'release-ignore': async target => {
    const version = String(target?.dataset?.version || App.state.releaseAvailable?.version || '');
    App.state.releaseAvailable = null;
    if (App.state.tab === 'home') App.refresh('home');
    if (!version) return;
    try { await App.api.releaseIgnore(version); } catch { /* 记不上也不影响本次隐藏 */ }
    toast(t('release.ignored', '已忽略 {v}：不会再提示这个版本', { v: version }));
  },
  // 更新完成后重新检查：清掉“已完成”状态，重新走一遍检查流程
  'release-recheck': () => { App.state.releaseRun = null; showReleaseUpdate(); },
  //By leewheel 2026年11月5日 更新失败：错误可复制、可打开日志、可重试（老大要求）
  'release-copy-error': async () => {
    const text = String(document.getElementById('update-error-text')?.textContent || App.state.releaseRun?.error || '').trim();
    if (!text) { toast('没有可复制的错误信息'); return; }
    let done = false;
    try { if (App.api.copyText) { await App.api.copyText(text); done = true; } } catch { done = false; }
    if (!done) { try { await navigator.clipboard.writeText(text); done = true; } catch { done = false; } }
    toast(done ? '错误信息已复制，直接粘贴发出来即可' : '复制失败：请用鼠标选中错误文本，按 Ctrl+C', done ? 'success' : 'warning');
  },
  'release-error-log': () => {
    const target = App.state.releaseRun?.errorLog;
    if (!target) { toast('这次没有生成日志文件'); return; }
    guard(async () => { await App.api.openPath(target); });
  },
  'release-retry': () => { App.state.releaseRun = null; showReleaseUpdate(); },
  'release-apply': button => applyReleaseUpdate(button),
  //By leewheel 2026年11月6日 强制更新 = 从 GitHub 重新下载最新 zip 覆盖安装（不看版本号）
  //By leewheel 2026年11月6日 镜像测速：给最新更新包的所有下载源各测 256KB，按速度排序并缓存，
  // 之后“开始更新/强制更新”会优先用最快的源（结果在弹窗里列出来，玩家自己也能看到谁快）。
  'release-speedtest': button => guard(async () => {
    if (button) button.disabled = true;
    const box = document.getElementById('release-progress');
    if (box) box.innerHTML = `<p class="release-status">正在测速，请稍等（每个源最多 8 秒）…</p>`;
    try {
      const result = await App.api.mirrorSpeedtest();
      if (!result?.ok) { toast(result?.message || '测速失败', 'warning'); if (box) box.innerHTML = ''; return; }
      const rows = (result.list || []).map(item => {
        const host = (() => { try { return new URL(item.url).host; } catch { return item.url; } })();
        return item.ok
          ? `<li>${esc(host)} · <strong>${esc(item.kbps >= 1024 ? `${(item.kbps / 1024).toFixed(1)} MB/s` : `${item.kbps} KB/s`)}</strong> · 首字节 ${item.firstByteMs}ms</li>`
          : `<li class="bad">${esc(host)} · ${esc(item.reason || String(item.error || '').slice(0, 60))}</li>`;
      }).join('');
      if (box) box.innerHTML = `<p class="release-status ok">测速完成：下载会自动用最快的源</p><ul class="release-mirrors">${rows}</ul>`;
    } catch (error) {
      toast(`测速失败：${String(error?.message || error)}`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }),
  //By leewheel 2026年11月6日 打开数据库导入日志（逐条 OK/FAIL）
  'release-sql-log': button => guard(async () => {
    if (button) button.disabled = true;
    try {
      const result = await App.api.releaseSqlLog();
      if (!result?.ok) toast(result?.message || '没有导入日志', 'warning');
    } catch (error) {
      toast(`打开日志失败：${String(error?.message || error)}`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }, button),
  //By leewheel 2026年11月8日 强制更新改成“先选装到哪一版，再装”。
  // 老大要求：强制更新要能选装哪一个补丁。补丁是叠加的，所以选中一版 = 装到这一版为止
  // （目标 + 它之前还没装的补丁，按旧→新依次装），单装中间那个包等于跳过前置，最后必定跑不起来。
  'release-force-remote': button => guard(async () => {
    if (button) button.disabled = true;
    try {
      const info = await App.api.releaseList();
      if (!info?.ok) { toast(info?.message || '读取 GitHub 更新列表失败', 'warning'); return; }
      const list = (info.list || []).slice().reverse();
      if (!list.length) { toast('GitHub 上没有可安装的补丁（没有 zip 更新包）', 'warning'); return; }
      const rows = list.map(item => {
        const size = item.asset?.size ? `${(item.asset.size / 1048576).toFixed(1)} MB` : '';
        const tags = [
          item.installed ? '<em class="pick-tag ok">已装</em>' : '',
          //By leewheel 2026年11月10日 累积包：这一版的内容已经被后面某个累积包包含，不会再单独下载。
          item.coveredBy ? `<em class="pick-tag">已被 ${esc(item.coveredBy)} 包含</em>` : '',
          item.isFull ? '<em class="pick-tag">全量包</em>' : '<em class="pick-tag warn">增量包</em>',
          item.coveredByBaseline && !item.installed ? '<em class="pick-tag">整合包已含</em>' : '',
        ].join('');
        const when = item.publishedAt ? formatDate(item.publishedAt, true) : '';
        return `<li><button class="button ghost small pick-row" data-action="release-force-pick" data-version="${esc(item.version)}">
          <span class="pick-name"><strong>${esc(item.version)}</strong>${tags}</span>
          <span class="muted small">${esc(when)}${size ? ` · ${esc(size)}` : ''}</span>
        </button></li>`;
      }).join('');
      dialog.open(`${dialog.header('强制更新：选择要装到哪一版')}
        <div class="dialog-content">
          <p class="muted small">补丁是叠加的：选中的那一版会连同它之前还没装的补丁一起，按发布顺序依次安装。整合包已含的补丁自动跳过。选“装到最新版”＝一次性补齐所有缺失补丁。</p>
          <p class="muted small">标着「已被 X 包含」的旧版本不用单独装：X 那一个包里已经带着它的全部内容，选中 X 就是一次装完。</p>
          <ul class="notes release-picks">${rows}</ul>
        </div>
        <footer class="dialog-foot">
          <button class="button ghost" data-action="release-force-latest">装到最新版</button>
          <button class="button" data-action="dialog-close">取消</button>
        </footer>`);
    } catch (error) {
      toast(`读取更新列表失败：${String(error?.message || error)}`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }),
  'release-force-pick': button => { const version = button?.dataset?.version || ''; dialog.close(); forceRemote(version); },
  'release-force-latest': () => { dialog.close(); forceRemote(''); },
  //By leewheel 2026年11月6日 强制更新（本地包）：GitHub 没 zip 资产、或版本号相同但文件坏了时，
  // 选一个 CoA-Update-*.zip 直接重装，跳过版本比较（今天这种启动不了的情况就靠它救）。
  'release-local': button => guard(async () => {
    const file = await App.api.releaseLocalPick();
    if (!file) return;
    if (button) button.disabled = true;
    toast('开始强制更新…');
    try {
      const result = await App.api.releaseLocalZip({ path: file, importSql: true });
      toast(`强制更新完成：${result?.version || ''}`, 'success');
      App.state.releaseRun = null;
      showReleaseUpdate();
    } catch (error) {
      toast(`强制更新失败：${String(error?.message || error)}`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }),
  'release-page': () => { const url = App.state.releaseInfo?.latest?.url; if (url && App.api.openUrl) App.api.openUrl(url).catch(() => {}); },
  'release-history': () => showReleaseHistory(),
  'verify-copy': button => guard(async () => { await App.api.copyVersions(); toast(t('verify.copied', 'Versions copied: paste them on Discord.'), 'success'); }, button),
  'verify-fix': button => guard(async () => {
    const id = button.dataset.id;
    const ok = await confirmDialog({ title: t('verify.fixTitle', 'Apply this fix?'), body: esc(t('verify.fixBody', 'Only the setting or file named in the check is changed; a copy of any edited file is kept next to it.')), confirm: t('verify.fix', 'Fix') });
    if (!ok) return;
    App.state.verify = await App.api.verifyFix(id);
    toast(t('verify.fixed', 'Fixed. The checks were run again.'), 'success');
    App.render();
  }, button),
  'dashboard-start': button => guard(async () => { toast(t('home.dashboardStarting', 'Starting the dashboard…')); App.state.dashboard = await App.api.startDashboard(); await App.api.openDashboard(); App.render(); }, button),
  'dashboard-open': button => guard(() => App.api.openDashboard(), button),
  // Start, wait until it answers, then open its window.
  'dashboard-launch': button => guard(async () => {
    toast(t('home.dashboardStarting', 'Starting the dashboard…'));
    App.state.dashboard = await App.api.startDashboard();
    for (let i = 0; i < 20 && !App.state.dashboard?.running; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); App.state.dashboard = await App.api.dashboardStatus(); }
    if (App.state.dashboard?.running) await App.api.openDashboard();
    App.render();
  }, button),
  'dashboard-stop': button => guard(async () => { App.state.dashboard = await App.api.stopDashboard(); App.render(); }, button),
  // Who can join: this PC only, or other PCs. Kept by the launcher and written again after every update.
  'network-open': button => guard(async () => {
    const data = await App.api.networkInfo();
    App.state.network = data.network;
    const n = data.network;
    const authPort = data.ports?.auth || 3724;
    const worldPort = data.ports?.world || 8085;
    const suffix = authPort !== 3724 ? `:${authPort}` : '';
    const chips = data.lan.map(ip => `<button class="chip" data-action="network-ip" data-ip="${esc(ip)}">${icon('globe')}<span>${esc(ip)}</span></button>`).join('');
    dialog.open(`${dialog.header(t('net.title', 'Who can join'), t('net.subtitle', 'Kept by the launcher: written again after every update of the server'))}<div class="dialog-content">
      <label class="toggle-row"><input type="radio" name="net-mode" value="local" ${n.mode === 'local' ? 'checked' : ''}><span><strong>${esc(t('net.local', 'This PC only'))}</strong><small>${esc(t('net.localHint', 'The game on this PC connects to 127.0.0.1{suffix}. Nobody else can join.', { suffix }))}</small></span></label>
      <label class="toggle-row"><input type="radio" name="net-mode" value="open" ${n.mode === 'open' ? 'checked' : ''}><span><strong>${esc(t('net.open', 'Other PCs too (home network or Internet)'))}</strong><small>${esc(t('net.openHint', 'The server listens on every network card and gives the address below to the players.'))}</small></span></label>
      <div class="field-pair"><div class="field"><span>${esc(t('net.address', 'Address given to the players'))}</span><input id="net-address" value="${esc(n.address)}" spellcheck="false"><small>${esc(t('net.addressHint', 'Home: the IP of this PC. Internet: your public IP, ports {auth} and {world} forwarded to this PC.', { auth: authPort, world: worldPort }))}</small>${chips ? `<div class="button-row">${chips}</div>` : ''}</div>
      <div class="field"><span>${esc(t('net.name', 'Realm name'))}</span><input id="net-name" value="${esc(n.name)}" maxlength="32"></div></div>
      <div class="line-action">${icon('shield')}<span>${esc(t('net.firewall', 'Windows Firewall: open ports {auth} and {world} (administrator).', { auth: authPort, world: worldPort }))}</span><button class="button ghost small" data-action="network-firewall">${esc(t('net.firewallButton', 'Open the firewall'))}</button></div>
      <div class="line-action" title="Data\\enUS\\realmlist.wtf">${icon('user')}<span>${esc(t('net.friends', 'Your friends, in their realmlist.wtf:'))}<code id="net-friends" data-suffix="${esc(suffix)}">set realmlist ${esc(n.address)}${esc(suffix)}</code></span><button class="button ghost small" data-action="network-copy">${icon('copy')}${esc(t('common.copy', 'Copy'))}</button></div>
    </div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="network-save">${esc(t('common.save', 'Save'))}</button></footer>`, 'wide');
  }, button),
  'network-ip': button => { const input = $('#net-address'); if (input) input.value = button.dataset.ip; const open = $('input[name=net-mode][value=open]'); if (open) open.checked = true; friendsLine(); },
  'network-copy': async () => {
    const line = friendsLine();
    try { await navigator.clipboard.writeText(line); toast(t('net.copied', 'Copied: {line}', { line }), 'success'); }
    catch { toast(line); }
  },
  'network-save': button => guard(async () => {
    const mode = $('input[name=net-mode]:checked')?.value || 'local';
    const result = await App.api.saveNetwork({ mode, address: $('#net-address')?.value || '', name: $('#net-name')?.value || '' });
    App.state.network = result.network;
    dialog.close();
    refreshAddon();
    toast(result.running ? t('net.savedRestart', 'Saved. Restart the server for it to take effect.') : t('net.saved', 'Saved: the server uses it at its next start.'), 'success');
    App.render();
  }, button),
  'network-firewall': button => guard(async () => { await App.api.openFirewall(); toast(t('net.firewallDone', 'Firewall rules added.'), 'success'); }, button),
  // A clean instance: an empty folder, the repack and its bots installed there; the others stay as they are.
  'instance-new': () => {
    dialog.open(`${dialog.header(t('instance.title', 'Create a new server'), t('instance.subtitle', 'A clean instance in a folder of its own'))}<div class="dialog-content">
      <p>${esc(t('instance.body', 'Choose an empty folder: the repack and its bots are installed there, with a fresh database. Your current server is not touched and stays in "My servers".'))}</p>
      <label class="toggle-row"><input type="checkbox" id="instance-ports"><span><strong>${esc(t('instance.ports', 'Other ports, to run it at the same time as another server'))}</strong><small>${esc(t('instance.portsHint', 'Free ports are chosen (for example 3308, 3725, 8086). Players then set their realmlist to 127.0.0.1:3725. Without this, only one server runs at a time.'))}</small></span></label>
    </div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="instance-create">${icon('folder')}${esc(t('instance.choose', 'Choose an empty folder'))}</button></footer>`);
  },
  'instance-create': button => guard(async () => {
    const result = await App.api.createInstance({ otherPorts: $('#instance-ports')?.checked === true });
    if (!result) return;
    dialog.close();
    Object.assign(App.state, { server: result.info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, pending: {}, withBots: true, srvTab: 'install' });
    toast(result.ports ? t('instance.createdPorts', 'New server folder ready, on ports {mysql}/{auth}/{world}. Install it now.', { mysql: result.ports.mysqlPort, auth: result.ports.authPort, world: result.ports.worldPort }) : t('instance.created', 'New server folder ready. Install it now.'), 'success');
    App.go('server');
    refreshUpdates();
  }, button),
  'instance-pick': button => guard(async () => {
    const list = await App.api.instances();
    const rows = list.map(item => `<div class="history-row"><div><strong>${esc(item.path)}</strong><small>${esc([item.repack ? item.release || '?' : t('instance.empty', 'not installed yet'), item.bots ? `CoA Bots ${item.bots}` : '', item.ports?.auth ? t('instance.portsOf', 'ports {mysql}/{auth}/{world}', { mysql: item.ports.mysql, auth: item.ports.auth, world: item.ports.world }) : ''].filter(Boolean).join(' · '))}</small></div>${item.current ? `<span class="pill ok">${esc(t('instance.current', 'Current'))}</span>` : `<button class="button primary small" data-action="instance-switch" data-path="${esc(item.path)}" ${item.exists ? '' : 'disabled'}>${esc(t('instance.use', 'Use'))}</button><button class="button ghost small" data-action="instance-forget" data-path="${esc(item.path)}">${esc(t('instance.forget', 'Forget'))}</button>`}</div>`).join('');
    dialog.open(`${dialog.header(t('home.menuSwitch', 'My servers…').replace('…', ''), t('instance.listHint', 'Forgetting a server only removes it from this list: its folder stays on the disk.'))}<div class="dialog-content"><div class="history-list">${rows}</div></div><footer class="dialog-foot"><button class="button ghost" data-action="instance-add">${icon('folder')}${esc(t('home.menuAdd', 'Add a repack folder I unpacked…'))}</button><button class="button ghost" data-action="instance-new">${icon('download')}${esc(t('home.menuNew', 'Create a new server (clean instance)…'))}</button></footer>`, 'wide');
  }, button),
  // A repack unpacked by hand: its folder is chosen, checked, added to "My servers" and managed from now on.
  'instance-add': button => guard(async () => {
    const info = await App.api.chooseServer();
    if (!info) return;
    dialog.close();
    Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, botsError: '', pending: {} });
    toast(info.installed ? t('instance.switched', 'Now managing {path}.', { path: info.path }) : t('instance.notRepack', 'This folder is not a complete repack (Start_All_Server.bat, Core, mysql…): choose the folder that holds them.'), info.installed ? 'success' : 'error');
    App.go('home');
    refreshUpdates();
    if (info.installed) runVerify(false);
  }, button),
  'instance-switch': button => guard(async () => {
    const info = await App.api.switchInstance(button.dataset.path);
    dialog.close();
    Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, pending: {} });
    toast(t('instance.switched', 'Now managing {path}.', { path: info.path }), 'success');
    App.render();
    refreshUpdates();
    if (info.installed) runVerify(false);
  }, button),
  'instance-forget': button => guard(async () => { await App.api.forgetInstance(button.dataset.path); App.actions['instance-pick'](button); }, button),
});

// The line the friends put in their game: follows the address typed in "Who can join".
function friendsLine() {
  const code = $('#net-friends');
  const line = `set realmlist ${($('#net-address')?.value || '').trim() || '127.0.0.1'}${code?.dataset.suffix || ''}`;
  if (code) code.textContent = line;
  return line;
}
document.addEventListener('input', event => { if (event.target.id === 'net-address') friendsLine(); });

// "main-20261018-0ab739f5" reads "main-20261018" on the home cards (the full id stays in Verification).
//By leewheel 2026-11-05 原本只想砍掉末尾的 git 提交哈希（如 -a1b2c3d），但 [0-9a-f]{7,40} 把纯数字日期也吃了，
// 于是 “coa-publish-20261105” 被显示成 “coa-publish”，版本号看不全。现在要求末尾必须含 a-f 字母才算哈希。
function shortRelease(release) { return String(release || '').replace(/-(?=[0-9a-f]{7,40}$)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}$/i, ''); }
