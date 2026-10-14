// shot_update_bar.js — 截图查看「云端更新提示条」在实际看板上的呈现（一次性验证脚本）
//
// 目的：功能测试（test_update_notice.js）只断言 DOM 可见性，看不出"是否挡住了标题/是否被 iframe 裁切"。
// 本脚本用假云端触发提示条后截图：3 个直开看板 + 1 个壳页 iframe 场景。
// 不触碰生产数据（route 拦 Supabase）。

const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const OUT = path.join(__dirname, 'shots_bar');
fs.mkdirSync(OUT, { recursive: true });

const W = [{
  asin: 'B0TEST0001', start: '2026-09-12', end: '2026-09-12', name: '测试产品A',
  metrics: { orders: 3, sales: 59.97, adCost: 6.5, adClicks: 12, adOrders: 2, adImpr: 1500, adSales: 39.98 },
}];

const MOCK = { mode: 'empty' };
const body = () => JSON.stringify([{
  data: { catalog: [], asinMap: [], woot: MOCK.mode === 'empty' ? [] : W },
  updated_at: new Date().toISOString(),
}]);

const CLEAR = function () {
  try {
    if (!sessionStorage.getItem('__shot')) {
      sessionStorage.setItem('__shot', '1');
      ['pc_woot', 'pc_catalog', 'pc_asinmap'].forEach(k => localStorage.removeItem(k));
    }
  } catch (e) {}
};

const poke = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
let seq = 0;
const U = f => `${BASE}/${f}?cb=shot${Date.now()}${(seq++).toString(36)}`;

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const file of ['daily.html', 'product.html', 'monthly.html']) {
    MOCK.mode = 'empty';
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/rest\/v1\/mapping/, r => r.fulfill({ status: 200, contentType: 'application/json', body: body() }));
    await ctx.addInitScript(CLEAR);
    const page = await ctx.newPage();
    await page.goto(U(file), { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    MOCK.mode = 'woot';
    await poke(page);
    await page.waitForTimeout(800);
    const vis = await page.evaluate(() => {
      const b = document.getElementById('wbUpdateBar');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { display: getComputedStyle(b).display, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
    });
    console.log(file, '提示条:', JSON.stringify(vis));
    await page.screenshot({ path: path.join(OUT, file.replace('.html', '.png')) });
    await ctx.close();
  }

  // 壳页 iframe 场景（同事实际入口）
  MOCK.mode = 'empty';
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.route(/rest\/v1\/mapping/, r => r.fulfill({ status: 200, contentType: 'application/json', body: body() }));
  await ctx2.addInitScript(CLEAR);
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/index.html?cb=shot${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
  await page2.waitForTimeout(6000);
  const frame = page2.frame({ url: /daily\.html/ }) || page2.frames().find(f => /daily\.html/.test(f.url()));
  MOCK.mode = 'woot';
  if (frame) {
    await frame.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page2.waitForTimeout(1000);
    const info = await frame.evaluate(() => {
      const b = document.getElementById('wbUpdateBar');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { display: getComputedStyle(b).display, top: Math.round(r.top), w: Math.round(r.width), docTop: Math.round(r.top + (window.scrollY || 0)) };
    });
    console.log('壳页 iframe 内提示条:', JSON.stringify(info));
  } else {
    console.log('壳页未找到 daily iframe');
  }
  await page2.screenshot({ path: path.join(OUT, 'shell-iframe.png') });
  await ctx2.close();

  await browser.close();
  console.log('截图目录:', OUT);
})();
