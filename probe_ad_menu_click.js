// 在现有页面点击广告菜单，确认页面切换，并监听请求
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

  // 步骤1: 点击“广告”标签
  console.log('点击广告标签...');
  await page.click('span:has-text("广告")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'step1_click_ad.png' });

  // 步骤2: 查找广告管理并点击
  const adManage = await page.$('span:has-text("广告管理")');
  if (adManage) {
    console.log('点击广告管理...');
    await adManage.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'step2_ad_manage.png' });
  } else {
    console.log('未找到广告管理span');
    // 尝试 <a> 里的span
    const a = await page.$('a:has-text("广告管理")');
    if (a) { await a.click(); await page.waitForTimeout(5000); }
  }

  console.log('页面URL:', page.url());
  await page.screenshot({ path: 'step3_final.png' });

  // 所有frame
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
