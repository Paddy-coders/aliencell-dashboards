// _live_cost_check.js — 真实云端数据下验证看板读到 Woot 成本配置(一次性诊断, 不入回归)
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'live@aliencell.com' } }));
  });
  const page = await ctx.newPage();
  const out = {};
  for (const f of ['daily.html', 'monthly.html', '_deploy/product.html']) {
    await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/' + f, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(12000);        // 等 cloudWootSync 拉云端 + 可能的 reload
    out[f] = await page.evaluate(() => {
      const cfg = JSON.parse(localStorage.getItem('pc_woot_cfg') || 'null');
      return {
        cfgAsins: cfg ? Object.keys(cfg.cost || {}).length : -1,
        price: cfg && cfg.price,
        b0: (cfg && cfg.cost && cfg.cost['B0H69JJZ1M']) || null,
        unitCostFn: (typeof wootUnitCost === 'function') ? wootUnitCost('B0H69JJZ1M') : 'no fn'
      };
    });
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
