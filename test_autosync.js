const { chromium } = require('./playwright-auth');

async function openDD(page, id) {
  const isOpen = await page.$eval(`#${id}`, el => el.classList.contains('open'));
  if (!isOpen) { await page.click(`#${id} .dd-btn`); await page.waitForTimeout(200); }
}
async function clickOpt(page, listId, text, opts = {}) {
  for (const o of await page.$$(listId + ' .dd-opt')) {
    const t = await o.textContent();
    if (t.includes(text)) { await o.click(opts); return true; }
  }
  return false;
}
async function optTexts(page, listId) {
  return await page.$$eval(listId + ' .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
}

async function testFile(url, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  console.log(`\n=== ${label} ===`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  let pass = 0, fail = 0;
  function check(name, cond) { console.log(`  ${cond ? '✓' : '✗'} ${name}`); cond ? pass++ : fail++; }

  // Test 0: 初始状态下拉只显示有数据项 (地区/国家数按当前数据动态计算, 勿硬编码)
  await openDD(page, 'ddRegion');
  const rOpts0 = await optTexts(page, '#ddRegionList');
  const expRegions = await page.evaluate(() =>
    typeof ROWS !== 'undefined' ? [...new Set(ROWS.map(r => regionOf(r.cc)))] : [...new Set(DATA.countries.filter(c => c.hasData).map(c => regionOf(c.code)))]);
  check('初始地区列表只显示有数据地区 ' + expRegions.join('+') + ' (实际 ' + rOpts0.length + ')',
    rOpts0.length === expRegions.length && expRegions.every(rc => rOpts0.some(t => t.includes(rc))));
  await openDD(page, 'ddCountry');
  const cOpts0 = await optTexts(page, '#ddCountryList');
  const expCountries = await page.evaluate(() =>
    typeof ROWS !== 'undefined' ? [...new Set(ROWS.map(r => r.cc))] : DATA.countries.filter(c => c.hasData).map(c => c.code));
  check('初始国家列表只显示有数据国家 ' + expCountries.join('+') + ' (实际 ' + cOpts0.length + ')',
    cOpts0.length === expCountries.length && expCountries.every(cc => cOpts0.some(t => t.includes(cc))));

  // Test 1: Select NA region → countries auto-selected + 国家列表只剩地区内国家
  await openDD(page, 'ddRegion');
  await clickOpt(page, '#ddRegionList', '北美地区');
  await page.waitForTimeout(500);
  const sel1 = await page.evaluate(() => ({ r: [...selRegion], c: selCountry.size }));
  check('选NA地区 → 地区=NA, 国家自动选中', sel1.r.includes('NA') && sel1.c > 0);
  await openDD(page, 'ddCountry');
  const cOpts1 = await optTexts(page, '#ddCountryList');
  check('选NA后国家列表只显示地区内国家(无德国)', cOpts1.length >= 1 && !cOpts1.some(t => t.includes('德国')) && cOpts1.every(t => t.includes('美国') || t.includes('加拿大') || t.includes('墨西哥')));

  // Test 2: Clear by clicking NA again (single-click toggle off)
  await openDD(page, 'ddRegion');
  await clickOpt(page, '#ddRegionList', '北美地区');
  await page.waitForTimeout(300);
  const rs2 = await page.$eval('#ddRegionSummary', el => el.textContent);
  const cs2 = await page.$eval('#ddCountrySummary', el => el.textContent);
  check('单击NA取消 → 地区=全部, 国家=全部', rs2 === '全部' && cs2 === '全部');

  // Test 3: Select US country → region auto-set to NA
  await openDD(page, 'ddCountry');
  const clickedUS = await clickOpt(page, '#ddCountryList', '美国');
  await page.waitForTimeout(500);
  const sel3 = await page.evaluate(() => ({ r: [...selRegion], c: [...selCountry] }));
  check('选美国 → 地区自动=NA, 国家=US', clickedUS && sel3.r.includes('NA') && sel3.c.includes('US'));

  // Test 4: 一键切换到 EU (地区列表始终显示有数据地区, 不会被国家选择锁死) → US cleared
  await openDD(page, 'ddRegion');
  const rOpts4 = await optTexts(page, '#ddRegionList');
  check('选US后地区列表仍显示有数据地区(' + expRegions.length + ') 可切换', rOpts4.length === expRegions.length && rOpts4.some(t => t.includes('欧盟')));
  await clickOpt(page, '#ddRegionList', '欧盟');
  await page.waitForTimeout(500);
  const sel4 = await page.evaluate(() => ({ r: [...selRegion], c: [...selCountry] }));
  check('一键切换到EU → 地区=EU, 国家不含US', sel4.r.includes('EU') && !sel4.c.includes('US'));

  // Test 5: 选EU后国家列表只剩EU区有数据国家(区外国家置灰/隐藏, 至少不含美国); 地区Ctrl+北美 → NA+EU 多地区, 国家 US+DE
  await openDD(page, 'ddCountry');
  const cOpts5 = await optTexts(page, '#ddCountryList');
  // 期望值动态计算(勿硬编码: 各国数据范围会变, EU 区有数据国家不止德国)
  const expEu5 = await page.evaluate(() => {
    const codes = typeof ROWS !== 'undefined' ? [...new Set(ROWS.map(r => r.cc))] : DATA.countries.filter(c => c.hasData).map(c => c.code);
    return codes.filter(c => regionOf(c) === 'EU');
  });
  const okEu5 = expEu5.length > 0 && cOpts5.length === expEu5.length
    && expEu5.every(cc => cOpts5.some(t => t.includes(cc)))
    && !cOpts5.some(t => t.includes('美国'));
  check('选EU后国家列表只剩EU区有数据国家 ' + expEu5.join('+') + ' (实际 ' + cOpts5.length + ': ' + cOpts5.join(',') + ')', okEu5);
  await openDD(page, 'ddRegion');
  await clickOpt(page, '#ddRegionList', '北美地区', { modifiers: ['Control'] });
  await page.waitForTimeout(500);
  const sel5 = await page.evaluate(() => ({ r: [...selRegion], c: [...selCountry] }));
  check('Ctrl+地区 NA → 地区=NA+EU, 国家=US+DE', sel5.r.includes('NA') && sel5.r.includes('EU') && sel5.c.includes('US') && sel5.c.includes('DE'));

  // Test 6: Click "清空" on region → both cleared
  await openDD(page, 'ddRegion');
  const clearBtn = await page.$('#ddRegion .dd-tools .btn:not(.primary)');
  if (clearBtn) { await clearBtn.click(); await page.waitForTimeout(300); }
  else {
    const allBtn = await page.$('#ddRegion .dd-tools .btn');
    if (allBtn) { await allBtn.click(); await page.waitForTimeout(300); }
  }
  const rs6 = await page.$eval('#ddRegionSummary', el => el.textContent);
  const cs6 = await page.$eval('#ddCountrySummary', el => el.textContent);
  check('清空地区 → 地区=全部, 国家=全部', rs6 === '全部' && cs6 === '全部');

  console.log(`  Results: ${pass} pass, ${fail} fail`);
  if (errors.length) console.log('  JS ERRORS:', errors);
  else console.log('  No JS errors');

  await browser.close();
  return fail === 0;
}

(async () => {
  const m = await testFile('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/monthly.html', 'monthly.html');
  const p = await testFile('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html', 'product.html');
  console.log(m && p ? '\nALL PASS' : '\nSOME FAILED');
})();
