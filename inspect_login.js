const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const html = await page.content();
  const tabs = await page.locator('.login-tab, .ant-tabs-tab, [role="tab"], .home-ant-tabs-tab, .login-tab-item, .tab-item').allInnerTexts().catch(() => []);
  const btns = await page.locator('.home-ant-btn-primary, .ant-btn-primary, button').allInnerTexts().catch(() => []);
  const inputs = await page.locator('input').evaluateAll(els => els.map(e => ({id: e.id, name: e.name, placeholder: e.placeholder, type: e.type})));
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), tabs, btns, inputs }, null, 2));
  await page.screenshot({ path: 'login_inspect.png', fullPage: false });
  await ctx.close().catch(()=>{});
  await browser.close().catch(()=>{});
})();
