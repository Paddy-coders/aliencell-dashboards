// shot_shell.js — 壳页 iframe 场景的提示条截图（一次性验证脚本）
const { chromium } = require('./playwright-auth');
const path = require('path');
const OUT = path.join(__dirname, 'shots_bar');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const W = [{
  asin: 'B0TEST0001', start: '2026-09-12', end: '2026-09-12', name: '测试产品A',
  metrics: { orders: 3, sales: 59.97, adCost: 6.5, adClicks: 12, adOrders: 2, adImpr: 1500, adSales: 39.98 },
}];
const MOCK = { mode: 'empty' };
const body = () => JSON.stringify([{ data: { catalog: [], asinMap: [], woot: MOCK.mode === 'empty' ? [] : W }, updated_at: new Date().toISOString() }]);
const CLEAR = function () {
  try {
    if (!sessionStorage.getItem('__shot')) {
      sessionStorage.setItem('__shot', '1');
      ['pc_woot', 'pc_catalog', 'pc_asinmap'].forEach(k => localStorage.removeItem(k));
    }
  } catch (e) {}
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/rest\/v1\/mapping/, r => r.fulfill({ status: 200, contentType: 'application/json', body: body() }));
  // 壳页会异步校验登录态：不 mock auth/v1/user 会被踢回 login.html（HANDOVER 坑 9）
  await ctx.route(/auth\/v1\/user/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'test-user', email: 'tester@aliencell.com', aud: 'authenticated', role: 'authenticated' }) }));
  await ctx.route(/auth\/v1\/token/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Date.now() + 3600000, user: { id: 'test-user', email: 'tester@aliencell.com' } }) }));
  await ctx.addInitScript(CLEAR);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/index.html?cb=shell${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(4000);

  // 切到「每日数据看板」
  await page.evaluate(() => { const b = document.querySelector('.nav-item[data-id="daily"]'); if (b) b.click(); });
  await page.waitForTimeout(9000);

  const frame = page.frames().find(f => /daily\.html/.test(f.url()));
  if (!frame) { console.log('未找到 daily iframe'); process.exit(1); }
  MOCK.mode = 'woot';
  await frame.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1200);
  const info = await frame.evaluate(() => {
    const b = document.getElementById('wbUpdateBar');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { display: getComputedStyle(b).display, top: Math.round(r.top), w: Math.round(r.width), docH: document.documentElement.clientHeight };
  });
  console.log('壳页 iframe 内提示条:', JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, 'shell-daily.png') });
  await browser.close();
  console.log('OK');
})();
