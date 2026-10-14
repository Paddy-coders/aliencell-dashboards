// 只操作当前 frame, 避免跨域
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

  await page.evaluate(() => {
    const app = document.querySelector('#app');
    const vue = app && (app.__vue__ || app._vnode?.component?.proxy);
    if (vue && vue.$router) {
      vue.$router.push('/m_69809');
      return 'router_push';
    }
    window.location.hash = '#/m_69809';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return 'hash_change';
  });
  await page.waitForTimeout(20000);

  console.log('URL:', page.url());
  for (const f of page.frames()) console.log('FRAME:', (f.url() || '').slice(0, 200));

  const relevant = reqs.filter(r => r.url.includes('netapi') || r.url.includes('api') || r.body.includes('actiontype'));
  console.log('相关请求:', relevant.length);
  for (const r of relevant.slice(-20)) {
    console.log('[' + r.method + ']', r.url);
    try { const b = JSON.parse(r.body); console.log('  actiontype:', b.actiontype, 'Filter:', JSON.stringify(b.Content?.Filter)); } catch (e) { console.log('  body:', r.body.slice(0, 200)); }
  }
  await page.screenshot({ path: 'ad_manage_vue2.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
