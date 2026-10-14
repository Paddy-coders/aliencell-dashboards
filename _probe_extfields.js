// 诊断用(勿入回归): 拉易仓利润报表 ASIN 维度全期数据, 统计「未计入毛利的费用字段」量级
//   用途: 回答「FBA库存与入境服务费有没有计入」「多渠道/评测相关成本有多少」
// 用法: node _probe_extfields.js [from] [to]
const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FROM = process.argv[2] || '2026-06-01';
const TO = process.argv[3] || '';

function fmtLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtLocal(d); }
function monthOf(s) { return s.slice(0, 7); }
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

// 关注的字段: 现有已计入 + 疑似未计入
const FIELDS = [
  // 已计入
  'quantityTotal', 'productSalesTotal', 'promotionalRebatesTotal', 'sellingFeesTotal',
  'fbaFeesTotal', 'productCostTotal', 'fbaMonthStorageFee', 'fbaLongtermStorageFee',
  'couponAndLightningDealFeeTotal', 'serviceFeeTotal', 'grossProfitTotal',
  // 疑似未计入: FBA 库存与入境服务费
  'fbaInventoryFeeTotal', 'storageFeeTotal', 'storageFee', 'longTermStorageFee',
  'fbaInboundTransportationFee', 'fbaInboundConvenienceFee', 'fbaWeightBasedFee',
  'fbaInternationalInboundFreightFee', 'otherFbaInventoryFeeOtherFee', 'otherFbaInventoryFeeFbaFee',
  'otherFbaInventoryFbaAndFba', 'fbaRemovalFee', 'fbaReturnDisposalFeeTotal',
  // 多渠道
  'multiChannelQuantity', 'multiFbaFees', 'multiPurchaseCostFee', 'multiPurchaseShippingFee',
  'multiPurchaseTariffFee', 'multiFirstShippingFee', 'multiFirstShippingTariffFee',
  // 评测
  'isEvaluateOrder', 'amountEvaluateFee', 'evaluatePurchaseCostFee', 'evaluatePurchaseShippingFee',
  'evaluatePurchaseTariffFee', 'evaluateFirstShippingFee', 'evaluateFirstShippingTariffFee',
  // 其它收支(参考)
  'fbaReimbursementTotal', 'platformOtherExpendTotal', 'otherUnclassifiedExpenses',
];
const SUM = new Set(['multiChannelQuantity', 'isEvaluateOrder', 'fbaRemovalFee']);

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  let page = pages.find(p => p.url().includes('eccang.com'));
  if (!page) { console.log('ERROR: 找不到易仓页签'); await b.close(); process.exit(1); }
  if (String(page.url()).includes('/login')) { console.log('ERROR: 易仓未登录'); await b.close(); process.exit(1); }
  if (!page.url().includes('profit_system')) {
    await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/profit_system#/ps/profit-statement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(9000);
  }
  const TOKEN = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value || ''; } catch (e) { return ''; } });
  if (!TOKEN) { console.log('ERROR: token 读取失败'); await b.close(); process.exit(1); }

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
      } catch (e) { console.log('  重试', a, start, e.message.slice(0, 80)); }
      await sleep(2000 * a);
    }
    return null;
  }

  const today = fmtLocal(new Date());
  const endDate = TO || today;
  const months = [];
  for (let ym = monthOf(FROM); ym <= monthOf(endDate); ym = (() => { const [y, m] = ym.split('-').map(Number); const nm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; return nm; })()) months.push(ym);

  const perMonth = {};
  const perAsin = {};
  const allRecs = [];
  for (const ym of months) {
    if (ym < monthOf(FROM)) continue;
    const { start, end } = monthRange(ym);
    const recs = await query(start, end);
    if (!recs) { console.log('月', ym, '失败'); continue; }
    perMonth[ym] = {};
    for (const f of FIELDS) {
      let t = 0;
      for (const r of recs) {
        const v = Number(r[f] || 0);
        if (f === 'multiChannelQuantity' || f === 'isEvaluateOrder' || f === 'fbaRemovalFee') t += v; else t += v;
      }
      perMonth[ym][f] = +t.toFixed(2);
      if (Math.abs(t) > 0.005) {
        if (!perAsin[f]) perAsin[f] = {};
        for (const r of recs) {
          const v = Number(r[f] || 0);
          if (Math.abs(v) > 0.005) {
            const k = `${r.asin}|${r.site}|${r.userAccount}`;
            perAsin[f][k] = +((perAsin[f][k] || 0) + v).toFixed(2);
          }
        }
      }
    }
    allRecs.push(...recs);
    console.log(ym, recs.length, '行');
    await sleep(200);
  }

  const tot = {};
  for (const f of FIELDS) tot[f] = +Object.values(perMonth).reduce((a, m) => a + (m[f] || 0), 0).toFixed(2);

  const out = { from: FROM, to: endDate, generatedAt: new Date().toLocaleString('sv-SE'), fields: FIELDS, totals: tot, perMonth, perAsin };
  fs.writeFileSync('_extfields_probe.json', JSON.stringify(out), 'utf8');
  console.log('\n=== 全期合计 (' + FROM + ' ~ ' + endDate + ', ' + allRecs.length + ' 行) ===');
  for (const f of FIELDS) console.log('  ' + f.padEnd(34) + String(tot[f]).padStart(14));
  console.log('\n已写 _extfields_probe.json');
  await b.close().catch(() => {});
})().catch(e => { console.error('FATAL', e); process.exit(1); });
