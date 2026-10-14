// 每日看板验证: 表格渲染/环比/日历筛选/国家ASIN筛选/JS错误
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html');
  await page.waitForTimeout(1500);

  // 1. 表格行
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const dataRows = trs.filter(tr => !tr.classList.contains('total-row'));
    const out = dataRows.map(tr => {
      const tds = [...tr.querySelectorAll('td')];
      return {
        date: tds[0].innerText.replace(/\s+/g, ' ').trim(),
        traffic: tds[1].innerText.replace(/\n/g, ' | ').trim(),
        conv: tds[2].innerText.replace(/\n/g, ' | ').trim(),
        adClicks: tds[3].innerText.replace(/\n/g, ' | ').trim(),
        natural: tds[4].innerText.replace(/\n/g, ' | ').trim(),
        adConv: tds[5].innerText.replace(/\n/g, ' | ').trim(),
        adCost: tds[6].innerText.replace(/\n/g, ' | ').trim(),
        cpc: tds[7].innerText.replace(/\n/g, ' | ').trim(),
      };
    });
    return { dataRows: out, totalRow: trs.find(tr => tr.classList.contains('total-row'))?.innerText.replace(/\n/g, ' | ').trim(), badge: document.getElementById('rangeBadge').textContent };
  });
  console.log('=== 表格(最近7天) ===');
  console.log('范围badge:', rows.badge);
  rows.dataRows.forEach(r => console.log(JSON.stringify(r)));
  console.log('合计行:', rows.totalRow);

  // 2. 日历筛选: 只看 08-13 ~ 08-14
  await page.evaluate(() => {
    const from = document.getElementById('dateFrom');
    const to = document.getElementById('dateTo');
    from.value = '2026-08-13'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-14'; to.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(500);
  const r2 = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    return trs.filter(tr => !tr.classList.contains('total-row')).map(tr => tr.querySelector('td').innerText.replace(/\s+/g, ' ').trim());
  });
  console.log('\n=== 日历筛选 08-13~08-14 ===', JSON.stringify(r2));
  const badge2 = await page.evaluate(() => document.getElementById('rangeBadge').textContent);
  console.log('badge:', badge2);

  // 3. 国家筛选 DE (单击=单选)
  await page.evaluate(() => {
    // 先恢复日期
    const from = document.getElementById('dateFrom'), to = document.getElementById('dateTo');
    from.value = '2026-08-13'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-19'; to.dispatchEvent(new Event('change'));
  });
  await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(300);
  const deClicked = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const de = opts.find(o => o.innerText.includes('DE'));
    if (!de) return false;
    de.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForTimeout(500);
  const r3 = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    return { rows: trs.filter(tr => !tr.classList.contains('total-row')).map(tr => tr.querySelector('td').innerText.replace(/\s+/g, ' ').trim()), summary: document.getElementById('ddCountrySummary').textContent };
  });
  console.log('\n=== 国家筛选 DE === summary:', r3.summary, 'rows:', JSON.stringify(r3.rows));
  await page.keyboard.press('Escape');
  await page.click('body', { position: { x: 5, y: 5 } });

  // 4. ASIN 筛选: 选 B0H69JJZ1M
  await page.click('#ddAsin .dd-btn');
  await page.waitForTimeout(300);
  const asinClicked = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')];
    const a = opts.find(o => o.innerText.includes('B0H69JJZ1M'));
    if (!a) return false;
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForTimeout(500);
  const r4 = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const dataRow = trs.find(tr => !tr.classList.contains('total-row') && tr.querySelector('td').innerText.includes('08-13'));
    return {
      summary: document.getElementById('ddAsinSummary').textContent,
      row0813: dataRow ? dataRow.innerText.replace(/\n/g, ' | ').trim() : 'NOT FOUND',
    };
  });
  console.log('\n=== ASIN 筛选 B0H69JJZ1M === summary:', r4.summary);
  console.log('08-13行:', r4.row0813);

  // 5. 重置全部, 检查"全部"快捷按钮
  await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelector('#ddCountryList .dd-opt') && [...document.querySelectorAll('#ddCountryList .dd-opt')].forEach(o => o.remove()); });
  // 用全选清空: 直接点按钮
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#ddCountry .dd-panel .btn')];
    btns.forEach(b => { if (b.innerText.includes('全选')) b.click(); });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#ddAsin .dd-panel .btn')];
    btns.forEach(b => { if (b.innerText.includes('全选')) b.click(); });
  });
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => {
    const s1 = document.getElementById('ddCountrySummary').textContent;
    const s2 = document.getElementById('ddAsinSummary').textContent;
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    return { s1, s2, rowCount: trs.filter(tr => !tr.classList.contains('total-row')).length };
  });
  console.log('\n=== 重置后 ===', JSON.stringify(r5));

  console.log('\n=== JS错误 ===', errors.length ? errors : '无');
  await page.screenshot({ path: 'daily_check.png', fullPage: true });
  await browser.close();
})();
