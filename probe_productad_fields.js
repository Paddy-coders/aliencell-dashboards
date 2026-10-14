// 探测 ProductAd.GetFlatViewList 是否支持投放词相关字段
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

  async function callAPI(attrs) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' },
        data: {
          RequestDate: requestDate,
          Content: {
            Attributes: attrs,
            Pager: { PageIndex: 1, PageSize: 30 },
            Filter: { Report: { ReportDate: ['2026-08-08', '2026-08-14'] } },
            Sorter: {}
          },
          StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        }, timeout: 25000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const base = ["Asin","Sku","AdGroupID","CampaignID","CampaignName","AdGroupName","CampaignType","State"];
  const report = ["Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount"];

  // 1. 基础字段确认
  let r = await callAPI([...base, ...report]);
  let j = JSON.parse(r.text);
  const baseItem = (j.data?.Items || []).filter(it => !it.IsTotal)[0];
  console.log('基础字段返回 items:', (j.data?.Items || []).length, 'total:', j.data?.Total);
  if (baseItem) console.log('示例 item keys:', Object.keys(baseItem).join(', '));

  // 2. 加投放词字段尝试
  const kwAttrs = ["Keyword","KeywordText","TargetingType","TargetingValue","MatchType","TargetingId"];
  for (const a of kwAttrs) {
    r = await callAPI([...base, ...report, a]);
    try { j = JSON.parse(r.text); } catch (e) { j = null; }
    const items = j?.data?.Items || [];
    const it = items.filter(i => !i.IsTotal)[0];
    console.log(`加字段 [${a}] -> items=${items.length}`, '返回key:', it && a in it ? it[a] : (it && Object.keys(it).includes(a) ? '(empty)' : '❌字段不存在'));
  }

  // 3. 批量加所有 keyword 字段
  r = await callAPI([...base, ...report, ...kwAttrs]);
  try { j = JSON.parse(r.text); } catch (e) { j = null; }
  const it = (j?.data?.Items || []).filter(i => !i.IsTotal)[0];
  if (it) {
    console.log('\n批量加字段后示例 item:');
    for (const [k,v] of Object.entries(it)) {
      console.log(`  ${k}: ${String(v).slice(0, 80)}`);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
