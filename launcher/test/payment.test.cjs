'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」二维码的回归测试。
// 老大 2026-11-16 的硬要求：二维码必须实时生成、不许用他那张 10yuanToken.png 截图。
// 这里钉三件事：① 收款链接就是他那个码解出来的原文；② 返回的是真 PNG（不是贴图路径）；
// ③ 生成的码能被解码器读回同一串链接——只画不错，玩家扫了才有用。
const test = require('node:test');
const assert = require('node:assert/strict');

const payment = require('../src/payment.cjs');

const EXPECTED = 'wxp://f2f1xK54LfOF4fuSPzcKvYk77whnJPVjCDvJz5yCorxdJ0SKYJ-i3Hx6CQvFkYWtvCGJ';

test('收款链接就是 10yuanToken.png 解码出来的那一串', () => {
  assert.equal(payment.PAYMENT_LINK, EXPECTED);
  assert.ok(payment.PAYMENT_LINK.startsWith('wxp://'), '微信个人收款码的链接以 wxp:// 开头');
});

test('qrDataUrl 返回内联 PNG（不读磁盘上的任何图片）', async () => {
  const url = await payment.qrDataUrl();
  assert.ok(url.startsWith('data:image/png;base64,'), '必须是 PNG data URL');
  const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.length > 1000, '二维码 PNG 不该只有几十字节');
});

test('生成的二维码能被解回同一条链接', async t => {
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
  assert.equal(png.width, 480);
  assert.equal(png.height, 480);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(code, '画出来的图必须是一个可识别的二维码');
  assert.equal(code.data, payment.PAYMENT_LINK);
});
