// 每日看板验证 v5: 订单量+广告订单量列 + 可选列 + 固定一屏内部滚动 + 环比 + 合计行 + JS错误
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html');
  await page.waitForTimeout(1500);

  // 1) 表头: 日期 + 10指标(含订单量/广告订单量/ACOS)
  const headers = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.innerText.trim()));
  console.log('表头:', JSON.stringify(headers));
  console.log('11列且含订单量/广告订单量/ACOS:', headers.length === 11 && headers.includes('订单量') && headers.includes('广告订单量') && headers.includes('ACOS') ? 'PASS' : 'FAIL');

  // 2) 8/13 行: 订单量/广告订单量/ACOS 手工计算 vs 页面
  const check = await page.evaluate(() => {
    const d = '2026-08-13';
    const a = aggRows(d, new Set(), new Set());
    const expectAcos = a.adSales > 0 ? (a.adCost / a.adSales * 100).toFixed(2) + '%' : '—';
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row'));
    const tr = trs.find(t => t.innerText.includes('08-13'));
    const tds = [...tr.querySelectorAll('td')];
    const main = i => tds[i].querySelector('.cell-main').innerText.trim();
    return {
      expectOrders: String(a.orders), shownOrders: main(2),
      expectAdOrders: String(a.adOrders), shownAdOrders: main(5),
      expectAcos, shownAcos: tds[tds.length - 1].querySelector('.cell-main').innerText.trim(),
      raw: { orders: a.orders, adOrders: a.adOrders, adCost: a.adCost, adSales: a.adSales }
    };
  });
  console.log('\n8/13 订单量/广告订单量/ACOS 手工 vs 页面:', JSON.stringify(check));
  console.log('订单量正确:', check.expectOrders === check.shownOrders ? 'PASS' : 'FAIL');
  console.log('广告订单量正确:', check.expectAdOrders === check.shownAdOrders ? 'PASS' : 'FAIL');
  console.log('ACOS正确:', check.expectAcos === check.shownAcos ? 'PASS' : 'FAIL');

  // 3) 列选择: 隐藏"订单量"列
  await page.evaluate(() => toggleCol('orders'));
  await page.waitForTimeout(400);
  const headers2 = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.innerText.trim()));
  const colCountTxt = await page.evaluate(() => document.getElementById('colCount').textContent);
  console.log('\n隐藏订单量后表头:', JSON.stringify(headers2), '| 计数:', colCountTxt);
  console.log('列选择生效(10列含日期无订单量/指标计数9-10):', headers2.length === 10 && !headers2.includes('订单量') && colCountTxt === '9/10' ? 'PASS' : 'FAIL');
  await page.evaluate(() => allCols({ stopPropagation(){} }));
  await page.waitForTimeout(400);

  // 4) 布局: 页面级不滚动 + 表格内部滚动
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

  // 5) 合计行: 10列, 订单量与广告订单量存在
  const totalRow = await page.evaluate(() => {
    const tr = document.querySelector('#tableWrap tr.total-row');
    return [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
  });
  console.log('\n合计行:', JSON.stringify(totalRow));
  console.log('合计行11列:', totalRow.length === 11 ? 'PASS' : 'FAIL');

  // 6) 环比仍正常 (8/13 流量环比)
  const cmp = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row'));
    const tr = trs.find(t => t.innerText.includes('08-13'));
    const tds = [...tr.querySelectorAll('td')];
    return { traffic: tds[1].innerText.replace(/\n/g, ' | ').trim(), orders: tds[2].innerText.replace(/\n/g, ' | ').trim() };
  });
  console.log('\n8/13 流量与订单量单元格(主值+环比):', JSON.stringify(cmp));

  console.log('\n=== JS 错误 ===', errors.length ? errors.join('\n') : '无');
  await browser.close();
})();
