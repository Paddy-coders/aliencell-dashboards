/**
 * test_joybuy_profit.js — JoyBuy 利润模型回归（口径护栏）
 *
 * 为什么必须有：
 *   这套模型的口径几乎**全靠用户口头定义**（利润结构 + 承运商决定物流结算方式），
 *   而且有两个"静默错值"陷阱：
 *     ① 未成交/取消订单也被扣产品成本 → 月度毛利凭空变负（实测 FR 那笔取消的 X1 就是 648 EUR）
 *     ② 账单里有、订单列表里没有的费项（如平台单号 21xxxxxxxx 的海外物流仓储费）被整体丢弃
 *   这两条都不会报错，只会在数字上"看起来合理"。所以必须把口径本身断言下来。
 *
 * 依赖产物：joybuy_profit.json ← build_joybuy_profit.py
 *          （上游 joybuy_orders.json / joybuy_bills.json）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const P = f => path.join(DIR, f);
const load = f => JSON.parse(fs.readFileSync(P(f), 'utf8'));

let pass = 0, fail = 0;
const results = [];
function t(name, cond, detail) {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (detail ? '  → ' + JSON.stringify(detail) : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.02 : tol);
const has = f => fs.existsSync(P(f));

// ---------- 0. 前置文件 ----------
for (const f of ['joybuy_profit.json', 'joybuy_bills.json', 'joybuy_orders.json', 'joybuy_cost_config.json']) {
  if (!has(f)) { console.error('缺少产物 ' + f + '（先跑 fetch_joybuy_orders.js → fetch_joybuy_bills.js → build_joybuy_profit.py）'); process.exit(2); }
}
const jp = load('joybuy_profit.json');
const bills = load('joybuy_bills.json');
const orders = load('joybuy_orders.json');
const cfg = load('joybuy_cost_config.json');
const cost = load('product_cost_table.json');

const FIELDS = ['goods', 'commission', 'txnFee', 'adsCredit', 'vat', 'refund', 'refundCommission', 'returnServiceFee', 'joybuyLogistics', 'otherFees'];
const settled = jp.orders.filter(r => r.settled);
const paid = jp.orders.filter(r => r.goods);

console.log('\n===== JoyBuy 利润模型回归 =====\n');

// ---------- 1. 结构 ----------
t('产出含 orders / months / selfCheck', Array.isArray(jp.orders) && Array.isArray(jp.months) && !!jp.selfCheck);
t('每个订单行都有全部费项字段', jp.orders.every(r => FIELDS.every(f => typeof r[f] === 'number')),
  jp.orders.filter(r => !FIELDS.every(f => typeof r[f] === 'number')).slice(0, 2));
t('公式与物流规则写在产物里（可追溯口径）', /货款/.test(jp.formula) && /MCF/.test(jp.logisticsRule));

// ---------- 2. 费项 ↔ 账单恒等（防重复/漏算） ----------
const billByOrder = {};
bills.items.forEach(it => {
  const k = it.orderId;
  billByOrder[k] = billByOrder[k] || { n: 0, net: 0 };
  billByOrder[k].n++;
  billByOrder[k].net += it.signed;
});
t('账单每一行都落到了模型里（费项条数守恒）',
  Object.values(billByOrder).reduce((s, v) => s + v.n, 0) === bills.items.length);
const modelNet = jp.orders.reduce((s, r) => s + FIELDS.reduce((x, f) => x + r[f], 0), 0);
const billNet = bills.items.reduce((s, it) => s + it.signed, 0);
t('模型费项净额 = 账单费项净额（无重复累加）', near(modelNet, billNet, 0.01), { modelNet, billNet });

// ---------- 3. 平台毛利定义 ----------
const bad = jp.orders.filter(r => !near(r.platformProfit, FIELDS.reduce((s, f) => s + r[f], 0), 0.01));
t('平台毛利 = 货款+佣金+交易服务费+广告返点+VAT+退款+退回佣金+退货服务费+海外物流仓储+其他',
  bad.length === 0, bad.slice(0, 2).map(r => ({ oid: r.orderId, p: r.platformProfit })));

const totalPlatform = settled.reduce((s, r) => s + r.platformProfit, 0);
const scTotal = Object.values(jp.selfCheck.platformProfitTotalByCurrency).reduce((a, b) => a + b, 0);
t('自检里的平台毛利合计与逐行相加一致', near(totalPlatform, scTotal, 0.05), { totalPlatform, scTotal });

// ---------- 4. 费项语义与费率（用真实样本锁死方向） ----------
t('货款 direction=+1（应收）', bills.items.filter(i => /Product Payment/i.test(i.feeName)).every(i => i.direction === 1));
t('佣金/交易服务费/广告返点/VAT direction=−1（应付）',
  bills.items.filter(i => /Commission|Transanction|Ads Credit|VAT/i.test(i.feeName)).every(i => i.direction === -1));

const rateOf = (r, f) => (r.goods ? Math.abs(r[f]) / r.goods : null);
t('广告返点 = 货款的 1%', paid.every(r => near(rateOf(r, 'adsCredit'), 0.01, 0.0005)),
  paid.map(r => ({ oid: r.orderId.slice(-6), rate: rateOf(r, 'adsCredit') })));
t('交易服务费 = 货款的 2%（无此费项的行除外）',
  paid.filter(r => r.txnFee !== 0).every(r => near(rateOf(r, 'txnFee'), 0.02, 0.0005)),
  paid.map(r => ({ oid: r.orderId.slice(-6), rate: rateOf(r, 'txnFee') })));
t('佣金 = 货款的 4% 或 10%（按类目，实测两类各半）',
  paid.every(r => [0.04, 0.1].some(x => near(rateOf(r, 'commission'), x, 0.001))),
  paid.map(r => ({ oid: r.orderId.slice(-6), rate: rateOf(r, 'commission') })));
t('VAT ≈ 货款的 15.97%（DE 实测口径）',
  paid.every(r => near(rateOf(r, 'vat'), 0.1597, 0.002)),
  paid.map(r => ({ oid: r.orderId.slice(-6), rate: rateOf(r, 'vat') })));

// ---------- 5. 物流口径由承运商决定 ----------
const mcfRe = new RegExp(cfg.logistics.mcfCarrierPattern, 'i');
const misBased = orders.orders.filter(o => {
  const should = (o.carrierNames || []).some(n => mcfRe.test(n)) ? 'MCF' : (o.carrierNames || []).length ? 'LASTMILE' : 'UNKNOWN';
  const row = jp.orders.find(r => r.orderId === String(o.orderId));
  return row && row.logisticsBasis !== should;
});
t('物流口径 = 承运商判定（Amazon Logistics→MCF，其它有承运商→LASTMILE，无→UNKNOWN）',
  misBased.length === 0, misBased.map(o => o.orderId));
t('存在 Amazon Logistics 承运商样本（MCF 分支被真实覆盖）',
  orders.orders.some(o => (o.carrierNames || []).some(n => mcfRe.test(n))));
t('LASTMILE 行的物流费 = 成本表尾程 × 件数（本币）',
  jp.orders.filter(r => r.logisticsBasis === 'LASTMILE' && r.logisticsFee != null).every(r => r.logisticsFee > 0),
  jp.orders.filter(r => r.logisticsBasis === 'LASTMILE').map(r => ({ oid: r.orderId.slice(-6), fee: r.logisticsFee })));
// ---------- 5b. MCF 按官方费率卡 + 产品包装尺寸自动匹配分段（2026-10-12 接通） ----------
const mcfRows = jp.orders.filter(r => r.logisticsBasis === 'MCF');
t('MCF 行按官方费率卡算出物流费（不再需要手填单价）',
  mcfRows.length > 0 && mcfRows.every(r => r.logisticsFee != null && r.logisticsFee > 0),
  mcfRows.map(r => ({ oid: r.orderId.slice(-6), fee: r.logisticsFee, src: r.logisticsSource })));
t('MCF 行带分段明细（产品/尺寸/分段/计费重/基价/币种，可逐项追溯）',
  mcfRows.every(r => (r.logisticsDetail || []).length > 0
    && r.logisticsDetail.every(d => d.dimsCm && d.tier && d.base != null && d.fee != null && d.cur)),
  mcfRows.map(r => (r.logisticsDetail || []).map(d => ({ p: d.product, tier: d.tier, base: d.base, fee: d.fee }))));
t('MCF 明细金额 = 基价 × (1 + 燃油附加)（燃油没被漏乘）',
  mcfRows.every(r => r.logisticsDetail.every(d => {
    const fx = (jp.selfCheck.mcfRateCard || {}).fuelPct;
    return fx != null && Math.abs(d.fee - d.base * (1 + fx / 100)) < 0.011;
  })));
t('MCF 计费重 >= 毛重（体积重只加不减）',
  mcfRows.every(r => r.logisticsDetail.every(d => d.shipWG >= d.weightKg * 1000 - 1)));
t('MCF 计费重不超过命中的重量档上限（档位没选错）',
  mcfRows.every(r => r.logisticsDetail.every(d => d.bandG == null || d.shipWG <= d.bandG + 1e-6)));
t('分段判定正确：材料包 33.2×32×4 命中 Standard Parcel（中边 32 > Small Parcel 上限 25）',
  mcfRows.some(r => r.logisticsDetail.some(d => d.product === '材料包' && d.tier === 'std_parcel')),
  mcfRows.flatMap(r => r.logisticsDetail).map(d => ({ p: d.product, tier: d.tier })));
t('MCF 费率卡信息写进产物（生效日 / 燃油 / 尺寸表规模 / 来源文件）',
  !!jp.selfCheck.mcfRateCard && !!jp.selfCheck.mcfRateCard.effective
  && jp.selfCheck.mcfRateCard.fuelPct > 0 && jp.selfCheck.mcfRateCard.productsWithDims > 0,
  jp.selfCheck.mcfRateCard);
t('MCF 口径写进产物 mcfRule（发货仓/分区/体积重/燃油可追溯）',
  !!jp.mcfRule && /德国仓/.test(jp.mcfRule) && /5000/.test(jp.mcfRule) && /燃油/.test(jp.mcfRule));
t('MCF 算不出的行必须记 null 并进 missingMcf（禁止静默按 0）',
  jp.orders.filter(r => r.logisticsBasis === 'MCF' && r.logisticsFee == null)
    .every(r => jp.selfCheck.missingMcf.some(m => m.orderId === r.orderId)),
  jp.selfCheck.missingMcf);
t('超出费率卡最大档的行必须显式进 mcfOverRange（不悄悄套用小档）',
  (jp.selfCheck.mcfOverRange || []).every(x => !!x.why),
  jp.selfCheck.mcfOverRange);
t('MCF 询价器无加载错误',
  !jp.selfCheck.mcfPricerError, jp.selfCheck.mcfPricerError);

// ---------- 6. 两个静默陷阱（本测试的核心） ----------
const notSettled = jp.orders.filter(r => !r.settled);
t('未成交/取消订单不计产品成本（否则凭空变负）',
  notSettled.length > 0 && notSettled.every(r => r.costLocal == null && r.grossProfit == null),
  notSettled.map(r => ({ oid: r.orderId.slice(-6), status: r.status, cost: r.costLocal, gross: r.grossProfit })));
t('月度汇总只含 settled / orphanFee 行',
  jp.months.every(m => m.orders >= 1),
  jp.months.map(m => ({ ym: m.ym, orders: m.orders })));
t('账单里有、订单列表里没有的费项不被丢弃（孤儿费项）',
  jp.selfCheck.orphanFeeRows > 0
  && jp.orders.filter(r => r.orphanFee).every(r => Math.abs(r.platformProfit) > 0)
  && jp.months.some(m => Math.abs(m.joybuyLogistics) > 0),
  { orphanFeeRows: jp.selfCheck.orphanFeeRows, months: jp.months.map(m => ({ ym: m.ym, jl: m.joybuyLogistics })) });
t('所有费项名都被映射（无 unmapped）',
  (jp.selfCheck.unmappedFeeNames || []).length === 0, jp.selfCheck.unmappedFeeNames);
t('所有订单 SKU 都能匹配成本表产品',
  (jp.selfCheck.unknownProduct || []).length === 0, jp.selfCheck.unknownProduct);

// ---------- 7. 成本/头程换算方向 ----------
const withCost = jp.orders.filter(r => r.costLocal != null && r.costRMB > 0);
t('有成本的行都带汇率', withCost.every(r => r.fxCnyPerLocal > 1));
t('RMB→本币方向正确（成本本币 = RMB ÷ 汇率）',
  withCost.every(r => near(r.costLocal, r.costRMB / r.fxCnyPerLocal, 0.02)),
  withCost.map(r => ({ oid: r.orderId.slice(-6), local: r.costLocal, calc: +(r.costRMB / r.fxCnyPerLocal).toFixed(4) })));
t('头程同样按汇率折算',
  jp.orders.filter(r => r.headLocal != null && r.headRMB > 0)
    .every(r => near(r.headLocal, r.headRMB / r.fxCnyPerLocal, 0.02)));

// ---------- 8. 完整毛利链 ----------
const grossRows = jp.orders.filter(r => r.grossProfit != null);
t('完整毛利 = 平台毛利 − 物流费 − 产品成本 − 头程（逐行）',
  grossRows.every(r => near(r.grossProfit, r.platformProfit - (r.logisticsFee || 0) - r.costLocal - r.headLocal, 0.02)),
  grossRows.map(r => ({ oid: r.orderId.slice(-6), g: r.grossProfit })));
const mg = jp.months.reduce((s, m) => s + (m.grossProfit || 0), 0);
t('月度完整毛利 = 逐行之和', near(mg, grossRows.reduce((s, r) => s + r.grossProfit, 0), 0.05), { mg });

// ---------- 9. 交叉验证：账单货款 vs Data Compass 月销（宽松带） ----------
// 两者归属口径不同（账单按结算 happenTime；Data Compass 按月内周重叠天数等比分摊），
// 所以只断言「同月同站、同数量级、差 ≤ 20%」，不做等号 —— 防止把口径差异误判成 bug。
if (has('joybuy_monthly.json')) {
  const jm = load('joybuy_monthly.json');
  const ccOf = { 'DE-Site': 'DE', 'UK-Site': 'UK', 'NL-Site': 'NL', 'FR-Site': 'FR' };
  const billsByYM = {};
  jp.orders.forEach(r => { if (r.goods) { const k = r.ym + '|' + ccOf[r.site]; billsByYM[k] = (billsByYM[k] || 0) + r.goods; } });
  const cmp = [];
  Object.keys(billsByYM).forEach(k => {
    const [ym, cc] = k.split('|');
    const row = (jm.siteTotals || []).find(x => x.ym === ym && x.cc === cc);
    if (!row) return;
    const d = Math.abs(billsByYM[k] - (row.sales || 0)) / Math.max(row.sales || 1, 1);
    cmp.push({ k, bills: +billsByYM[k].toFixed(2), dc: row.sales, diffPct: +(d * 100).toFixed(1) });
  });
  t('账单货款与 Data Compass 月销同月同站、差异 ≤ 25%（口径不同，只做量级校验）',
    cmp.length > 0 && cmp.every(c => c.diffPct <= 25), cmp);
}

// ---------- 10. 报告 ----------
console.log(results.join('\n'));
console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
if (jp.selfCheck.missingMcf.length) {
  console.log('\n⚠️ MCF 记 null 的单（不计入失败，需补尺寸或人工定价）：' +
    jp.selfCheck.missingMcf.map(m => m.orderId + '(' + m.site + ',' + m.units + '件) ' + (m.why || '')).join(' | '));
}
if ((jp.selfCheck.mcfOverRange || []).length) {
  console.log('\n⚠️ 超出 MCF 费率卡范围（已按最大档兜底，实际未必能用 MCF）：' +
    jp.selfCheck.mcfOverRange.map(x => x.product + ' ' + x.dimsCm.join('x') + 'cm/' + x.weightKg + 'kg').join(' | '));
}
process.exit(fail ? 1 : 0);
