// 精确登录：填写表单后按Enter提交
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

  // 先查找"登录"按钮
  const btnInfo = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, a, input[type="submit"], div[role="button"]')];
    return all.filter(e => (e.textContent || '').trim() === '登录').map(e => ({
      tag: e.tagName,
      className: e.className,
      id: e.id,
      type: e.type
    }));
  });
  console.log('登录按钮:', JSON.stringify(btnInfo));

  // 填写表单
  await page.fill('#userName', 'YY-Paddy');
  await page.fill('#password', 'YY1688...');
  await sleep(500);

  // 如果有登录按钮就点击，否则按Enter
  if (btnInfo.length > 0) {
    const sel = btnInfo[0].id ? `#${btnInfo[0].id}` : btnInfo[0].className ? `.${btnInfo[0].className.split(' ').join('.')}` : 'button';
    await page.click(sel);
  } else {
    await page.keyboard.press('Enter');
  }

  await sleep(10000);
  console.log('登录后 URL:', page.url());
  await page.screenshot({ path: 'login_success.png', timeout: 15000 });

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
