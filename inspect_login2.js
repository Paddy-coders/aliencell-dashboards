const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.home-ant-btn-primary, .ant-btn-primary, button, a'));
    return all.map(e => ({
      tag: e.tagName,
      class: e.className,
      text: e.textContent?.trim().slice(0, 50),
      type: e.type
    }));
  });
  const forms = await page.evaluate(() => Array.from(document.forms).map(f => ({
    action: f.action,
    inputs: Array.from(f.elements).map(i => ({id:i.id, name:i.name, type:i.type, placeholder:i.placeholder}))
  })));
  console.log(JSON.stringify({ url: page.url(), info, forms }, null, 2));
  await ctx.close().catch(()=>{});
  await browser.close().catch(()=>{});
})();
