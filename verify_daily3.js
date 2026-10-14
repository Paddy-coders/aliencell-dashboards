// 每日看板验证 v3: 默认显示全部历史 + 自定义日期范围 + 快捷按钮 + JS错误
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html');
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => ({
    totalDays: Object.keys(DATA.days).length,
    fromVal: document.getElementById('dateFrom').value,
    toVal: document.getElementById('dateTo').value,
    fromMin: document.getElementById('dateFrom').min,
    toMax: document.getElementById('dateTo').max,
    rowCount: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).length,
    firstDate: (() => { const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')); return trs.length ? trs[0].querySelector('td').innerText.replace(/\s+/g, ' ').trim() : null; })(),
    lastDate: (() => { const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')); return trs.length ? trs[trs.length - 1].querySelector('td').innerText.replace(/\s+/g, ' ').trim() : null; })(),
  }));
  console.log('=== 初始状态(应默认全部历史) ===');
  console.log(JSON.stringify(state, null, 1));
  const okDefault = state.rowCount === state.totalDays && state.fromVal === state.fromMin && state.toVal === state.toMax;
  console.log('默认显示全部:', okDefault ? 'PASS' : 'FAIL');

  // 快捷按钮: 最近7天
  await page.evaluate(() => quickRange(7));
  await page.waitForTimeout(400);
  const r7 = await page.evaluate(() => ({
    from: document.getElementById('dateFrom').value,
    to: document.getElementById('dateTo').value,
    rows: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).length,
  }));
  console.log('\n=== 最近7天 ===', JSON.stringify(r7));
  console.log('最近7天行数=7:', r7.rows === 7 ? 'PASS' : 'FAIL');

  // 快捷按钮: 全部
  await page.evaluate(() => quickRange(0));
  await page.waitForTimeout(400);
  const rAll = await page.evaluate(() => ({
    from: document.getElementById('dateFrom').value,
    to: document.getElementById('dateTo').value,
    rows: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).length,
  }));
  console.log('\n=== 全部 ===', JSON.stringify(rAll));
  console.log('全部行数=总天数:', rAll.rows === state.totalDays ? 'PASS' : 'FAIL');

  // 自定义范围: 8/10 ~ 8/12 (3天)
  await page.evaluate(() => {
    const from = document.getElementById('dateFrom');
    const to = document.getElementById('dateTo');
    from.value = '2026-08-10'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-12'; to.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const custom = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).length,
    dates: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).map(tr => tr.querySelector('td').innerText.replace(/\s+/g, ' ').trim()),
  }));
  console.log('\n=== 自定义 08-10~08-12 ===', JSON.stringify(custom));
  console.log('自定义3天:', custom.rows === 3 ? 'PASS' : 'FAIL');

  // 环比在自定义范围仍正确(8/12 应有环比 8/05)
  const cmp = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row'));
    const tr = trs.find(t => t.innerText.includes('08-12'));
    return tr ? [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\n/g, ' | ').trim()) : null;
  });
  console.log('\n=== 8/12 行(自定义范围内应含环比) ===');
  console.log(JSON.stringify(cmp));

  console.log('\n=== JS 错误 ===', errors.length ? errors.join('\n') : '无');
  await browser.close();
})();
