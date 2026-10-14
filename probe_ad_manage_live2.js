// 稳健版: 点击"广告"标签 -> 点击"广告管理" -> 监听 netapi 请求 + 读取状态列
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
      reqs.push({ url: url.slice(0, 150), body: body.slice(0, 3000) });
    }
  });

  // 点击"广告"标签
  const tabClicked = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) { tab.click(); return true; }
    return false;
  });
  console.log('广告标签点击:', tabClicked);
  await page.waitForTimeout(4000);

  // 点击"广告管理"菜单
  const menuClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item, .entry-menus-item')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) { it.click(); return true; }
    return false;
  });
  console.log('广告管理点击:', menuClicked);
  await page.waitForTimeout(15000);

  console.log('URL:', page.url());
  await page.screenshot({ path: 'ad_manage_live2.png' });

  console.log('\n=== netapi 请求 (' + reqs.length + '条) ===');
  for (const r of reqs.slice(-20)) {
    console.log('URL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || '(无)');
      console.log('  Filter:', JSON.stringify(b.Content?.Filter || {}));
      console.log('  Attributes:', (b.Content?.Attributes || []).join(','));
    } catch (e) { console.log('  body(raw):', r.body); }
    console.log('---');
  }

  // 读取 iframe 内页面状态
  const frames = page.frames();
  console.log('\niframe 数:', frames.length);
  for (const f of frames) {
    const u = f.url();
    if (u.includes('amz') || u.includes('ad') || u.includes('selmuch')) {
      console.log('  frame:', u.slice(0, 150));
      try {
        const txt = await f.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : '');
        const stateLines = txt.split('\n').map(l => l.trim()).filter(l => /暂停|归档|启用|投放/.test(l)).slice(0, 30);
        console.log('  状态文本:', JSON.stringify(stateLines));
      } catch (e) { console.log('  frame evaluate fail:', e.message); }
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
