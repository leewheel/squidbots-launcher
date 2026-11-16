'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」打赏弹窗（老大 2026-11-16 定的样子）：
//   对话框正上方大标题 BY ME SOME TOKEN → 中间实时生成的二维码 → 下面一行说明
//   → 底部两个按钮「可以」/「给劳资滚！」。
// 二维码由主进程 src\payment.cjs 现场画，界面里没有任何图片文件，
// 所以那条“不许用截图”的要求是由生成方式本身保证的，不是靠人工检查。
//By leewheel 2026年11月17日 二维码内容与说明文字都换了：二维码里放结项文案，说明行补上价格「(￥10元)」。
//End By leewheel

let tokenCloseTimer = null;

function tokenDialogOpen() {
  clearTimeout(tokenCloseTimer);
  tokenCloseTimer = null;
  dialog.open(
    `<div class="token-box" id="token-box">
      <h2 class="token-title">BY ME SOME TOKEN</h2>
      <div class="token-qr" id="token-qr">${skeleton(3)}</div>
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
    box.innerHTML = `<img class="token-image" src="${esc(result.dataUrl)}" alt="Token 购买二维码">`;
  });
}

// 「可以」：先说一句谢谢，再关窗口（老大要求“关闭窗口前弹出一句”）
function tokenDialogThanks() {
  const box = document.getElementById('token-box');
  if (box) {
    box.innerHTML = `<h2 class="token-title">BY ME SOME TOKEN</h2>
      <p class="token-thanks" id="token-thanks">${icon('heart')}<span>感谢你为广大群友的事业做出贡献</span></p>`;
  }
  clearTimeout(tokenCloseTimer);
  // 2.6 秒够看清那句话；期间玩家把弹窗关了就不再硬关（那时 id 也不在了）
  tokenCloseTimer = setTimeout(() => {
    if (document.getElementById('token-thanks')) dialog.close();
    tokenCloseTimer = null;
  }, 2600);
}

App.actions['token-open'] = () => tokenDialogOpen();
App.actions['token-yes'] = () => tokenDialogThanks();
App.actions['token-no'] = () => { clearTimeout(tokenCloseTimer); tokenCloseTimer = null; dialog.close(); };
