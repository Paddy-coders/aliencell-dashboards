const { chromium } = require('./playwright-auth');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // 选 X1-词组匹配 活动
  await page.evaluate(() => {
    selCampaigns.clear();
    const camp = DATA.campaigns.find(c => c.name === 'X1-词组匹配');
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(500);
  // 展开第一个广告组
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(400);
  // 展开前 3 个投放词
  await page.evaluate(() => {
    document.querySelectorAll('.kw-row').forEach((row, i) => {
      if (i < 3) toggleKwDetail(row);
    });
  });
  await page.waitForTimeout(300);
  // 滚动到广告组卡片
  await page.evaluate(() => {
    const el = document.getElementById('adgroupCard');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot_kw_expanded.png', fullPage: false });
  console.log('screenshot saved');
  await browser.close();
})();
