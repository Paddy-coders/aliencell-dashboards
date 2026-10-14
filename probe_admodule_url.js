// 直接导航尝试广告模块URL + 真实鼠标点击菜单两种方式
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  await page.bringToFront();

  // 方式A: 尝试访问广告模块常见URL
  for (const u of [
    'https://amz-ad.eccang.com/',
    'https://amz-ad.eccang.com/index.html',
  ]) {
    try {
      const r = await ctx.request.get(u, { timeout: 15000, maxRedirects: 0 });
      console.log(`GET ${u} -> status=${r.status()} location=${r.headers()['location'] || ''}`);
    } catch (e) {
      console.log(`GET ${u} -> ERR ${e.message.slice(0, 100)}`);
    }
  }

  // 方式B: 真实鼠标点击菜单
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_79356', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);
  // 点击 广告 Tab
  try {
    await page.locator('.home-ant-tabs-tab:has-text("广告")').first().hover();
    await page.waitForTimeout(1000);
    await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click();
    console.log('A1. 点击广告Tab OK');
  } catch (e) { console.log('A1. FAIL', e.message); }
  await page.waitForTimeout(3000);

  // 找"广告管理"链接的位置并真实点击
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告管理');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
  });
  console.log('广告管理位置:', JSON.stringify(info));
  if (info && info.visible) {
    await page.mouse.click(info.x, info.y);
    console.log('A2. 鼠标点击 广告管理 OK');
  } else {
    console.log('A2. 广告管理不可见, 尝试点击其父级分组展开');
    const openGroup = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.entry-menus-item__title')];
      const g = groups.find(e => (e.textContent || '').trim() === '广告管理' && e.offsetParent !== null);
      if (g) { g.click(); return 'OK'; }
      return 'NO';
    });
    console.log('展开分组:', openGroup);
    await page.waitForTimeout(2000);
    const info2 = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a.entry-menus-item__title')];
      const el = els.find(e => (e.textContent || '').trim() === '广告管理');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, visible: r.width > 0 && r.height > 0 };
    });
    console.log('展开后位置:', JSON.stringify(info2));
    if (info2 && info2.visible) { await page.mouse.click(info2.x, info2.y); console.log('A2b. 鼠标点击 OK'); }
  }

  // 轮询 URL 变化
  console.log('\n--- 轮询 12s ---');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(3000);
    const ps = ctx.pages().map(p => p.url().slice(0, 140));
    const fs = page.frames().map(f => (f.url() || '').slice(0, 130)).filter(u => u && !u.startsWith('about:'));
    console.log(`t+${(i + 1) * 3}s pages=${JSON.stringify(ps)}`);
    console.log(`        frames=${JSON.stringify(fs.slice(0, 5))}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
