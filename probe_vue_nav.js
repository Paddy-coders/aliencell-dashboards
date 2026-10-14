// 通过 Vue Router 直接导航到广告管理 m_69809
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

  // 尝试通过 Vue Router 导航
  const navResult = await page.evaluate(() => {
    // 找 Vue 根实例
    let app = document.querySelector('#app');
    let vue = app && (app.__vue__ || app._vnode?.component?.proxy);
    if (!vue) {
      for (const key of Object.keys(window)) {
        if (window[key] && window[key].$router) { vue = window[key]; break; }
      }
    }
    if (!vue) {
      // 尝试通过 querySelector 找 router-view 并向上找 Vue 实例
      const rv = document.querySelector('router-view') || document.querySelector('.router-view');
      if (rv) vue = rv.__vue__ || rv._vnode?.component?.proxy;
    }
    if (vue && vue.$router) {
      vue.$router.push('/m_69809');
      return { ok: true, router: true };
    }
    // fallback: 直接改 hash 并触发事件
    window.location.hash = '#/m_69809';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return { ok: true, router: false };
  });
  console.log('导航结果:', navResult);
  await page.waitForTimeout(20000);

  console.log('URL:', page.url());
  console.log('\n=== frames ===');
  for (const f of page.frames()) console.log('FRAME:', (f.url() || '').slice(0, 200));

  const relevant = reqs.filter(r => r.url.includes('netapi') || r.url.includes('api') || r.body.includes('actiontype'));
  console.log('\n=== 相关请求 (' + relevant.length + ') ===');
  for (const r of relevant.slice(-30)) {
    console.log('[' + r.method + ']', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || '(无)');
      console.log('  Filter:', JSON.stringify(b.Content?.Filter || {}));
    } catch (e) { console.log('  body:', r.body.slice(0, 300)); }
    console.log('---');
  }
  await page.screenshot({ path: 'ad_manage_vue_nav.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
