// 捕获点击"广告管理"时的所有网络请求(含菜单配置) + 弹窗URL; 并尝试带token访问广告模块
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  await page.bringToFront();

  // 捕获所有 XHR/fetch 请求
  const reqs = [];
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'xhr' || t === 'fetch') {
      reqs.push({ url: req.url().slice(0, 180), method: req.method() });
    }
  });
  ctx.on('request', req => {
    const t = req.resourceType();
    if ((t === 'xhr' || t === 'fetch') && req.url().includes('eccang') && req.url().includes('menu')) {
      reqs.push({ url: req.url().slice(0, 200), method: req.method(), note: 'menu-related' });
    }
  });

  // 监听弹窗
  ctx.on('page', p => {
    console.log('[新页面]', p.url().slice(0, 100));
    setTimeout(async () => {
      try {
        console.log('[新页面10s后]', p.url().slice(0, 200));
      } catch (e) {}
    }, 10000);
  });

  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);
  try { await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click(); } catch (e) {}
  await page.waitForTimeout(3000);

  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告管理');
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  });
  console.log('点击广告管理:', clicked);
  await page.waitForTimeout(10000);

  console.log('\n--- 捕获的请求(menu相关) ---');
  const menuReqs = reqs.filter(r => r.note || /menu/i.test(r.url));
  menuReqs.slice(0, 15).forEach(r => console.log(' ', r.method, r.url));

  console.log('\n--- 页面状态 ---');
  for (const p of ctx.pages()) {
    console.log(' PAGE:', p.url().slice(0, 160));
  }
  const fs = page.frames().map(f => (f.url() || '').slice(0, 150)).filter(u => u && !u.startsWith('about:'));
  console.log(' FRAMES:', JSON.stringify(fs.slice(0, 6)));

  // 尝试带 token 访问广告模块
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  console.log('\nTOKEN 前20位:', token ? token.slice(0, 20) + '...' : '无');
  const p2 = await ctx.newPage();
  try {
    await p2.goto('https://amz-ad.eccang.com/?token=' + encodeURIComponent(token || ''), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('warn:', e.message));
    await p2.waitForTimeout(8000);
    console.log('带token访问 amz-ad:', p2.url().slice(0, 160));
    const t = await p2.evaluate(() => (document.body.innerText || '').slice(0, 200)).catch(() => '(eval fail)');
    console.log('BODY:', JSON.stringify(t));
    await p2.screenshot({ path: 'amz_ad_token.png', timeout: 15000 }).catch(() => {});
  } catch (e) { console.log('带token访问 ERR', e.message); }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
