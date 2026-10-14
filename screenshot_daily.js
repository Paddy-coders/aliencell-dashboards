// 截图: 每日看板筛选联动置灰效果
const { chromium } = require('./playwright-auth');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'daily.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 选 X1系列 → 国家面板展示范围外置灰
  await page.evaluate(() => {
    document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
    document.getElementById('ddSeries').classList.add('open');
  });
  await page.waitForTimeout(200);

  // 选 X1系列
  await page.evaluate(() => {
    const list = document.getElementById('ddSeriesList');
    const opts = [...list.querySelectorAll('.dd-opt')];
    const x1 = opts.find(el => el.querySelector('.opt-name')?.textContent?.trim()?.includes('X1') && !el.querySelector('.opt-name')?.textContent?.includes('无'));
    if (x1) x1.click();
  });
  await page.waitForTimeout(300);

  // 打开国家面板展示置灰
  await page.evaluate(() => {
    document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
    document.getElementById('ddCountry').classList.add('open');
  });
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'screenshot_daily_dim.png', fullPage: false });
  console.log('screenshot saved');
  await browser.close();
})();
