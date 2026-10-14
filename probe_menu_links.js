// 提取菜单项的真实 href / moduleId / data 属性
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const info = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item, .entry-menus-item')];
    const ads = items.filter(e => /广告/.test((e.textContent || '').trim()));
    return ads.map(e => {
      const a = e.querySelector('a') || e;
      return {
        text: (e.textContent || '').trim(),
        tag: e.tagName,
        href: a.getAttribute('href') || '',
        'data-module-id': a.getAttribute('data-module-id') || e.getAttribute('data-module-id') || '',
        'data-key': a.getAttribute('data-key') || e.getAttribute('data-key') || '',
        onclick: String(a.getAttribute('onclick') || e.getAttribute('onclick') || '').slice(0, 200),
        className: String(e.className).slice(0, 60),
      };
    });
  });
  console.log('广告菜单项:', JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
