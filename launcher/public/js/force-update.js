//By leewheel 2026年11月6日 强制更新：本机版本低于仓库 force-update.json 里的 minVersion 时，
// 全屏遮罩挡住所有操作，只能先更新——否则像“数据库缺表导致世界服起不来”这种问题，
// 玩家连更新入口都点不出来，只能手动改库。
(async () => {
  try {
    const info = await App.api.forceCheck();
    if (!info?.needsForce) return;
    App.state.forceUpdate = info;
    const mask = document.createElement('div');
    mask.id = 'force-update-mask';
    mask.innerHTML = `
      <div class="force-card">
        <h2>必须更新后才能使用</h2>
        <p class="force-version">当前版本 <b>${info.current || '未知'}</b> → 需要 <b>${info.minVersion}</b></p>
        <p class="force-reason">${info.reason || '这一版修复了影响启动的问题，旧版本无法正常使用。'}</p>
        <p class="muted small">点下面的按钮会打开更新窗口；更新完成后重新打开启动器即可。</p>
        <button class="button primary" data-force="update">立即更新</button>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-force="update"]').addEventListener('click', () => {
      if (App.actions['release-open']) App.actions['release-open']();
    });
  } catch { /* 读不到策略（离线）就不强制，别把玩家挡在门外 */ }
})();
