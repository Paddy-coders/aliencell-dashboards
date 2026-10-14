// 批量测试更多投放词/关键词相关 actiontype
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function call(at) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': at },
        data: {
          RequestDate: requestDate,
          Content: { Attributes: ["ID","Name","Keyword","KeywordText","MatchType","TargetingType","TargetingValue","AdGroupID","CampaignID","State","Report.Impressions","Report.Clicks"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
          StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        }, timeout: 15000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const candidates = [
    'AdGroupTargeting.GetFlatViewList','CampaignTargeting.GetFlatViewList',
    'SpKeyword.GetFlatViewList','SbKeyword.GetFlatViewList','SdKeyword.GetFlatViewList',
    'SpTarget.GetFlatViewList','SbTarget.GetFlatViewList','SdTarget.GetFlatViewList',
    'SpTargeting.GetFlatViewList','SbTargeting.GetFlatViewList','SdTargeting.GetFlatViewList',
    'SponsoredProductsKeyword.GetFlatViewList','SponsoredBrandsKeyword.GetFlatViewList','SponsoredDisplayKeyword.GetFlatViewList',
    'SponsoredProductsTarget.GetFlatViewList','SponsoredBrandsTarget.GetFlatViewList','SponsoredDisplayTarget.GetFlatViewList',
    'Keyword.GetReport','Targeting.GetReport','SearchTerm.GetReport',
    'Keyword.GetList','Targeting.GetList','SearchTerm.GetList',
    'AdKeyword.GetList','AdTargeting.GetList','AdGroupKeyword.GetList',
    'Report.GetFlatViewList','Report.GetList',
    'NegativeKeyword.GetFlatViewList','NegativeTargeting.GetFlatViewList',
    'AdGroupNegativeKeyword.GetFlatViewList','CampaignNegativeKeyword.GetFlatViewList',
    'KeywordReport.GetFlatViewList','TargetingReport.GetFlatViewList','SearchTermReport.GetFlatViewList',
    'AdGroup.GetFlatViewList', // 确认对比
  ];

  for (const at of candidates) {
    const r = await call(at);
    let ok = false, items = -1, msg = '';
    try {
      const j = JSON.parse(r.text);
      ok = j.ret === 0;
      items = j.data && j.data.Items ? j.data.Items.length : -1;
      msg = j.msg || '';
    } catch (e) {}
    const flag = ok ? '✅' : (r.status === 511 ? '❌511' : (items >= 0 ? '⚠️' : '❌'));
    console.log(`[${at}] ${flag} items=${items} msg=${msg.slice(0, 50)} text=${r.text.slice(0, 60)}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
