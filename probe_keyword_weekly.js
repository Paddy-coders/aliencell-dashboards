// 验证投放词周度数据：AdGroup.GetList + AdGroupBidKw.GetList(带Report日期) + AdGroupQuery.GetList
// 目标：确认关键词/搜索词按周(ReportDate)返回指标
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
  const campaignId = '22010039657137';
  // 最近完整周(周六-周五)
  const d = new Date();
  const day = d.getDay();
  const offset = day >= 5 ? day - 5 : day + 2;
  const lastFri = new Date(d); lastFri.setDate(d.getDate() - offset);
  const wStart = new Date(lastFri); wStart.setDate(lastFri.getDate() - 6);
  const fmt = x => x.toLocaleDateString('en-CA');
  const week = { start: fmt(wStart), end: fmt(lastFri) };
  console.log(`周范围: ${week.start} ~ ${week.end}`);

  const KW_ATTRS = ["CampaignID","CampaignID_Str","AdGroupID","KeywordID","KeywordID_Str","KeywordText","MatchType","State","Bid",
    "Report.Impressions","Report.Clicks","Report.ClickRate","Report.Cost","Report.CPC","Report.Orders","Report.SalesAmount",
    "Report.ACoS","Report.ROAS","Report.OrdersRate","Report.SalesQty","Report.SelfOrders","Report.SelfSalesQty","Report.SelfSalesAmount",
    "Report.OtherOrders","Report.OtherSalesQty","Report.OtherSalesAmount","CampaignType","IsTotal","OrgState"];

  // 1. AdGroup.GetList 获取广告组
  console.log('\n=== 1. AdGroup.GetList ===');
  const agBody = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {},
      Attributes: ["CampaignID","AdGroupID","Name","State","CampaignType"],
      Filter: { CampaignID: campaignId, AttributeFilters: [] }
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let agRes = await callAPI('AdGroup.GetList', agBody);
  let adGroups = [];
  try {
    const d2 = JSON.parse(agRes.text);
    adGroups = d2.data?.data?.Items || d2.data?.Items || d2.Content?.Items || [];
    console.log(`ret=${d2.ret} msg=${d2.msg||''} AdGroups: ${adGroups.length}`);
    adGroups.slice(0, 8).forEach(ag => console.log(`  ${ag.AdGroupID} | ${ag.Name} | ${ag.State} | ${ag.CampaignType}`));
  } catch (e) { console.log('Raw:', agRes.text.slice(0, 200)); }

  if (adGroups.length === 0) {
    console.log('无广告组，尝试 AdGroup.GetFlatViewList + AttributeFilters');
    const agBody2 = {
      RequestDate: rd,
      Content: {
        Filter: { AttributeFilters: [{ AttributeCode: "CampaignID", Operator: "=", Value: campaignId }] },
        Attributes: ["AdGroupID","Name","State","CampaignID","DefaultBid"],
        PageIndex: 1, PageSize: 500
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const r2 = await callAPI('AdGroup.GetFlatViewList', agBody2);
    try {
      const d2 = JSON.parse(r2.text);
      adGroups = d2.data?.Items || d2.Content?.Items || [];
      console.log(`FlatView AdGroups: ${adGroups.length}`);
      adGroups.slice(0, 8).forEach(ag => console.log(`  ${ag.AdGroupID} | ${ag.Name} | ${ag.State}`));
    } catch (e) { console.log('Raw:', r2.text.slice(0, 200)); }
  }

  // 2. 逐广告组测试 AdGroupBidKw.GetList（带周度Report过滤 vs 不带）
  console.log('\n=== 2. AdGroupBidKw.GetList ===');
  let kwFound = false;
  for (const ag of adGroups.slice(0, 5)) {
    console.log(`\n--- AdGroup ${ag.AdGroupID} (${ag.Name}) ---`);
    for (const withDate of [false, true]) {
      const filter = { AttributeFilters: [], CampaignID: campaignId, AdGroupID: ag.AdGroupID, ClassType: 0 };
      if (withDate) filter.Report = { ReportDate: [week.start, week.end] };
      const kwBody = {
        RequestDate: rd,
        Content: { Attributes: KW_ATTRS, Filter: filter, Pager: { PageIndex: 1, PageSize: 500 }, Sorter: {} },
        StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
        UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
      };
      const res = await callAPI('AdGroupBidKw.GetList', kwBody);
      try {
        const d2 = JSON.parse(res.text);
        const items = (d2.data?.data?.Items || d2.data?.Items || []).filter(it => !it.IsTotal);
        const total = d2.data?.data?.TotalCount ?? items.length;
        console.log(`  ${withDate ? '[周度]' : '[全期]'} ret=${d2.ret} items=${items.length} total=${total}`);
        if (items.length > 0 && !kwFound) {
          kwFound = true;
          const it = items[0];
          console.log('  First keys:', Object.keys(it).join(','));
          console.log('  First:', JSON.stringify(it).slice(0, 500));
        }
      } catch (e) { console.log(`  ${withDate ? '[周度]' : '[全期]'} RAW:`, res.text.slice(0, 150)); }
      await sleep(200);
    }
  }

  // 3. AdGroupQuery.GetList 搜索词（用chunk里的正确字段）
  console.log('\n=== 3. AdGroupQuery.GetList ===');
  const Q_ATTRS = ["QueryText","TargetName","MatchType","Impressions","Clicks","ClickRate","OrdersRate","ACoS","Orders","Cost","CPC",
    "SalesAmount","SalesQty","SelfOrders","SelfSalesAmount","SelfSalesQty","OtherOrders","OtherSalesAmount","OtherSalesQty",
    "ViewImpressions","VCPM","CPA","NewOrders","NewSalesQty","NewSalesAmount","NewOrdersPercentage","NewSalesQtyPercentage",
    "NewSalesAmountPercentage","CampaignType","Tactic"];
  for (const ag of adGroups.slice(0, 3)) {
    const qBody = {
      RequestDate: rd,
      Content: {
        Attributes: Q_ATTRS,
        Filter: { AttributeFilters: [], AdGroupID: ag.AdGroupID, ClassType: 0, Report: { ReportDate: [week.start, week.end] } },
        Pager: { PageIndex: 1, PageSize: 500 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const res = await callAPI('AdGroupQuery.GetList', qBody);
    try {
      const d2 = JSON.parse(res.text);
      const items = (d2.data?.data?.Items || d2.data?.Items || []).filter(it => !it.IsTotal);
      console.log(`  ${ag.AdGroupID}: ret=${d2.ret} items=${items.length}`);
      if (items.length > 0) {
        console.log('  First:', JSON.stringify(items[0]).slice(0, 400));
        break;
      }
    } catch (e) { console.log(`  ${ag.AdGroupID} RAW:`, res.text.slice(0, 150)); }
    await sleep(200);
  }

  console.log('\nkwFound=', kwFound);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
