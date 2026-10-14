// 诊断: daily.html 中 evaluate 调用 handleOptClick 是否生效
const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8899';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(BASE + '/daily.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  console.log('环境:', await page.evaluate(() => ({
    hasFn: typeof handleOptClick, hasRenderAll: typeof renderAll,
    selCountry: selCountry.size, selAsin: selAsin.size, selSeries: selSeries.size, selName: selName.size,
    days: DAYS.length, asinList: asinList.length
  })));

  // 方式A: evaluate 传字符串箭头函数
  await page.evaluate(`() => { handleOptClick({ ctrlKey:false, metaKey:false, stopPropagation(){} }, selCountry, 'US', renderAll); }`);
  console.log('A 后:', await page.evaluate(() => ({ selCountry: [...selCountry], summary: document.getElementById('ddCountrySummary').textContent })));

  // 方式B: evaluate 传函数(引用沙箱内变量, 不走全局)
  await page.evaluate(() => { handleOptClick({ ctrlKey:false, metaKey:false, stopPropagation(){} }, selCountry, 'DE', renderAll); });
  console.log('B 后:', await page.evaluate(() => ({ selCountry: [...selCountry], summary: document.getElementById('ddCountrySummary').textContent })));

  // 方式C: 直接调用页面里的原生 onclick (模拟真实用户)
  await page.evaluate(() => { document.getElementById('ddCountry').classList.add('open'); });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const fr = opts.find(o => o.textContent.includes('FR'));
    fr.onclick({ preventDefault() {}, stopPropagation() {} });
  });
  console.log('C 后:', await page.evaluate(() => ({ selCountry: [...selCountry], summary: document.getElementById('ddCountrySummary').textContent })));

  // asinScope 计算验证
  console.log('asinScope(当前):', await page.evaluate(() => { const s = asinScope(); return s ? [...s] : null; }));
  console.log('countryScope(当前):', await page.evaluate(() => { const s = countryScope(); return s ? [...s] : null; }));
  console.log('errors:', errors);
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exitCode = 1; });
