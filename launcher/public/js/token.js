'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」打赏弹窗（老大 2026-11-16 定的样子）：
//   对话框正上方大标题 BY ME SOME TOKEN → 中间实时生成的二维码 → 下面一行说明
//   → 底部两个按钮「可以」/「给劳资滚！」。
// 二维码由主进程 src\payment.cjs 现场画，界面里没有任何图片文件，
// 所以那条“不许用截图”的要求是由生成方式本身保证的，不是靠人工检查。
//By leewheel 2026年11月17日 第一屏二维码改成“扫码看一段话”（指向 TOKEN.md，微信不吃纯文字码），
// 说明行补上价格「(￥10元)」；再加悬浮提示（悬浮显示那段话）与点击（弹纯文字框，5 秒自动关）。
//By leewheel 2026年11月17日 走完整条链路（老大要求）：
//   第一屏 → 点「可以」→ 关掉这一屏、出**真正的收款码** → 点「大爷赏你了」→ 感谢窗口 → 自动关掉所有弹窗。
//End By leewheel

let tokenCloseTimer = null;
let tokenTextTimer = null;
// 第一屏拿到的正文（主进程 payment.cjs 的 QR_TEXT，只此一份，界面不另抄一段）
let tokenPayload = '';
//By leewheel 2026年11月17日 标题下那行小字（老大要求）：说明码是现场生成的，宽度不超过二维码
const TOKEN_SUB = '实时生成二维码，不会被篡改';

function tokenDialogOpen() {
  clearTimeout(tokenCloseTimer);
  clearTimeout(tokenTextTimer);
  tokenCloseTimer = null;
  tokenTextTimer = null;
  dialog.open(
    `<div class="token-box" id="token-box">
      <h2 class="token-title">BY ME SOME TOKEN</h2>
      <p class="token-sub">${TOKEN_SUB}</p>
      <button class="token-qr" id="token-qr" type="button" data-action="token-text" aria-label="查看二维码内容">${skeleton(3)}</button>
      <p class="token-note">仅用于本项目的Token购买(￥10元)</p>
      <footer class="dialog-foot token-foot">
        <button class="button ghost" type="button" data-action="token-no">给劳资滚！</button>
        <button class="button primary" type="button" data-action="token-yes">可以</button>
      </footer>
    </div>`,
    'small token',
  );
  // 打开就现画一张：每次进来都是新生成的二维码，不缓存、不落盘
  guard(async () => {
    const result = await App.api.tokenQr();
    const box = document.getElementById('token-qr');
    if (!box || !result?.dataUrl) return;
    tokenPayload = result.text || '';
    // 悬浮提示就是那段话（原生 title，不额外做浮层，不会挡住二维码）
    if (tokenPayload) box.title = tokenPayload;
    box.innerHTML = `<img class="token-image" src="${esc(result.dataUrl)}" alt="Token 购买二维码">`;
  });
}

// 点二维码：先关掉二维码框，再弹出纯文字框，5 秒后自动消隐关闭
function tokenDialogText() {
  if (!tokenPayload) return;
  const element = $('#dialog');
  if (element.open) element.close();
  dialog.open(
    `<div class="token-box token-box-text" id="token-text-box">
      <h2 class="token-title">BY ME SOME TOKEN</h2>
      <p class="token-message">${esc(tokenPayload)}</p>
    </div>`,
    'small token token-text',
  );
  clearTimeout(tokenTextTimer);
  tokenTextTimer = setTimeout(() => {
    if (document.getElementById('token-text-box')) dialog.close();
    tokenTextTimer = null;
  }, 5000);
}

// 「可以」：关掉这一屏，出真正的收款码（wxp:// 微信个人收款码），只留一个「大爷赏你了」
function tokenDialogPay() {
  const element = $('#dialog');
  if (element.open) element.close();
  dialog.open(
    `<div class="token-box" id="token-box-pay">
      <h2 class="token-title">BY ME SOME TOKEN</h2>
      <p class="token-sub">${TOKEN_SUB}</p>
      <div class="token-qr" id="token-pay">${skeleton(3)}</div>
      <p class="token-note">仅用于本项目的Token购买(￥10元)</p>
      <footer class="dialog-foot token-foot">
        <button class="button primary" type="button" data-action="token-paid">大爷赏你了</button>
      </footer>
    </div>`,
    'small token',
  );
  // 收款码同样现画：扫码直接付钱，微信原生认 wxp://
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
      <h2 class="token-title">BY ME SOME TOKEN</h2>
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
App.actions['token-yes'] = () => tokenDialogPay();
App.actions['token-paid'] = () => tokenDialogThanks();
App.actions['token-text'] = () => tokenDialogText();
App.actions['token-no'] = () => {
  clearTimeout(tokenCloseTimer);
  clearTimeout(tokenTextTimer);
  tokenCloseTimer = null;
  tokenTextTimer = null;
  dialog.close();
};
