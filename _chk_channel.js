const { chromium } = require('./playwright-auth');
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///' + BASE + '/daily.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(3500);
  const r = await p.evaluate(() => {
    const out = { injected: WOOT_INJECTED, hasSel: typeof selChannel, summary: document.getElementById('ddChannelSummary').textContent };
    out.opts = [...document.querySelectorAll('#ddChannelList .dd-opt')].map(e => e.textContent.trim());
    const mk = (set) => { selChannel = set; const v = metricVals(aggRows('2026-09-07', new Set(), new Set())); return { sales: v.sales, adCost: v.adCost, orders: v.orders, profit: v.profit, traffic: v.traffic }; };
    out.merged = mk(new Set());
    out.woot = mk(new Set(['woot']));
    out.amazon = mk(new Set(['amazon']));
    selChannel = new Set();
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('page errors:', errs);
  await b.close();
})();
