// 在主页面源码中搜索 m_69809 的路由映射和广告相关 JS
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const html = await page.evaluate(() => document.documentElement.outerHTML);
  // 搜索 m_69809
  const idx = html.indexOf('m_69809');
  console.log('m_69809 位置:', idx, '附近:', html.slice(Math.max(0, idx-200), idx+300));

  // 搜索广告相关的路由配置
  const adMatches = [];
  const re = /["']m_\d+["'][^>]*>[^<]*广告/g;
  let m;
  while ((m = re.exec(html)) !== null) adMatches.push(m[0]);
  console.log('广告路由匹配:', adMatches.slice(0, 10));

  // 搜索 script src 中包含 ad 或 amz 的
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script')].map(s => s.src).filter(Boolean));
  const adScripts = scripts.filter(s => /ad|amz|advert/i.test(s));
  console.log('广告相关脚本:', adScripts.slice(0, 10));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
