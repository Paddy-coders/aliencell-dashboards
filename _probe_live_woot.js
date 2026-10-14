// _probe_live_woot.js — 线上 monthly.html 行构成拆解：Amazon / JoyBuy / Woot 各贡献多少销售额
// 用法: node _probe_live_woot.js   （诊断用，勿入回归）
const { chromium } = require('./playwright-auth');
const HOST = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'smoke@aliencell.com' } }));
  });
  const page = await ctx.newPage();
  await page.goto(HOST + '/monthly.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(7000);

  const out = await page.evaluate(() => {
    const sum = (a, f) => a.reduce((s, r) => s + (+r[f] || 0), 0);
    const woot = ROWS.filter(r => r.channel === 'woot');
    const jb = ROWS.filter(r => r.plat === 'joybuy');
    const off = ROWS.filter(r => r.channel !== 'woot' && r.plat !== 'joybuy');
    const f2 = n => Math.round(n * 100) / 100;
    return {
      rowsTotal: ROWS.length,
      nWoot: woot.length, nJoyBuy: jb.length, nAmazon: off.length,
      // 销售额列（r.sales 原币种，不折汇）
      amazon_sales: f2(sum(off, 'sales')),
      joybuy_sales: f2(sum(jb, 'sales')),
      woot_sales: f2(sum(woot, 'sales')),      // 看板行上的 sales 字段
      woot_pSales: f2(sum(woot, 'pSales')),    // 等效利润字段里的营收（采购价口径）
      woot_orders: f2(sum(woot, 'orders')),
      woot_units: f2(sum(woot, 'units')),
      woot_adCost: f2(sum(woot, 'adCost')),
      total_sales: f2(sum(ROWS, 'sales')),
      // 页面实际渲染的合计行文本（默认视图：全部平台 + 渠道合并）
      kpi: Array.from(document.querySelectorAll('#kpiCards .kpi, .kpi')).slice(0, 3)
        .map(e => e.innerText.replace(/\s+/g, ' ').trim()),
      sums: Array.from(document.querySelectorAll('.dd-summary')).map(e => e.textContent.trim()),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await ctx.close();
  await browser.close();
})();
