'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」打赏入口的二维码。
// 🔴 老大 2026-11-16 的要求：二维码必须**实时生成**，不许把他给的 10yuanToken.png 直接贴到界面上。
//   那张图是聊天里截图下来的收款码（上面一行 ¥10.00、中间一只猫头像加绿勾），
//   当资源分发既糊又难看，还得跟图一起进包。
// 做法：把那张图里**真正的收款链接**读出来（用解码器解出来的原文，不是猜的），存成常量，
//   每次打开弹窗由 qrcode 现场画一张新的 PNG 给界面用。链接换了只改下面这一处。
//End By leewheel
const QRCode = require('qrcode');

// 微信个人收款码（10 元）：解码 10yuanToken.png 得到的原文，逐字符核对过，别手改。
const PAYMENT_LINK = 'wxp://f2f1xK54LfOF4fuSPzcKvYk77whnJPVjCDvJz5yCorxdJ0SKYJ-i3Hx6CQvFkYWtvCGJ';

/**
 * 现场生成二维码，返回 PNG 的 data URL（界面直接用 <img src> 贴上去）。
 * width 480：界面上按 220 显示，等于 2 倍图，高分屏不发虚；margin 3 是扫码最稳的留白（太窄挑角度）。
 */
async function qrDataUrl() {
  return QRCode.toDataURL(PAYMENT_LINK, {
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 480,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

module.exports = { PAYMENT_LINK, qrDataUrl };
