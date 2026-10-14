// 测试更多可能的投放词接口命名变体
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
  const adGroupId = '501750541660021';

  const candidates = [
    'AdKeywords.GetList',
    'AdKeywords.GetFlatViewList',
    'KeywordsForOrders.GetList',
    'KeywordsForOrders.GetFlatViewList',
    'KeywordForOrders.GetList',
    'Target.GetList',
    'Target.GetFlatViewList',
    'Targets.GetList',
    'ProductAdTarget.GetList',
    'ProductAdTarget.GetFlatViewList',
    'AdGroupTarget.GetList',
    'CampaignTarget.GetList',
    'SponsoredProductsKeywords.GetList',
    'SponsoredProductsTargets.GetList',
    'SponsoredBrandsKeywords.GetList',
    'SponsoredDisplayTargets.GetList',
    'NegativeKeywords.GetList',
    'CampaignNegativeKeywords.GetList',
    'AdGroupNegativeKeyword.GetList',
    'AdGroupNegativeKeywords.GetList',
    'CampaignNegativeKeywords.GetFlatViewList',
    'NegativeKeyword.GetFlatViewList',
    'KeywordReport.GetList',
    'KeywordReport.GetFlatViewList',
    'TargetReport.GetList',
    'TargetReport.GetFlatViewList',
    'SearchTermReport.GetList',
    'SearchTermReport.GetFlatViewList',
    'AdKeywordReport.GetList',
    'AdKeywordReport.GetFlatViewList',
    'Placement.GetList',
    'Placement.GetFlatViewList',
    'KeywordPlacement.GetList',
    'KeywordPlacement.GetFlatViewList',
  ];

  for (const actionType of candidates) {
    const body = {
      RequestDate: rd,
      Content: {
        Attributes: ["KeywordID","KeywordText","MatchType","State","Bid"],
        Pager: { PageIndex: 1, PageSize: 50 },
        Filter: { AttributeFilters: [{ AttributeCode: "AdGroupID", Operator: "=", Value: adGroupId }] },
        Sorter: {}
      },
      StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
      UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
    };
    const res = await callAPI(actionType, body);
    let ok = false;
    try {
      const d = JSON.parse(res.text);
      if (d.ret === 0 && (d.data?.Items || d.Content?.Items)?.length > 0) {
        ok = true;
        console.log(`✅ ${actionType}: ${(d.data?.Items || d.Content?.Items).length} items`);
        console.log('First:', JSON.stringify((d.data?.Items || d.Content?.Items)[0]).slice(0, 300));
      } else if (d.ret !== 511 && d.msg !== 'ActionType is invalid!') {
        console.log(`⚠️ ${actionType}: ret=${d.ret} msg=${d.msg || ''}`);
      }
    } catch (e) {}
    if (!ok && res.status === 511) {
      // 不输出invalid减少噪音
    } else if (!ok) {
      console.log(`❌ ${actionType}: status=${res.status} text=${res.text.slice(0, 100)}`);
    }
    await sleep(200);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
