// 正确导航到"广告管理"页面
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 1. 先点击顶部"广告"标签页
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) tab.click();
  });
  await page.waitForTimeout(2000);

  // 2. 在广告标签页下点击"广告管理"（展开菜单后）
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) it.click();
  });
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'ad_manage_page2.png' });
  console.log('URL:', page.url());

  // 3. 提取表格/列表的文本
  const bodyText = await page.evaluate(() => {
    const table = document.querySelector('.home-ant-table-tbody, .ant-table-tbody, .ant-table-body');
    const out = [];
    if (table) {
      const rows = table.querySelectorAll('tr');
      for (const r of rows) {
        const cells = [...r.querySelectorAll('td')].map(c => (c.textContent || '').trim());
        if (cells.length) out.push(cells);
      }
    }
    // 尝试其他列表结构
    const allText = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length <= 20);
    return { rows: out.slice(0, 20), textHints: allText.filter(l => /投放|暂停|关闭|结束|状态|启用|禁用/.test(l)).slice(0, 40) };
  });
  console.log('表格行:', JSON.stringify(bodyText.rows, null, 1).slice(0, 3000));
  console.log('状态相关文本:', JSON.stringify(bodyText.textHints, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
