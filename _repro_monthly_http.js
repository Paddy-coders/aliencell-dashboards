// 诊断: 为什么 http 下的 monthly.html 里 selChannel 不可见（file:// 下正常）—— 不入回归
const { chromium } = require('./playwright-auth');
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
  await ctx.addInitScript(([woot]) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(woot));
  }, [[{ start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
        metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } }]]);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  const reqs = []; page.on('request', r => { if (!/\.(png|jpg|svg|ico)$/.test(r.url())) reqs.push(r.url()); });
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  for (const url of ['http://127.0.0.1:8896/monthly.html', 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/monthly.html']) {
    errs.length = 0; reqs.length = 0;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const g = (n) => { try { return typeof eval(n); } catch (e) { return 'THROW:' + e.name; } };
      return {
        url: location.href.slice(-40),
        selChannel: g('selChannel'), ROWS: g('ROWS'), aggMonth: g('aggMonth'),
        filteredRows: g('filteredRows'), wootUnitCost: g('wootUnitCost'), renderAll: g('renderAll'),
        myWootCost: g('wootCostFromMap'), profitOf: g('profitOf'),
        rowsLen: (function () { try { return eval('ROWS.length'); } catch (e) { return 'n/a'; } })(),
        bodyHasLogin: document.body.innerText.includes('登录'),
      };
    });
    console.log('\n== ' + url.slice(0, 50) + ' ==');
    console.log(JSON.stringify(info, null, 1));
    console.log('pageerror:', errs.slice(0, 4));
    console.log('请求:', reqs.slice(0, 6));
  }
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
