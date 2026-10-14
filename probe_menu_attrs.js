// 读取广告管理元素的 onclick/dataset/内部属性
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) tab.click();
  });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .entry-menus-item')];
    const adManage = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (!adManage) return { found: false };
    const a = adManage.querySelector('a');
    const onclickStr = adManage.onclick ? adManage.onclick.toString().slice(0, 400) : 'none';
    const aOnclickStr = a && a.onclick ? a.onclick.toString().slice(0, 400) : 'none';
    const dataset = adManage.dataset ? Object.fromEntries([...Object.entries(adManage.dataset)]) : {};
    // 查找附近的 script 或 event 属性
    return { found: true, tag: adManage.tagName, onclick: onclickStr, a_onclick: aOnclickStr, dataset, dataMenuKey: adManage.getAttribute('data-menu-key') };
  });
  console.log('属性:', JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
