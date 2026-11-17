'use strict';
//By leewheel 2026年11月16日 打赏弹窗（老大 2026-11-16 定的样子）。
//By leewheel 2026年11月17日 走完整条链路：第一屏 → 「可以」→ 真正的收款码 → 「大爷赏你了」→ 感谢窗 → 全关。
//By leewheel 2026年11月18日 老大定案：只保留打赏版，且**第一个画面直接就是收款码**，标题「By Me Some Token」改中文「打赏Token」。
//  流程简化成：点侧栏「打赏Token」→ 收款码（现画）→「大爷赏你了」→ 感谢窗 2.6 秒 → 全部关掉。
//  第一屏那段“结项文案二维码 + 可以”整屏删除，不再有中间步骤。
//  二维码一律由主进程 src\payment.cjs 现场画，界面里没有任何图片文件 —— 这是“不许用截图”这条要求的保证方式。
let tokenCloseTimer = null;

// 标题下那行小字（老大要求）：说明码是现场生成的，宽度不超过二维码
const TOKEN_SUB = '实时生成二维码，不会被篡改';
//By leewheel 2026年11月18日 标题改中文：老大说「By Me Some Token」不直观
const TOKEN_TITLE = '打赏Token';

// 首屏 = 收款码（wxp:// 微信个人收款码），只留一个「大爷赏你了」
function tokenDialogOpen() {
  clearTimeout(tokenCloseTimer);
  tokenCloseTimer = null;
  dialog.open(
    `<div class="token-box" id="token-box-pay">
      <h2 class="token-title">${TOKEN_TITLE}</h2>
      <p class="token-sub">${TOKEN_SUB}</p>
      <div class="token-qr" id="token-pay">${skeleton(3)}</div>
      <p class="token-note">仅用于本项目的Token购买(￥10元)</p>
      <footer class="dialog-foot token-foot">
        <button class="button ghost" type="button" data-action="token-no">滚!臭要饭的!</button>
        <button class="button primary" type="button" data-action="token-paid">大爷赏你了</button>
      </footer>
    </div>`,
    'small token',
  );
  // 打开就现画：每次进来都是新生成的二维码，不缓存、不落盘
  guard(async () => {
    const result = await App.api.tokenPay();
    const box = document.getElementById('token-pay');
    if (!box || !result?.dataUrl) return;
    box.innerHTML = `<img class="token-image" src="${esc(result.dataUrl)}" alt="Token 收款码">`;
  });
}

// 「大爷赏你了」：关掉收款码，弹感谢窗口，2.6 秒后把弹窗全部关掉
function tokenDialogThanks() {
  const element = $('#dialog');
  if (element.open) element.close();
  dialog.open(
    `<div class="token-box" id="token-thanks-box">
      <h2 class="token-title">${TOKEN_TITLE}</h2>
      <p class="token-thanks" id="token-thanks">${icon('heart')}<span>感谢你为广大群友的事业做出贡献</span></p>
    </div>`,
    'small token',
  );
  clearTimeout(tokenCloseTimer);
  tokenCloseTimer = setTimeout(() => {
    if (document.getElementById('token-thanks')) dialog.close();
    tokenCloseTimer = null;
  }, 2600);
}

App.actions['token-open'] = () => tokenDialogOpen();
App.actions['token-paid'] = () => tokenDialogThanks();
//By leewheel 2026年11月18日 老大要求补一个「滚!臭要饭的!」：点了直接关掉弹窗，什么都不发生
App.actions['token-no'] = () => {
  clearTimeout(tokenCloseTimer);
  tokenCloseTimer = null;
  dialog.close();
};
