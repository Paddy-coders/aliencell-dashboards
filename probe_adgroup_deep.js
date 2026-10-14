// 深度探测 AdGroup.GetFlatViewList 参数结构: 测试各种Attributes/Filter/Pager组合
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

  async function call(body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': 'AdGroup.GetFlatViewList' },
        data: body, timeout: 20000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const makeBody = (content) => ({
    RequestDate: requestDate,
    Content: content,
    StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  });

  const tests = [
    // 最简
    { Attributes: [], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
    { Attributes: ["AdGroupID"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
    { Attributes: ["AdGroupID","AdGroupName"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
    // 带 CampaignID
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","CampaignName","State"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
    // 带 Report 日期
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
    // 带 Report 字段
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State","Report.Impressions","Report.Clicks"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
    // 无 Report Filter
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State","Impressions","Clicks"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: {}, Sorter: {} },
    // 加 Keyword 字段
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State","Keyword","KeywordText","MatchType"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
    // 更大 PageSize
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: {} },
    // 不同 Sorter
    { Attributes: ["AdGroupID","AdGroupName","CampaignID","State"], Pager: { PageIndex: 1, PageSize: 10 }, Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } }, Sorter: { Field: 'AdGroupID', Direction: 'ASC' } },
  ];

  for (const t of tests) {
    const r = await call(makeBody(t));
    let items = -1, msg = '';
    try { const j = JSON.parse(r.text); items = j.data && j.data.Items ? j.data.Items.length : -1; msg = j.msg || j.ret || ''; } catch (e) {}
    console.log(`attrs=${t.Attributes.length} filter=${Object.keys(t.Filter).length} items=${items} msg=${msg.slice(0, 60)} text=${r.text.slice(0, 80)}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
