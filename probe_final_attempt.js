// 最后尝试: ProductAd.GetList 不同参数 / Campaign 接口 / 扩展 Filter
const { chromium } = require('playwright');
const US = { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 };
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  const token = await page.evaluate(() => { const raw = localStorage.getItem('pro__Access-Token'); try { return JSON.parse(raw).value; } catch { return raw; } });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function call(actiontype, content) {
    const body = { RequestDate: requestDate, Content: content, StoreSiteID: US.storeSiteId, StoreID: US.storeId, MarketSiteID: US.marketSiteId, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': actiontype }, data: body, timeout: 30000 });
    try { const j = JSON.parse(await r.text()); return { count: (j.data?.Items || []).filter(it => !it.IsTotal).length, dist: {} }; } catch (e) { return { count: -1, text: String(await r.text()).slice(0, 200) }; }
  }

  // 1. ProductAd.GetList 不同参数
  console.log('=== ProductAd.GetList 变体 ===');
  const listVariants = [
    { Attributes: [], Pager: { PageIndex: 1, PageSize: 500 }, Filter: {}, Sorter: {} },
    { Attributes: ["State"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: {}, Sorter: {} },
    { Pager: { PageIndex: 1, PageSize: 500 }, Filter: {}, Sorter: {} }, // 无 Attributes
    { Attributes: ["Asin","State","CampaignName"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: { State: 'paused' }, Sorter: {} },
    { Attributes: ["Asin","State","CampaignName"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: { State: 'all' }, Sorter: {} },
  ];
  for (const v of listVariants) {
    const r = await call('ProductAd.GetList', v);
    console.log('GetList', JSON.stringify(v.Filter || {}), '->', r.count);
  }

  // 2. Campaign 相关接口
  console.log('\n=== Campaign 接口 ===');
  const campActions = [
    'ProductAdCampaign.GetFlatViewList',
    'Campaign.GetFlatViewList',
    'ProductAdCampaign.GetList',
    'Campaign.GetList',
    'ProductAdCampaign.GetManageList',
  ];
  for (const a of campActions) {
    const r = await call(a, { Attributes: ["CampaignName","State","CampaignID"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: {}, Sorter: {} });
    console.log(a, '->', r.count, r.text || '');
  }

  // 3. 扩展 Filter 测试 (对象形式)
  console.log('\n=== 扩展 Filter ===');
  const extFilters = [
    { State: { Value: 'paused', Operator: 'eq' } },
    { State: { Value: ['enabled','paused','archived'], Operator: 'in' } },
    { IncludePaused: true },
    { IncludeArchived: true },
    { State: 'all', IncludePaused: true },
  ];
  for (const f of extFilters) {
    const r = await call('ProductAd.GetFlatViewList', { Attributes: ["State"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: f, Sorter: {} });
    console.log('Filter', JSON.stringify(f), '->', r.count);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
