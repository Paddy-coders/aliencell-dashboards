// 监听点击"广告管理"后的弹窗与URL变化, 定位广告管理页面
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

  ctx.on('page', p => {
    console.log('[popup] 新页面出现:', p.url().slice(0, 120));
    p.on('domcontentloaded', () => console.log('[popup] domcontentloaded:', p.url().slice(0, 160)));
  });

  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);

  try { await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click(); } catch (e) {}
  await page.waitForTimeout(3000);

  // 检查菜单项的跳转目标: 从 Vue 实例或 DOM 中找广告管理菜单的 href / 点击处理
  const menuInfo = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.entry-menus-item').forEach(el => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t.includes('广告管理') || t.includes('广告首页') || t.includes('广告概况') || t.includes('广告明细')) {
        out.push({
          text: t.slice(0, 30),
          cls: (el.className || '').toString(),
          html: el.outerHTML.slice(0, 400),
          hasChild: el.children.length
        });
      }
    });
    return out;
  });
  console.log('\n--- 广告菜单项 outerHTML ---');
  menuInfo.forEach(m => console.log(m.text, '\n ', m.html, '\n'));

  // 点击"广告明细"(可能是广告报表明细, 含关键词/投放词)
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告明细');
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK:广告明细';
  });
  console.log('2. 点击 广告明细 ->', clicked);

  // 轮询页面 URL 变化 15 秒
  console.log('\n--- 轮询页面状态 15s ---');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(3000);
    const ps = ctx.pages().map(p => p.url().slice(0, 150));
    const fs = page.frames().map(f => (f.url() || '').slice(0, 130)).filter(u => u && !u.startsWith('about:'));
    console.log(`t+${(i + 1) * 3}s pages=${JSON.stringify(ps)}`);
    console.log(`        frames=${JSON.stringify(fs.slice(0, 4))}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
