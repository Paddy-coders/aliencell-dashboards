// 直接在浏览器中导航到广告模块, 等待JS跳转, 观察最终页面与网络请求
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });

  const newPage = await ctx.newPage();
  const reqs = [];
  newPage.on('request', req => {
    const u = req.url();
    if (u.includes('netapi') || u.includes('amz-ad')) reqs.push({ url: u.slice(0, 160), at: req.headers()['actiontype'] || '' });
  });

  const targetUrl = 'https://amz-ad.eccang.com/?resource=sso&token=' + encodeURIComponent(token || '');
  console.log('导航到:', targetUrl.slice(0, 120));
  await newPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await newPage.waitForTimeout(15000);
  console.log('最终URL:', newPage.url().slice(0, 160));
  console.log('TITLE:', await newPage.title().catch(() => ''));
  const body = await newPage.evaluate(() => (document.body.innerText || '').slice(0, 300)).catch(() => '(eval fail)');
  console.log('BODY:', JSON.stringify(body));

  // 尝试在广告模块内路由到关键词页面
  await newPage.evaluate(() => {
    if (window.$router) window.$router.push('/adtargetingkwd').catch(()=>{});
    // vue-router 3 常用挂载方式
    for (const k of Object.keys(window)) {
      const v = window[k];
      if (v && v.$router) { v.$router.push('/adtargetingkwd').catch(()=>{}); break; }
    }
  });
  await newPage.waitForTimeout(8000);
  console.log('路由后URL:', newPage.url().slice(0, 160));
  const body2 = await newPage.evaluate(() => (document.body.innerText || '').slice(0, 300)).catch(() => '(eval fail)');
  console.log('BODY2:', JSON.stringify(body2));

  console.log('netapi reqs:', JSON.stringify(reqs.slice(0, 15)));
  await newPage.screenshot({ path: 'amz_ad_loggedin.png', timeout: 15000 }).catch(() => {});
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
