// 打开"自研接入流程(ECCANG客户)"文档，抓签名算法说明
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto('https://open.eccang.com/#/documentCenter', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.getByText('接入指南', { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.getByText('自研接入流程(ECCANG客户)', { exact: true }).first().click({ timeout: 6000 }).catch(e => console.log('点击失败:', e.message.split('\n')[0]));
    await page.waitForTimeout(5000);
    const text = await page.evaluate(() => document.body.innerText);
    const idx = text.indexOf('收费');
    console.log(text.slice(idx > 0 ? idx : 0, (idx > 0 ? idx : 0) + 6000));
  } catch (e) {
    console.log('访问失败:', e.message);
  }
  console.log('\nJS错误:', errors.length ? errors : '无');
  await browser.close();
})();
