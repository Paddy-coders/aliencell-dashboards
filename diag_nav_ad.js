// 通过 home 页面 iframe 导航到广告管理，观察自然跳转过程
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  // 找已登录的 home 页面
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com/entry')) { page = p; break; } }
  if (!page) { console.log('NO HOME PAGE'); await browser.close(); return; }

  // 导航到广告管理（selmuch-web 内的路由）
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(12000);
  console.log('最终URL:', page.url().slice(0, 180));

  // 如果仍在 home 域，看 iframe
  if (page.url().includes('home.eccang.com')) {
    const fr = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      return f ? { src: f.src, id: f.id, cls: f.className } : null;
    }).catch(() => null);
    console.log('iframe:', JSON.stringify(fr));
  }

  // 检查页面内 amz-ad 链接
  const links = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.href).filter(h => h.includes('amz-ad')).slice(0, 5)).catch(() => []);
  console.log('amz-ad links:', links);

  await page.screenshot({ path: 'home_ad_nav.png', fullPage: false });

  // 另：尝试直接在新标签页打开 amz-ad 的某个已知路径（也许 token 需通过 cookie 而非 URL 参数）
  const ap = await ctx.newPage();
  await ap.goto('https://amz-ad.eccang.com/#/keywordsfororders', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto2 warn:', e.message));
  await ap.waitForTimeout(5000);
  const tk = await ap.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; } }).catch(() => null);
  console.log('直接访问 amz-ad 首页 token:', tk ? 'OK' : 'NULL', 'URL:', ap.url().slice(0, 120));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
