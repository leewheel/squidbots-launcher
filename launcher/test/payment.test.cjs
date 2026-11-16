'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」二维码的回归测试。
// 老大 2026-11-16 的硬要求：二维码必须实时生成、不许用他那张 10yuanToken.png 截图。
//By leewheel 2026年11月17日 二维码内容改成“扫码看这段话”。第一版把中文直接编码进二维码，
// 微信扫出「不支持显示二维码中的文字」，所以改成指向 TOKEN.md 页面的链接。
// 这里钉三件事：① 二维码里是那个链接；② 返回的是真 PNG（不是贴图路径）；
// ③ 生成的码能被解码器读回同一个链接 —— 只画不错，玩家扫了才有用。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const payment = require('../src/payment.cjs');

const EXPECTED_URL = 'https://github.com/leewheel/squidbots-launcher/blob/main/TOKEN.md';
const EXPECTED_PAY = 'wxp://f2f1xK54LfOF4fuSPzcKvYk77whnJPVjCDvJz5yCorxdJ0SKYJ-i3Hx6CQvFkYWtvCGJ';

test('二维码指向 TOKEN.md 页面（微信只认链接，纯文字码不显示）', () => {
  assert.equal(payment.QR_URL, EXPECTED_URL);
  assert.ok(payment.QR_URL.startsWith('https://'), '必须是 https 链接');
});

test('点「可以」后出的收款码就是微信个人收款码（wxp://）', () => {
  assert.equal(payment.PAY_URL, EXPECTED_PAY);
  assert.ok(payment.PAY_URL.startsWith('wxp://'), '微信个人收款码以 wxp:// 开头');
});

test('页面正文就是老大那段话，且与仓库里的 TOKEN.md 对得上', () => {
  const expected = '经过16日晚间的测试，共获取善款40元整，我倒贴10元后购买了腾讯1000点积分，由此可见呵.....感谢四位大佬！';
  assert.equal(payment.QR_TEXT, expected);
  // TOKEN.md 与代码不在同一个包里（页面在仓库根），打包版里读不到就跳过这一步
  const page = path.join(__dirname, '..', '..', 'TOKEN.md');
  if (!fs.existsSync(page)) return;
  const text = fs.readFileSync(page, 'utf8');
  assert.ok(text.includes(expected), 'TOKEN.md 里必须包含这段原话，否则扫码看到的就不是它');
});

test('qrDataUrl 返回内联 PNG（不读磁盘上的任何图片）', async () => {
  const url = await payment.qrDataUrl();
  assert.ok(url.startsWith('data:image/png;base64,'), '必须是 PNG data URL');
  const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.length > 1000, '二维码 PNG 不该只有几十字节');
});

test('生成的二维码能被解回同一个链接', async t => {
  let jsQR, PNG;
  try {
    jsQR = require('jsqr');
    PNG = require('pngjs').PNG;
  } catch {
    t.skip('本机没装解码器（jsqr/pngjs），跳过“扫得出来”这一条');
    return;
  }
  const url = await payment.qrDataUrl();
  const png = PNG.sync.read(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
  // qrcode 的 width 是“接近值”：按整数倍缩放，模块数除不尽时略小于要求。
  assert.equal(png.width, png.height, '二维码必须是正方形');
  assert.ok(png.width >= 400, `边长 ${png.width} 太小，高分屏会发虚`);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(code, '画出来的图必须是一个可识别的二维码');
  assert.equal(code.data, payment.QR_URL);

  // 收款码也要能被解回 wxp:// 链接，否则玩家扫了付不了钱
  const payUrl = await payment.payQrDataUrl();
  const payPng = PNG.sync.read(Buffer.from(payUrl.slice('data:image/png;base64,'.length), 'base64'));
  const payCode = jsQR(new Uint8ClampedArray(payPng.data), payPng.width, payPng.height);
  assert.ok(payCode, '收款码必须可识别');
  assert.equal(payCode.data, payment.PAY_URL);
});
