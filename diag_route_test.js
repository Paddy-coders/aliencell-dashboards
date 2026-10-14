// 诊断2: 验证 page.route 拦截改写是否生效 (与 fetch_daily_data.js 相同的拦截逻辑)
// 目标日期 2026-08-19, 全部13账号 → 若生效, 响应行应全部 date=2026-08-19 且站点数=13
const { chromium } = require('playwright');

const ALL_ACCOUNTS = [
  'Aliencell_Direct_BE','Aliencell_Direct_CA','Aliencell_Direct_DE','Aliencell_Direct_ES',
  'Aliencell_Direct_FR','Aliencell_Direct_IE','Aliencell_Direct_IT','Aliencell_Direct_MX',
  'Aliencell_Direct_NL','Aliencell_Direct_PL','Aliencell_Direct_SE','Aliencell_Direct_UK','Aliencell_Direct_US'
];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  let page = null;
  const eccPages = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) eccPages.push(p);
  }
  page = eccPages.find(p => !p.url().includes('/login')) || eccPages[0];
  if (page.url().includes('/login')) { console.log('未登录'); process.exit(1); }

  let frame = page.frames().find(f => f.url().includes('businessReportNew'));
  if (!frame) { console.log('无业务报告frame'); process.exit(1); }

  // 与 fetch_daily_data.js 完全一致的拦截
  const TARGET = '2026-08-19';
  let bizStart = TARGET + ' 00:00:00';
  let bizEnd = TARGET + ' 23:59:59';
  let intercepted = 0;
  await page.route('**/traffic/list', async (route) => {
    const req = route.request();
    try {
      if (req.method() === 'POST' && req.postData()) {
        const data = JSON.parse(req.postData());
        data.pageSize = 1000;
        data.user_account = ALL_ACCOUNTS;
        data.date_start = bizStart;
        data.date_end = bizEnd;
        intercepted++;
        await route.continue({ postData: JSON.stringify(data) });
        return;
      }
    } catch (e) {}
    await route.continue();
  });

  const results = [];
  page.on('response', async (resp) => {
    if (!resp.url().includes('/traffic/list')) return;
    try {
      const j = JSON.parse(await resp.text());
      if (j && Array.isArray(j.data)) {
        const dates = [...new Set(j.data.map(r => r.date))];
        const sites = [...new Set(j.data.map(r => r.site || r.user_account))];
        results.push({ n: j.data.length, dates, sites: sites.length, siteList: sites.slice(0, 15) });
      } else {
        results.push({ n: -1, raw: JSON.stringify(j).slice(0, 200) });
      }
    } catch (e) {}
  });

  await frame.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if ((b.textContent || '').replace(/\s/g, '') === '搜索') { b.click(); return true; }
    }
  });
  await page.waitForTimeout(10000);
  await page.unroute('**/traffic/list');

  console.log('拦截改写次数:', intercepted);
  console.log('捕获响应数:', results.length);
  results.forEach((r, i) => console.log(`响应#${i + 1}:`, JSON.stringify(r)));
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
