const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'eccang_creds.json'), 'utf8'));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const failedReq = [];
  page.on('requestfailed', r => failedReq.push(r.url().slice(0, 120) + ' :: ' + (r.failure()?.errorText || '')));
  const respLog = [];
  page.on('response', r => { if (/login|token|user/i.test(r.url())) respLog.push(r.status() + ' ' + r.url().slice(0, 140)); });

  await page.goto('https://home.eccang.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(5000);

  // 检查所有 primary 按钮
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('.home-ant-btn-primary')].map((b, i) => ({
      i, tag: b.tagName, text: (b.innerText || b.textContent || '').trim().slice(0, 30), visible: !!(b.offsetParent)
    }));
  });
  console.log('primary 按钮:', JSON.stringify(btns));

  // 填表
  await page.fill('#userName', CONFIG.username);
  await page.fill('#password', CONFIG.password);
  await page.locator('#userName').evaluate(el => el.blur()).catch(() => {});
  await page.locator('#password').evaluate(el => el.blur()).catch(() => {});
  await page.waitForTimeout(800);

  // 找"登录"按钮（不限 tag）
  const loginBtn = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-ant-btn-primary, .home-ant-btn')];
    const hit = els.find(e => (e.innerText || '').trim() === '登录');
    return hit ? { tag: hit.tagName, cls: hit.className.slice(0, 80), text: hit.innerText.trim() } : null;
  });
  console.log('登录按钮定位:', JSON.stringify(loginBtn));

  // 点击（用 filter hasText /^登录$/ 于 .home-ant-btn-primary）
  const submitBtn = page.locator('.home-ant-btn-primary').filter({ hasText: /^登录$/ }).first();
  const cnt = await submitBtn.count().catch(() => 0);
  console.log('filter 登录按钮 count:', cnt);
  if (cnt > 0) {
    await submitBtn.click().catch(e => console.log('click err:', e.message));
  } else {
    // 兜底：所有 primary 中非 ERP1.0 的
    const all = page.locator('.home-ant-btn-primary');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const t = await all.nth(i).innerText().catch(() => '');
      if (!t.includes('ERP')) { await all.nth(i).click(); console.log('点击第', i, '个 primary:', t.trim()); break; }
    }
  }
  await page.waitForTimeout(4000);
  console.log('点击后 URL:', page.url().slice(0, 150));
  // 错误提示
  const errText = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-ant-message, .ant-message, .el-message, [class*=error], [class*=Error]')];
    return els.map(e => (e.innerText || '').trim()).filter(t => t && t.length < 120).slice(0, 5);
  }).catch(() => []);
  console.log('错误提示:', JSON.stringify(errText));
  await page.screenshot({ path: 'login_diag2.png', fullPage: false });
  console.log('respLog:', respLog.slice(0, 10));
  console.log('failedReq:', failedReq.slice(0, 5));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
