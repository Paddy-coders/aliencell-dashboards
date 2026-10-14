// probe_ads_scope.js — 只读探针：老日期的广告数据「重拉后会不会变多」
//
// 背景（2026-09-24）：一次校准普查发现 daily_data.json 里广告条数存在明显「台阶」——
//   06-23~07-31 = 44 条(2 国) / 08-01~08-10 = 66 条(3 国) / 08-11 起 = 192 条(9 国)，
//   而 08-11~08-17 重拉后从 66 变成 192。需要判断：
//     A. 历史结构本来就小（那时投放的广告实体少）→ 44/66 是真实值，历史无需处理
//     B. 旧日期当时只采到部分实体（覆盖不全）→ 44/66 偏低，历史 ACOS/花费被低估，需要全量重拉
//   本探针对指定老日期直接调 ProductAd.GetFlatViewList（13 国），与 daily_data.json 已存条数对比。
//   完全不写任何文件。
//
// 用法：
//   PROBE_DATES=2026-07-26,2026-08-05 node probe_ads_scope.js
//   PROBE_DATES=2026-06-23,2026-07-15,2026-08-05 node probe_ads_scope.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const CDP_PORT = process.env.CDP_PORT || '9223';
const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

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

const DATES = (process.env.PROBE_DATES || '2026-07-26,2026-08-05').split(',').map(s => s.trim());
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = x => Math.round(x * 100) / 100;

const stored = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'daily_data.json'), 'utf8')).days || {};

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) if (p.url().includes('eccang.com') && !p.url().includes('/login')) page = page || p;
  }
  if (!page) { console.log('ERROR: 未找到已登录的易仓页面，请先跑 auto_login_eccang.js'); process.exit(1); }
  console.log('页面:', page.url().slice(0, 120));

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('ERROR: 未能从页面取到 ToKen(pro__Access-Token)'); await browser.close(); process.exit(1); }
  console.log('ToKen 已获取, 前缀:', String(token).slice(0, 12));

  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // 与 fetch_daily_data.js 完全一致的调用管道（endpoint + actiontype 头 + token）
  const ctx = browser.contexts()[0];
  async function callAPI(actionType, body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: body, timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const makeBody = (store, d) => ({
    RequestDate: requestDate,
    Content: {
      Attributes: [
        "Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal",
        "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount",
        "Report.ClickRate","Report.OrdersRate","Report.CPC","Report.ACoS",
        "CampaignName","AdGroupName","PortfolioName","CampaignType"
      ],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: { Report: { ReportDate: [d, d] } },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  });

  console.log('\n日期         国家  已存items  新查items   已存花费   新查花费');
  console.log('-'.repeat(72));
  const conclusion = [];
  for (const d of DATES) {
    let oldTot = 0, newTot = 0, oldCost = 0, newCost = 0, grown = [];
    const results = await Promise.all(Object.entries(STORES).map(async ([cc, store]) => {
      const r = await callAPI('ProductAd.GetFlatViewList', makeBody(store, d));
      try {
        const j = JSON.parse(r.text);
        return [cc, (j.data?.Items || []).filter(it => !it.IsTotal)];
      } catch (e) { console.log(`  [${cc}] ${d} FAIL status=${r.status} ${String(r.text).slice(0,60)}`); return [cc, null]; }
    }));
    const agg = (arr) => arr.reduce((a, i) => {
      const r = i.Report || {};
      a.cost += num(r.Cost); a.clicks += num(r.Clicks); a.orders += num(r.Orders); a.sales += num(r.SalesAmount);
      return a;
    }, { cost: 0, clicks: 0, orders: 0, sales: 0 });
    const oldAgg = { cost: 0, clicks: 0, orders: 0, sales: 0 };
    const newAgg = { cost: 0, clicks: 0, orders: 0, sales: 0 };
    for (const [cc, items] of results) {
      const oldItems = ((stored[d] || {}).ads || {})[cc] || [];
      const oi = oldItems.length, ni = items ? items.length : -1;
      const oc = oldItems.reduce((s, i) => s + num((i.Report || {}).Cost), 0);
      const nc = items ? items.reduce((s, i) => s + num((i.Report || {}).Cost), 0) : 0;
      oldTot += oi; newTot += Math.max(0, ni); oldCost += oc; newCost += nc;
      const oa = agg(oldItems), na = agg(items || []);
      for (const k of ['cost', 'clicks', 'orders', 'sales']) { oldAgg[k] += oa[k]; newAgg[k] += na[k]; }
      if (ni > oi) grown.push(cc);
      if (oi || ni) console.log(`${d}  ${cc}  ${String(oi).padStart(8)}  ${String(ni).padStart(9)}  ${oc.toFixed(2).padStart(10)}  ${nc.toFixed(2).padStart(10)}${ni > oi ? '  ← 变多' : ''}`);
    }
    const dCost = round2(newAgg.cost - oldAgg.cost), dClk = newAgg.clicks - oldAgg.clicks,
          dOrd = newAgg.orders - oldAgg.orders, dSal = round2(newAgg.sales - oldAgg.sales);
    const moneyChanged = dCost !== 0 || dClk !== 0 || dOrd !== 0 || dSal !== 0;
    console.log(`  ⇒ ${d} 合计: items ${oldTot} → ${newTot}`);
    console.log(`     金额类: 花费 ${round2(oldAgg.cost)}→${round2(newAgg.cost)}(${dCost>=0?'+':''}${dCost})  点击 ${oldAgg.clicks}→${newAgg.clicks}(${dClk>=0?'+':''}${dClk})  订单 ${oldAgg.orders}→${newAgg.orders}(${dOrd>=0?'+':''}${dOrd})  销售额 ${round2(oldAgg.sales)}→${round2(newAgg.sales)}(${dSal>=0?'+':''}${dSal})  ${moneyChanged ? '⚠️ 金额有差异' : '✓ 金额完全一致'}`);
    conclusion.push({ d, oldTot, newTot, oldCost: round2(oldCost), newCost: round2(newCost), grown, dCost, dClk, dOrd, dSal });
    console.log('');
  }

  await browser.close();
  console.log('='.repeat(72));
  const grew = conclusion.filter(c => c.newTot > c.oldTot);
  const money = conclusion.filter(c => c.dCost || c.dClk || c.dOrd || c.dSal);
  console.log(`条数变多的日期: ${grew.length}/${conclusion.length}`);
  console.log(`金额(花费/点击/订单/销售额)有差异的日期: ${money.length}/${conclusion.length}`);
  if (grew.length && !money.length) {
    console.log('结论：老日期重拉后**条数变多、但金额完全一致** —— 多出来的是当时零消耗的广告实体。');
    console.log('     广告接口对历史日期返回的是「当前广告结构 + 该日指标」，所以历史覆盖缺口只体现在条数，');
    console.log('     **不影响花费/点击/订单/销售额等金额类指标**，历史 ACOS 未被低估，无需全量补拉。');
  } else if (money.length) {
    console.log('结论：老日期重拉后**金额也有差异** → 历史金额类指标被低估，需补拉受影响区间：');
    money.forEach(c => console.log(`       ${c.d}: 花费${c.dCost>=0?'+':''}${c.dCost} 点击${c.dClk>=0?'+':''}${c.dClk} 订单${c.dOrd>=0?'+':''}${c.dOrd} 销售额${c.dSal>=0?'+':''}${c.dSal}`));
  } else {
    console.log('结论：老日期重拉后条数与金额均一致 → 无需处理');
  }
  console.log('\n（探针只读：未修改任何本地文件、未写任何数据）');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
