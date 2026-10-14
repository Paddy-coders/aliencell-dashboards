// 使用正确的请求格式（含ToKen和店铺ID）探测Campaign和Keyword接口
const { chromium } = require('playwright');
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  // 从页面 localStorage 获取 token
  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });
  console.log('Token 前缀:', token ? token.slice(0, 40) + '...' : '无');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // 店铺配置
  const stores = [
    { name: 'US', StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1 },
    { name: 'DE', StoreSiteID: 586013, StoreID: 174010, MarketSiteID: 6 },
    { name: 'UK', StoreSiteID: 586014, StoreID: 174010, MarketSiteID: 10 },
  ];

  async function callAPI(actionType, extraBody, store) {
    const body = {
      RequestDate: rd,
      ...extraBody,
      StoreSiteID: store.StoreSiteID,
      StoreID: store.StoreID,
      MarketSiteID: store.MarketSiteID,
      UniqueID: 0,
      EmployeeID: 0,
      PersonOrganizationID: 0,
      AccountType: 0,
      ToKen: token
    };
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

  // 1. 测试 Campaign.GetFlatViewList 三种店铺
  for (const store of stores) {
    console.log(`\n=== Campaign.GetFlatViewList [${store.name}] ===`);
    const res = await callAPI('Campaign.GetFlatViewList', {
      Content: { Filter: {}, Attributes: ["CampaignID","Name","State","CampaignType"], PageIndex: 1, PageSize: 20 }
    }, store);
    console.log('Status:', res.status);
    try {
      const d = JSON.parse(res.text);
      console.log('ret:', d.ret, 'msg:', d.msg || '');
      if (d.Content?.Items) {
        console.log('Items:', d.Content.Items.length);
        if (d.Content.Items.length > 0) {
          console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 250));
        }
      }
    } catch (e) { console.log('Raw:', res.text.slice(0, 300)); }
    await sleep(500);
  }

  // 2. 对第一个有数据的店铺，测试 AdGroup 和 Keyword 接口
  // 先找有数据的店铺
  let activeStore = null;
  let campaigns = [];
  for (const store of stores) {
    const res = await callAPI('Campaign.GetFlatViewList', {
      Content: { Filter: {}, Attributes: ["CampaignID","Name","State"], PageIndex: 1, PageSize: 5 }
    }, store);
    try {
      const d = JSON.parse(res.text);
      if (d.ret === 0 && d.Content?.Items?.length > 0) {
        activeStore = store;
        campaigns = d.Content.Items;
        break;
      }
    } catch (e) {}
  }

  if (!activeStore) {
    console.log('\n所有店铺都没有广告活动数据');
    await browser.close();
    return;
  }

  console.log(`\n=== 有数据的店铺: ${activeStore.name}, Campaigns: ${campaigns.length} ===`);
  const campaignId = campaigns[0].CampaignID;

  // 测试 AdGroup.GetFlatViewList
  console.log('\n=== AdGroup.GetFlatViewList ===');
  const agRes = await callAPI('AdGroup.GetFlatViewList', {
    Content: { Filter: { CampaignID: campaignId }, Attributes: ["AdGroupID","Name","State"], PageIndex: 1, PageSize: 20 }
  }, activeStore);
  console.log('Status:', agRes.status);
  let adGroups = [];
  try {
    const d = JSON.parse(agRes.text);
    console.log('ret:', d.ret, 'msg:', d.msg || '');
    if (d.Content?.Items) {
      console.log('Items:', d.Content.Items.length);
      adGroups = d.Content.Items;
      if (d.Content.Items.length > 0) {
        console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 250));
      }
    }
  } catch (e) { console.log('Raw:', agRes.text.slice(0, 300)); }

  if (adGroups.length === 0) {
    console.log('\n没有广告组数据');
    await browser.close();
    return;
  }

  const adGroupId = adGroups[0].AdGroupID;

  // 3. 测试投放词接口
  const candidates = [
    'Keyword.GetFlatViewList',
    'Targeting.GetFlatViewList',
    'AdKeyword.GetFlatViewList',
    'CampaignKeyword.GetFlatViewList',
    'AdGroupKeyword.GetFlatViewList',
    'ProductTargeting.GetFlatViewList',
    'SponsoredProductsKeyword.GetFlatViewList',
    'SponsoredProductsTarget.GetFlatViewList',
    'SearchTerm.GetFlatViewList',
    'AdTarget.GetFlatViewList',
    'SpKeyword.GetFlatViewList',
    'SdTarget.GetFlatViewList',
    'SbKeyword.GetFlatViewList',
    'NegativeKeyword.GetFlatViewList',
    'CampaignNegativeKeyword.GetFlatViewList',
  ];

  const keywordBody = {
    Content: {
      Filter: { AdGroupID: adGroupId },
      Attributes: ["KeywordID", "KeywordText", "MatchType", "State", "Bid"],
      PageIndex: 1,
      PageSize: 50
    }
  };

  for (const actionType of candidates) {
    console.log(`\n=== ${actionType} ===`);
    const res = await callAPI(actionType, keywordBody, activeStore);
    console.log('Status:', res.status);
    try {
      const d = JSON.parse(res.text);
      console.log('ret:', d.ret, 'msg:', d.msg || '');
      if (d.Content?.Items?.length > 0) {
        console.log('ITEMS FOUND:', d.Content.Items.length);
        console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 400));
      }
    } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }
    await sleep(300);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
