const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\\\/g, '/');
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('JS ERROR:', e.message); });
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text().slice(0, 200)));
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 选 X1-词组匹配活动
  await page.evaluate(() => {
    selCampaigns.clear();
    const camp = DATA.campaigns.find(c => c.name === 'X1-词组匹配');
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(800);

  // 展开第一个广告组
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(500);

  // 诊断关键词区
  const diag = await page.evaluate(() => {
    const kwRows = document.querySelectorAll('.kw-row');
    const kwDetailRows = document.querySelectorAll('.kw-detail-row');
    const kwSection = document.querySelector('.kw-section');
    const firstKw = kwRows[0];
    const firstDetail = kwDetailRows[0];
    let detailHtml = '';
    let weeksData = null;
    try {
      if (firstDetail) detailHtml = firstDetail.innerHTML.slice(0, 500);
    } catch(e) {}
    // 检查 DATA.keywords 中第一个关键词的 weeks 格式
    if (DATA.keywords && DATA.keywords[0]) {
      const kw = DATA.keywords[0];
      weeksData = { hasWeeks: !!kw.weeks, keys: kw.weeks ? Object.keys(kw.weeks) : [] };
    }
    return {
      kwRows: kwRows.length,
      kwDetailRows: kwDetailRows.length,
      hasSection: !!kwSection,
      firstDetailHtml: detailHtml,
      firstKwNextSibling: firstKw ? firstKw.nextElementSibling?.className : null,
      weeksData,
      DATA_keywords_count: DATA.keywords ? DATA.keywords.length : -1,
    };
  });
  console.log('DIAG:', JSON.stringify(diag, null, 2));

  // 尝试展开第一个关键词并检查
  await page.evaluate(() => {
    const row = document.querySelector('.kw-row');
    if (row) toggleKwDetail(row);
  });
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const row = document.querySelector('.kw-row');
    const detail = row ? row.nextElementSibling : null;
    return {
      kwClass: row ? row.className : null,
      detailDisplay: detail ? detail.style.display : null,
      detailOpen: detail ? detail.dataset.open : null,
      detailHtml: detail ? detail.innerHTML.slice(0, 500) : null,
    };
  });
  console.log('AFTER:', JSON.stringify(after, null, 2));
  console.log('Errors:', errors.length);

  await browser.close();
})();
