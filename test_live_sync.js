const { chromium } = require('./playwright-auth');
const BASE = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link';
async function testFile(path, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const s0 = await page.evaluate(() => ({
    regions: [...document.querySelectorAll('#ddRegionList .dd-opt .opt-name')].map(e => e.textContent.trim()),
    countries: [...document.querySelectorAll('#ddCountryList .dd-opt .opt-name')].map(e => e.textContent.trim())
  }));
  console.log(label + ' 初始 → 地区' + s0.regions.length + '个 | 国家' + s0.countries.length + '个', JSON.stringify(s0.countries.map(c => c.split(' ').pop())), errors.length ? 'ERRORS:' + errors : '');
  await page.evaluate("countryOptClick({ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }, 'US')");
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => ({
    region: [...selRegion], country: [...selCountry],
    cOpts: [...document.querySelectorAll('#ddCountryList .dd-opt .opt-name')].map(e => e.textContent.trim())
  }));
  console.log(label + ' 选US →', JSON.stringify(s1), errors.length ? 'ERRORS:' + errors : '');
  await page.evaluate("regionOptClick({ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }, 'EU')");
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(() => ({ region: [...selRegion], country: [...selCountry] }));
  console.log(label + ' 切EU →', JSON.stringify(s2), errors.length ? 'ERRORS:' + errors : '');
  await browser.close();
  // 地区数是数据驱动的(NA/EU/UK/JP/AU 里有数据的才出现), 不能写死 —— 曾写死 2 导致假失败
  const initOk = s0.regions.length >= 2 && s0.countries.length < 13;
  const usOk = s1.region.includes('NA') && s1.country.includes('US') && !s1.cOpts.some(t => t.includes('德国'));
  const euOk = s2.region.includes('EU') && !s2.country.includes('US');
  return initOk && usOk && euOk && errors.length === 0;
}
(async () => {
  const p = await testFile('/product.html', '[product]');
  const m = await testFile('/monthly.html', '[monthly]');
  console.log(p && m ? 'LIVE ALL PASS' : 'LIVE FAILED');
})();
