// 第二轮：有花费广告组上验证 关键词全期指标 + 周度过滤变体 + 表现报表ViewFormat各值
const { chromium } = require('playwright');
const crypto = require('crypto');

function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });
  if (!token) { console.log('NO TOKEN'); await browser.close(); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    const bodyStr = JSON.stringify(body);
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': actionType, 'contentmd5': md5(bodyStr) },
        data: body, timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 0, text: e.message }; }
  }

  const store = { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 };
  const cid = '43472039186019';
  const agId = '218449056837479';  // 有花费: 247$ (08-08~08-14)
  const week = { start: '2026-08-08', end: '2026-08-14' };

  const KW_ATTRS = ["CampaignID","CampaignID_Str","AdGroupID","KeywordID","KeywordID_Str","KeywordText","MatchType","State","Bid",
    "Report.Impressions","Report.Clicks","Report.ClickRate","Report.Cost","Report.CPC","Report.Orders","Report.SalesAmount",
    "Report.ACoS","Report.ROAS","Report.OrdersRate","Report.SalesQty","Report.SelfOrders","Report.SelfSalesQty","Report.SelfSalesAmount",
    "Report.OtherOrders","Report.OtherSalesQty","Report.OtherSalesAmount","CampaignType","IsTotal","OrgState"];

  // 1. 全期关键词指标（期望非0）
  console.log('=== 1. AdGroupBidKw.GetList [全期] ===');
  const kwBody1 = {
    RequestDate: rd,
    Content: { Attributes: KW_ATTRS, Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0 }, Pager: { PageIndex: 1, PageSize: 100 }, Sorter: {} },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('AdGroupBidKw.GetList', kwBody1);
  try {
    const j = JSON.parse(res.text);
    const items = (j.data?.data?.Items || j.data?.Items || []).filter(it => !it.IsTotal);
    console.log(`ret=${j.ret} items=${items.length}`);
    const withCost = items.filter(it => (it.Report?.Cost || 0) > 0);
    console.log(`有花费关键词: ${withCost.length}/${items.length}`);
    withCost.slice(0, 3).forEach(it => console.log(`  ${it.KeywordText} | cost=${it.Report.Cost} impr=${it.Report.Impressions} clicks=${it.Report.Clicks} orders=${it.Report.Orders} sales=${it.Report.SalesAmount}`));
    if (items[0]) console.log('First:', JSON.stringify(items[0]).slice(0, 400));
  } catch (e) { console.log('Raw:', res.text.slice(0, 150)); }

  // 2. 周度过滤变体
  console.log('\n=== 2. 周度过滤变体 ===');
  const variants = [
    { name: 'v1 Filter.Report', body: { Attributes: KW_ATTRS, Filter: { Report: { ReportDate: [week.start, week.end] } }, Pager: { PageIndex: 1, PageSize: 100 }, Sorter: {} } },
    { name: 'v2 Filter完整+Report', body: { Attributes: KW_ATTRS, Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0, Report: { ReportDate: [week.start, week.end] } }, Pager: { PageIndex: 1, PageSize: 100 }, Sorter: {} } },
    { name: 'v3 顶层Report', body: { Attributes: KW_ATTRS, Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0 }, Report: { ReportDate: [week.start, week.end] }, Pager: { PageIndex: 1, PageSize: 100 }, Sorter: {} } },
  ];
  for (const v of variants) {
    const body = {
      RequestDate: rd,
      Content: v.body,
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    res = await callAPI('AdGroupBidKw.GetList', body);
    try {
      const j = JSON.parse(res.text);
      const items = (j.data?.data?.Items || j.data?.Items || []).filter(it => !it.IsTotal);
      const cost = items.reduce((s, it) => s + (it.Report?.Cost || 0), 0);
      console.log(`[${v.name}] ret=${j.ret} items=${items.length} 总Cost=${cost.toFixed(2)}`);
    } catch (e) { console.log(`[${v.name}] RAW:`, res.text.slice(0, 120)); }
    await sleep(200);
  }

  // 3. Report.GetAdvPerformanceList 各 ViewFormat
  console.log('\n=== 3. 表现报表 ViewFormat 各值 ===');
  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty","SelfOrders","SelfSalesAmount","OtherOrders","OtherSalesAmount"];
  for (const vf of [0, 1, 2, 3, 4]) {
    const body = {
      RequestDate: rd,
      Content: {
        Pager: { PageIndex: 1, PageSize: 50 },
        Filter: {
          AdvPerformanceReportTypeEnum: 4,
          Indicators: IND,
          ReportDate1: week.start,
          ReportDate2: week.end,
          ReportFilter: [{ AttributeCode: "TargetID", Value: 0 }, { AttributeCode: "AdGroupID", Value: agId }],
          ViewFormat: vf,
          StoreSiteID: store.storeSiteId
        },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    res = await callAPI('Report.GetAdvPerformanceList', body);
    try {
      const j = JSON.parse(res.text);
      const items = j.data?.data?.Items || j.data?.Items || [];
      console.log(`[ViewFormat=${vf}] ret=${j.ret} items=${items.length} total=${j.data?.data?.TotalCount}`);
      if (items.length > 0) {
        console.log('  keys:', Object.keys(items[0]).join(','));
        console.log('  First:', JSON.stringify(items[0]).slice(0, 350));
      }
    } catch (e) { console.log(`[ViewFormat=${vf}] RAW:`, res.text.slice(0, 120)); }
    await sleep(200);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
