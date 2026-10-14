// 重新用AttributeFilters格式测试，并打印完整响应
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

  // 1. 确认 AdGroup.GetFlatViewList 仍然有效
  console.log('=== AdGroup.GetFlatViewList (with AdGroupID) ===');
  const agBody = {
    RequestDate: rd,
    Content: {
      Filter: { AdGroupID: adGroupId },
      Attributes: ["AdGroupID","Name","State","CampaignID","DefaultBid"],
      PageIndex: 1,
      PageSize: 10
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const agRes = await callAPI('AdGroup.GetFlatViewList', agBody);
  console.log('Status:', agRes.status);
  try {
    const d = JSON.parse(agRes.text);
    console.log('ret:', d.ret);
    console.log('Content keys:', d.Content ? Object.keys(d.Content) : 'no Content');
    console.log('Items:', d.Content?.Items?.length);
  } catch (e) { console.log('Raw:', agRes.text.slice(0, 300)); }

  // 2. AdGroupBidKw.GetList with AttributeFilters
  console.log('\n=== AdGroupBidKw.GetList (AttributeFilters) ===');
  const kwBody = {
    RequestDate: rd,
    Content: {
      Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: adGroupId }] },
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
    console.log('Full data keys:', d.data ? Object.keys(d.data) : 'no data');
    if (d.data?.data) console.log('data.data keys:', Object.keys(d.data.data));
    const items = d.data?.data?.Items || d.data?.Items || [];
    console.log('Items:', items.length);
    if (items.length > 0) {
      console.log('First:', JSON.stringify(items[0]).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', kwRes.text.slice(0, 400)); }

  // 3. AdGroupPAT.GetList with AttributeFilters
  console.log('\n=== AdGroupPAT.GetList (AttributeFilters) ===');
  const patBody = {
    RequestDate: rd,
    Content: {
      Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: adGroupId }] },
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
    const items = d.data?.data?.Items || d.data?.Items || [];
    console.log('Items:', items.length);
    if (items.length > 0) {
      console.log('First:', JSON.stringify(items[0]).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', patRes.text.slice(0, 400)); }

  // 4. 尝试使用 CampaignID 过滤（可能有些接口需要用 CampaignID）
  console.log('\n=== AdGroupBidKw.GetList (CampaignID filter) ===');
  const kwBody2 = {
    RequestDate: rd,
    Content: {
      Filter: { AttributeFilters: [{ AttributeCode: "CampaignID", Operator: "=", Value: "22010039657137" }] },
      Attributes: ["KeywordID","KeywordText","MatchType","State","Bid","AdGroupID","CampaignID"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const kwRes2 = await callAPI('AdGroupBidKw.GetList', kwBody2);
  try {
    const d = JSON.parse(kwRes2.text);
    console.log('ret:', d.ret, 'Items:', (d.data?.data?.Items || d.data?.Items || []).length);
  } catch (e) {}

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
