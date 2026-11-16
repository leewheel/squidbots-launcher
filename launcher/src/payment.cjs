'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」打赏入口的二维码：**实时生成**，不贴任何截图。
//By leewheel 2026年11月17日 二维码内容改成“扫码看这段话”。第一版直接把中文塞进二维码里，
// 老大用微信一扫报「不支持显示二维码中的文字」—— 微信只认链接，纯文字码它不显示。
// 所以改成指向一个页面（仓库里的 TOKEN.md，页面正文就是那段话），微信扫开就是内容。
//End By leewheel
const QRCode = require('qrcode');

// 扫码打开的页面（公开仓库，匿名可读；启动器本来就从 GitHub 更新，能玩就能打开这个链接）
const QR_URL = 'https://github.com/leewheel/squidbots-launcher/blob/main/TOKEN.md';

// 页面正文（与 TOKEN.md 保持一致，留一份在代码里便于核对内容改没改）
const QR_TEXT = '经过16日晚间的测试，共获取善款40元整，我倒贴10元后购买了腾讯1000点积分，由此可见呵.....感谢四位大佬！';

/**
 * 现场生成二维码，返回 PNG 的 data URL（界面直接用 <img src> 贴上去）。
 * width 480：界面上按 220 显示，等于 2 倍图，高分屏不发虚；margin 3 是扫码最稳的留白（太窄挑角度）。
 */
async function qrDataUrl() {
  return QRCode.toDataURL(QR_URL, {
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 480,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

module.exports = { QR_URL, QR_TEXT, qrDataUrl };
