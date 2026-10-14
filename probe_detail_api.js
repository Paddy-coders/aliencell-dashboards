// 测试 AdGroup.GetDetail / Campaign.GetDetail 是否包含投放词数据
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
  const campaignId = '22010039657137';
  const adGroupId = '501750541660021';

  const tests = [
    { actionType: 'Campaign.GetDetail', filter: { CampaignID: campaignId }, attrs: ["CampaignID","Name","State","TargetingType"] },
    { actionType: 'AdGroup.GetDetail', filter: { AdGroupID: adGroupId }, attrs: ["AdGroupID","Name","State","CampaignID"] },
    { actionType: 'Campaign.GetInfo', filter: { CampaignID: campaignId }, attrs: ["CampaignID","Name","State"] },
    { actionType: 'AdGroup.GetInfo', filter: { AdGroupID: adGroupId }, attrs: ["AdGroupID","Name","State"] },
    { actionType: 'Campaign.GetTarget', filter: { CampaignID: campaignId }, attrs: ["CampaignID","TargetID","TargetName"] },
    { actionType: 'AdGroup.GetTarget', filter: { AdGroupID: adGroupId }, attrs: ["AdGroupID","TargetID","TargetName"] },
    { actionType: 'Campaign.GetKeyword', filter: { CampaignID: campaignId }, attrs: ["CampaignID","KeywordID","KeywordText"] },
    { actionType: 'AdGroup.GetKeyword', filter: { AdGroupID: adGroupId }, attrs: ["AdGroupID","KeywordID","KeywordText"] },
    { actionType: 'Campaign.GetKeywords', filter: { CampaignID: campaignId }, attrs: ["CampaignID","KeywordID","KeywordText"] },
    { actionType: 'AdGroup.GetKeywords', filter: { AdGroupID: adGroupId }, attrs: ["AdGroupID","KeywordID","KeywordText"] },
  ];

  for (const t of tests) {
    const body = {
      RequestDate: rd,
      Content: {
        Attributes: t.attrs,
        Pager: { PageIndex: 1, PageSize: 50 },
        Filter: { AttributeFilters: Object.entries(t.filter).map(([k, v]) => ({ AttributeCode: k, Operator: "=", Value: v })) },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    console.log(`\n=== ${t.actionType} ===`);
    const res = await callAPI(t.actionType, body);
    console.log('Status:', res.status);
    try {
      const d = JSON.parse(res.text);
      console.log('ret:', d.ret, 'msg:', d.msg || '');
      if (d.data?.Items?.length > 0) {
        console.log('Items:', d.data.Items.length);
        console.log('First:', JSON.stringify(d.data.Items[0]).slice(0, 400));
      } else if (d.Content?.Items?.length > 0) {
        console.log('Items:', d.Content.Items.length);
        console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 400));
      }
    } catch (e) { console.log('Raw:', res.text.slice(0, 300)); }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
