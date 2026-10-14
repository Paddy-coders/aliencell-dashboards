// 批量抓取: 13国 × 最近8周 ProductAd.GetFlatViewList (广告指标+视频字段+ASIN映射)
// 周度: 周六-周五; 动态计算周范围, 每次覆盖最新完整周+前7周(含前3周复核区间)
// 输出: ad_weekly_all_video.json (结构同昨日 ad_weekly_all.json: { output, mapping })
const { chromium } = require('playwright');
const fs = require('fs');

const STORES = {
  US: { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 },
  BE: { storeSiteId: 586021, storeId: 174010, marketSiteId: 21 },
  CA: { storeSiteId: 586025, storeId: 174011, marketSiteId: 3 },
  DE: { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 },
  ES: { storeSiteId: 586017, storeId: 174010, marketSiteId: 8 },
  FR: { storeSiteId: 586016, storeId: 174010, marketSiteId: 9 },
  IE: { storeSiteId: 586022, storeId: 174010, marketSiteId: 22 },
  IT: { storeSiteId: 586015, storeId: 174010, marketSiteId: 12 },
  MX: { storeSiteId: 586023, storeId: 174010, marketSiteId: 2 },
  NL: { storeSiteId: 586018, storeId: 174010, marketSiteId: 13 },
  PL: { storeSiteId: 586020, storeId: 174010, marketSiteId: 19 },
  SE: { storeSiteId: 586019, storeId: 174010, marketSiteId: 20 },
  UK: { storeSiteId: 586014, storeId: 174010, marketSiteId: 10 },
};

// 动态计算最近N周 (周六-周五), 以最近完整周五为基准
function getLastFriday(d = new Date()) {
  const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const offset = day >= 5 ? day - 5 : day + 2; // days back to last Friday
  const lastFri = new Date(d);
  lastFri.setDate(d.getDate() - offset);
  lastFri.setHours(0, 0, 0, 0);
  return lastFri;
}
function fmt(d) { return d.toLocaleDateString('en-CA'); }
const WEEK_COUNT = 8; // 最新完整周 + 前7周(复核前3周需重叠覆盖)
const lastFri = getLastFriday();
const WEEKS = [];
for (let i = 0; i < WEEK_COUNT; i++) {
  const end = new Date(lastFri); end.setDate(lastFri.getDate() - i * 7);
  const start = new Date(end); start.setDate(end.getDate() - 6);
  WEEKS.unshift({ start: fmt(start), end: fmt(end) });
}
console.log('广告抓取周范围(%d周): %s', WEEK_COUNT, WEEKS.map(w => `${w.start}~${w.end}`).join(', '));

const CDP_PORT = process.env.CDP_PORT || '9223'; // 自动化专用调试实例(由 auto_login_eccang.js 启动并登录)
const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('selmuch-web') || p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) {
    // 自动打开易仓入口页(同一profile会话共享, 无需重新登录)
    page = await ctx.newPage();
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto 警告:', e.message));
    await page.waitForTimeout(6000);
  }
  if (page.url().includes('/login')) {
    console.log('未登录易仓(停留在登录页)。请先运行 node auto_login_eccang.js 完成自动登录后再采集。');
    await browser.close(); return;
  }

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('未获取到 token (可能未登录)'); await browser.close(); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: body, timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const makeBody = (store, dateRange) => ({
    RequestDate: requestDate,
    Content: {
      Attributes: [
        "Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal",
        "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount",
        "Report.ClickRate","Report.OrdersRate","Report.CPC","Report.ACoS",
        "Report.VideoCompleteViews","Report.VideoMidpointViews","Report.VideoFirstQuartileViews",
        "Report.VideoThirdQuartileViews","Report.Video5SecondViews","Report.VideoUnmutes",
        "CampaignName","AdGroupName","PortfolioName","CampaignType"
      ],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: dateRange
        ? { Report: { ReportDate: [dateRange.start, dateRange.end] } }
        : {},
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  });

  const output = {};   // country -> { weeks: {start_end: items[]} }
  const mapping = {};  // country -> items (无日期映射)
  const campaigns = {}; // country -> [Campaign.GetList items]

  for (const [country, store] of Object.entries(STORES)) {
    // 1. 映射（无日期）
    let r = await callAPI('ProductAd.GetFlatViewList', makeBody(store, null));
    let j;
    try { j = JSON.parse(r.text); } catch (e) { console.log(country, 'mapping parse fail'); continue; }
    const mapItems = (j.data?.Items || []).filter(it => !it.IsTotal);
    mapping[country] = mapItems;
    console.log(`[${country}] mapping: ${mapItems.length} ads`);

    // 1b. Campaign.GetList 全状态广告活动（用于获取已暂停/已归档状态）
    const campBody = {
      RequestDate: requestDate,
      Content: {
        Attributes: ["CampaignID","State","Name","CampaignType","SponsoredType","DailyBudget","BudgetType","StartDate","EndDate"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Filter: { AttributeFilters: [] },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    r = await callAPI('Campaign.GetList', campBody);
    try {
      j = JSON.parse(r.text);
      const campItems = (j.data?.Items || []).filter(it => !it.IsTotal);
      campaigns[country] = campItems;
      const dist = {};
      for (const it of campItems) { dist[it.State] = (dist[it.State] || 0) + 1; }
      console.log(`[${country}] campaigns: ${campItems.length} campaigns, states=${JSON.stringify(dist)}`);
    } catch (e) {
      console.log(`[${country}] Campaign.GetList fail: ${String(r.text).substring(0, 80)}`);
      campaigns[country] = [];
    }

    // 2. 每周指标
    output[country] = { weeks: {} };
    for (const w of WEEKS) {
      r = await callAPI('ProductAd.GetFlatViewList', makeBody(store, w));
      try {
        j = JSON.parse(r.text);
        const items = (j.data?.Items || []).filter(it => !it.IsTotal);
        output[country].weeks[`${w.start}_${w.end}`] = items;
        const cost = items.reduce((s, it) => s + (it.Report?.Cost || 0), 0);
        const vc = items.reduce((s, it) => s + (it.Report?.VideoCompleteViews || 0), 0);
        console.log(`   ${w.start}~${w.end}: ${items.length} ads, cost=${cost.toFixed(2)}, 完播=${vc}`);
      } catch (e) {
        console.log(`   ${w.start}~${w.end}: FAIL ${String(r.text).substring(0, 80)}`);
        output[country].weeks[`${w.start}_${w.end}`] = [];
      }
    }
  }

  fs.writeFileSync('ad_weekly_all_video.json', JSON.stringify({ output, mapping, campaigns }, null, 1));
  console.log('\nSaved ad_weekly_all_video.json (with campaigns)');
  await browser.close();
})();
