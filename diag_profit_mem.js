// 诊断: 逐日抓取时内存增长情况
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 120000);

function mem() { const m = process.memoryUsage(); return 'heap=' + (m.heapUsed / 1048576).toFixed(0) + 'MB rss=' + (m.rss / 1048576).toFixed(0) + 'MB'; }

(async () => {
  console.log('start', mem());
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  console.log('after cdp', mem());
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  let page = pages.find(p => p.url().includes('eccang.com'));
  if (!page || !page.url().includes('profit_system')) {
    await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/profit_system#/ps/profit-statement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(8000);
  }
  const TOKEN = await Promise.race([
    page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value || ''; } catch (e) { return ''; } }),
    sleep(8000).then(() => '')
  ]);
  console.log('token ok', mem());
  const req = page.context().request;
  console.log('after request ctx', mem());

  const mkBody = (start, end) => ({
    selectOptionsConditionList: [
      { selectType: 'site', selectValue: [] }, { selectType: 'userAccount', selectValue: [] },
      { selectType: 'transactionStatus', selectValue: [] }, { selectType: 'category', selectValue: [] },
      { selectType: 'sellerStatus', selectValue: [] }, { selectType: 'sellerUser', selectValue: [] },
      { selectType: 'isLowPrice', selectValue: [] }, { selectType: 'tags', selectValue: [] }
    ],
    inputOptionsConditionList: [{ inputType: 'asin', inputValue: [] }, { inputType: 'brand', inputValue: [] }],
    timeCondition: { timeType: 'dateTime', startTime: start + ' 00:00:00', endTime: end + ' 23:59:59' },
    dateType: 'd', currencyCode: 'ORIGINAL', pageNo: 1, pageSize: 500,
    timeArea: 'SITE', profitFormulaType: 1, costType: '1', chargeType: 'ord', dimension: 'ctm', parentAsin: 0
  });

  const days = ['2026-06-23', '2026-06-24', '2026-06-25', '2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15', '2026-09-30', '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-09'];
  for (const d of days) {
    const t0 = Date.now();
    const r = await req.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
      headers: { 'Content-Type': 'application/json', 'authorization': TOKEN, 'x-access-token': TOKEN, 'company': 'ntvb7tr' },
      data: mkBody(d, d), timeout: 60000
    });
    const txt = await r.text();
    let n = -1;
    try { const j = JSON.parse(txt); n = j.data && j.data.records ? j.data.records.length : -1; } catch (e) {}
    console.log(d, 'status=' + r.status(), 'bytes=' + txt.length, 'rows=' + n, (Date.now() - t0) + 'ms', mem());
    await sleep(120);
  }
  // 连续 60 次同一天, 看是否线性增长(泄漏)
  console.log('--- 重复同一天 30 次 ---');
  for (let i = 0; i < 30; i++) {
    const r = await req.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
      headers: { 'Content-Type': 'application/json', 'authorization': TOKEN, 'x-access-token': TOKEN, 'company': 'ntvb7tr' },
      data: mkBody('2026-09-15', '2026-09-15'), timeout: 60000
    });
    const txt = await r.text();
    if (i % 5 === 0) console.log('iter', i, 'bytes=' + txt.length, mem());
    await sleep(80);
  }
  await b.close().catch(() => {});
  console.log('done', mem());
  process.exit(0);
})().catch(e => { console.log('ERR', e.message, mem()); process.exit(1); });
