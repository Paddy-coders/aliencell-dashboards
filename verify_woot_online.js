const { chromium } = require('playwright');
const path = require('path');
const LIVE = 'file:///' + path.resolve('_deploy/product.html').split(path.sep).join('/');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'verify@aliencell.com' } }));
  });
  await p.goto(LIVE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(5000);
  try { await p.waitForLoadState('networkidle'); } catch (e) {}
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const woot = JSON.parse(localStorage.getItem('pc_woot') || '[]');
    // 云端 Woot 按周分摊(全周)
    const byWeek = {};
    (DATA.weeks || []).forEach(w => {
      const alloc = wootAllocByAsin(woot, w.start, w.end);
      alloc.forEach((v, asin) => {
        if (v.sales || v.adCost || v.adOrders || v.adSales) {
          byWeek[w.label + '(' + w.start + '~' + w.end + ')'] = {
            asin, sales: +v.sales.toFixed(2), adCost: +v.adCost.toFixed(2),
            orders: Math.round(v.orders), adClicks: Math.round(v.adClicks), adSales: +v.adSales.toFixed(2)
          };
        }
      });
    });
    // 页面实际注入后的 W39/W40 ADS 值(B0H69JJZ1M)
    const asin = 'B0H69JJZ1M';
    const adsW = {};
    (DATA.weeks || []).forEach(w => {
      if (typeof ADS !== 'undefined' && ADS[asin] && ADS[asin].weeks[w.label]) {
        const a = ADS[asin].weeks[w.label].US;
        if (a.spend > 0) adsW[w.label] = { spend: +a.spend.toFixed(2), clicks: a.clicks, adSales: +a.sales.toFixed(2) };
      }
    });
    return { wootCount: woot.length, wootByWeek: byWeek, adsByWeek: adsW };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
