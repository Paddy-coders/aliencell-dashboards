// 每日看板验证 v4: ACOS列 + 可选列(列选择) + 固定一屏内部滚动 + 环比 + 合计行 + JS错误
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html');
  await page.waitForTimeout(1500);

  // 1) 表头: 日期 + 8指标(含ACOS)
  const headers = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.innerText.trim()));
  console.log('表头:', JSON.stringify(headers));
  console.log('9列且含ACOS:', headers.length === 9 && headers.includes('ACOS') ? 'PASS' : 'FAIL');

  // 2) ACOS 值正确性: 手工计算 8/13 全选 ACOS vs 页面显示
  const acosCheck = await page.evaluate(() => {
    const d = '2026-08-13';
    const a = aggRows(d, new Set(), new Set());
    const expect = a.adSales > 0 ? (a.adCost / a.adSales * 100).toFixed(2) + '%' : '—';
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row'));
    const tr = trs.find(t => t.innerText.includes('08-13'));
    const tds = [...tr.querySelectorAll('td')];
    const acosTd = tds[tds.length - 1]; // 默认全选时最后一列=ACOS
    return { expect, shown: acosTd.querySelector('.cell-main').innerText.trim(), adCost: a.adCost, adSales: a.adSales };
  });
  console.log('\nACOS 8/13 手工 vs 页面:', JSON.stringify(acosCheck));
  console.log('ACOS值正确:', acosCheck.expect === acosCheck.shown ? 'PASS' : 'FAIL');

  // 3) 列选择: 隐藏"流量"列
  await page.evaluate(() => toggleCol('traffic'));
  await page.waitForTimeout(400);
  const headers2 = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.innerText.trim()));
  const colCountTxt = await page.evaluate(() => document.getElementById('colCount').textContent);
  console.log('\n隐藏流量后表头:', JSON.stringify(headers2), '| 计数:', colCountTxt);
  console.log('列选择生效(8列无流量/7-8计数):', headers2.length === 8 && !headers2.includes('流量') && colCountTxt === '7/8' ? 'PASS' : 'FAIL');
  await page.evaluate(() => allCols({ stopPropagation(){} }));
  await page.waitForTimeout(400);

  // 4) 布局: 页面级不滚动(body overflow hidden) + 表格内部滚动
  const layout = await page.evaluate(() => ({
    docScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    wrapScrollH: document.getElementById('tableWrap').scrollHeight,
    wrapClientH: document.getElementById('tableWrap').clientHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  console.log('\n布局:', JSON.stringify(layout));
  const okLayout = layout.bodyOverflow === 'hidden' && layout.docScrollH <= layout.innerH + 2 && layout.wrapScrollH > layout.wrapClientH;
  console.log('固定一屏+内部滚动:', okLayout ? 'PASS' : 'FAIL');

  // 5) 8/13 行: 环比 + ACOS 都存在
  const cmp = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row'));
    const tr = trs.find(t => t.innerText.includes('08-13'));
    return [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\n/g, ' | ').trim());
  });
  console.log('\n8/13 行(9列: 日期+8指标, 每格主值+环比):');
  console.log(JSON.stringify(cmp, null, 1));

  // 6) 合计行含 ACOS
  const totalRow = await page.evaluate(() => {
    const tr = document.querySelector('#tableWrap tr.total-row');
    return [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
  });
  console.log('\n合计行:', JSON.stringify(totalRow));
  console.log('合计行9列:', totalRow.length === 9 ? 'PASS' : 'FAIL');

  console.log('\n=== JS 错误 ===', errors.length ? errors.join('\n') : '无');
  await browser.close();
})();
