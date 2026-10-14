// 基于现有采集脚本的请求格式，探测Campaign -> AdGroup -> Keyword接口
const { chromium } = require('playwright');
const crypto = require('crypto');

function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    const bodyStr = JSON.stringify(body);
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'actiontype': actionType,
          'contentmd5': md5(bodyStr)
        },
        data: body,
        timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 0, text: e.message }; }
  }

  // 1. 测试 Campaign.GetList（已知有效的接口）
  let activeStore = null;
  let campaigns = [];
  for (const [country, store] of Object.entries(STORES)) {
    const body = {
      RequestDate: rd,
      Content: {
        Attributes: ["CampaignID","State","Name","CampaignType","SponsoredType","DailyBudget","BudgetType","StartDate","EndDate"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Filter: { AttributeFilters: [] },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const res = await callAPI('Campaign.GetList', body);
    try {
      const d = JSON.parse(res.text);
      const items = (d.data?.Items || []).filter(it => !it.IsTotal);
      if (items.length > 0) {
        activeStore = { name: country, ...store };
        campaigns = items;
        console.log(`[${country}] Campaign.GetList: ${items.length} campaigns`);
        console.log('First:', JSON.stringify(items[0]).slice(0, 200));
        break;
      }
    } catch (e) {}
  }

  if (!activeStore) {
    console.log('没有店铺有Campaign数据');
    await browser.close();
    return;
  }

  // 2. 测试 AdGroup.GetList
  const campaignId = campaigns[0].CampaignID;
  console.log(`\n=== AdGroup.GetList (CampaignID=${campaignId}) [${activeStore.name}] ===`);
  const agBody = {
    RequestDate: rd,
    Content: {
      Attributes: ["AdGroupID","Name","State","CampaignID","DefaultBid"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: { AttributeFilters: [{ AttributeCode: "CampaignID", Operator: "=", Value: campaignId }] },
      Sorter: {}
    },
    StoreSiteID: activeStore.storeSiteId, StoreID: activeStore.storeId, MarketSiteID: activeStore.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const agRes = await callAPI('AdGroup.GetList', agBody);
  let adGroups = [];
  try {
    const d = JSON.parse(agRes.text);
    adGroups = (d.data?.Items || []).filter(it => !it.IsTotal);
    console.log('Items:', adGroups.length);
    if (adGroups.length > 0) {
      console.log('First:', JSON.stringify(adGroups[0]).slice(0, 250));
    }
  } catch (e) { console.log('Raw:', agRes.text.slice(0, 300)); }

  if (adGroups.length === 0) {
    console.log('没有广告组数据');
    await browser.close();
    return;
  }

  const adGroupId = adGroups[0].AdGroupID;

  // 3. 测试投放词接口（批量）
  const candidates = [
    { actionType: 'AdKeyword.GetList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid","CampaignID","AdGroupID"] },
    { actionType: 'AdKeyword.GetFlatViewList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid"] },
    { actionType: 'Targeting.GetList', filterKey: 'AdGroupID', attrs: ["TargetID","TargetName","TargetType","State","Bid"] },
    { actionType: 'Targeting.GetFlatViewList', filterKey: 'AdGroupID', attrs: ["TargetID","TargetName","TargetType","State","Bid"] },
    { actionType: 'ProductTargeting.GetList', filterKey: 'AdGroupID', attrs: ["TargetID","TargetName","TargetType","State","Bid"] },
    { actionType: 'SearchTerm.GetList', filterKey: 'AdGroupID', attrs: ["SearchTermID","SearchTermText","MatchType"] },
    { actionType: 'CampaignKeyword.GetList', filterKey: 'CampaignID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid"] },
    { actionType: 'NegativeKeyword.GetList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State"] },
    { actionType: 'CampaignNegativeKeyword.GetList', filterKey: 'CampaignID', attrs: ["KeywordID","KeywordText","MatchType","State"] },
    { actionType: 'SpKeyword.GetList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid"] },
    { actionType: 'SbKeyword.GetList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid"] },
    { actionType: 'SdTarget.GetList', filterKey: 'AdGroupID', attrs: ["TargetID","TargetName","TargetType","State","Bid"] },
    { actionType: 'Keyword.GetList', filterKey: 'AdGroupID', attrs: ["KeywordID","KeywordText","MatchType","State","Bid"] },
  ];

  for (const cand of candidates) {
    const filterValue = cand.filterKey === 'CampaignID' ? campaignId : adGroupId;
    const body = {
      RequestDate: rd,
      Content: {
        Attributes: cand.attrs,
        Pager: { PageIndex: 1, PageSize: 500 },
        Filter: { AttributeFilters: [{ AttributeCode: cand.filterKey, Operator: "=", Value: filterValue }] },
        Sorter: {}
      },
      StoreSiteID: activeStore.storeSiteId, StoreID: activeStore.storeId, MarketSiteID: activeStore.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    console.log(`\n=== ${cand.actionType} ===`);
    const res = await callAPI(cand.actionType, body);
    console.log('Status:', res.status);
    try {
      const d = JSON.parse(res.text);
      console.log('ret:', d.ret, 'msg:', d.msg || '');
      const items = (d.data?.Items || []).filter(it => !it.IsTotal);
      if (items.length > 0) {
        console.log('✅ ITEMS FOUND:', items.length);
        console.log('First:', JSON.stringify(items[0]).slice(0, 400));
      } else {
        console.log('Items: 0');
      }
    } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }
    await sleep(400);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
