// 第五轮：1) ViewFormat=1 长范围看周边界 dsion 模式；2) 批量获取尝试（不带 KeywordID）
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

  function baseBody() {
    return {
      RequestDate: rd,
      Content: {
        Pager: { PageIndex: 1, PageSize: 500 },
        Filter: {
          AdvPerformanceReportTypeEnum: 5,
          Indicators: IND,
          ReportDate1: '2026-06-01',
          ReportDate2: '2026-08-14',
          ReportFilter: [],
          ViewFormat: 1,
          StoreSiteID: store.storeSiteId
        },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
  }
  async function run(label, actionType, body, maxItems) {
    const res = await callAPI(actionType, body);
    try {
      const j = JSON.parse(res.text);
      const items = j.data?.data?.Items || j.data?.Items || [];
      console.log(`${label}: ret=${j.ret} msg=${j.msg||''} items=${items.length}`);
      items.slice(0, maxItems||8).forEach(it => {
        const nonZero = (it.Cost||0)+(it.Impressions||0)+(it.Clicks||0)+(it.Orders||0);
        console.log(`  ${it.IsTotal?'TOTAL':''} ${it.dsion} | impr=${it.Impressions} clicks=${it.Clicks} cost=${it.Cost} orders=${it.Orders} sales=${it.SalesAmount} nz=${nonZero}`);
      });
      return items;
    } catch (e) { console.log(`${label} RAW:`, res.text.slice(0, 200)); return []; }
  }

  // 1. 单关键词 长范围 ViewFormat=1 → 周边界
  console.log('=== 1. L5 kw 06-01~08-14 ViewFormat=1 周边界 ===');
  let b = baseBody();
  b.Content.Filter.ReportFilter = [{ AttributeCode: "KeywordID", Value: kwId }];
  let items = await run('  ', 'Report.GetAdvPerformanceList', b, 15);
  console.log('  周行数(非Total):', items.filter(i=>!i.IsTotal).length);
  const nonTotal = items.filter(i=>!i.IsTotal);
  if (nonTotal.length > 1) {
    // 推断相邻行的间隔（天）
    const parse = d => { const p = d.split('/'); return new Date(2000+parseInt(p[2]), parseInt(p[0])-1, parseInt(p[1])); };
    const d0 = parse(nonTotal[0].dsion), d1 = parse(nonTotal[1].dsion);
    console.log(`  首两行间隔: ${Math.round((d1-d0)/86400000)} 天, 首行 ${nonTotal[0].dsion} 星期=${['日','一','二','三','四','五','六'][d0.getDay()]}`);
    const dw = ['日','一','二','三','四','五','六'];
    console.log('  各行星期:', nonTotal.map(i => { const d = parse(i.dsion); return `${i.dsion}(${dw[d.getDay()]})`; }).join(' '));
  }
  await sleep(200);

  // 2. 批量尝试 L5 + CampaignID only
  console.log('\n=== 2. L5 CampaignID only ===');
  b = baseBody();
  b.Content.Filter.ReportFilter = [{ AttributeCode: "CampaignID", Value: cid }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 8);
  await sleep(200);

  // 3. 批量尝试 L5 + AdGroupID only
  console.log('\n=== 3. L5 AdGroupID only ===');
  b = baseBody();
  b.Content.Filter.ReportFilter = [{ AttributeCode: "AdGroupID", Value: agId }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 8);
  await sleep(200);

  // 4. 批量尝试 L4 + CampaignID + AdGroupID (ViewFormat=0 每天)
  console.log('\n=== 4. L4 cid+agid ViewFormat=0 ===');
  b = baseBody();
  b.Content.Filter.AdvPerformanceReportTypeEnum = 4;
  b.Content.Filter.ViewFormat = 0;
  b.Content.Filter.ReportFilter = [{ AttributeCode: "CampaignID", Value: cid }, { AttributeCode: "AdGroupID", Value: agId }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 6);
  await sleep(200);

  // 5. 批量尝试 L5 + CampaignID + AdGroupID ViewFormat=0
  console.log('\n=== 5. L5 cid+agid ViewFormat=0 ===');
  b = baseBody();
  b.Content.Filter.AdvPerformanceReportTypeEnum = 5;
  b.Content.Filter.ViewFormat = 0;
  b.Content.Filter.ReportFilter = [{ AttributeCode: "CampaignID", Value: cid }, { AttributeCode: "AdGroupID", Value: agId }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 6);
  await sleep(200);

  // 6. 批量尝试 L4 + CampaignID + AdGroupID ViewFormat=1
  console.log('\n=== 6. L4 cid+agid ViewFormat=1 ===');
  b = baseBody();
  b.Content.Filter.AdvPerformanceReportTypeEnum = 4;
  b.Content.Filter.ViewFormat = 1;
  b.Content.Filter.ReportFilter = [{ AttributeCode: "CampaignID", Value: cid }, { AttributeCode: "AdGroupID", Value: agId }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 10);
  await sleep(200);

  // 7. L4 + CampaignID only ViewFormat=1（活动下所有投放）
  console.log('\n=== 7. L4 CampaignID only ViewFormat=1 ===');
  b = baseBody();
  b.Content.Filter.AdvPerformanceReportTypeEnum = 4;
  b.Content.Filter.ViewFormat = 1;
  b.Content.Filter.ReportFilter = [{ AttributeCode: "CampaignID", Value: cid }];
  await run('  ', 'Report.GetAdvPerformanceList', b, 10);

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
