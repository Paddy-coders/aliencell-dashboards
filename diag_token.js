const { chromium } = require('playwright');
const crypto = require('crypto');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  console.log('pages:');
  for (const p of ctx.pages()) console.log('  ', p.url().slice(0, 120));

  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang')) { page = p; break; } }
  if (!page) { console.log('NO ECCANG PAGE'); await browser.close(); return; }

  // 收集所有 localStorage 里的 token 候选
  const tokens = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/token/i.test(k)) out[k] = String(localStorage.getItem(k)).slice(0, 80);
    }
    return out;
  });
  console.log('localStorage token keys:', JSON.stringify(tokens));

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });
  console.log('pro__Access-Token:', token ? token.slice(0, 60) + '...' : 'NULL');

  if (!token) { await browser.close(); return; }

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

  // 连通性测试：Campaign.GetList（最小请求）
  const b = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 5 },
      Sorter: {},
      Attributes: ["CampaignID", "Name"],
      Filter: {}
    },
    StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const res = await callAPI('Campaign.GetList', b);
  console.log('Campaign.GetList:', res.text.slice(0, 300));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
