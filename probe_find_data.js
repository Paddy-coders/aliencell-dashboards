// 获取所有广告组，逐个测试找到有关键词/PAT数据的
const { chromium } = require('playwright');
const crypto = require('crypto');

function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

  // 1. 获取所有广告组（使用data路径）
  console.log('=== 获取所有广告组 ===');
  const agBody = {
    RequestDate: rd,
    Content: {
      Filter: {},
      Attributes: ["AdGroupID","Name","State","CampaignID","DefaultBid","CampaignType"],
      PageIndex: 1,
      PageSize: 500
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const agRes = await callAPI('AdGroup.GetFlatViewList', agBody);
  let adGroups = [];
  try {
    const d = JSON.parse(agRes.text);
    adGroups = d.data?.Items || [];
    console.log('AdGroups:', adGroups.length);
    for (const ag of adGroups.slice(0, 5)) {
      console.log(`  ${ag.AdGroupID} | ${ag.Name} | ${ag.CampaignType} | ${ag.State}`);
    }
  } catch (e) { console.log('Raw:', agRes.text.slice(0, 200)); }

  // 2. 逐个广告组测试关键词和PAT
  let foundKw = false;
  let foundPat = false;

  for (const ag of adGroups.slice(0, 10)) {
    const agId = ag.AdGroupID;
    const campaignId = ag.CampaignID;

    // BidKw
    const kwBody = {
      RequestDate: rd,
      Content: {
        Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: agId }] },
        Attributes: ["KeywordID","KeywordText","MatchType","State","Bid","AdGroupID","CampaignID"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const kwRes = await callAPI('AdGroupBidKw.GetList', kwBody);
    try {
      const d = JSON.parse(kwRes.text);
      const items = d.data?.Items || [];
      if (items.length > 0) {
        console.log(`\n✅ BidKw FOUND in ${agId} (${ag.Name}): ${items.length} items`);
        console.log('First:', JSON.stringify(items[0]).slice(0, 300));
        foundKw = true;
      }
    } catch (e) {}

    // PAT - 尝试多种字段组合
    const patBody = {
      RequestDate: rd,
      Content: {
        Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: agId }] },
        Attributes: ["TargetID","TargetingText","State","Bid","AdGroupID","CampaignID"],
        Pager: { PageIndex: 1, PageSize: 500 },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const patRes = await callAPI('AdGroupPAT.GetList', patBody);
    try {
      const d = JSON.parse(patRes.text);
      const items = d.data?.Items || [];
      if (items.length > 0) {
        console.log(`\n✅ PAT FOUND in ${agId} (${ag.Name}): ${items.length} items`);
        console.log('First:', JSON.stringify(items[0]).slice(0, 300));
        foundPat = true;
      }
    } catch (e) {}

    if (foundKw && foundPat) break;
    await sleep(300);
  }

  // 3. 如果PAT还没找到，尝试不同的Attributes字段
  if (!foundPat && adGroups.length > 0) {
    console.log('\n=== 尝试不同PAT字段组合 ===');
    const testAg = adGroups[0];
    const attrSets = [
      ["TargetID","TargetingText","TargetType","State","Bid"],
      ["TargetID","TargetingText","State"],
      ["TargetID","TargetName","TargetType","State","Bid"],
      ["TargetID","Expression","State","Bid"],
      ["CampaignID","AdGroupID","TargetingText"],
    ];
    for (const attrs of attrSets) {
      const patBody = {
        RequestDate: rd,
        Content: {
          Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: testAg.AdGroupID }] },
          Attributes: attrs,
          Pager: { PageIndex: 1, PageSize: 500 },
          Sorter: {}
        },
        StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
        UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
      };
      const patRes = await callAPI('AdGroupPAT.GetList', patBody);
      try {
        const d = JSON.parse(patRes.text);
        console.log(`Attrs [${attrs.join(',')}]: ret=${d.ret} items=${(d.data?.Items || []).length}`);
        if ((d.data?.Items || []).length > 0) {
          console.log('First:', JSON.stringify(d.data.Items[0]).slice(0, 300));
          foundPat = true;
          break;
        }
      } catch (e) { console.log('Raw:', patRes.text.slice(0, 100)); }
    }
  }

  console.log('\n总结: foundKw=', foundKw, 'foundPat=', foundPat);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
