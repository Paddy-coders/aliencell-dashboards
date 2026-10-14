// 精确测试 AdGroupBidKw.GetList 和 AdGroupPAT.GetList
const { chromium } = require('playwright');
const crypto = require('crypto');

function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

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
        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': actionType, 'contentmd5': md5(bodyStr) },
        data: body, timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 0, text: e.message }; }
  }

  const store = { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 };
  const adGroupId = '501750541660021';

  // 1. AdGroupBidKw.GetList
  console.log('=== AdGroupBidKw.GetList ===');
  const kwBody = {
    RequestDate: rd,
    Content: {
      Filter: { AdGroupID: adGroupId },
      Attributes: ["KeywordID","KeywordText","MatchType","State","Bid","AdGroupID","CampaignID"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const kwRes = await callAPI('AdGroupBidKw.GetList', kwBody);
  console.log('Status:', kwRes.status);
  try {
    const d = JSON.parse(kwRes.text);
    console.log('ret:', d.ret, 'msg:', d.msg || '');
    console.log('data keys:', d.data ? Object.keys(d.data) : 'no data');
    const items = d.data?.data?.Items || d.data?.Items || [];
    console.log('Items:', items.length);
    if (items.length > 0) {
      console.log('First:', JSON.stringify(items[0]).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', kwRes.text.slice(0, 300)); }

  // 2. AdGroupPAT.GetList
  console.log('\n=== AdGroupPAT.GetList ===');
  const patBody = {
    RequestDate: rd,
    Content: {
      Filter: { AdGroupID: adGroupId },
      Attributes: ["TargetID","TargetingText","TargetType","State","Bid","AdGroupID","CampaignID"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const patRes = await callAPI('AdGroupPAT.GetList', patBody);
  console.log('Status:', patRes.status);
  try {
    const d = JSON.parse(patRes.text);
    console.log('ret:', d.ret, 'msg:', d.msg || '');
    console.log('data keys:', d.data ? Object.keys(d.data) : 'no data');
    const items = d.data?.data?.Items || d.data?.Items || [];
    console.log('Items:', items.length);
    if (items.length > 0) {
      console.log('First:', JSON.stringify(items[0]).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', patRes.text.slice(0, 300)); }

  // 3. 测试不同AdGroup（因为当前AdGroup可能没有关键词）
  // 先用 AdGroup.GetFlatViewList 获取所有广告组
  console.log('\n=== AdGroup.GetFlatViewList (获取所有广告组) ===');
  const agBody = {
    RequestDate: rd,
    Content: {
      Filter: {},
      Attributes: ["AdGroupID","Name","State","CampaignID","DefaultBid"],
      PageIndex: 1,
      PageSize: 100
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const agRes = await callAPI('AdGroup.GetFlatViewList', agBody);
  let adGroups = [];
  try {
    const d = JSON.parse(agRes.text);
    adGroups = d.Content?.Items || [];
    console.log('AdGroups:', adGroups.length);
    if (adGroups.length > 0) {
      console.log('First:', JSON.stringify(adGroups[0]).slice(0, 200));
    }
  } catch (e) {}

  // 尝试前3个广告组
  for (let i = 0; i < Math.min(3, adGroups.length); i++) {
    const agId = adGroups[i].AdGroupID;
    console.log(`\n--- 测试 AdGroup ${agId} (${adGroups[i].Name}) ---`);
    const testBody = {
      RequestDate: rd,
      Content: {
        Filter: { AdGroupID: agId },
        Attributes: ["KeywordID","KeywordText","MatchType","State","Bid"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const testRes = await callAPI('AdGroupBidKw.GetList', testBody);
    try {
      const d = JSON.parse(testRes.text);
      const items = d.data?.data?.Items || d.data?.Items || [];
      console.log(`  BidKw Items: ${items.length}`);
      if (items.length > 0) {
        console.log('  First:', JSON.stringify(items[0]).slice(0, 300));
      }
    } catch (e) {}

    // PAT
    const patBody2 = {
      RequestDate: rd,
      Content: {
        Filter: { AdGroupID: agId },
        Attributes: ["TargetID","TargetingText","TargetType","State","Bid"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const patRes2 = await callAPI('AdGroupPAT.GetList', patBody2);
    try {
      const d = JSON.parse(patRes2.text);
      const items = d.data?.data?.Items || d.data?.Items || [];
      console.log(`  PAT Items: ${items.length}`);
      if (items.length > 0) {
        console.log('  First:', JSON.stringify(items[0]).slice(0, 300));
      }
    } catch (e) {}
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
