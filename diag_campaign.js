const { chromium } = require('playwright');
const crypto = require('crypto');
function md5(s) { return crypto.createHash('md5').update(s).digest('hex').toUpperCase(); }
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pro__Access-Token')).value);
  const now = new Date(), pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  async function callAPI(a, body) {
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': a, 'contentmd5': md5(JSON.stringify(body)) },
      data: body, timeout: 30000
    });
    return r.text();
  }
  // 1. 查 US 店铺所有 enabled 活动
  const b = { RequestDate: rd, Content: { Pager: { PageIndex: 1, PageSize: 200 }, Sorter: {}, Attributes: ["CampaignID","Name","State","TargetingType","CampaignType","SponsoredType"], Filter: { AttributeFilters: [{AttributeCode:"State",Operator:"=",Value:"enabled"}] } }, StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token };
  const t = await callAPI('Campaign.GetList', b);
  const j = JSON.parse(t);
  console.log('US enabled 活动数:', j.data?.TotalCount);
  const ids = (j.data?.Items || []).map(it => ({ id: it.CampaignID, name: it.Name, type: it.CampaignType, st: it.SponsoredType }));
  console.log('前20:');
  ids.slice(0, 20).forEach(it => console.log(' ', it.id, it.name, it.type, it.st));
  // 找 43472039186019
  const hit = ids.find(x => x.id === '43472039186019');
  console.log('\n43472039186019 在 US enabled 列表中:', !!hit, hit);
  // 2. 不限 state 找
  b.Content.Filter = { AttributeFilters: [] };
  const t2 = await callAPI('Campaign.GetList', b);
  const j2 = JSON.parse(t2);
  console.log('\nUS 全状态活动数:', j2.data?.TotalCount);
  const hit2 = (j2.data?.Items || []).find(x => x.CampaignID === '43472039186019');
  console.log('43472039186019 状态:', hit2?.State);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
