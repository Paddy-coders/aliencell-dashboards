// 探测2: 13国无过滤状态分布 + US 不同 State 过滤值的行为
const { chromium } = require('playwright');
const STORES = {
  US: { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 },
  BE: { storeSiteId: 586021, storeId: 174010, marketSiteId: 21 },
  CA: { storeSiteId: 586025, storeId: 174011, marketSiteId: 3 },
  DE: { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 },
  ES: { storeSiteId: 586017, storeId: 174010, marketSiteId: 8 },
  FR: { storeSiteId: 586016, storeId: 174010, marketSiteId: 9 },
  IE: { storeSiteId: 586022, storeId: 174010, marketSiteId: 22 },
  IT: { storeSiteId: 586015, storeId: 174010, marketSiteId: 12 },
  MX: { storeSiteId: 586023, storeId: 174010, marketSiteId: 2 },
  NL: { storeSiteId: 586018, storeId: 174010, marketSiteId: 13 },
  PL: { storeSiteId: 586020, storeId: 174010, marketSiteId: 19 },
  SE: { storeSiteId: 586019, storeId: 174010, marketSiteId: 20 },
  UK: { storeSiteId: 586014, storeId: 174010, marketSiteId: 10 },
};
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('selmuch-web') || p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const attrs = ["Asin", "Sku", "AdGroupID", "CampaignID", "CampaignID_Str", "Name", "State", "IsTotal", "CampaignName", "AdGroupName", "PortfolioName", "CampaignType"];

  async function mapFor(store, stateFilter) {
    const body = {
      RequestDate: requestDate,
      Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 500 }, Filter: stateFilter ? { State: stateFilter } : {}, Sorter: {} },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' }, data: body, timeout: 30000 });
    try {
      const j = JSON.parse(await r.text());
      return (j.data?.Items || []).filter(it => !it.IsTotal);
    } catch (e) { return []; }
  }

  // 1. 各国无过滤状态分布
  console.log('=== 13国 mapping 状态分布(无过滤) ===');
  const allDist = {};
  for (const [c, s] of Object.entries(STORES)) {
    const items = await mapFor(s, null);
    const d = {};
    for (const it of items) d[it.State] = (d[it.State] || 0) + 1;
    allDist[c] = d;
    console.log(`[${c}] ${items.length}条 ${JSON.stringify(d)}`);
  }

  // 2. US 各 State 过滤值行为
  console.log('\n=== US Filter.State 各值行为 ===');
  for (const v of ['enabled', 'disabled', 'paused', 'all', '']) {
    const items = await mapFor(STORES.US, v);
    const d = {};
    for (const it of items) d[it.State] = (d[it.State] || 0) + 1;
    console.log(`Filter.State=${JSON.stringify(v)} -> ${items.length}条 ${JSON.stringify(d)}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
