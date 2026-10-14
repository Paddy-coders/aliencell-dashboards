const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 只选 X1-词组匹配 活动，和之前成功的测试一样
  await page.evaluate(() => {
    selCampaigns.clear();
    const camp = DATA.campaigns.find(c => c.name === 'X1-词组匹配');
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(1000);

  // 展开所有广告组
  await page.evaluate(() => {
    document.querySelectorAll('#adgroupBody .grp-row').forEach(row => {
      if (row.dataset.open !== '1') toggleGroupDetail(row);
    });
  });
  await page.waitForTimeout(1000);

  // 检查每个广告组的关键词区
  const info = await page.evaluate(() => {
    const rows = document.querySelectorAll('#adgroupBody .grp-row');
    const results = [];
    rows.forEach(r => {
      const next = r.nextElementSibling;
      if (!next || !next.classList.contains('grp-detail')) return;
      const kwSection = next.querySelector('.kw-section');
      const kwTitle = kwSection ? kwSection.querySelector('.kw-title') : null;
      const kwRows = kwSection ? kwSection.querySelectorAll('.kw-row') : [];
      results.push({
        adGroup: r.querySelector('td:nth-child(2)')?.textContent?.slice(0, 40),
        gkey: r.dataset.gkey,
        hasDetail: !!next,
        hasKwSection: !!kwSection,
        kwTitle: kwTitle?.textContent?.slice(0, 60),
        kwCount: kwRows.length,
        kwTexts: Array.from(kwRows).map(kr => kr.querySelector('td:nth-child(2)')?.textContent?.slice(0, 30)),
      });
    });
    return results;
  });
  console.log(JSON.stringify(info, null, 2));

  // 对第一个有关键词的广告组，展开其第一个关键词并截图
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#adgroupBody .grp-row');
    for (const r of rows) {
      const next = r.nextElementSibling;
      if (!next) continue;
      const kwRow = next.querySelector('.kw-row');
      if (kwRow) {
        toggleKwDetail(kwRow);
        return { expanded: true, adGroup: r.querySelector('td:nth-child(2)')?.textContent };
      }
    }
    return { expanded: false };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshot_kw_working.png', fullPage: false });
  console.log('screenshot saved');

  await browser.close();
})();
