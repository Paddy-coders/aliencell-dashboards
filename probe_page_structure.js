// 查看易仓当前页面顶层结构: iframe? 标签? 菜单?
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('页面数:', pages.length);
  for (const p of pages) {
    console.log('页面URL:', p.url().slice(0, 100));
  }
  let page = null;
  for (const p of pages) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const info = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('iframe')].map(f => ({ src: (f.src || '').slice(0, 120), id: f.id, cls: String(f.className).slice(0, 40) }));
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')].map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30);
    const menus = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item, .ant-menu-title-content')].map(e => (e.textContent || '').trim()).filter(t => t && t.length <= 15).slice(0, 60);
    const bodySnippet = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l && l.length <= 30).slice(0, 50);
    return { iframes, tabs, menus, bodySnippet };
  });
  console.log('iframes:', JSON.stringify(info.iframes, null, 1));
  console.log('tabs:', JSON.stringify(info.tabs));
  console.log('menus:', JSON.stringify(info.menus, null, 1));
  console.log('body前50行:', JSON.stringify(info.bodySnippet, null, 1));
  await page.screenshot({ path: 'page_structure.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
