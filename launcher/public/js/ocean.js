'use strict';
//By leewheel 2026-11-03
// 背景画布：暗色水面 + 一束从上方打下来的光 + 向上漂浮的星点。
// 原来右下角画的那只鱿鱼（触手/身体/眼睛）已按老大要求整段删除，其它界面也不再出现。
const Ocean = (() => {
  let canvas;
  let ctx;
  let width = 0;
  let height = 0;
  let scale = 1;
  let frame = 0;
  let still = false;
  let motes = [];

  function css(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function resize() {
    if (!canvas) return;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    motes = Array.from({ length: Math.round((width * height) / 14000) }, () => ({
      x: Math.random() * width, y: Math.random() * height, r: 0.6 + Math.random() * 1.8,
      v: 0.08 + Math.random() * 0.25, drift: Math.random() * Math.PI * 2, glow: Math.random(),
    }));
    if (still) draw(0);
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    // 水面透下来的光
    const ray = ctx.createRadialGradient(width * 0.3, -height * 0.2, 10, width * 0.3, -height * 0.2, height * 1.1);
    ray.addColorStop(0, css('--surface-light', 'rgba(90, 200, 220, 0.20)'));
    ray.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(0, 0, width, height);
    // 向上漂的星点
    ctx.fillStyle = css('--mote', '#7ff5e3');
    for (const mote of motes) {
      if (!still) {
        mote.y -= mote.v;
        mote.x += Math.sin(time * 0.3 + mote.drift) * 0.12;
        if (mote.y < -4) { mote.y = height + 4; mote.x = Math.random() * width; }
      }
      ctx.globalAlpha = 0.18 + 0.35 * Math.abs(Math.sin(time * 0.6 + mote.glow * 6));
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    draw(now / 1000);
    frame = requestAnimationFrame(loop);
  }

  return {
    start(element, reduceMotion) {
      canvas = element;
      ctx = canvas.getContext('2d');
      still = reduceMotion;
      resize();
      window.addEventListener('resize', resize);
      cancelAnimationFrame(frame);
      if (still) draw(0); else frame = requestAnimationFrame(loop);
    },
    setStill(value) {
      still = value;
      cancelAnimationFrame(frame);
      if (still) draw(0); else frame = requestAnimationFrame(loop);
    },
  };
})();
