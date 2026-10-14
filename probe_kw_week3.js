// 第三轮决定性验证：
// 1) AdGroupBidKw 顶层Report过滤 是否真的按周过滤（无花费周 vs 有花费周）
// 2) L1 活动级表现报表是否正确返回真实数字
// 3) L4 指定TargetID 是否返回该关键词周度趋势
// 4) L6 搜索词级 是否返回搜索词行
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
  const agId = '218449056837479';
  const kwId = '46634681516800';

  const KW_ATTRS = ["CampaignID","CampaignID_Str","AdGroupID","KeywordID","KeywordID_Str","KeywordText","MatchType","State","Bid",
    "Report.Impressions","Report.Clicks","Report.ClickRate","Report.Cost","Report.CPC","Report.Orders","Report.SalesAmount",
    "Report.ACoS","Report.ROAS","Report.OrdersRate","Report.SalesQty","Report.SelfOrders","Report.SelfSalesQty","Report.SelfSalesAmount",
    "Report.OtherOrders","Report.OtherSalesQty","Report.OtherSalesAmount","CampaignType","IsTotal","OrgState"];

  // 1. 顶层Report过滤 分周测试
  console.log('=== 1. AdGroupBidKw 顶层Report分周 ===');
  const weeks = [
    { name: '无花费周 06-20~06-26', s: '2026-06-20', e: '2026-06-26' },
    { name: '有花费周 07-11~07-17', s: '2026-07-11', e: '2026-07-17' },
    { name: '有花费周 08-08~08-14', s: '2026-08-08', e: '2026-08-14' },
  ];
  for (const w of weeks) {
    const body = {
      RequestDate: rd,
      Content: {
        Attributes: KW_ATTRS,
        Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0 },
        Report: { ReportDate: [w.s, w.e] },
        Pager: { PageIndex: 1, PageSize: 100 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const res = await callAPI('AdGroupBidKw.GetList', body);
    try {
      const j = JSON.parse(res.text);
      const items = (j.data?.data?.Items || j.data?.Items || []).filter(it => !it.IsTotal);
      const cost = items.reduce((s, it) => s + (it.Report?.Cost || 0), 0);
      const impr = items.reduce((s, it) => s + (it.Report?.Impressions || 0), 0);
      console.log(`[${w.name}] ret=${j.ret} items=${items.length} Cost=${cost.toFixed(2)} Impressions=${impr}`);
    } catch (e) { console.log(`[${w.name}] RAW:`, res.text.slice(0, 120)); }
    await sleep(200);
  }

  // 2. L1 活动级表现报表（不设 IsSumRow）
  console.log('\n=== 2. L1 活动级表现报表 ===');
  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty"];
  const l1Body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 1,
        Indicators: IND,
        ReportDate1: '2026-08-08',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "CampaignID", Value: cid }],
        ViewFormat: 0,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('Report.GetAdvPerformanceList', l1Body);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    items.slice(0, 4).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders} sales=${it.SalesAmount}`));
  } catch (e) { console.log('RAW:', res.text.slice(0, 200)); }

  // 3. L4 指定 TargetID（具体关键词）
  console.log('\n=== 3. L4 指定TargetID ===');
  const l4Body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 4,
        Indicators: IND,
        ReportDate1: '2026-08-08',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "TargetID", Value: kwId }],
        ViewFormat: 0,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('Report.GetAdvPerformanceList', l4Body);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    items.slice(0, 4).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders} sales=${it.SalesAmount}`));
  } catch (e) { console.log('RAW:', res.text.slice(0, 200)); }

  // 4. L4 CampaignID only（不带TargetID，看是否返回每投放行）
  console.log('\n=== 4. L4 CampaignID only ===');
  const l4b = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 4,
        Indicators: IND,
        ReportDate1: '2026-08-08',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "CampaignID", Value: cid }],
        ViewFormat: 0,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('Report.GetAdvPerformanceList', l4b);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    if (items.length > 0) {
      console.log('keys:', Object.keys(items[0]).join(','));
      items.slice(0, 4).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders}`));
    }
  } catch (e) { console.log('RAW:', res.text.slice(0, 200)); }

  // 5. L6 搜索词级
  console.log('\n=== 5. L6 搜索词 ===');
  const l6Body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 6,
        Indicators: IND,
        ReportDate1: '2026-08-08',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "QueryTextID", Value: 0 }, { AttributeCode: "CampaignID", Value: cid }],
        ViewFormat: 0,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('Report.GetAdvPerformanceList', l6Body);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    if (items.length > 0) {
      console.log('keys:', Object.keys(items[0]).join(','));
      items.slice(0, 3).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost}`));
    }
  } catch (e) { console.log('RAW:', res.text.slice(0, 200)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
