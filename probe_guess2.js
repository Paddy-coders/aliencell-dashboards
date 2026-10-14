// 测试广告模块 URL 猜测 + 更多 actiontype 探测
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

  // 1. URL 猜测
  for (const u of [
    'https://amz-ad.eccang.com/?resource=sso&token=' + encodeURIComponent(token || ''),
    'https://amz-ad.eccang.com/#/adtargetingkwd?resource=sso&token=' + encodeURIComponent(token || ''),
    'https://amz-ad.eccang.com/ad/adtargetingkwd/list?resource=sso&token=' + encodeURIComponent(token || ''),
  ]) {
    try {
      const r = await ctx.request.get(u, { timeout: 15000, maxRedirects: 5 });
      const body = await r.text();
      console.log(`GET ${u.slice(0, 120)} -> ${r.status()} body=${body.slice(0, 80)}`);
    } catch (e) { console.log(`GET ${u.slice(0, 120)} -> ERR ${e.message.slice(0, 80)}`); }
  }

  // 2. 更多 actiontype 探测
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, attrs) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: {
          RequestDate: requestDate,
          Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 30 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
          StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        }, timeout: 20000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const base = ["Asin","Sku","AdGroupID","CampaignID","CampaignName","AdGroupName","CampaignType","State"];
  const report = ["Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount"];
  const moreAT = [
    'AdGroup.GetFlatViewList', 'AdGroupKeyword.GetFlatViewList', 'AdGroupTarget.GetFlatViewList',
    'AdTargetingKwd.GetFlatViewList', 'AdTargeting.GetFlatViewList', 'AdKeyword.GetFlatViewList',
    'KeywordReport.GetFlatViewList', 'TargetingReport.GetFlatViewList',
    'CampaignKeyword.GetFlatViewList', 'CampaignTarget.GetFlatViewList',
    'AdGroupKeywords.GetFlatViewList', 'AdGroupTargets.GetFlatViewList',
    'AdvertisingKeyword.GetFlatViewList', 'AdvertisingTarget.GetFlatViewList',
    'KwdTargetSelected.GetFlatViewList', 'DuplicateTargeting.GetFlatViewList',
    'AdGroupReport.GetFlatViewList', 'CampaignReport.GetFlatViewList',
    'ProductAdReport.GetFlatViewList', 'ProductAdKeyword.GetFlatViewList',
    'ProductAdTarget.GetFlatViewList', 'AdGroup.GetList',
  ];

  for (const at of moreAT) {
    const r = await callAPI(at, [...base, ...report]);
    let ok = false; let items = -1;
    try {
      const j = JSON.parse(r.text);
      items = j.data && j.data.Items ? j.data.Items.length : -1;
      if (j.ErrCode === 0 || items >= 0) ok = true;
    } catch (e) {}
    console.log(`[${at}] status=${r.status} ok=${ok} items=${items} text=${r.text.slice(0, 60)}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
