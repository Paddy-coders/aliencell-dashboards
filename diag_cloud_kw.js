const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('JS ERROR:', e.message); });
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text().slice(0, 200)));
  await page.goto('https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link/ad.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 选 X1-词组匹配
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

  const diag = await page.evaluate(() => {
    const kwRows = document.querySelectorAll('.kw-row');
    const kwDetailRows = document.querySelectorAll('.kw-detail-row');
    // 获取每个关键词的文本和聚合花费
    const kws = [];
    kwRows.forEach((r, i) => {
      const tds = r.querySelectorAll('td');
      const text = tds[1]?.textContent || '';
      const cost = tds[5]?.textContent || '';
      kws.push({ idx: i, text: text.slice(0, 30), cost });
    });
    // 获取第一个详情行的完整HTML
    const firstDetail = kwDetailRows[0];
    let fullHtml = '';
    if (firstDetail) {
      const cell = firstDetail.querySelector('.kw-detail-cell');
      if (cell) fullHtml = cell.innerHTML;
    }
    return {
      kwRows: kwRows.length,
      kwDetailRows: kwDetailRows.length,
      keywords: kws,
      detailHtmlLength: fullHtml.length,
      detailHtml: fullHtml.slice(0, 2000),
      DATA_keywords_count: DATA.keywords ? DATA.keywords.length : -1,
      DATA_weeks: DATA.weeks.map(w => w.label),
    };
  });
  console.log('DIAG:', JSON.stringify(diag, null, 2));
  console.log('Errors:', errors.length);

  await browser.close();
})();
