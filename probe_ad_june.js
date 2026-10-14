// 快速探测广告接口对 6月底/7月初 的数据
const { chromium } = require('playwright');

const STORES = {
  US: { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 },
  DE: { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 },
  UK: { storeSiteId: 586014, storeId: 174010, marketSiteId: 10 },
  FR: { storeSiteId: 586016, storeId: 174010, marketSiteId: 9 },
  ES: { storeSiteId: 586017, storeId: 174010, marketSiteId: 8 },
  IT: { storeSiteId: 586015, storeId: 174010, marketSiteId: 12 },
};
const DATES = ['2026-06-23', '2026-07-01', '2026-07-10', '2026-07-20'];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) if (p.url().includes('eccang.com')) { page = p; break; }
    if (page) break;
  }
  if (!page) { console.log('ERROR: 无页面'); process.exit(1); }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('ERROR: 无token'); process.exit(1); }

  async function callAPI(store, d) {
    const body = {
      storeSiteId: store.storeSiteId, storeId: store.storeId, marketSiteId: store.marketSiteId,
      pageIndex: 1, pageSize: 100,
      dateType: 1,
      date_start: d + ' 00:00:00', date_end: d + ' 23:59:59',
      isTotal: 0,
    };
    try {
      const r = await page.evaluate(async ({ token, body }) => {
        const resp = await fetch('https://amz-ad.eccang.com/netapi/ProductAd.GetFlatViewList?token=' + encodeURIComponent(token), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return await resp.text();
      }, { token, body });
      const j = JSON.parse(r);
      return (j.data?.Items || []).filter(it => !it.IsTotal);
    } catch (e) { return null; }
  }

  for (const d of DATES) {
    for (const [c, store] of Object.entries(STORES)) {
      const items = await callAPI(store, d);
      if (items && items.length) {
        let cost = 0, sales = 0;
        for (const it of items) { cost += it.Report?.Cost || 0; sales += it.Report?.SalesAmount || 0; }
        console.log(`[广告 ${d}] ${c}: items=${items.length} cost=${cost.toFixed(2)} sales=${sales.toFixed(2)}`);
      }
    }
  }
  await browser.close();
  console.log('=== 广告探测完成 ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
