// 探测: 不同 actiontype / Filter 变体能否取到非 enabled 广告
const { chromium } = require('playwright');
const STORES = {
  US: { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 },
  DE: { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 },
};
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  const token = await page.evaluate(() => { const raw = localStorage.getItem('pro__Access-Token'); try { return JSON.parse(raw).value; } catch { return raw; } });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const attrs = ["Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal","CampaignName","AdGroupName","PortfolioName","CampaignType"];

  async function call(actiontype, store, filterExtra) {
    const body = {
      RequestDate: requestDate,
      Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 500 }, Filter: filterExtra || {}, Sorter: {} },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json', 'actiontype': actiontype },
      data: body, timeout: 30000
    });
    try {
      const j = JSON.parse(await r.text());
      const items = (j.data?.Items || []).filter(it => !it.IsTotal);
      const dist = {};
      for (const it of items) dist[it.State] = (dist[it.State] || 0) + 1;
      return { count: items.length, dist, ok: true };
    } catch (e) { return { count: 0, dist: {}, ok: false, text: String(r.text()).slice(0, 200) }; }
  }

  // 测试不同 actiontype
  const actions = [
    'ProductAd.GetFlatViewList',
    'ProductAd.GetList',
    'ProductAd.GetDetailList',
    'ProductAd.GetFlatViewList2',
    'ProductAdCampaign.GetFlatViewList',
    'ProductAd.GetFlatViewListExt',
    'Advert.GetFlatViewList',
    'Advert.GetList',
  ];

  console.log('=== 不同 actiontype (US) ===');
  for (const a of actions) {
    const r = await call(a, STORES.US, {});
    console.log(a, '->', r.ok ? `count=${r.count} dist=${JSON.stringify(r.dist)}` : `FAIL ${r.text}`);
  }

  // 测试 ProductAd.GetFlatViewList 不同 Filter 变体
  console.log('\n=== Filter 变体 (US) ===');
  const variants = [
    { State: null },
    { State: '' },
    { State: [] },
    { State: ['enabled','paused','archived'] },
    { State: ['ENABLED','PAUSED','ARCHIVED'] },
    { State: 'all' },
    { State: 'ALL' },
    { AdvertState: 'paused' },
    { Status: 'paused' },
    { IsTotal: false },
  ];
  for (const f of variants) {
    const r = await call('ProductAd.GetFlatViewList', STORES.US, f);
    console.log('Filter', JSON.stringify(f), '->', r.ok ? `count=${r.count} dist=${JSON.stringify(r.dist)}` : `FAIL ${r.text}`);
  }

  // 测试获取所有字段名(不带 State, 看是否有别的状态字段)
  console.log('\n=== 完整字段探测 (US mapping) ===');
  const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
    headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' },
    data: {
      RequestDate: requestDate,
      Content: { Attributes: [], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
      StoreSiteID: STORES.US.storeSiteId, StoreID: STORES.US.storeId, MarketSiteID: STORES.US.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    }, timeout: 30000
  });
  try {
    const j = JSON.parse(await r.text());
    const items = (j.data?.Items || []).filter(it => !it.IsTotal);
    if (items.length) {
      console.log('字段:', Object.keys(items[0]).join(', '));
      console.log('首条:', JSON.stringify(items[0]).slice(0, 600));
    } else console.log('无数据');
  } catch (e) { console.log('FAIL', String(await r.text()).slice(0, 300)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
