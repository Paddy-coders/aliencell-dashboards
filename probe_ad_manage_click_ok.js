// 点击广告标签 → 点击下拉菜单中的广告管理链接（精确class）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('iframe#/m_69809')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();

  const reqs = [];
  ctx.on('request', req => {
    const url = req.url();
    let body = '';
    try { body = req.postData() || ''; } catch (e) {}
    if (url.includes('netapi') || body.includes('actiontype') || url.includes('amz-ad')) {
      reqs.push({ url, body, headers: req.headers() });
    }
  });

  console.log('点击广告标签...');
  await page.click('.home-ant-tabs-tab:has-text("广告")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'click_ad.png' });

  console.log('点击广告管理链接...');
  await page.click('.entry-layout-menus-item__text--link:has-text("广告管理")');
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'click_admanage.png' });

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
