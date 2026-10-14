// 诊断用(勿入回归): 确认 fbaInventoryFeeTotal / fbaInboundTransportationFee 是「日粒度」还是「仅月度汇总」
//   对比: 单日 vs 整月, 以及空 ASIN 行是否承载这些费用
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIELDS = ['fbaInventoryFeeTotal', 'fbaInboundTransportationFee', 'fbaMonthStorageFee', 'fbaLongtermStorageFee', 'storageFee', 'fbaRemovalFee', 'productCostTotal'];

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  let page = pages.find(p => p.url().includes('eccang.com'));
  if (!page) { console.log('ERROR: 无易仓页签'); await b.close(); process.exit(1); }
  const TOKEN = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value || ''; } catch (e) { return ''; } });
  const req = page.context().request;
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
  async function query(start, end) {
    for (let a = 1; a <= 3; a++) {
      try {
        const r = await req.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
          headers: { 'Content-Type': 'application/json', 'authorization': TOKEN, 'x-access-token': TOKEN, 'company': 'ntvb7tr' },
          data: mkBody(start, end), timeout: 90000
        });
        const j = JSON.parse((await r.body()).toString('utf8'));
        if (j && j.data && Array.isArray(j.data.records)) return j.data.records;
      } catch (e) { }
      await sleep(2000 * a);
    }
    return null;
  }
  const cases = [
    ['单日', '2026-08-15', '2026-08-15'],
    ['单日', '2026-09-15', '2026-09-15'],
    ['整月', '2026-08-01', '2026-08-31'],
    ['整月', '2026-09-01', '2026-09-30'],
  ];
  for (const [tag, s, e] of cases) {
    const recs = await query(s, e);
    if (!recs) { console.log(tag, s, '失败'); continue; }
    const tot = {};
    for (const f of FIELDS) tot[f] = +recs.reduce((a, r) => a + Number(r[f] || 0), 0).toFixed(2);
    const noAsin = recs.filter(r => !r.asin);
    console.log(`\n[${tag}] ${s} ~ ${e}  行数=${recs.length} (空ASIN行 ${noAsin.length})`);
    for (const f of FIELDS) console.log('   ' + f.padEnd(30) + String(tot[f]).padStart(12));
    if (noAsin.length) {
      console.log('   空ASIN行: ' + noAsin.map(r => `${r.site}/${r.userAccount} ` + FIELDS.map(f => f + '=' + (r[f] || 0)).join(',')).join(' | ').slice(0, 500));
    }
    await sleep(250);
  }
  await b.close().catch(() => { });
})().catch(e => { console.error('FATAL', e); process.exit(1); });
