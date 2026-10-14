// 点击广告标签 → 展开菜单 → 点击下拉菜单中的广告管理（nth选择器）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const reqs = [];
  ctx.on('request', req => {
    const url = req.url();
    let body = '';
    try { body = req.postData() || ''; } catch (e) {}
    if (url.includes('netapi') || body.includes('actiontype') || url.includes('amz-ad')) {
      reqs.push({ url, body, headers: req.headers() });
    }
  });

  // 先关闭可能已展开的菜单
  await page.click('body', { position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  console.log('点击广告标签...');
  await page.click('span:has-text("广告")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 's1_menu.png' });

  console.log('点击广告管理（nth=1）...');
  try {
    const loc = page.locator('text=广告管理').nth(1);
    await loc.click({ force: true, timeout: 5000 });
  } catch (e) {
    console.log('nth=1 失败，尝试nth=0:', e.message);
    const loc = page.locator('text=广告管理').nth(0);
    await loc.click({ force: true, timeout: 5000 });
  }
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 's2_admanage.png' });

  console.log('页面URL:', page.url());
  console.log('\n=== FRAMES ===');
  for (const f of page.frames()) {
    console.log(' -', f.url().slice(0, 150));
  }

  console.log('\n=== 捕获请求总数:', reqs.length, '===');
  for (const r of reqs) {
    let at = '?';
    let filter = '';
    let attrs = '';
    try {
      const b = JSON.parse(r.body);
      at = r.headers['actiontype'] || b.actiontype || '?';
      filter = JSON.stringify(b.Content?.Filter || {}).slice(0, 500);
      attrs = (b.Content?.Attributes || []).slice(0, 15).join(',');
    } catch (e) {}
    console.log('\n[POST]', r.url.slice(0, 120));
    console.log('  actiontype:', at);
    console.log('  Attributes:', attrs);
    console.log('  Filter:', filter);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
