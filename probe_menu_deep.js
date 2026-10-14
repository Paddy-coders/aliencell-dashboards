// 提取广告管理菜单的完整 DOM 属性和事件信息
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 先切换到"广告"标签
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) tab.click();
  });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item, .entry-menus-item')];
    const adManage = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (!adManage) return { found: false, allTexts: items.slice(0, 10).map(e => e.textContent.trim()) };
    const attrs = {};
    for (const attr of adManage.attributes) attrs[attr.name] = attr.value;
    const childA = adManage.querySelector('a');
    const childAttrs = childA ? Object.fromEntries([...childA.attributes].map(a => [a.name, a.value])) : {};
    return { found: true, tag: adManage.tagName, attrs, childAttrs, outerHTML: adManage.outerHTML.slice(0, 600) };
  });
  console.log('广告管理元素:', JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
