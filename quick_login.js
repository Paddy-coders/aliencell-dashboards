// 直接在当前浏览器登录页填写表单并登录
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();
  console.log('当前URL:', page.url());

  // 如果已经在登录页，填写表单
  if (page.url().includes('/login')) {
    await page.fill('input[name="username"], input[placeholder*="用户名"], input[placeholder*="账号"]', 'YY-Paddy');
    await page.fill('input[name="password"], input[type="password"]', 'YY1688...');
    // 点击登录按钮（排除 ERP1.0 按钮）
    const btn = page.locator('.home-ant-btn-primary').filter({ hasText: /^登录$/ }).first();
    if (await btn.count()) {
      await btn.click();
      console.log('已点击登录按钮');
    } else {
      // 兜底
      await page.click('button:has-text("登录")');
    }
    await page.waitForTimeout(10000);
    console.log('登录后 URL:', page.url());
    await page.screenshot({ path: 'login_result.png', timeout: 15000 });
  } else {
    console.log('不在登录页');
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
