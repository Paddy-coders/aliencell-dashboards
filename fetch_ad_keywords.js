// 投放词周度数据采集
// 流程：13国 → Campaign.GetList → AdGroup.GetList → AdGroupBidKw.GetList → Report.GetAdvPerformanceList (L5 + ViewFormat=0) → 本地按周六-周五聚合
// 输出：ad_keywords_all.json
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
function md5(s) { return crypto.createHash('md5').update(s).digest('hex').toUpperCase(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 13 国店铺配置（与 fetch_ad_weekly_video.js 保持一致）
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

// 周范围（与 ad_weekly_all_video.json 的 8 周一致；最早 2026-06-20 周期）
// 为保险起见拉取 2026-06-13（该周第一天=6/13 周六）到今天，确保覆盖
function getDateRange(weeksBack) {
  // 周六-周五为一周；今天若是周三，返回最近一个周六(本周六=today-4~5)
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  // 上一个/本周六: 若 today 是周六(6) 则 today-0=本周六；若是周日(0) 则 today-1
  const lastSat = new Date(now); lastSat.setDate(now.getDate() - ((day + 1) % 7));
  // 起始 = lastSat - (weeksBack-1)*7
  const start = new Date(lastSat); start.setDate(lastSat.getDate() - (weeksBack - 1) * 7);
  const end = new Date(now);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: fmt(start), end: fmt(end) };
}

// 项目周定义：周六-周五，周标签=该周周一的ISO周数
function getWeeks(startStr, endStr) {
  // 起点=startStr（周六），终点=endStr
  // 每周一(weekStart+2)的 ISO 周数
  const weeks = [];
  let cur = new Date(startStr + 'T00:00:00Z');
  while (cur <= new Date(endStr + 'T00:00:00Z')) {
    const mon = new Date(cur); mon.setUTCDate(cur.getUTCDate() + 2);
    const iso = mon.toISOString().slice(0, 10); // 调试用
    const weekStart = new Date(cur);
    const weekEnd = new Date(cur); weekEnd.setUTCDate(cur.getUTCDate() + 6);
    // ISO 周数
    const target = new Date(mon.valueOf());
    const dayNum = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    const label = `W${String(week).padStart(2,'0')}`;
    weeks.push({ label, start: weekStart.toISOString().slice(0,10), end: weekEnd.toISOString().slice(0,10) });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return weeks;
}

// 聚合按天行 → 按周六-周五周
function aggregateByWeek(dayRows, weeks) {
  // dayRows: [{dsion:'08/01', Cost, Impressions, Clicks, Orders, SalesAmount}, ...]
  // 输出: { W32: {impressions,clicks,cost,orders,sales}, ... }（只对在 weeks 范围内的日期聚合）
  const result = {};
  weeks.forEach(w => result[w.label] = { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 });
  for (const r of dayRows) {
    // dsion 格式 MM/DD
    const [m, d] = r.dsion.split('/').map(Number);
    if (!m || !d) continue;
    // 用一个非闰年作为占位年（仅用于周归属）
    const year = 2026;
    const dt = new Date(Date.UTC(year, m - 1, d));
    // 找该日期属于哪个周：w.start(周六) <= dt <= w.end(周五)
    const w = weeks.find(w => dt >= new Date(w.start + 'T00:00:00Z') && dt <= new Date(w.end + 'T23:59:59Z'));
    if (!w) continue;
    const cur = result[w.label];
    cur.impressions += Number(r.Impressions) || 0;
    cur.clicks += Number(r.Clicks) || 0;
    cur.cost += Number(r.Cost) || 0;
    cur.orders += Number(r.Orders) || 0;
    cur.sales += Number(r.SalesAmount) || 0;
  }
  // 保留两位小数
  for (const k of Object.keys(result)) {
    result[k].cost = Number(result[k].cost).toFixed(2) * 1;
    result[k].sales = Number(result[k].sales).toFixed(2) * 1;
  }
  return result;
}

// AdGroupBidKw.GetList 完整 Attributes（与 chunk 一致）
const KW_ATTRS = ['IsKeywordRob','KeywordRobRuleName','Report.JumpRate','CampaignID','CampaignID_Str','AdGroupID','KeywordID','KeywordID_Str','KeywordText','MatchType','State','Bid','SuggestedBid','SuggestedRangeStart','SuggestedRangeEnd','MonitorStatus','Report.Impressions','Report.Clicks','Report.ClickRate','Report.Cost','Report.CPC','Report.Orders','Report.SalesAmount','Report.ACoS','Report.ACoTS','Report.ASoTS','Report.ROAS','Report.OrdersRate','ServingStatus','HasAdScheduleHint','AdScheduleStartTime','AdScheduleEndTime','OrgBid','OptimizeRuleName','OptimizeRuleColor','IsAddNegKw','AddNegMatchTypeList','IsLock','AdScheduleColor','ScheduleTemplateName','AddNegLevelList','CampaignType','IsTotal','OrgState','Report.SelfOrders','Report.OtherOrders','Report.SalesQty','Report.SelfSalesQty','Report.OtherSalesQty','Report.SelfSalesAmount','Report.OtherSalesAmount'];
const IND = ['Impressions','Clicks','ClickRate','Cost','CPC','Orders','SalesAmount','ACoS','ROAS','OrdersRate','SalesQty'];

(async () => {
  const WEEKS_BACK = 8; // 8 周（与现有 ad_weekly 一致）
  const { start: rangeStart, end: rangeEnd } = getDateRange(WEEKS_BACK);
  const weeks = getWeeks(rangeStart, rangeEnd);
  console.log('周范围:', rangeStart, '~', rangeEnd);
  console.log('周列表:', weeks.map(w => `${w.label}(${w.start}~${w.end})`).join(', '));

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO HOME PAGE'); await browser.close(); process.exit(2); }
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pro__Access-Token')).value).catch(() => null);
  if (!token) { console.log('NO TOKEN'); await browser.close(); process.exit(2); }
  console.log('token 准备就绪');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  // 注意：eccang 的 RequestDate 字段用 UTC（与后端服务时区对齐）
  // 但之前探测用了本地时区也能成功。保守使用与现有 fetch_ad_weekly_video.js 一致：东八区
  const rdLocal = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': actionType, 'contentmd5': md5(JSON.stringify(body)) },
      data: body, timeout: 60000
    });
    const j = JSON.parse(await r.text());
    return j;
  }

  // 进度与统计
  let totalCampaigns = 0, totalAdGroups = 0, totalKeywords = 0, totalApiCalls = 0;
  const output = {};

  const TEST_ONLY = process.env.TEST_ONLY; // 'US'/'DE'/... 仅跑该国家
  const storeEntries = Object.entries(STORES).filter(([k]) => !TEST_ONLY || k === TEST_ONLY);
  for (const [country, store] of storeEntries) {
    console.log(`\n===== ${country} =====`);
    const countryCamps = {};
    // 1. Campaign.GetList (enabled)
    const c1 = await callAPI('Campaign.GetList', {
      RequestDate: rdLocal, Content: {
        Pager: { PageIndex: 1, PageSize: 500 }, Sorter: {},
        Attributes: ['CampaignID','Name','State','TargetingType','CampaignType','SponsoredType'],
        Filter: { AttributeFilters: [{ AttributeCode: 'State', Operator: '=', Value: 'enabled' }, { AttributeCode: 'TargetingType', Operator: '=', Value: 'manual' }] }
      }, StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    });
    totalApiCalls++;
    const allCamps = c1.data?.data?.Items || c1.data?.Items || [];
    // 不再按 CampaignType 过滤，全部保留（SB/SD/SP 均可能有投放词）
    const camps = allCamps;
    console.log(`  enabled 活动数: ${camps.length}`);
    if (camps.length === 0) { output[country] = { campaigns: {} }; continue; }
    if (camps.length > 0) console.log(`  [诊断] 首个活动字段: ${JSON.stringify(camps[0]).slice(0, 300)}`);

    for (const camp of camps) {
      // 2. AdGroup.GetList（注意 SB 可能没有关键词或结构不同；目前关键词主要在 SP 手动）
      const a1 = await callAPI('AdGroup.GetList', {
        RequestDate: rdLocal, Content: {
          Pager: { PageIndex: 1, PageSize: 500 }, Sorter: {},
        // 最小 Attributes（多字段如 AdGroupType/TargetingType 会报 1004）
        Attributes: ['CampaignID','AdGroupID','Name'],
        Filter: { CampaignID: camp.CampaignID, AttributeFilters: [{ AttributeCode: 'State', Operator: '=', Value: 'enabled' }] }
        }, StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
        UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
      });
      totalApiCalls++;
      const adGroups = a1.data?.data?.Items || a1.data?.Items || [];
      console.log(`    活动 ${camp.Name}(${camp.CampaignType}) 广告组=${adGroups.length}`);
      if (adGroups.length === 0) {
        console.log(`    [诊断] AdGroup.GetList(cid=${camp.CampaignID}) ret=${a1.data?.ret ?? a1.ret} msg=${a1.data?.msg ?? a1.msg ?? ''} items=0`);
        continue;
      }
      const campData = { id: camp.CampaignID, name: camp.Name, type: camp.CampaignType, sponsoredType: camp.SponsoredType, adGroups: {} };
      for (const ag of adGroups) {
        // 3. AdGroupBidKw.GetList（关键词列表）
        const k1 = await callAPI('AdGroupBidKw.GetList', {
          RequestDate: rdLocal, Content: {
            Attributes: KW_ATTRS,
            Filter: { AttributeFilters: [], CampaignID: camp.CampaignID, AdGroupID: ag.AdGroupID, ClassType: 0 },
            Pager: { PageIndex: 1, PageSize: 500 }, Sorter: {}
          }, StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
          UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
        });
        totalApiCalls++;
        const kws = (k1.data?.data?.Items || k1.data?.Items || []).filter(k => !k.IsTotal);
        if (kws.length === 0) {
          console.log(`      [诊断] AdGroupBidKw.GetList(agid=${ag.AdGroupID}) ret=${k1.data?.ret ?? k1.ret} items=0`);
          continue;
        }
        const agData = { id: ag.AdGroupID, name: ag.Name, keywords: [] };
        for (const kw of kws) {
          // 4. Report.GetAdvPerformanceList L5 + ViewFormat=0 + 8周范围
          const r1 = await callAPI('Report.GetAdvPerformanceList', {
            RequestDate: rdLocal, Content: {
              Pager: { PageIndex: 1, PageSize: 500 },
              Filter: {
                AdvPerformanceReportTypeEnum: 5, Indicators: IND,
                ReportDate1: rangeStart, ReportDate2: rangeEnd,
                ReportFilter: [{ AttributeCode: 'KeywordID', Value: kw.KeywordID }],
                ViewFormat: 0, StoreSiteID: store.storeSiteId
              }, Sorter: {}
            }, StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
            UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
          });
          totalApiCalls++;
          const days = (r1.data?.data?.Items || r1.data?.Items || []).filter(d => !d.IsTotal);
          const weeklyAgg = aggregateByWeek(days, weeks);
          agData.keywords.push({
            keywordId: kw.KeywordID,
            keywordText: kw.KeywordText,
            matchType: kw.MatchType,
            state: kw.State,
            bid: kw.Bid || 0,
            weeks: weeklyAgg
          });
          totalKeywords++;
          await sleep(120);
        }
        campData.adGroups[ag.AdGroupID] = agData;
        totalAdGroups++;
      }
      countryCamps[camp.CampaignID] = campData;
      totalCampaigns++;
    }
    output[country] = { campaigns: countryCamps };
    // 持久化中间结果
    fs.writeFileSync(path.join(__dirname, 'ad_keywords_all.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      range: { start: rangeStart, end: rangeEnd, weeks },
      countries: output
    }, null, 0));
    console.log(`  已采集: ${country} 活动=${Object.keys(countryCamps).length} 关键词=${output[country].campaigns && Object.values(countryCamps).reduce((s,c)=>s+Object.values(c.adGroups).reduce((a,ag)=>a+ag.keywords.length,0),0)} API=${totalApiCalls}`);
  }

  await browser.close();
  console.log(`\n完成: 活动=${totalCampaigns} 广告组=${totalAdGroups} 关键词=${totalKeywords} API调用=${totalApiCalls}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
