// 新开标签页直接进入广告管理 m_69809，全上下文监听请求
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const reqs = [];
  // 监听整个上下文的所有请求
  ctx.on('request', req => {
    const url = req.url();
    let body = '';
    try { body = req.postData() || ''; } catch (e) {}
    if (url.includes('netapi') || body.includes('actiontype') || url.includes('Ad') || url.includes('ad.') || url.includes('amz')) {
      reqs.push({ url, body, headers: req.headers() });
    }
  });

  const page = await ctx.newPage();
  const target = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809';
  console.log('新标签页导航:', target);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(20000);

  console.log('页面URL:', page.url());
  await page.screenshot({ path: 'probe_newtab.png', fullPage: false });

  console.log('\n=== 捕获请求总数:', reqs.length, '===');
  const seen = new Set();
  for (const r of reqs) {
    let at = '?';
    let filter = '';
    let attrs = '';
    try {
      const b = JSON.parse(r.body);
      at = r.headers['actiontype'] || b.actiontype || '(header无actiontype)';
      filter = JSON.stringify(b.Content?.Filter || {}).slice(0, 500);
      attrs = (b.Content?.Attributes || []).slice(0, 15).join(',');
    } catch (e) {}
    const key = at + '|' + attrs.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('\n[POST]', r.url.slice(0, 120));
    console.log('  actiontype:', at);
    console.log('  Attributes:', attrs);
    console.log('  Filter:', filter);
    console.log('  body前600:', r.body.slice(0, 600));
  }

  // 所有frame
  console.log('\n=== FRAMES ===');
  for (const f of page.frames()) {
    console.log(' -', f.url().slice(0, 150));
  }

  await page.close();
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
