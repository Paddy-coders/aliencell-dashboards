// 探测 AdGroup.GetFlatViewList 正确参数结构
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

  async function call(actionType, attrs, filter) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: {
          RequestDate: requestDate,
          Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 30 }, Filter: filter, Sorter: {} },
          StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        }, timeout: 20000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const base = ["AdGroupID","AdGroupName","CampaignID","CampaignName","State","DefaultBid"];
  const report = ["Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount"];
  const kw = ["Keyword","KeywordText","MatchType","TargetingType","TargetingValue"];

  // 1. 尝试不同 Attributes
  const attrSets = [
    base,
    [...base, ...report],
    ["AdGroupID","AdGroupName","CampaignID","CampaignName","State"],
    ["AdGroupID","AdGroupName","CampaignID","State","Impressions","Clicks","Cost","Orders","SalesAmount"],
    ["AdGroupID","AdGroupName","CampaignID","State","Report"],
    [...base, ...kw],
  ];
  console.log('=== AdGroup.GetFlatViewList 参数测试 ===');
  for (const attrs of attrSets) {
    const r = await call('AdGroup.GetFlatViewList', attrs, { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } });
    let msg = '', items = -1;
    try { const j = JSON.parse(r.text); msg = j.msg || ''; items = j.data && j.data.Items ? j.data.Items.length : -1; } catch (e) {}
    console.log(`attrs[${attrs.length}] -> items=${items} msg=${msg.slice(0, 60)} text=${r.text.slice(0, 80)}`);
  }

  // 2. 尝试不同的 Filter 结构
  console.log('\n=== AdGroup.GetFlatViewList Filter 测试 ===');
  const filters = [
    {},
    { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } },
    { ReportDate: { Start: '2026-08-08', End: '2026-08-14' } },
    { Date: ['2026-08-08', '2026-08-14'] },
    { AdGroup: { ReportDate: ['2026-08-08', '2026-08-14'] } },
  ];
  for (const f of filters) {
    const r = await call('AdGroup.GetFlatViewList', base, f);
    let msg = '', items = -1;
    try { const j = JSON.parse(r.text); msg = j.msg || ''; items = j.data && j.data.Items ? j.data.Items.length : -1; } catch (e) {}
    console.log(`Filter ${JSON.stringify(f).slice(0, 60)} -> items=${items} msg=${msg.slice(0, 60)}`);
  }

  // 3. 尝试 AdGroup.GetList
  console.log('\n=== AdGroup.GetList 测试 ===');
  for (const attrs of [["AdGroupID","AdGroupName","CampaignID","CampaignName","State"], ["AdGroupID","AdGroupName","State"]]) {
    const r = await call('AdGroup.GetList', attrs, {});
    let msg = '', items = -1;
    try { const j = JSON.parse(r.text); msg = j.msg || ''; items = j.data && j.data.Items ? j.data.Items.length : -1; } catch (e) {}
    console.log(`attrs[${attrs.length}] -> items=${items} msg=${msg.slice(0, 60)} text=${r.text.slice(0, 80)}`);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
