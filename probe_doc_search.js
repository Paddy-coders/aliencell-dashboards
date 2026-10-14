// 打开「获取销售和流量报告」文档，抓取完整参数说明
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

  await page.goto('https://open.eccang.com/#/documentCenter', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // 搜索
  const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="search"], input[type="text"]').first();
  if (await searchInput.count() > 0) {
    await searchInput.fill('AmazonSalesAndTrafficReport');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }

  // 点击搜索结果「获取销售和流量报告」
  const link = page.locator('text=获取销售和流量报告').first();
  if (await link.count() > 0) {
    await link.click();
    await page.waitForTimeout(5000);
  } else {
    console.log('未找到文档链接，截图诊断');
  }

  // 抓取正文区全部文本
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('=== 文档全文 ===');
  console.log(bodyText.slice(0, 8000));

  await page.screenshot({ path: 'doc_sales_traffic.png', fullPage: true });
  await browser.close();
})();
