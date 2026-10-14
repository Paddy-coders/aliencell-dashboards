// 重新登录 amz-ad.eccang.com（SSO 方式）：从 home.eccang.com 拿 ERP token → 导航 SSO → 验证新 token
const { chromium } = require('playwright');
const crypto = require('crypto');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];

  // 1. 找 home.eccang.com 页面拿 ERP token
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO HOME PAGE'); await browser.close(); return; }
  const erpToken = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  });
  console.log('ERP token:', erpToken ? erpToken.slice(0, 50) + '...' : 'NULL');
  if (!erpToken) { console.log('NO ERP TOKEN - 需要先登录 home'); await browser.close(); return; }

  // 2. 关闭多余的 amz-ad login 页（保留一个用于导航）
  for (const p of ctx.pages()) {
    const u = p.url();
    if (u.includes('amz-ad.eccang.com/login')) { await p.close().catch(() => {}); }
  }

  // 3. 导航 SSO
  const ap = await ctx.newPage();
  const targetUrl = 'https://amz-ad.eccang.com/?resource=sso&token=' + encodeURIComponent(erpToken);
  console.log('SSO 导航:', targetUrl.slice(0, 100) + '...');
  await ap.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  // 等待跳转 + token 写入
  for (let i = 0; i < 30; i++) {
    await ap.waitForTimeout(2000);
    const u = ap.url();
    const tk = await ap.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
    }).catch(() => null);
    if (tk && !u.includes('login')) {
      console.log(`OK 跳转后URL: ${u.slice(0, 120)} (${i*2}s)`);
      console.log('amz-ad token:', tk.slice(0, 50) + '...');
      break;
    }
    if (i === 29) console.log('超时未跳转, 最后URL:', u.slice(0, 150));
  }
  const finalUrl = ap.url();
  const tk2 = await ap.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  }).catch(() => null);
  console.log('FINAL URL:', finalUrl.slice(0, 150), '| token:', tk2 ? 'OK' : 'NULL');
  if (!tk2) { await browser.close(); return; }

  // 4. 连通性验证 Campaign.GetList（用 amz-ad 自己的 token）
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 5 }, Sorter: {},
      Attributes: ["CampaignID", "Name"],
      Filter: { AttributeFilters: [{ AttributeCode: "State", Operator: "=", Value: "enabled" }] }
    },
    StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: tk2
  };
  const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
    headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': 'Campaign.GetList', 'contentmd5': md5(JSON.stringify(body)) },
    data: body, timeout: 30000
  });
  const t = await resp.text();
  console.log('Campaign.GetList:', t.slice(0, 250));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
