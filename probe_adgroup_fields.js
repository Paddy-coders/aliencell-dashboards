// 逐个字段探测 AdGroup.GetFlatViewList 兼容性, 找出所有有效字段名
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

  async function call(attrs) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': 'AdGroup.GetFlatViewList' },
        data: {
          RequestDate: requestDate,
          Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
          StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        }, timeout: 15000
      });
      return { text: await resp.text() };
    } catch (e) { return { text: 'ERROR' }; }
  }

  const fields = [
    "AdGroupID","AdGroupName","Name","CampaignID","CampaignName","CampaignID_Str",
    "State","Status","DefaultBid","Bid",
    "Asin","Sku","Keyword","KeywordText","MatchType","TargetingType","TargetingValue",
    "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount",
    "Impressions","Clicks","Cost","Orders","SalesAmount",
  ];

  const ok = [];
  for (const f of fields) {
    const r = await call(["AdGroupID", f]);
    let success = false;
    try { success = JSON.parse(r.text).ret === 0; } catch (e) {}
    console.log(`AdGroupID+${f} -> ${success ? '✅' : '❌'} ${r.text.slice(0, 60)}`);
    if (success) ok.push(f);
  }
  console.log('\n有效字段:', ok.join(', '));

  // 组合有效字段请求并打印第一条数据
  if (ok.length) {
    const r2 = await call(["AdGroupID", ...ok]);
    try {
      const j = JSON.parse(r2.text);
      const items = j.data.Items || [];
      console.log('\n组合请求 items:', items.length);
      if (items[0]) console.log('示例:', JSON.stringify(items[0]).slice(0, 400));
    } catch (e) {}
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
