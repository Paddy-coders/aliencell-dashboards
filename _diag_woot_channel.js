// _diag_woot_channel.js — 诊断周看板渠道注入后页面 JS 是否正常
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((w) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
  }, [WOOT_DAY]);
  const page = await ctx.newPage();
  const errs = [], consoleErrs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.goto(BASE + '/product.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);

  const d = await page.evaluate(() => {
    const probe = {};
    const grab = (name, fn) => { try { probe[name] = fn(); } catch (e) { probe[name] = 'ERR: ' + e.message; } };
    grab('DATA_typeof', () => typeof DATA);
    grab('windowDATA', () => typeof window.DATA);
    grab('METRICS_typeof', () => typeof METRICS);
    grab('selChannel_typeof', () => typeof selChannel);
    grab('windowSelChannel', () => typeof window.selChannel);
    grab('CHANNELS', () => typeof CHANNELS);
    grab('asinWeekData', () => typeof asinWeekData);
    grab('_asinWeekDataAll', () => typeof window._asinWeekDataAll);
    grab('ddExists', () => !!document.getElementById('ddChannel'));
    grab('firstBarChild', () => { const b = document.querySelector('.filter-bar'); return b && b.firstChild ? (b.firstChild.id || b.firstChild.tagName + '.' + b.firstChild.className) : null; });
    grab('wootPartsKeys', () => { try { return Object.keys(DATA.wootParts || {}).length; } catch (e) { return 'ERR:' + e.message; } });
    grab('scriptTags', () => [...document.querySelectorAll('script')].map(s => (s.type || 'classic') + ':' + (s.src ? 'src' : 'inline')).slice(0, 10));
    return probe;
  });
  console.log('=== probe ===');
  console.log(JSON.stringify(d, null, 1));
  console.log('=== page errors (' + errs.length + ') ===');
  errs.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 400)));
  console.log('=== console errors (' + consoleErrs.length + ') ===');
  consoleErrs.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 300)));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
