// 点击广告管理后, 全面dump所有frame和请求
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi')) {
      let body = '';
      try { body = req.postData() || ''; } catch (e) {}
      reqs.push({ url: url.slice(0, 150), body: body.slice(0, 2000) });
    }
  });

  // 直接点击"广告管理" (当前可能已在广告tab)
  const menuClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item, .entry-menus-item')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) { it.click(); return true; }
    return false;
  });
  console.log('广告管理点击:', menuClicked);
  await page.waitForTimeout(20000);

  // dump 所有 pages 的 url 和 frames
  console.log('\n=== 所有页面 ===');
  for (const p of ctx.pages()) console.log('PAGE:', p.url().slice(0, 150));
  console.log('\n=== 当前页所有 frame ===');
  for (const f of page.frames()) {
    console.log('FRAME:', (f.url() || '').slice(0, 200));
  }
  console.log('\n=== netapi 请求 (' + reqs.length + ') ===');
  for (const r of reqs.slice(-25)) {
    console.log('URL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || '(无)');
      console.log('  Filter:', JSON.stringify(b.Content?.Filter || {}));
      console.log('  Attributes:', (b.Content?.Attributes || []).join(','));
    } catch (e) { console.log('  body(raw):', r.body); }
    console.log('---');
  }
  await page.screenshot({ path: 'ad_manage_live3.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
