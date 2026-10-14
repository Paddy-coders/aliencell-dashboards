// 在广告管理页面调整筛选条件，尝试显示广告活动数据
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('admanagement')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();
  console.log('URL:', page.url());

  // 尝试清除所有筛选条件或切换店铺
  // 方法1: 点击"所有广告活动"下拉
  await page.evaluate(() => {
    // 找所有下拉/选择器，尝试切换
    const selects = [...document.querySelectorAll('.ant-select, select')];
    for (const s of selects) {
      console.log('select:', (s.textContent || '').trim().slice(0, 40));
    }
    // 找"所有店铺"或店铺选择器
    const shopBtn = [...document.querySelectorAll('button, div, span')].find(e =>
      (e.textContent || '').trim().includes('所有店铺') || (e.textContent || '').trim().includes('店铺')
    );
    if (shopBtn) { shopBtn.click(); console.log('clicked shop'); }
  });
  await sleep(2000);

  // 方法2: 修改日期范围为更大的范围（点击日期输入框）
  await page.evaluate(() => {
    const dateInputs = [...document.querySelectorAll('input')].filter(i => i.placeholder && i.placeholder.includes('日期'));
    for (const inp of dateInputs) {
      console.log('date input found');
    }
  });

  // 方法3: 直接点击"确认"或"查询"按钮
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, span, a')];
    const q = btns.find(e => (e.textContent || '').trim() === '查询' || (e.textContent || '').trim() === '确认' || (e.textContent || '').trim() === '搜索');
    if (q) { q.click(); console.log('clicked query'); }
  });
  await sleep(5000);

  // 提取页面表格内容（包括div模拟的表格）
  const content = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    const divTables = [...document.querySelectorAll('.ant-table, .table, [class*="table"]')];
    return {
      tableCount: tables.length,
      divTableCount: divTables.length,
      bodyText: (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 40),
      rows: [...document.querySelectorAll('tr, .ant-table-row')].map(r => (r.textContent || '').trim().slice(0, 80)).filter(t => t.length > 3).slice(0, 10)
    };
  });

  console.log('Tables:', content.tableCount, 'Div tables:', content.divTableCount);
  console.log('Rows:', content.rows);
  console.log('Body lines:', content.bodyText.slice(0, 20));

  await page.screenshot({ path: 'td_list_after_query.png', timeout: 15000 });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
