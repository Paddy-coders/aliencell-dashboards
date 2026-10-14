// 关键验证：单日历史数据完整性 + 月仓储费记账月份 + 接口耗时
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 110000);

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  let page = pages.find(p => p.url().includes('eccang.com'));
  if (!page) { console.log('no eccang page'); process.exit(1); }

  // 确保在利润报表页
  if (!page.url().includes('profit_system')) {
    await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/profit_system#/ps/profit-statement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(8000);
  }
  const TOKEN = await Promise.race([
    page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value || ''; } catch (e) { return ''; } }),
    sleep(8000).then(() => '')
  ]);
  if (!TOKEN) { console.log('token 读取失败'); process.exit(1); }
  console.log('token ok, exp 距今(天):', ((1791859235 * 1000 - Date.now()) / 86400000).toFixed(1));

  const req = page.context().request;
  const mkBody = (start, end, pageSize) => ({
    selectOptionsConditionList: [
      { selectType: 'site', selectValue: [] }, { selectType: 'userAccount', selectValue: [] },
      { selectType: 'transactionStatus', selectValue: [] }, { selectType: 'category', selectValue: [] },
      { selectType: 'sellerStatus', selectValue: [] }, { selectType: 'sellerUser', selectValue: [] },
      { selectType: 'isLowPrice', selectValue: [] }, { selectType: 'tags', selectValue: [] }
    ],
    inputOptionsConditionList: [{ inputType: 'asin', inputValue: [] }, { inputType: 'brand', inputValue: [] }],
    timeCondition: { timeType: 'dateTime', startTime: start, endTime: end },
    dateType: 'd', currencyCode: 'ORIGINAL', pageNo: 1, pageSize: pageSize || 300,
    timeArea: 'SITE', profitFormulaType: 1, costType: '1', chargeType: 'ord', dimension: 'ctm', parentAsin: 0
  });
  const q = async (start, end, pageSize) => {
    const t0 = Date.now();
    const r = await req.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
      headers: { 'Content-Type': 'application/json', 'authorization': TOKEN, 'x-access-token': TOKEN, 'company': 'ntvb7tr' },
      data: mkBody(start, end, pageSize), timeout: 60000
    });
    const j = await r.json();
    return { ms: Date.now() - t0, j };
  };
  const sum = (rows) => {
    const s = k => +rows.reduce((a, r) => a + (Number(r[k]) || 0), 0).toFixed(2);
    return { 行数: rows.length, 销售额: s('productSalesTotal'), 佣金: s('sellingFeesTotal'), 配送费: s('fbaFeesTotal'), 广告费: s('otherTransactionFeeTotal'), 成本: s('productCostTotal'), 月仓储: s('fbaMonthStorageFee'), 推广服务: s('couponAndLightningDealFeeTotal'), 服务费: s('serviceFeeTotal'), ERP毛利: s('grossProfitTotal') };
  };

  // 1) 历史单日
  for (const d of ['2026-09-15', '2026-09-20', '2026-10-01', '2026-10-08']) {
    const { ms, j } = await q(d + ' 00:00:00', d + ' 23:59:59');
    console.log('\n单日', d, '(' + ms + 'ms)', JSON.stringify(sum((j.data && j.data.records) || [])));
  }

  // 2) 月度（看月仓储费记账月份）
  for (const [s, e] of [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-10']]) {
    const { ms, j } = await q(s + ' 00:00:00', e + ' 23:59:59');
    console.log('\n月', s.slice(0, 7), '(' + ms + 'ms)', JSON.stringify(sum((j.data && j.data.records) || [])));
  }

  await b.close().catch(() => {});
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
