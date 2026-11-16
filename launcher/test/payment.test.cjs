'use strict';
//By leewheel 2026年11月16日 「By Me Some Token」二维码的回归测试。
// 老大 2026-11-16 的硬要求：二维码必须实时生成、不许用他那张 10yuanToken.png 截图。
//By leewheel 2026年11月17日 二维码内容换成老大给的结项文案（不再放 wxp:// 收款链接）。
// 这里钉三件事：① 文案一字不差；② 返回的是真 PNG（不是贴图路径）；
// ③ 生成的码能被解码器读回同一段文字 —— 只画不错，玩家扫了才有用。
const test = require('node:test');
const assert = require('node:assert/strict');

const payment = require('../src/payment.cjs');

const EXPECTED = '经过16日晚间的测试，共获取善款40元整，我倒贴10元后购买了腾讯1000点积分，由此可见呵.....感谢四位大佬！';

test('二维码内容就是老大给的那段结项文案', () => {
  assert.equal(payment.QR_TEXT, EXPECTED);
});

test('qrDataUrl 返回内联 PNG（不读磁盘上的任何图片）', async () => {
  const url = await payment.qrDataUrl();
  assert.ok(url.startsWith('data:image/png;base64,'), '必须是 PNG data URL');
  const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.length > 1000, '二维码 PNG 不该只有几十字节');
});

test('生成的二维码能被解回同一段中文', async t => {
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
  // qrcode 的 width 是“接近值”：它按 整数倍缩放，模块数除不尽时会略小于要求（实测 479）。
  // 这里只要求正方、够大、够清晰，不钉死像素。
  assert.equal(png.width, png.height, '二维码必须是正方形');
  assert.ok(png.width >= 400, `边长 ${png.width} 太小，高分屏会发虚`);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(code, '画出来的图必须是一个可识别的二维码');
  // 解码器对 byte 模式会给 UTF-8 结果；万一它按 latin1 解，至少字节序列必须一致
  const ok = code.data === payment.QR_TEXT
    || Buffer.from(code.binaryData || []).toString('utf8') === payment.QR_TEXT;
  assert.ok(ok, `解出来的内容对不上：${JSON.stringify(String(code.data).slice(0, 60))}`);
});
