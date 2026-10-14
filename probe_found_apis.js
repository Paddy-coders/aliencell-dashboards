// 测试找到的投放词接口：AdGroupBidKw / AdGroupPAT / AdGroupNegKw / CampaignNegKw
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
  const campaignId = '22010039657137';
  const adGroupId = '501750541660021';

  const tests = [
    // 广告组关键词投放
    { name: 'AdGroupBidKw.GetList', actionType: 'AdGroupBidKw.GetList', filter: { AdGroupID: adGroupId }, attrs: ["KeywordID","KeywordText","MatchType","State","Bid","AdGroupID","CampaignID"] },
    // 广告组商品投放
    { name: 'AdGroupPAT.GetList', actionType: 'AdGroupPAT.GetList', filter: { AdGroupID: adGroupId }, attrs: ["TargetID","TargetName","TargetType","State","Bid","AdGroupID","CampaignID"] },
    // 广告组否定关键词
    { name: 'AdGroupNegKw.GetList', actionType: 'AdGroupNegKw.GetList', filter: { AdGroupID: adGroupId }, attrs: ["KeywordID","KeywordText","MatchType","State","AdGroupID","CampaignID"] },
    // 广告活动否定关键词
    { name: 'CampaignNegKw.GetList', actionType: 'CampaignNegKw.GetList', filter: { CampaignID: campaignId }, attrs: ["KeywordID","KeywordText","MatchType","State","CampaignID"] },
    // 广告活动否定商品投放
    { name: 'CampaignNegPAT.GetList', actionType: 'CampaignNegPAT.GetList', filter: { CampaignID: campaignId }, attrs: ["TargetID","TargetName","TargetType","State","CampaignID"] },
    // 搜索词
    { name: 'AdGroupQuery.GetList', actionType: 'AdGroupQuery.GetList', filter: { AdGroupID: adGroupId }, attrs: ["QueryID","QueryText","MatchType","Impressions","Clicks","Cost","Orders","SalesAmount"] },
  ];

  for (const t of tests) {
    console.log(`\n=== ${t.name} ===`);

    // 尝试两种Filter格式
    const formats = [
      { Filter: t.filter }, // 直接字段格式
      { Filter: { AttributeFilters: Object.entries(t.filter).map(([k, v]) => ({ AttributeCode: k, Operator: "=", Value: v })) } } // AttributeFilters格式
    ];

    for (let i = 0; i < formats.length; i++) {
      const body = {
        RequestDate: rd,
        Content: {
          ...formats[i],
          Attributes: t.attrs,
          Pager: { PageIndex: 1, PageSize: 500 },
          Sorter: {}
        },
        StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
        UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
      };
      const res = await callAPI(t.actionType, body);
      console.log(`  Format ${i + 1}: Status=${res.status}`);
      try {
        const d = JSON.parse(res.text);
        console.log(`  ret=${d.ret} msg=${d.msg || ''}`);
        const items = (d.data?.Items || d.Content?.Items || []).filter(it => !it.IsTotal);
        if (items.length > 0) {
          console.log(`  ✅ ITEMS: ${items.length}`);
          console.log(`  First:`, JSON.stringify(items[0]).slice(0, 400));
          break; // 成功则跳出格式循环
        }
      } catch (e) { console.log(`  Raw:`, res.text.slice(0, 150)); }
      await sleep(200);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
