// 探测易仓ERP广告API中"投放词/关键词"相关 actiontype
// 复用 ProductAd.GetFlatViewList 的 body 结构, 尝试不同 actiontype, 看哪些有效
const { chromium } = require('playwright');
const fs = require('fs');

const STORE = { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 }; // DE
const CANDIDATES = [
  'Keyword.GetFlatViewList', 'Keywords.GetFlatViewList', 'AdKeyword.GetFlatViewList',
  'Targeting.GetFlatViewList', 'Target.GetFlatViewList', 'AdGroupTarget.GetFlatViewList',
  'AdGroupTargets.GetFlatViewList', 'SearchTerm.GetFlatViewList', 'SearchTerms.GetFlatViewList',
  'AdGroup.GetFlatViewList', 'CampaignKeyword.GetFlatViewList', 'KeywordReport.GetFlatViewList',
  'ProductAdKeyword.GetFlatViewList', 'TargetReport.GetFlatViewList', 'SearchTermReport.GetFlatViewList',
  'AdKeywordTarget.GetFlatViewList', 'Keyword.GetList', 'Targeting.GetList', 'KeywordTarget.GetFlatViewList',
];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com') || p.url().includes('amz-ad')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('NO TOKEN'); await browser.close(); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: body, timeout: 20000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const base = {
    RequestDate: requestDate,
    Content: {
      Attributes: [
        "Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal",
        "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount",
        "Report.ClickRate","Report.OrdersRate","Report.CPC","Report.ACoS",
        "CampaignName","AdGroupName","CampaignType","TargetingType","TargetingValue","Keyword","MatchType"
      ],
      Pager: { PageIndex: 1, PageSize: 30 },
      Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } },
      Sorter: {}
    },
    StoreSiteID: STORE.storeSiteId, StoreID: STORE.storeId, MarketSiteID: STORE.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };

  for (const at of CANDIDATES) {
    const r = await callAPI(at, base);
    let summary = '';
    try {
      const j = JSON.parse(r.text);
      const items = (j.data && j.data.Items) || [];
      const total = j.data && j.data.Total ? j.data.Total : '';
      if (j.ErrCode === 0 || (Array.isArray(items))) {
        const keys = items[0] ? Object.keys(items[0]).join(',') : '(no items)';
        summary = `✅ OK items=${items.length} total=${total} | 字段: ${keys.slice(0, 220)}`;
      } else {
        summary = `❌ ErrCode=${j.ErrCode} msg=${String(j.Message || j.ErrMsg || '').slice(0, 60)}`;
      }
    } catch (e) {
      summary = `⚠️ 非JSON: ${String(r.text).slice(0, 80)}`;
    }
    console.log(`[${at}] status=${r.status} ${summary}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
