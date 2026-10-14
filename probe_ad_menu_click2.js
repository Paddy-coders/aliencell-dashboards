// 点击广告标签 → 展开菜单 → 点击下拉菜单中的广告管理链接
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const reqs = [];
  ctx.on('request', req => {
    const url = req.url();
    let body = '';
    try { body = req.postData() || ''; } catch (e) {}
    if (url.includes('netapi') || body.includes('actiontype') || url.includes('amz-ad')) {
      reqs.push({ url, body, headers: req.headers() });
    }
  });

  // 先确保菜单收起（任意点击空白）
  await page.click('body', { position: { x: 10, y: 10 } });
  await page.waitForTimeout(500);

  console.log('点击广告标签...');
  // 点击顶部导航栏"广告"
  const adNav = await page.$('ul.el-menu >> text=广告');
  if (adNav) await adNav.click(); else await page.click('text=广告');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'step1_menu.png' });

  // 点击下拉菜单中的"广告管理"——使用 nth 排除顶部标题
  console.log('点击下拉菜单中的广告管理...');
  const links = await page.$$('text=广告管理');
  console.log('找到', links.length, '个广告管理元素');
  // 通常第二个是下拉菜单中的链接（第一个是列头/标题）
  let clicked = false;
  for (let i = 0; i < links.length; i++) {
    const isVisible = await links[i].isVisible();
    console.log('  元素', i, 'visible=', isVisible);
    if (isVisible && !clicked) {
      await links[i].click({ force: true });
      clicked = true;
      console.log('  -> 已点击元素', i);
      break;
    }
  }
  if (!clicked) {
    console.log('没有可见的广告管理，尝试坐标点击');
    await page.click('text=广告管理', { force: true });
  }

  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'step2_ad_manage.png' });

  console.log('页面URL:', page.url());

  // 所有frame
  console.log('\n=== FRAMES ===');
  for (const f of page.frames()) {
    console.log(' -', f.url().slice(0, 150));
  }

  console.log('\n=== 捕获请求总数:', reqs.length, '===');
  for (const r of reqs) {
    let at = '?';
    let filter = '';
    let attrs = '';
    try {
      const b = JSON.parse(r.body);
      at = r.headers['actiontype'] || b.actiontype || '?';
      filter = JSON.stringify(b.Content?.Filter || {}).slice(0, 500);
      attrs = (b.Content?.Attributes || []).slice(0, 15).join(',');
    } catch (e) {}
    console.log('\n[POST]', r.url.slice(0, 120));
    console.log('  actiontype:', at);
    console.log('  Attributes:', attrs);
    console.log('  Filter:', filter);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
