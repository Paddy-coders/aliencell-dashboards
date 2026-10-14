// 尝试点击 ERP 菜单中 "广告明细" 并观察 iframe 加载 + 捕获 netapi 请求
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

  const netapiReqs = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('netapi')) {
      const at = req.headers()['actiontype'] || '';
      let body = '';
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = { raw: String(req.postData()).slice(0, 100) }; }
      netapiReqs.push({ at, url: u.slice(0, 100), body: JSON.stringify(body).slice(0, 300) });
    }
  });

  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69810', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(8000);
  console.log('URL:', page.url().slice(0, 120));

  // 获取所有 iframe URL
  console.log('\nFrames:', JSON.stringify(page.frames().map(f => f.url().slice(0, 120)).filter(u => u)));

  // 点击 广告 Tab
  try { await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click(); } catch (e) {}
  await page.waitForTimeout(3000);

  // 点击 广告明细
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告明细');
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  });
  console.log('点击广告明细:', clicked);
  await page.waitForTimeout(12000);

  console.log('URL after:', page.url().slice(0, 120));
  console.log('Frames after:', JSON.stringify(page.frames().map(f => f.url().slice(0, 120)).filter(u => u)));

  // 检查 iframe 内容
  const framesWithAd = page.frames().filter(f => f.url().includes('amz-ad') || f.url().includes('ad.') || f.url().includes('m_698'));
  console.log('\n广告相关 frames:', framesWithAd.length);
  for (const f of framesWithAd) {
    try {
      const t = await f.evaluate(() => (document.body.innerText || '').slice(0, 250));
      console.log('Frame', f.url().slice(0, 100), '\n  text:', JSON.stringify(t));
    } catch (e) { console.log('Frame', f.url().slice(0, 100), 'eval fail'); }
  }

  await page.screenshot({ path: 'ad_detail_probe.png', timeout: 15000 }).catch(() => {});

  console.log('\nnetapi reqs:', JSON.stringify(netapiReqs.slice(0, 10)));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
