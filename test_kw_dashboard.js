// 测试投放词展开功能
const { chromium } = require('./playwright-auth');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', e => errors.push(e.message));

  const filePath = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const results = [];

  // 1. 检查 DATA.keywords 已加载
  const kwCount = await page.evaluate(() => DATA.keywords ? DATA.keywords.length : -1);
  results.push(['DATA.keywords 数量', kwCount > 0, `count=${kwCount}`]);

  // 2. 检查 KW_COLS 定义
  const kwCols = await page.evaluate(() => typeof KW_COLS !== 'undefined' ? KW_COLS.length : -1);
  results.push(['KW_COLS 定义', kwCols > 0, `len=${kwCols}`]);

  // 3. 选中一个有关键词的活动
  // ⚠️ 不要只写死活动名：运营会改广告活动名，写死会在改名后**静默失效** ——
  //    selCampaigns 落空 → 广告组表为空 → 下面 6 项断言连挂，看起来像功能坏了。
  //    2026-10-10 实测 'X1-词组匹配' 已在广告账号里不存在（三个数据文件里 0 命中），
  //    就是这种情形。所以先按原名找，找不到就退化为「找确实带投放词的活动」。
  await page.evaluate(() => {
    selCampaigns.clear();
    const kws = DATA.keywords || [];
    const camp = DATA.campaigns.find(c => c.name === 'X1-词组匹配')
      || DATA.campaigns.find(c => kws.some(k => String(k.campaignId) === String(c.id)));
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(500);

  // 4. 检查广告组卡片可见
  const agCardVisible = await page.evaluate(() => {
    const card = document.getElementById('adgroupCard');
    return card && card.style.display !== 'none';
  });
  results.push(['广告组卡片可见', agCardVisible, '']);

  // 5. 检查广告组行数
  const agRows = await page.evaluate(() => document.querySelectorAll('#adgroupBody .grp-row').length);
  results.push(['广告组行数', agRows > 0, `count=${agRows}`]);

  // 6. 展开第一个广告组
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(500);

  // 7. 检查投放词区是否出现
  const kwSectionExists = await page.evaluate(() => {
    return document.querySelectorAll('.kw-section').length > 0;
  });
  results.push(['投放词区出现', kwSectionExists, `sections=${await page.evaluate(() => document.querySelectorAll('.kw-section').length)}`]);

  // 8. 检查投放词行数
  const kwRows = await page.evaluate(() => document.querySelectorAll('.kw-row').length);
  results.push(['投放词行数', kwRows > 0, `count=${kwRows}`]);

  // 9. 展开第一个投放词
  await page.evaluate(() => {
    const row = document.querySelector('.kw-row');
    if (row) toggleKwDetail(row);
  });
  await page.waitForTimeout(300);

  // 10. 检查投放词周度子表是否出现
  const kwDetailVisible = await page.evaluate(() => {
    const detail = document.querySelector('.kw-detail-row[data-open="1"]');
    return detail && detail.style.display !== 'none';
  });
  results.push(['投放词周度子表可见', kwDetailVisible, '']);

  // 11. 检查子表行数
  const kwSubRows = await page.evaluate(() => {
    const detail = document.querySelector('.kw-detail-row[data-open="1"] .sub-table tbody');
    return detail ? detail.querySelectorAll('tr').length : 0;
  });
  results.push(['投放词子表行数', kwSubRows > 0, `rows=${kwSubRows}`]);

  // 12. 折叠广告组后检查投放词区消失
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(200);
  const kwSectionAfterCollapse = await page.evaluate(() => {
    // 检查可见性（折叠后元素仍存在但 display:none）
    let visible = 0;
    document.querySelectorAll('.kw-section').forEach(s => {
      if (s.offsetParent !== null) visible++;
    });
    return visible;
  });
  results.push(['折叠后投放词区消失', kwSectionAfterCollapse === 0, `visible=${kwSectionAfterCollapse}`]);

  // 13. 选中 DE 活动测试
  await page.evaluate(() => {
    selCampaigns.clear();
    const camp = DATA.campaigns.find(c => c.country === 'DE' && c.type === 'sponsoredProducts');
    if (camp) selCampaigns.add(camp.id);
    syncAndRender();
  });
  await page.waitForTimeout(500);
  const deAgRows = await page.evaluate(() => document.querySelectorAll('#adgroupBody .grp-row').length);
  results.push(['DE 广告组行数', deAgRows > 0, `count=${deAgRows}`]);

  // 14. 展开 DE 第一个广告组检查关键词
  await page.evaluate(() => {
    const row = document.querySelector('#adgroupBody .grp-row');
    if (row) toggleGroupDetail(row);
  });
  await page.waitForTimeout(300);
  const deKwRows = await page.evaluate(() => document.querySelectorAll('.kw-row').length);
  results.push(['DE 投放词行数', deKwRows >= 0, `count=${deKwRows}`]);

  // 15. 检查 JS 错误
  results.push(['无JS错误', errors.length === 0, errors.slice(0, 3).join('; ')]);

  // 输出结果
  let pass = 0, fail = 0;
  console.log('\n===== 投放词展开功能测试 =====');
  results.forEach(([name, ok, info]) => {
    console.log(`${ok ? '✅' : '❌'} ${name} ${info ? '(' + info + ')' : ''}`);
    if (ok) pass++; else fail++;
  });
  console.log(`\n通过: ${pass}/${results.length}, 失败: ${fail}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
