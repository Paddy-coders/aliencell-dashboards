// 第四轮决定性验证：
// 1) Report.GetAdvPerformanceReport + L5(KeywordID) + ViewFormat=1（周聚合）→ 单关键词周度
// 2) Report.GetAdvPerformanceList + L5(KeywordID) + ViewFormat=0/1 → 对比
// 3) L5 不带 KeywordID 只带 CampaignID+AdGroupID → 是否批量返回每关键词行（关键！）
// 4) L5 带 KeywordID + ViewFormat=0 → 按天趋势
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
  const kwId = '46634681516800'; // laser cutter

  const IND = ["Impressions","Clicks","ClickRate","Cost","CPC","Orders","SalesAmount","ACoS","ROAS","OrdersRate","SalesQty"];

  function showItems(label, j, maxItems) {
    const items = j.data?.data?.Items || (j.data?.data?.list?.[0]?.group) || j.data?.Items || [];
    const keys = items.length ? Object.keys(items[0]).join(',') : '';
    console.log(`${label}: ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
    if (keys) console.log(`  keys: ${keys}`);
    (Array.isArray(items) ? items : []).slice(0, maxItems || 5).forEach(it => {
      const sum = it => (it.Cost||0)+(it.Impressions||0)+(it.Clicks||0)+(it.Orders||0)+(it.SalesAmount||0);
      console.log(`  ${it.dsion||it.KeywordText||it.TargetingText||'?'} | impr=${it.Impressions??'-'} clicks=${it.Clicks??'-'} cost=${it.Cost??'-'} orders=${it.Orders??'-'} sales=${it.SalesAmount??'-'} (sum=${sum(it)})`);
    });
    return items;
  }

  // 1. GetAdvPerformanceReport L5 + 单关键词 + ViewFormat=1（周）
  console.log('=== 1. Report.GetAdvPerformanceReport L5 单关键词 ViewFormat=1 ===');
  let body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 50 },
      Filter: {
        AdvPerformanceReportTypeEnum: 5,
        Indicators: IND,
        ReportDate1: '2026-08-08',
        ReportDate2: '2026-08-14',
        ReportFilter: [{ AttributeCode: "KeywordID", Value: kwId }],
        ViewFormat: 1,
        StoreSiteID: store.storeSiteId
      },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  let res = await callAPI('Report.GetAdvPerformanceReport', body);
  let j;
  try { j = JSON.parse(res.text); showItems('  [Report L5 kw ViewFormat=1]', j, 5); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 2. GetAdvPerformanceReport L5 + 单关键词 + ViewFormat=0（日）
  console.log('\n=== 2. Report.GetAdvPerformanceReport L5 单关键词 ViewFormat=0 ===');
  body.Content.Filter.ViewFormat = 0;
  res = await callAPI('Report.GetAdvPerformanceReport', body);
  try { j = JSON.parse(res.text); showItems('  [Report L5 kw ViewFormat=0]', j, 8); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 3. GetAdvPerformanceList L5 + 单关键词 + ViewFormat=1
  console.log('\n=== 3. Report.GetAdvPerformanceList L5 单关键词 ViewFormat=1 ===');
  body.Content.Filter.ViewFormat = 1;
  res = await callAPI('Report.GetAdvPerformanceList', body);
  try { j = JSON.parse(res.text); showItems('  [List L5 kw ViewFormat=1]', j, 5); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 4. L5 不带 KeywordID，带 CampaignID + AdGroupID（批量！）
  console.log('\n=== 4. List L5 CampaignID+AdGroupID（无KeywordID）批量 ===');
  body.Content.Filter.ReportFilter = [
    { AttributeCode: "CampaignID", Value: cid },
    { AttributeCode: "AdGroupID", Value: agId }
  ];
  body.Content.Filter.ViewFormat = 1;
  res = await callAPI('Report.GetAdvPerformanceList', body);
  try { j = JSON.parse(res.text); showItems('  [List L5 cid+agid VF=1]', j, 10); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 5. Report L5 不带 KeywordID，带 CampaignID + AdGroupID（批量）
  console.log('\n=== 5. Report L5 CampaignID+AdGroupID（无KeywordID）批量 ===');
  res = await callAPI('Report.GetAdvPerformanceReport', body);
  try { j = JSON.parse(res.text); showItems('  [Report L5 cid+agid VF=1]', j, 10); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 6. List L4 TargetID=kwId（投放ID即关键词ID）对比
  console.log('\n=== 6. List L4 TargetID=kwId（投放即关键词） ===');
  body.Content.Filter.AdvPerformanceReportTypeEnum = 4;
  body.Content.Filter.ReportFilter = [{ AttributeCode: "TargetID", Value: kwId }];
  body.Content.Filter.ViewFormat = 1;
  res = await callAPI('Report.GetAdvPerformanceList', body);
  try { j = JSON.parse(res.text); showItems('  [List L4 kwTarget VF=1]', j, 5); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }
  await sleep(200);

  // 7. List L5 单关键词 ViewFormat=0 长范围（看能否返回多天）
  console.log('\n=== 7. List L5 单关键词 06-01~08-14 ViewFormat=0 ===');
  body.Content.Filter.AdvPerformanceReportTypeEnum = 5;
  body.Content.Filter.ReportFilter = [{ AttributeCode: "KeywordID", Value: kwId }];
  body.Content.Filter.ReportDate1 = '2026-06-01';
  body.Content.Filter.ReportDate2 = '2026-08-14';
  body.Content.Filter.ViewFormat = 0;
  res = await callAPI('Report.GetAdvPerformanceList', body);
  try { j = JSON.parse(res.text); showItems('  [List L5 kw long VF=0]', j, 12); }
  catch (e) { console.log('RAW:', res.text.slice(0, 300)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
