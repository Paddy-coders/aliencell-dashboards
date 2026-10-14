// 重新测试 AdGroup.GetFlatViewList（正确Filter格式）并尝试扩展字段包含投放词
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

  // 1. 测试 AdGroup.GetFlatViewList 基本字段
  console.log('=== AdGroup.GetFlatViewList 基本 ===');
  const basicBody = {
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
  const basicRes = await callAPI('AdGroup.GetFlatViewList', basicBody);
  console.log('Status:', basicRes.status);
  try {
    const d = JSON.parse(basicRes.text);
    console.log('ret:', d.ret, 'msg:', d.msg || '');
    if (d.Content?.Items?.length > 0) {
      console.log('Items:', d.Content.Items.length);
      console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 400));
    } else if (d.data?.Items?.length > 0) {
      console.log('Items:', d.data.Items.length);
      console.log('First:', JSON.stringify(d.data.Items[0]).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', basicRes.text.slice(0, 300)); }

  // 2. 测试 AdGroup.GetFlatViewList 扩展字段（尝试投放词相关字段）
  const extendedAttrs = [
    ["AdGroupID","Name","State","CampaignID","DefaultBid","KeywordText","MatchType","KeywordID"],
    ["AdGroupID","Name","State","CampaignID","DefaultBid","TargetingText","TargetingType","TargetID"],
    ["AdGroupID","Name","State","CampaignID","DefaultBid","Keywords","Targets"],
    ["AdGroupID","Name","State","CampaignID","DefaultBid","Keyword"],
    ["AdGroupID","Name","State","CampaignID","DefaultBid","Target"],
  ];

  for (const attrs of extendedAttrs) {
    console.log(`\n=== AdGroup.GetFlatViewList with ${attrs.filter(a => !['AdGroupID','Name','State','CampaignID','DefaultBid'].includes(a)).join(',')} ===`);
    const body = {
      RequestDate: rd,
      Content: { Filter: { AdGroupID: adGroupId }, Attributes: attrs, PageIndex: 1, PageSize: 10 },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const res = await callAPI('AdGroup.GetFlatViewList', body);
    try {
      const d = JSON.parse(res.text);
      console.log('ret:', d.ret);
      if (d.Content?.Items?.length > 0) {
        const item = d.Content.Items[0];
        const extra = {};
        for (const k of attrs) { if (item[k] !== undefined) extra[k] = item[k]; }
        console.log('Extra fields:', JSON.stringify(extra).slice(0, 400));
      } else if (d.data?.Items?.length > 0) {
        const item = d.data.Items[0];
        const extra = {};
        for (const k of attrs) { if (item[k] !== undefined) extra[k] = item[k]; }
        console.log('Extra fields:', JSON.stringify(extra).slice(0, 400));
      }
    } catch (e) { console.log('Raw:', res.text.slice(0, 200)); }
  }

  // 3. 测试 ProductAd.GetFlatViewList 扩展字段
  console.log('\n=== ProductAd.GetFlatViewList with KeywordText ===');
  const padBody = {
    RequestDate: rd,
    Content: {
      Filter: { AdGroupID: adGroupId },
      Attributes: ["Asin","Sku","AdGroupID","CampaignID","Name","State","KeywordText","MatchType","KeywordID","TargetID","TargetName","TargetingType"],
      Pager: { PageIndex: 1, PageSize: 10 }
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const padRes = await callAPI('ProductAd.GetFlatViewList', padBody);
  try {
    const d = JSON.parse(padRes.text);
    console.log('ret:', d.ret);
    if (d.data?.Items?.length > 0) {
      const item = d.data.Items[0];
      const extra = {};
      for (const k of ['KeywordText','MatchType','KeywordID','TargetID','TargetName','TargetingType']) {
        if (item[k] !== undefined) extra[k] = item[k];
      }
      console.log('Extra fields:', JSON.stringify(extra).slice(0, 400));
    }
  } catch (e) { console.log('Raw:', padRes.text.slice(0, 200)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
