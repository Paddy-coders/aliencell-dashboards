const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 清除所有筛选，展开所有广告组，找到有关键词的广告组
  await page.evaluate(() => {
    selCountry.clear(); selWeek.clear(); selAsin.clear(); selSeries.clear(); selName.clear();
    selType.clear(); selState.clear(); selCampaigns.clear();
    syncAndRender();
  });
  await page.waitForTimeout(800);

  // 展开所有广告组
  await page.evaluate(() => {
    document.querySelectorAll('#adgroupBody .grp-row').forEach(row => {
      if (row.dataset.open !== '1') toggleGroupDetail(row);
    });
  });
  await page.waitForTimeout(600);

  // 找到有关键词 "laser engraver machine" 的广告组
  const info = await page.evaluate(() => {
    const rows = document.querySelectorAll('#adgroupBody .grp-row');
    const matches = [];
    rows.forEach(r => {
      const next = r.nextElementSibling;
      const kwSection = next ? next.querySelector('.kw-section') : null;
      if (kwSection) {
        const kws = [];
        kwSection.querySelectorAll('.kw-row').forEach(kr => {
          const tds = kr.querySelectorAll('td');
          kws.push({ text: tds[1]?.textContent, cost: tds[5]?.textContent });
        });
        matches.push({ adGroup: r.querySelector('td:nth-child(2)')?.textContent, kwCount: kws.length, kws });
      }
    });
    return matches;
  });
  console.log('AdGroups with keywords:', JSON.stringify(info, null, 2));

  // 找到包含 "laser engraver machine" 的广告组，点击展开其第一个关键词
  const found = await page.evaluate(() => {
    const rows = document.querySelectorAll('#adgroupBody .grp-row');
    for (const r of rows) {
      const next = r.nextElementSibling;
      if (!next) continue;
      const kwRows = next.querySelectorAll('.kw-row');
      for (const kr of kwRows) {
        const text = kr.querySelector('td:nth-child(2)')?.textContent;
        if (text && text.includes('laser engraver machine')) {
          // 展开这个关键词
          toggleKwDetail(kr);
          return { found: true, adGroup: r.querySelector('td:nth-child(2)')?.textContent, keyword: text };
        }
      }
    }
    return { found: false };
  });
  console.log('Found:', JSON.stringify(found));

  if (found.found) {
    await page.waitForTimeout(400);
    // 截图
    await page.screenshot({ path: 'screenshot_kw_debug.png', fullPage: false });
    console.log('screenshot saved');
  }

  await browser.close();
})();
