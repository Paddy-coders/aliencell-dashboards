// 验证关键词周度数据链路（用 home 域通用 token）
const { chromium } = require('playwright');
const crypto = require('crypto');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  // 优先 home 域页面（token 通用）
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }
  console.log('取token 页面:', page.url().slice(0, 80));

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });
  if (!token) { console.log('NO TOKEN'); await browser.close(); return; }
  console.log('token:', token.slice(0, 50) + '...');

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

  const store = { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 }; // US
  const cid = '43472039186019';
  const agId = '218449056837479';
  const kwId = '46634681516800';
  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty"];

  // 1. AdGroupBidKw 关键词列表
  console.log('\n=== 1. AdGroupBidKw.GetList ===');
  const KW_ATTRS = ["CampaignID","CampaignID_Str","AdGroupID","KeywordID","KeywordID_Str","KeywordText","MatchType","State","Bid",
    "Report.Impressions","Report.Clicks","Report.ClickRate","Report.Cost","Report.CPC","Report.Orders","Report.SalesAmount",
    "Report.ACoS","Report.ROAS","Report.OrdersRate","Report.SalesQty","CampaignType","IsTotal","OrgState"];
  let body = {
    RequestDate: rd, Content: {
      Attributes: KW_ATTRS,
      Filter: { AttributeFilters: [], CampaignID: cid, AdGroupID: agId, ClassType: 0 },
      Pager: { PageIndex: 1, PageSize: 100 }, Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('AdGroupBidKw.GetList', body);
  let j = JSON.parse(res.text);
  let items = j.data?.data?.Items || [];
  console.log(`ret=${j.ret} items=${items.length}`);
  const kwItems = items.filter(i => !i.IsTotal);
  console.log(`关键词数: ${kwItems.length}`);
  kwItems.slice(0, 5).forEach(i => console.log(`  ${i.KeywordID} "${i.KeywordText}" match=${i.MatchType} state=${i.State} cost=${i.Report?.Cost} impr=${i.Report?.Impressions} clicks=${i.Report?.Clicks} orders=${i.Report?.Orders} sales=${i.Report?.SalesAmount}`));
  await sleep(200);

  // 2. L5 kw 06-01~08-14 ViewFormat=0
  console.log('\n=== 2. L5 kw 06-01~08-14 ViewFormat=0 全部行 ===');
  body = {
    RequestDate: rd, Content: {
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: {
        AdvPerformanceReportTypeEnum: 5, Indicators: IND,
        ReportDate1: '2026-06-01', ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "KeywordID", Value: kwId }],
        ViewFormat: 0, StoreSiteID: store.storeSiteId
      }, Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  res = await callAPI('Report.GetAdvPerformanceList', body);
  j = JSON.parse(res.text);
  items = j.data?.data?.Items || [];
  console.log(`ret=${j.ret} items=${items.length}`);
  const nonTotal = items.filter(i => !i.IsTotal);
  console.log(`非Total行: ${nonTotal.length}, 首行: ${nonTotal[0]?.dsion}, 末行: ${nonTotal[nonTotal.length-1]?.dsion}`);
  const nz = nonTotal.filter(i => (i.Cost||0) > 0);
  console.log('有花费日:', nz.map(i => `${i.dsion}:cost=${i.Cost}`).join(' '));
  await sleep(200);

  // 3. L5 kw 08-01~08-14 ViewFormat=0
  console.log('\n=== 3. L5 kw 08-01~08-14 ViewFormat=0 ===');
  body.Content.Filter.ReportDate1 = '2026-08-01';
  body.Content.Filter.ReportDate2 = '2026-08-14';
  res = await callAPI('Report.GetAdvPerformanceList', body);
  j = JSON.parse(res.text);
  items = j.data?.data?.Items || [];
  console.log(`items=${items.length}`);
  items.filter(i => !i.IsTotal).forEach(i => console.log(`  ${i.dsion}: cost=${i.Cost} impr=${i.Impressions} clicks=${i.Clicks} orders=${i.Orders} sales=${i.SalesAmount}`));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
