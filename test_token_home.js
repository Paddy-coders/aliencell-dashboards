const { chromium } = require('playwright');
const crypto = require('crypto');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  }).catch(() => null);
  console.log('home token:', token ? token.slice(0, 60) + '...' : 'NULL');
  if (!token) { await browser.close(); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function test(actionType, body) {
    const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': actionType, 'contentmd5': md5(JSON.stringify(body)) },
      data: body, timeout: 30000
    });
    const t = await resp.text();
    console.log(actionType + ':', t.slice(0, 200));
  }

  const b1 = {
    RequestDate: rd, Content: {
      Pager: { PageIndex: 1, PageSize: 5 }, Sorter: {}, Attributes: ["CampaignID", "Name"],
      Filter: { AttributeFilters: [{ AttributeCode: "State", Operator: "=", Value: "enabled" }] }
    },
    StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  await test('Campaign.GetList', b1);

  // 也试试 StoreSiteID=586021 (UK)
  b1.StoreSiteID = 586021; b1.Content.Filter.StoreSiteID = 586021;
  await test('Campaign.GetList', b1);

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
