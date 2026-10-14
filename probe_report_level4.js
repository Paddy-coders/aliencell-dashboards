// 探测 Report.GetAdvPerformanceList 各层级/过滤组合，确认投放词周度数据来源
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

  // 周范围
  const d = new Date();
  const day = d.getDay();
  const offset = day >= 5 ? day - 5 : day + 2;
  const lastFri = new Date(d); lastFri.setDate(d.getDate() - offset);
  const wStart = new Date(lastFri); wStart.setDate(lastFri.getDate() - 6);
  const fmt = x => x.toLocaleDateString('en-CA');
  const week = { start: fmt(wStart), end: fmt(lastFri) };
  console.log(`周范围: ${week.start} ~ ${week.end}`);

  // 1. Campaign.GetList — 找 SP 活动
  console.log('\n=== 1. Campaign.GetList (US) ===');
  const campBody = {
    RequestDate: rd,
    Content: {
      Attributes: ["CampaignID","Name","State","CampaignType","TargetingType","SponsoredType"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: { AttributeFilters: [] },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('Campaign.GetList', campBody);
  let campaigns = [];
  try {
    const j = JSON.parse(res.text);
    campaigns = j.data?.data?.Items || j.data?.Items || [];
    console.log(`ret=${j.ret} campaigns: ${campaigns.length}`);
    const byType = {};
    campaigns.forEach(c => { const k = `${c.CampaignType}/${c.TargetingType}`; byType[k] = (byType[k]||0)+1; });
    console.log('类型分布:', JSON.stringify(byType));
    campaigns.slice(0, 10).forEach(c => console.log(`  ${c.CampaignID} | ${c.CampaignType} | ${c.TargetingType} | ${c.Name}`));
  } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }

  // 2. 挑一个 SP 活动拿广告组
  const spCamp = campaigns.find(c => c.CampaignType === 'sponsoredProducts' && c.TargetingType === 'manual') || campaigns.find(c => c.CampaignType === 'sponsoredProducts');
  if (!spCamp) { console.log('无SP活动'); await browser.close(); return; }
  console.log(`\n选用 SP 活动: ${spCamp.CampaignID} (${spCamp.Name}) targeting=${spCamp.TargetingType}`);
  const cid = spCamp.CampaignID;

  const agBody = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {},
      Attributes: ["CampaignID","AdGroupID","Name","State","CampaignType"],
      Filter: { CampaignID: cid, AttributeFilters: [] }
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('AdGroup.GetList', agBody);
  let adGroups = [];
  try {
    const j = JSON.parse(res.text);
    adGroups = j.data?.data?.Items || j.data?.Items || [];
    console.log(`AdGroups: ${adGroups.length}`);
    adGroups.slice(0, 5).forEach(ag => console.log(`  ${ag.AdGroupID} | ${ag.Name} | ${ag.State}`));
  } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }

  if (adGroups.length === 0) { console.log('无广告组'); await browser.close(); return; }
  const agId = adGroups[0].AdGroupID;

  // 3. AdGroupBidKw.GetList 确认该SP广告组有关键词 + 全期指标
  console.log(`\n=== 2. AdGroupBidKw.GetList (${cid}/${agId}) ===`);
  const kwAttrs = ["CampaignID","CampaignID_Str","AdGroupID","KeywordID","KeywordID_Str","KeywordText","MatchType","State","Bid",
    "Report.Impressions","Report.Clicks","Report.ClickRate","Report.Cost","Report.CPC","Report.Orders","Report.SalesAmount",
    "Report.ACoS","Report.ROAS","Report.OrdersRate","Report.SalesQty","Report.SelfOrders","Report.SelfSalesQty","Report.SelfSalesAmount",
    "Report.OtherOrders","Report.OtherSalesQty","Report.OtherSalesAmount","CampaignType","IsTotal","OrgState"];
  const kwBody = {
    RequestDate: rd,
    Content: {
      Attributes: kwAttrs,
      Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0 },
      Pager: { PageIndex: 1, PageSize: 100 },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('AdGroupBidKw.GetList', kwBody);
  let kwItems = [];
  try {
    const j = JSON.parse(res.text);
    kwItems = (j.data?.data?.Items || j.data?.Items || []).filter(it => !it.IsTotal);
    console.log(`ret=${j.ret} items=${kwItems.length} total=${j.data?.data?.TotalCount}`);
    if (kwItems.length > 0) {
      const it = kwItems[0];
      console.log('keys:', Object.keys(it).join(','));
      console.log('First:', JSON.stringify(it).slice(0, 600));
    }
  } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }

  // 4. Report.GetAdvPerformanceList 各种组合
  console.log('\n=== 3. Report.GetAdvPerformanceList ===');
  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty","SelfOrders","SelfSalesAmount","OtherOrders","OtherSalesAmount"];
  const combos = [
    { name: 'L4 TargetID=0', filter: { AdvPerformanceReportTypeEnum: 4, Indicators: IND, ReportDate1: week.start, ReportDate2: week.end, ReportFilter: [{ AttributeCode: "TargetID", Value: 0 }], ViewFormat: 0 } },
    { name: 'L4 +CampaignID', filter: { AdvPerformanceReportTypeEnum: 4, Indicators: IND, ReportDate1: week.start, ReportDate2: week.end, ReportFilter: [{ AttributeCode: "TargetID", Value: 0 }, { AttributeCode: "CampaignID", Value: cid }], ViewFormat: 0 } },
    { name: 'L4 +AdGroupID', filter: { AdvPerformanceReportTypeEnum: 4, Indicators: IND, ReportDate1: week.start, ReportDate2: week.end, ReportFilter: [{ AttributeCode: "TargetID", Value: 0 }, { AttributeCode: "AdGroupID", Value: agId }], ViewFormat: 0 } },
    { name: 'L4 TargetID=0 +KwTarget', filter: { AdvPerformanceReportTypeEnum: 4, Indicators: IND, ReportDate1: week.start, ReportDate2: week.end, ReportFilter: [{ AttributeCode: "TargetID", Value: 0 }, { AttributeCode: "TargetingType", Value: "KwTarget" }], ViewFormat: 0 } },
    { name: 'L1 Campaign +IsSumRow', filter: { AdvPerformanceReportTypeEnum: 1, Indicators: IND, ReportDate1: week.start, ReportDate2: week.end, ReportFilter: [{ AttributeCode: "CampaignID", Value: cid }], ViewFormat: 0, IsSumRow: 1 } },
  ];
  for (const c of combos) {
    const body = {
      RequestDate: rd,
      Content: { Pager: { PageIndex: 1, PageSize: 50 }, Filter: c.filter, Sorter: {} },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    res = await callAPI('Report.GetAdvPerformanceList', body);
    try {
      const j = JSON.parse(res.text);
      const items = (j.data?.data?.Items || j.data?.Items || []).filter(it => !it.IsTotal);
      console.log(`[${c.name}] ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
      if (items.length > 0) {
        const it = items[0];
        console.log('  keys:', Object.keys(it).join(','));
        console.log('  First:', JSON.stringify(it).slice(0, 500));
      }
    } catch (e) { console.log(`[${c.name}] RAW:`, res.text.slice(0, 150)); }
    await sleep(200);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
