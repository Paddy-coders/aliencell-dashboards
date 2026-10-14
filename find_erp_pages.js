// 找到ERP iframe页面，检查其内容
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  for (const p of ctx.pages()) {
    const u = p.url();
    if (u.includes('home.eccang.com')) {
      console.log('Page:', u.slice(0, 120));
      const txt = await p.evaluate(() => document.body.innerText.slice(0, 500));
      console.log('  body text:', JSON.stringify(txt));
      const hasAd = await p.evaluate(() => document.body.innerText.includes('广告'));
      console.log('  has 广告:', hasAd);
      await p.screenshot({ path: 'page_' + u.split('/').pop().replace(/[^a-z0-9]/gi,'_') + '.png' });
    }
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
