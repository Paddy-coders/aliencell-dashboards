// 读取广告管理元素的事件监听器, 找到触发导航的方式
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 确保在广告标签
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
    const listeners = getEventListeners ? getEventListeners(adManage) : 'no_getEventListeners';
    const aListeners = adManage.querySelector('a') ? (getEventListeners ? getEventListeners(adManage.querySelector('a')) : 'no_getEventListeners') : 'no_a';
    // 尝试找到 Vue 或 React 组件的 props / data attributes
    const vueData = adManage.__vue__ ? JSON.stringify(Object.keys(adManage.__vue__)) : 'no_vue';
    const vueProps = adManage.__vueParentComponent?.props ? JSON.stringify(adManage.__vueParentComponent.props) : 'no_vue_props';
    return { found: true, listeners, aListeners, vueData, vueProps, dataMenuKey: adManage.getAttribute('data-menu-key') };
  });
  console.log('事件监听:', JSON.stringify(info, null, 1));

  // 使用 CDP Runtime.getProperties 查看元素属性
  const cdpSession = await page.context().newCDPSession(page);
  const { result } = await cdpSession.send('Runtime.evaluate', { expression: `
    (() => {
      const items = [...document.querySelectorAll('.entry-menus-item--link, .entry-menus-item')];
      const adManage = items.find(e => (e.textContent || '').trim() === '广告管理');
      if (!adManage) return 'not_found';
      const a = adManage.querySelector('a');
      return {
        menuKey: adManage.getAttribute('data-menu-key'),
        onclick: adManage.onclick ? adManage.onclick.toString().slice(0, 300) : 'none',
        a_onclick: a && a.onclick ? a.onclick.toString().slice(0, 300) : 'none',
        dataset: adManage.dataset ? Object.entries(adManage.dataset).reduce((o,[k,v])=>{o[k]=v;return o},{}) : {}
      };
    })()
  `, returnByValue: true });
  console.log('CDP属性:', JSON.stringify(result.value, null, 1));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
