const { chromium } = require('./playwright-auth');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 选 X1-词组匹配
  await page.evaluate(() => {
    selCampaigns.clear();
    const camp = DATA.campaigns.find(c => c.name === 'X1-词组匹配');
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(1000);

  // 展开第一个广告组
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(800);

  // 滚动到投放词区域
  await page.evaluate(() => {
    const el = document.querySelector('.kw-section');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);

  // 截图1：折叠状态
  await page.screenshot({ path: 'kw_folded.png', fullPage: false });

  // 展开第一个关键词
  await page.evaluate(() => {
    const row = document.querySelector('.kw-row');
    if (row) toggleKwDetail(row);
  });
  await page.waitForTimeout(500);

  // 截图2：展开状态
  await page.screenshot({ path: 'kw_expanded2.png', fullPage: false });

  // 诊断信息
  const diag = await page.evaluate(() => {
    const row = document.querySelector('.kw-row');
    const detail = row ? row.nextElementSibling : null;
    return {
      kwClass: row ? row.className : null,
      toggleText: row ? row.querySelector('.kw-toggle')?.textContent : null,
      detailDisplay: detail ? detail.style.display : null,
      detailOpen: detail ? detail.dataset.open : null,
      detailVisible: detail ? detail.offsetHeight > 0 : false,
      detailHtml: detail ? detail.innerHTML.slice(0, 500) : null,
    };
  });
  console.log('DIAG:', JSON.stringify(diag, null, 2));

  await browser.close();
})();
