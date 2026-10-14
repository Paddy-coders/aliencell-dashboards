// 每日看板验证 v2: 环比显示/日历筛选/国家/ASIN(重置后)/JS错误
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html');
  await page.waitForTimeout(1500);

  // 1. 表格最近7天 + 环比
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const dataRows = trs.filter(tr => !tr.classList.contains('total-row'));
    const out = dataRows.map(tr => {
      const tds = [...tr.querySelectorAll('td')];
      return {
        date: tds[0].innerText.replace(/\s+/g, ' ').trim(),
        traffic: tds[1].innerText.replace(/\n/g, ' | ').trim(),
        adClicks: tds[3].innerText.replace(/\n/g, ' | ').trim(),
        natural: tds[4].innerText.replace(/\n/g, ' | ').trim(),
        adCost: tds[6].innerText.replace(/\n/g, ' | ').trim(),
        cpc: tds[7].innerText.replace(/\n/g, ' | ').trim(),
      };
    });
    return out;
  });
  console.log('=== 最近7天(默认) ===');
  rows.forEach(r => console.log(JSON.stringify(r)));

  // 2. 环比核对: 8/13 的环比应等于 8/06 (业务5行) 
  //    8/13 流量 vs 8/06 流量
  const cmpCheck = await page.evaluate(() => {
    const getRow = d => {
      const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
      const tr = trs.find(t => !t.classList.contains('total-row') && t.innerText.includes(d.slice(5)));
      return tr ? [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\n/g, ' | ').trim()) : null;
    };
    const r13 = getRow('2026-08-13');
    const r06 = getRow('2026-08-06');
    return { r13, r06 };
  });
  console.log('\n=== 8/13 环比核对 ===');
  console.log('8/13:', JSON.stringify(cmpCheck.r13));
  console.log('8/06(前一周同日):', JSON.stringify(cmpCheck.r06));

  // 3. 日历筛选 8/13~8/14
  await page.evaluate(() => {
    const from = document.getElementById('dateFrom');
    const to = document.getElementById('dateTo');
    from.value = '2026-08-13'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-14'; to.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).map(tr => tr.querySelector('td').innerText.replace(/\s+/g, ' ').trim()));
  console.log('\n=== 日历 08-13~08-14 ===', JSON.stringify(r2));

  // 4. 恢复日期, ASIN 筛选 B0H69JJZ1M (不选国家)
  await page.evaluate(() => {
    const from = document.getElementById('dateFrom'), to = document.getElementById('dateTo');
    from.value = '2026-08-13'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-19'; to.dispatchEvent(new Event('change'));
  });
  await page.click('#ddAsin .dd-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')];
    const a = opts.find(o => o.innerText.includes('B0H69JJZ1M'));
    if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  const r3 = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const row = trs.find(t => !t.classList.contains('total-row') && t.innerText.includes('08-13'));
    return { summary: document.getElementById('ddAsinSummary').textContent, row0813: row ? row.innerText.replace(/\n/g, ' | ').trim() : 'NOT FOUND' };
  });
  console.log('\n=== ASIN B0H69JJZ1M ===', JSON.stringify(r3));

  // 5. 重置(全选按钮), 验证国家联动 ASIN 面板
  await page.evaluate(() => {
    [...document.querySelectorAll('#ddAsin .dd-panel .btn')].forEach(b => { if (b.innerText.includes('全选')) b.click(); });
  });
  await page.waitForTimeout(300);
  // 选 DE 国家 → 查看 ASIN 面板中 US 的 ASIN 是否 dim
  await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const de = opts.find(o => o.innerText.includes('DE'));
    if (de) de.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  await page.click('#ddAsin .dd-btn');
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')];
    return {
      countrySummary: document.getElementById('ddCountrySummary').textContent,
      asinCount: opts.length,
      b0h69: opts.find(o => o.innerText.includes('B0H69JJZ1M')) ? opts.find(o => o.innerText.includes('B0H69JJZ1M')).className : 'N/A',
      dimCount: opts.filter(o => o.className.includes('dim')).length,
    };
  });
  console.log('\n=== 国家=DE 后 ASIN 面板 ===', JSON.stringify(r5));

  // 6. 重置全部 → 表格行数 14
  await page.evaluate(() => {
    [...document.querySelectorAll('#ddCountry .dd-panel .btn')].forEach(b => { if (b.innerText.includes('全选')) b.click(); });
    const from = document.getElementById('dateFrom'), to = document.getElementById('dateTo');
    from.value = '2026-08-06'; from.dispatchEvent(new Event('change'));
    to.value = '2026-08-19'; to.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const r6 = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#tableWrap tbody tr')].filter(tr => !tr.classList.contains('total-row')).length,
    badge: document.getElementById('rangeBadge').textContent,
  }));
  console.log('\n=== 全部14天 ===', JSON.stringify(r6));

  console.log('\n=== JS错误 ===', errors.length ? errors : '无');
  await page.screenshot({ path: 'daily_check.png', fullPage: true });
  await browser.close();
})();
