// 强制重新登录：home token 过期时清 localStorage → 重新填表 → SSO amz-ad → 验证
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'eccang_creds.json'), 'utf8'));
const PORT = (process.env.CDP_PORT || String(CONFIG.port || '9223')).replace('http://127.0.0.1:', '');

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];

  // 1. 导航 login 页（先清除旧 token 保证重新登录）
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/login?redirectPath=%2Fiframe%23%2Fm_71579', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(5000);
  await page.evaluate(() => { try { localStorage.removeItem('pro__Access-Token'); } catch (e) {} }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000);

  // 2. 判断是否登录页
  const hasLoginForm = await page.locator('#userName').count().then(c => c > 0).catch(() => false);
  console.log('登录表单存在:', hasLoginForm, 'URL:', page.url().slice(0, 100));
  if (hasLoginForm) {
    await page.fill('#userName', CONFIG.username);
    await page.fill('#password', CONFIG.password);
    await page.locator('#userName').evaluate(el => el.blur()).catch(() => {});
    await page.locator('#password').evaluate(el => el.blur()).catch(() => {});
    await page.waitForTimeout(1000);
    const chk = page.locator('.home-ant-checkbox-input');
    if (await chk.count()) { try { if (!(await chk.isChecked())) await chk.check({ force: true }); } catch (e) {} }
    const submitBtn = page.locator('.home-ant-btn-primary').filter({ hasText: /^登录$/ }).first();
    if (await submitBtn.count()) await submitBtn.click();
    else await page.click('.home-ant-btn-primary');
    await page.locator('#password').press('Enter');
    await page.waitForTimeout(3000);
    try { await page.waitForURL(u => !String(u.href).includes('/login'), { timeout: 30000 }); } catch (e) { console.log('跳转超时，等待 token...'); }
    await page.waitForTimeout(8000);
  }

  // 3. 验证 home token
  const erpToken = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  }).catch(() => null);
  console.log('ERP token:', erpToken ? erpToken.slice(0, 50) + '...' : 'NULL');
  if (!erpToken) { console.log('LOGIN FAILED'); await browser.close(); process.exit(2); }

  // 4. SSO 到 amz-ad
  for (const p of ctx.pages()) {
    if (p !== page && p.url().includes('amz-ad.eccang.com/login')) await p.close().catch(() => {});
  }
  const ap = await ctx.newPage();
  const ssoUrl = 'https://amz-ad.eccang.com/?resource=sso&token=' + encodeURIComponent(erpToken);
  await ap.goto(ssoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('sso goto warn:', e.message));
  let amzToken = null;
  for (let i = 0; i < 30; i++) {
    await ap.waitForTimeout(2000);
    const tk = await ap.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
    }).catch(() => null);
    const u = ap.url();
    if (tk && !u.includes('/login')) { amzToken = tk; console.log(`amz-ad 登录成功 (${i*2}s), URL: ${u.slice(0, 100)}`); break; }
    if (i === 29) console.log('amz-ad SSO 超时, URL:', u.slice(0, 120));
  }
  if (!amzToken) { console.log('AMZ-AD LOGIN FAILED'); await browser.close(); process.exit(2); }

  // 5. 连通性验证（Campaign.GetList 真实格式）
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const body = {
    RequestDate: rd,
    Content: {
      Pager: { PageIndex: 1, PageSize: 5 }, Sorter: {},
      Attributes: ["CampaignID", "Name"],
      Filter: { AttributeFilters: [{ AttributeCode: "State", Operator: "=", Value: "enabled" }, { AttributeCode: "TargetingType", Operator: "=", Value: "manual" }] }
    },
    StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: amzToken
  };
  const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
    headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': 'Campaign.GetList', 'contentmd5': md5(JSON.stringify(body)) },
    data: body, timeout: 30000
  });
  console.log('Campaign.GetList:', (await resp.text()).slice(0, 300));

  await page.screenshot({ path: 'relogin_home.png', fullPage: false }).catch(() => {});
  await ap.screenshot({ path: 'relogin_amzad.png', fullPage: false }).catch(() => {});
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
