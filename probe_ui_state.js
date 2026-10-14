// 截屏 + 检查页面结构: 店铺选择器/表格/加载状态
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  const url = 'https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(12000);

  // 截图
  await page.screenshot({ path: 'ui_campaign_now.png' }).catch(e => console.log('shot warn:', e.message));

  // 店铺选择器
  const storeSel = await page.locator('.el-select, .ant-select').allInnerTexts().catch(() => []);
  console.log('select元素文本:', storeSel.slice(0, 10));

  // 页面主要文本
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('body文本片段:', bodyText.slice(0, 600).replace(/\n+/g, ' | '));

  // 表格行
  const rows = await page.locator('.el-table__row, .vxe-body--row').count().catch(() => 0);
  console.log('表格行数:', rows);
  const rowText = await page.locator('.el-table__row, .vxe-body--row').first().innerText().catch(() => '');
  console.log('首行:', rowText.slice(0, 200).replace(/\n/g, ' | '));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
