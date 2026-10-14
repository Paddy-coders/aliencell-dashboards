// 全面探测: 所有国家 mapping 数据的 State 实际取值 + 状态过滤测试
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
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); process.exit(1); }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const attrs = ["Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal","CampaignName","AdGroupName","PortfolioName","CampaignType"];

  async function mapFor(store, stateFilter) {
    const body = { RequestDate: requestDate, Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 500 }, Filter: stateFilter ? { State: stateFilter } : {}, Sorter: {} }, StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' }, data: body, timeout: 30000 });
    try { const j = JSON.parse(await r.text()); return (j.data?.Items || []).filter(it => !it.IsTotal); } catch (e) { return []; }
  }

  // 1. 无过滤: 统计每个国家 State 分布
  console.log('=== 无状态过滤的 mapping 数据 State 分布 ===');
  const allDist = {};
  for (const [country, store] of Object.entries(STORES)) {
    const items = await mapFor(store, null);
    const d = {};
    for (const it of items) d[it.State] = (d[it.State] || 0) + 1;
    allDist[country] = d;
    console.log(`[${country}] ${items.length}条 ${JSON.stringify(d)}`);
    if (country === 'US' || country === 'DE') {
      // 打印前几条样例的状态值原始类型
      for (const it of items.slice(0, 5)) console.log(`   sample: State=${JSON.stringify(it.State)} Name=${String(it.Name).slice(0, 40)}`);
    }
  }

  // 2. 用 State 过滤测试各候选值 (US + DE)
  console.log('\n=== 状态过滤测试 (US/DE) ===');
  for (const v of ['enabled', 'paused', 'archived', 'disabled', 'ended', 'ARCHIVED', 'PAUSED']) {
    const us = await mapFor(STORES.US, v);
    const de = await mapFor(STORES.DE, v);
    console.log(`Filter State=${JSON.stringify(v)} -> US:${us.length} DE:${de.length}`);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
