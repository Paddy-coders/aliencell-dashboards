// 通过UI打开广告管理页面, 找到"关键词/投放词"子页面并捕获真实API
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

  const apiCalls = [];
  ctx.on('request', req => {
    const u = req.url();
    if (u.includes('netapi')) {
      const at = req.headers()['actiontype'] || '';
      let attrs = '';
      try { const b = JSON.parse(req.postData() || '{}'); attrs = (b.Content?.Attributes || []).join(',') || ''; } catch (e) {}
      apiCalls.push({ actiontype: at, attrs: attrs.slice(0, 260) });
    }
  });
  ctx.on('response', async resp => {
    const u = resp.url();
    if (u.includes('netapi')) {
      const at = resp.request().headers()['actiontype'] || '';
      let code = '';
      try { const j = await resp.json(); code = 'ErrCode=' + j.ErrCode + ' items=' + ((j.data && j.data.Items) ? j.data.Items.length : 0); } catch (e) {}
      apiCalls.push({ response: true, actiontype: at, code });
    }
  });

  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);

  // 点击 广告 Tab
  try { await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click(); console.log('1. 点击广告Tab OK'); } catch (e) { console.log('1. 广告Tab FAIL', e.message); }
  await page.waitForTimeout(3000);

  // 点击 广告管理
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告管理');
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  });
  console.log('2. 点击广告管理 ->', clicked);
  await page.waitForTimeout(12000);

  // 列出所有页面与iframe
  console.log('\n--- 所有页面 ---');
  for (const p of ctx.pages()) {
    console.log(' PAGE:', p.url().slice(0, 200));
  }
  let adPage = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('amz-ad') || p.url().includes('ad.eccang')) { adPage = p; break; }
  }
  // 如果广告管理在 iframe 里, 检查当前页 frames
  if (!adPage) {
    console.log('\n--- 主页面 frames ---');
    for (const f of page.frames()) {
      const fu = f.url();
      if (fu && !fu.startsWith('about:')) console.log(' FRAME:', fu.slice(0, 200));
      if (fu.includes('amz-ad') || fu.includes('ad.eccang')) { adPage = page; }
    }
  }
  const target = adPage || page;
  await target.bringToFront().catch(() => {});
  console.log('\n--- 广告管理页面文本 (关键词/投放词相关) ---');
  const txt = await target.evaluate(() => document.body.innerText || '').catch(() => '');
  ['关键词', '投放词', '广告组', '广告活动', '广告', '商品投放', '搜索词'].forEach(k => {
    const idx = txt.indexOf(k);
    console.log(`「${k}」: ${idx >= 0 ? '命中 -> ' + txt.slice(Math.max(0, idx - 25), idx + 45).replace(/\n/g, '|') : '未命中'}`);
  });

  // 找页面内 Tab / 菜单
  const tabs = await target.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="tabs-tab"],[role="tab"],[class*="menu-item"],[class*="tab-item"],[class*="item"] span,[class*="item"]').forEach(el => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 26) out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), text: t });
    });
    return out.slice(0, 80);
  }).catch(() => []);
  console.log('\n--- 广告管理页面 Tab/菜单元素 ---');
  tabs.forEach(t => console.log(`  ${t.tag}.${t.cls} :: ${t.text}`));

  await target.screenshot({ path: 'ad_manage_keyword_probe.png', timeout: 15000 }).catch(() => {});

  // 尝试点击"关键词"或"投放词" Tab
  let kwClicked = null;
  for (const kw of ['关键词', '投放词', '商品投放']) {
    try {
      const el = target.locator(`[class*="tabs-tab"]:has-text("${kw}")`).first();
      if (await el.count()) { await el.click(); kwClicked = kw; console.log(`\n3. 点击「${kw}」Tab OK`); break; }
    } catch (e) {}
  }
  if (!kwClicked) {
    // 备选: 遍历所有元素找精确文本匹配
    kwClicked = await target.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const hits = [];
      let el;
      while ((el = walker.nextNode())) {
        const t = (el.textContent || '').trim();
        if ((t === '关键词' || t === '投放词' || t === '商品投放') && el.children.length <= 2) {
          hits.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 80) });
          el.click();
          return t + ' clicked:' + hits.length;
        }
      }
      return 'NO_MATCH ' + JSON.stringify(hits.slice(0, 5));
    });
    console.log('\n3. 备选点击 ->', kwClicked);
  }
  await page.waitForTimeout(6000);

  console.log('\n--- API 请求捕获 ---');
  apiCalls.forEach(a => {
    if (a.response) console.log(`  RESP [${a.actiontype}] ${a.code}`);
    else console.log(`  REQ  [${a.actiontype}] attrs=${a.attrs}`);
  });

  await target.screenshot({ path: 'ad_manage_keyword_tab.png', timeout: 15000 }).catch(() => {});
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
