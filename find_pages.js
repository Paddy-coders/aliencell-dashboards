// 检查所有页面，找到包含菜单的那个
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  console.log('Pages:');
  for (const p of ctx.pages()) {
    const u = p.url();
    console.log(' -', u.slice(0, 120));
    if (u.includes('home.eccang.com/entry')) {
      await p.screenshot({ path: 'found_entry_page.png' });
    }
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
