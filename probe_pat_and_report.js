// AdGroupPAT.GetList 拿投放列表(TargetID) + 用真实TargetID测 L4 报表
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

  // 1. AdGroupPAT.GetList - 投放列表（含关键词）
  console.log('=== 1. AdGroupPAT.GetList (投放列表) ===');
  const patBody = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {},
      Attributes: ["CampaignID","AdGroupID","TargetID","TargetingText","TargetingType","TargetType","State","Bid",
        "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount","Report.ACoS","Report.ROAS"],
      Filter: { CampaignID: cid, AdGroupID: agId, AttributeFilters: [{ AttributeCode: "Negative", Operator: "=", Value: 0 }] }
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('AdGroupPAT.GetList', patBody);
  let targets = [];
  try {
    const j = JSON.parse(res.text);
    targets = j.data?.data?.Items || j.data?.Items || j.Content?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${targets.length}`);
    targets.slice(0, 5).forEach(t => console.log(`  ${t.TargetID} | ${t.TargetingText} | type=${t.TargetType} | state=${t.State} | bid=${t.Bid}`));
  } catch (e) { console.log('RAW:', res.text.slice(0, 300)); }

  // 2. L4 报表 - 用真实 TargetID
  console.log('\n=== 2. L4 用真实TargetID ===');
  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty"];
  if (targets.length > 0) {
    const tid = targets[0].TargetID;
    console.log('测试 TargetID:', tid, targets[0].TargetingText);
    const l4Body = {
      RequestDate: rd,
      Content: {
        Pager: { PageIndex: 1, PageSize: 50 },
        Filter: {
          AdvPerformanceReportTypeEnum: 4,
          Indicators: IND,
          ReportDate1: '2026-08-01',
          ReportDate2: '2026-08-14',
          ReportFilter: [{ AttributeCode: "TargetID", Value: tid }],
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
      items.slice(0, 5).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders} sales=${it.SalesAmount}`));
    } catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  }

  // 3. L1 活动级 长范围
  console.log('\n=== 3. L1 活动级 07-01~08-14 ===');
  const l1Body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 1,
        Indicators: IND,
        ReportDate1: '2026-07-01',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "CampaignID", Value: cid }],
        ViewFormat: 1,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('Report.GetAdvPerformanceList', l1Body);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    items.slice(0, 5).forEach(it => console.log(`  ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders} sales=${it.SalesAmount}`));
  } catch (e) { console.log('RAW:', res.text.slice(0, 300)); }

  // 4. AdGroupQuery.GetList 正确字段（chunk版）
  console.log('\n=== 4. AdGroupQuery.GetList ===');
  const Q_ATTRS = ["QueryText","TargetName","MatchType","Impressions","Clicks","ClickRate","OrdersRate","ACoS","Orders","Cost","CPC",
    "SalesAmount","SalesQty","SelfOrders","SelfSalesAmount","SelfSalesQty","OtherOrders","OtherSalesAmount","OtherSalesQty",
    "ViewImpressions","VCPM","CPA","NewOrders","NewSalesQty","NewSalesAmount","NewOrdersPercentage","NewSalesQtyPercentage",
    "NewSalesAmountPercentage","CampaignType","Tactic"];
  const qBody = {
    RequestDate: rd,
    Content: {
      Attributes: Q_ATTRS,
      Filter: { AttributeFilters: [], AdGroupID: agId, ClassType: 0 },
      Pager: { PageIndex: 1, PageSize: 100 },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('AdGroupQuery.GetList', qBody);
  try {
    const j = JSON.parse(res.text);
    const items = j.data?.data?.Items || j.data?.Items || [];
    console.log(`ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    if (items.length > 0) {
      console.log('keys:', Object.keys(items[0]).join(','));
      items.slice(0, 3).forEach(it => console.log(`  ${it.QueryText} | ${it.TargetName} | ${it.MatchType} | impr=${it.Impressions} cost=${it.Cost}`));
    }
  } catch (e) { console.log('RAW:', res.text.slice(0, 300)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
