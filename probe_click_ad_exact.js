// 精确点击广告标签（用class）→ 再点击下拉广告管理，监听请求
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

  console.log('点击广告标签(class)...');
  // 使用精确class选择器
  await page.click('.home-ant-tabs-tab:has-text("广告")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'click_ad_tab.png' });

  console.log('点击广告管理...');
  // 下拉菜单里通常第二个广告管理是链接（第一个是列头）
  const adManage = page.locator('text=广告管理').nth(1);
  await adManage.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'click_ad_manage.png' });

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
