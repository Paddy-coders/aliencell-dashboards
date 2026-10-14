// 直接导航到广告管理页面 m_69809, 监听所有请求并截图
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
    if (url.includes('eccang.com') || url.includes('selmuch')) {
      let body = '';
      try { body = req.postData() || ''; } catch (e) {}
      reqs.push({ url: url.slice(0, 200), body: body.slice(0, 3000), method: req.method() });
    }
  });

  const target = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809';
  console.log('导航到', target);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);

  console.log('URL:', page.url());
  await page.screenshot({ path: 'ad_manage_m69809.png' });

  // 过滤出可能相关的请求
  const relevant = reqs.filter(r => r.url.includes('netapi') || r.url.includes('api') || r.url.includes('rest') || r.body.includes('actiontype'));
  console.log('\n=== 相关请求 (' + relevant.length + ') ===');
  for (const r of relevant.slice(-30)) {
    console.log('[' + r.method + ']', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || '(无)');
      console.log('  Filter:', JSON.stringify(b.Content?.Filter || {}));
      console.log('  Attributes前10:', (b.Content?.Attributes || []).slice(0, 10).join(','));
    } catch (e) { console.log('  body:', r.body.slice(0, 300)); }
    console.log('---');
  }

  // 读取 iframe 内容
  for (const f of page.frames()) {
    const u = f.url();
    if (u && !u.includes('home.eccang.com') && u.includes('eccang')) {
      console.log('\nFRAME:', u.slice(0, 200));
      try {
        const txt = await f.evaluate(() => document.body.innerText.slice(0, 2000));
        const lines = txt.split('\n').map(l => l.trim()).filter(l => l && l.length <= 20).slice(0, 40);
        console.log('  文本:', JSON.stringify(lines));
      } catch (e) { console.log('  fail:', e.message); }
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
