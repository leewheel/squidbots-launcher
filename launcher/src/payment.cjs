'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」打赏入口的二维码。
// 🔴 老大 2026-11-16 的要求：二维码必须**实时生成**，不许把他给的 10yuanToken.png 直接贴到界面上。
//By leewheel 2026年11月17日 老大改了口径：二维码里不再放微信收款链接，改放**本次打赏结项的一段话**
//（40 元善款 + 我自己倒贴 10 元买腾讯 1000 点积分），扫码看到的就是这段话。
// 内容只在下面这一处，改文案不用动别的地方。
//End By leewheel
const QRCode = require('qrcode');

// 二维码内容（老大 2026-11-17 亲自给的原文，一字不改）
const QR_TEXT = '经过16日晚间的测试，共获取善款40元整，我倒贴10元后购买了腾讯1000点积分，由此可见呵.....感谢四位大佬！';

/**
 * 现场生成二维码，返回 PNG 的 data URL（界面直接用 <img src> 贴上去）。
 * width 480：界面上按 220 显示，等于 2 倍图，高分屏不发虚；margin 3 是扫码最稳的留白（太窄挑角度）。
 * 中文按 UTF-8 编码进 byte 模式：这段 55 个字约 160 字节，qrcode 会自动选到合适的版本；
 * 纠错等级 M 在“屏幕反光/斜着扫”时最稳。
 */
async function qrDataUrl() {
  return QRCode.toDataURL(QR_TEXT, {
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 480,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

module.exports = { QR_TEXT, qrDataUrl };
