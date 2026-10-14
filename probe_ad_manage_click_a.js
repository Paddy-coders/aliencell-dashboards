// 点击广告管理内部 <a> 元素, 同时监听所有 frame 的请求
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

  // 点击"广告"标签
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) tab.click();
  });
  await page.waitForTimeout(3000);

  // 点击"广告管理"内部的 a 元素
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .entry-menus-item')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) {
      const a = it.querySelector('a');
      if (a) { a.click(); return 'clicked_a'; }
      it.click(); return 'clicked_div';
    }
    return 'not_found';
  });
  await page.waitForTimeout(20000);

  console.log('URL:', page.url());

  // dump frames
  console.log('\n=== frames ===');
  for (const f of page.frames()) {
    console.log('FRAME:', (f.url() || '').slice(0, 200));
  }

  // 过滤相关请求
  const relevant = reqs.filter(r => r.url.includes('netapi') || r.url.includes('api') || r.body.includes('actiontype'));
  console.log('\n=== 相关请求 (' + relevant.length + ') ===');
  for (const r of relevant.slice(-30)) {
    console.log('[' + r.method + ']', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || '(无)');
      console.log('  Filter:', JSON.stringify(b.Content?.Filter || {}));
      console.log('  Attributes:', (b.Content?.Attributes || []).slice(0, 10).join(','));
    } catch (e) { console.log('  body:', r.body.slice(0, 300)); }
    console.log('---');
  }

  // 对广告管理 iframe 截图和读取状态文本
  for (const f of page.frames()) {
    const u = f.url();
    if (u && u.includes('amz') && u.includes('ad')) {
      console.log('\n广告 iframe:', u.slice(0, 200));
      try {
        await f.page().screenshot({ path: 'ad_manage_iframe.png' });
        const txt = await f.evaluate(() => document.body.innerText.slice(0, 3000));
        const lines = txt.split('\n').map(l => l.trim()).filter(l => l && l.length <= 20).slice(0, 50);
        console.log('  文本:', JSON.stringify(lines));
      } catch (e) { console.log('  fail:', e.message); }
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
