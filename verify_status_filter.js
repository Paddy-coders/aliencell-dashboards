// 验证广告状态筛选器
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('file:///' + require('path').resolve('ad_dashboard.html').replace(/\\/g, '/'));
  await page.waitForTimeout(3000);

  // 截图确认状态筛选器存在
  await page.screenshot({ path: 'status_filter_check.png', fullPage: false });
  console.log('截图 status_filter_check.png');

  // 点击状态下拉
  await page.click('#ddStatus .dd-btn');
  await page.waitForTimeout(800);

  // 提取选项文本
  const opts = await page.evaluate(() => {
    return [...document.querySelectorAll('#ddStatusList .dd-opt')].map(el => ({
      text: el.textContent.trim(),
      cls: el.className,
      checked: el.querySelector('input')?.checked
    }));
  });
  console.log('状态选项:', JSON.stringify(opts, null, 1));

  // 统计总记录数(无筛选)
  const totalRows = await page.evaluate(() => document.querySelectorAll('#mainTable tbody tr[data-level="group"]').length);
  console.log('总广告组行数(无筛选):', totalRows);

  // 点击"正在投放"
  const enabledOpt = await page.locator('#ddStatusList .dd-opt').filter({ hasText: /正在投放/ }).first();
  if (await enabledOpt.count()) {
    await enabledOpt.click();
    await page.waitForTimeout(800);
    const rows1 = await page.evaluate(() => document.querySelectorAll('#mainTable tbody tr[data-level="group"]').length);
    console.log('选"正在投放"后广告组行数:', rows1);
  }

  // 点击"已关闭"(应置灰,点击后无变化)
  const disabledOpt = await page.locator('#ddStatusList .dd-opt').filter({ hasText: /已关闭/ }).first();
  if (await disabledOpt.count()) {
    const cls = await disabledOpt.evaluate(el => el.className);
    console.log('已关闭选项 class:', cls);
    await disabledOpt.click();
    await page.waitForTimeout(800);
    const rows2 = await page.evaluate(() => document.querySelectorAll('#mainTable tbody tr[data-level="group"]').length);
    console.log('点击"已关闭"后广告组行数:', rows2);
  }

  await page.close();
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
