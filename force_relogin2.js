// 强制重新登录 v2：点击 ec-login-submit（新版登录按钮）
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

  // 1. 导航到登录页并清除旧 token
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/login?redirectPath=%2Fiframe%23%2Fm_71579', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(5000);
  await page.evaluate(() => { try { localStorage.removeItem('pro__Access-Token'); } catch (e) {} }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);

  // 2. 填表登录
  const hasForm = await page.locator('#userName').count().then(c => c > 0).catch(() => false);
  console.log('表单存在:', hasForm);
  if (!hasForm) { console.log('NO LOGIN FORM'); await browser.close(); process.exit(2); }

  await page.fill('#userName', CONFIG.username);
  await page.fill('#password', CONFIG.password);
  await page.locator('#userName').evaluate(el => el.blur()).catch(() => {});
  await page.locator('#password').evaluate(el => el.blur()).catch(() => {});
  await page.waitForTimeout(1200);

  // 新版登录按钮 ec-login-submit
  const submit = page.locator('.ec-login-submit');
  if (await submit.count()) {
    await submit.click();
    console.log('点击 ec-login-submit');
  } else {
    // 兜底：home-ant-btn-primary 且不是 ERP1.0
    const btn = page.locator('.home-ant-btn-primary').filter({ hasText: /^登录$/ }).first();
    if (await btn.count()) { await btn.click(); console.log('点击 .home-ant-btn-primary 登录'); }
    else { console.log('NO SUBMIT BUTTON'); await browser.close(); process.exit(2); }
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'login_click_v2.png', fullPage: false });

  // 等待跳转
  try { await page.waitForURL(u => !String(u.href).includes('/login'), { timeout: 30000 }); }
  catch (e) { console.log('waitForURL timeout'); }
  await page.waitForTimeout(8000);

  const url = page.url();
  const erpToken = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; }
  }).catch(() => null);
  console.log('URL:', url.slice(0, 120), '| ERP token:', erpToken ? erpToken.slice(0, 50)+'...' : 'NULL');
  if (!erpToken || url.includes('/login')) { console.log('HOME LOGIN FAILED'); await browser.close(); process.exit(2); }

  // 3. SSO amz-ad
  for (const p of ctx.pages()) {
    if (p !== page && p.url().includes('amz-ad.eccang.com/login')) await p.close().catch(() => {});
  }
  const ap = await ctx.newPage();
  const ssoUrl = 'https://amz-ad.eccang.com/?resource=sso&token=' + encodeURIComponent(erpToken);
  await ap.goto(ssoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('sso warn:', e.message));
  let amzToken = null;
  for (let i = 0; i < 30; i++) {
    await ap.waitForTimeout(2000);
    const tk = await ap.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; } }).catch(() => null);
    const u = ap.url();
    if (tk && !u.includes('/login')) { amzToken = tk; console.log(`amz-ad OK (${i*2}s), URL=${u.slice(0,100)}`); break; }
    if (i === 29) console.log('amz-ad SSO 超时', u.slice(0, 150));
  }
  if (!amzToken) { console.log('AMZ-AD LOGIN FAILED'); await browser.close(); process.exit(2); }

  // 4. 验证接口
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
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: amzToken
  };
  const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
    headers: { 'Content-Type': 'application/json;charset=UTF-8', 'actiontype': 'Campaign.GetList', 'contentmd5': md5(JSON.stringify(body)) },
    data: body, timeout: 30000
  });
  const txt = await resp.text();
  console.log('Campaign.GetList:', txt.slice(0, 250));

  // 保存新 token 供后续脚本直接复用
  console.log('AMZ-TOKEN:', amzToken);
  await browser.close();
  console.log('RELOGIN OK');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
