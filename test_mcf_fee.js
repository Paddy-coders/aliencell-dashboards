/* Amazon MCF 尾程费匹配 —— 专项回归（无浏览器，纯 JSON + 独立复算）
 *
 * 用法：node test_mcf_fee.js
 *
 * 设计要点（为什么值得单独一个测试）：
 *   ① **双实现交叉验证**：本文件用 JS 按官方档表**独立**重写一遍分段匹配，
 *      再与 Python 侧 mcf_fee.py 算出的产物逐条比对。抄实现就失去意义，
 *      所以这里故意不复用 Python 的代码，只共用 mcf_rate_card.json 这份官方数据。
 *   ② **边界**：计费重刚好等于档上限要落在本档；超一点点要落下一档。
 *   ③ **反向对照**：取错列（DE 站用 UK 列）金额必须不同 —— 证明「按目的地取列」承重；
 *      把尺寸压回档内必须不再 over —— 证明 over 不是恒真。
 *   ④ **静默陷阱**：NL 站币种（官方 cur 表没有 NL）、超范围兜底必须显式标 over。
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const CARD = JSON.parse(fs.readFileSync(path.join(HERE, 'mcf_rate_card.json'), 'utf8'));
const DIMS = JSON.parse(fs.readFileSync(path.join(HERE, 'product_dims.json'), 'utf8')).products;
const JP = JSON.parse(fs.readFileSync(path.join(HERE, 'joybuy_profit.json'), 'utf8'));

const results = [];
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const R = CARD.rates;
const EU = R.eu;
const EU_FUEL = R.euFuelPct;   // 燃油附加在费率卡顶层，不在 eu 子对象里

/* ---------- 1. 费率卡结构（与官方费率卡一致） ---------- */
t('费率卡版本与生效日齐备', !!R.ver && !!R.euEff && !!R.euFuelPct, { ver: R.ver, euEff: R.euEff });
t('EU 体积重除数 = 5000（cm³→g）', EU.dimDivisor === 5000, EU.dimDivisor);
t('EU 燃油附加 = 1.5%（费率卡顶层 euFuelPct）', EU_FUEL === 1.5, R.euFuelPct);
t('EU 共 6 个尺寸分段，重量档合计 30 档',
  EU.tierDefs.length === 6 && EU.tierDefs.reduce((a, d) => a + d.w.length, 0) === 30,
  EU.tierDefs.map(d => d.key + ':' + d.w.length));
t('8 个费率列都齐 30 档',
  ['DE', 'FR', 'IT', 'ES', 'UK', 'DE_Z1', 'DE_Z2', 'DE_Z3'].every(k => (EU.std[k] || []).length === 30));
t('分段门槛按「小→大」排序（否则大货会被小档吃掉）',
  EU.tierDefs.every((d, i) => i === 0 || d.maxW >= EU.tierDefs[i - 1].maxW - 1e-9));
t('尺寸表覆盖 21 个产品且三地区尺寸一致',
  Object.keys(DIMS).length === 21 && Object.values(DIMS).every(d => d.regionConsistent));

/* ---------- 2. JS 独立实现（不抄 Python） ---------- */
function seriesKey(country) {
  if (country === 'UK') return 'UK';
  if (country === 'DE') return 'DE';
  const z = EU.deZoneOf[country];
  return z ? 'DE_' + z : null;
}
function curOf(key) {
  if (key === 'UK') return 'GBP';
  if (key === 'DE' || key.startsWith('DE_')) return 'EUR';
  if (key === 'US') return 'USD';
  return null;
}
// 把 30 档平铺切成 6 个分段
function buildTiers(key) {
  const arr = EU.std[key];
  if (!arr) return null;
  let at = 0;
  return EU.tierDefs.map(def => {
    const steps = def.w.map(bandG => ({ limit: bandG, fee: arr[at++] }));
    return Object.assign({}, def, { steps });
  });
}
function dimWeightG(def, dimsCm) {
  if (!def.useDim) return 0;
  const d = dimsCm.slice().sort((a, b) => b - a);
  return (d[0] * d[1] * d[2]) / EU.dimDivisor * 1000;
}
function shipWeightG(def, dimsCm, kg) {
  const unit = kg * 1000;
  return def.useDim ? Math.max(unit, dimWeightG(def, dimsCm)) : unit;
}
function fits(def, dimsCm, kg) {
  const d = dimsCm.slice().sort((a, b) => b - a);
  if (d[0] > def.maxL || d[1] > def.maxM || d[2] > def.maxS) return false;
  if (kg * 1000 > def.maxW + 1e-9) return false;
  if (def.dimMax) {
    if (def.useDim && dimWeightG(def, dimsCm) > def.dimMax + 1e-9) return false;
  }
  return true;
}
function quote(country, dimsCm, kg) {
  const key = seriesKey(country);
  if (!key) return { error: 'no-column' };
  const tiers = buildTiers(key);
  if (!tiers) return { error: 'no-array' };
  if (!(dimsCm && dimsCm.length === 3 && dimsCm.every(x => x > 0) && kg > 0)) return { error: 'no-dims' };
  let hit = tiers.find(def => fits(def, dimsCm, kg));
  let over = false;
  if (!hit) { hit = tiers[tiers.length - 1]; over = true; }
  const w = shipWeightG(hit, dimsCm, kg);
  let step = hit.steps.find(s => w <= s.limit + 1e-9) || hit.steps[hit.steps.length - 1];
  const base = step.fee;
  return { tier: hit.key, label: hit.label, shipWG: w, bandG: step.limit, base: base,
           cur: curOf(key), over: over,
           fee: Math.round(base * (1 + EU_FUEL / 100) * 100) / 100 };
}

/* ---------- 3. 与 Python 侧产物逐条交叉比对 ---------- */
const details = JP.orders.flatMap(o => (o.logisticsDetail || []).map(d => Object.assign({ orderId: o.orderId, site: o.site }, d)));
t('产物里有 MCF 分段明细可比对', details.length > 0, details.length);
let mismatch = [];
details.forEach(d => {
  const country = d.site.split('-')[0];
  const q = quote(country, d.dimsCm, d.weightKg);
  const same = q.tier === d.tier
    && Math.abs(q.fee - d.fee) < 0.011
    && Math.abs(q.base - d.base) < 1e-9
    && Math.abs(q.shipWG - d.shipWG) < 0.05
    && q.cur === d.cur && q.over === d.over;
  if (!same) mismatch.push({ p: d.product, python: { tier: d.tier, fee: d.fee, base: d.base, shipW: d.shipWG }, js: q });
});
t('★ 双实现一致：JS 独立复算 == Python 产物（分段/基价/计费重/币种/超范围标记）',
  mismatch.length === 0, mismatch);

/* ---------- 4. 分段判定（含边界） ---------- */
const mk = (n) => DIMS[n].dimsCm;
const mt = (n) => DIMS[n].weightKg;
t('材料包 33.2×32×4/1.47kg → Standard Parcel（中边 32 超 Small Parcel 上限 25）',
  quote('DE', mk('材料包'), mt('材料包')).tier === 'std_parcel', quote('DE', mk('材料包'), mt('材料包')));
t('滚轴 33.8×17×11/1.9kg → Small Parcel（三边都在 35/25/12 内）',
  quote('DE', mk('滚轴'), mt('滚轴')).tier === 'small_parcel', quote('DE', mk('滚轴'), mt('滚轴')));
t('X1 主机 103×92.5×34/47.95kg → 超出费率卡（最长边 103 > 45cm），标 over',
  quote('DE', mk('X1主机+60W蓝光头+气泵'), mt('X1主机+60W蓝光头+气泵')).over === true);
t('X1 系列蜂窝板 78×58.7×7.2/5.91kg → 超范围（78 > 45cm），标 over',
  quote('DE', mk('X1系列蜂窝板'), mt('X1系列蜂窝板')).over === true);
t('体积重生效：蜂窝板单位重 5910g 但体积重 6593.2g > 单位重，取体积重',
  Math.abs(quote('DE', mk('X1系列蜂窝板'), mt('X1系列蜂窝板')).shipWG - 6593.2) < 0.5,
  quote('DE', mk('X1系列蜂窝板'), mt('X1系列蜂窝板')).shipWG);

// 边界：计费重刚好等于档上限 → 本档；+1g → 下一档
{
  // 先用一个能命中 Small Parcel 的尺寸，再调重量到边界
  const dims = [30, 20, 10];
  const lo = quote('DE', dims, 1.4);        // 1400g → 档上限 1400
  const hi = quote('DE', dims, 1.401);      // 1401g → 下一档 1900
  t('边界：计费重 = 档上限（1400g）落在本档', lo.bandG === 1400, lo);
  t('边界：计费重 +1g（1401g）落到下一档', hi.bandG === 1900, hi);
  t('边界：跨到下一档后费用变高', hi.fee > lo.fee, { lo: lo.fee, hi: hi.fee });
}

// 反向对照：把超范围的货压回档内 → 必须不再 over 且分段变具体
{
  const over = quote('DE', mk('X1主机+60W蓝光头+气泵'), mt('X1主机+60W蓝光头+气泵'));
  const inside = quote('DE', [44, 33, 25], 10);
  t('反向对照：把尺寸压进档内（44×33×25/10kg）→ over 变 false 且命中具体分段',
    over.over === true && inside.over === false && inside.tier === 'std_parcel',
    { over: { t: over.tier, o: over.over }, inside: { t: inside.tier, o: inside.over } });
}

/* ---------- 5. 取列 / 币种（含静默陷阱） ---------- */
t('取列：DE→德国本国列；NL→ZONE1；FR→ZONE2；ES→ZONE3；UK→英国列',
  seriesKey('DE') === 'DE' && seriesKey('NL') === 'DE_Z1' && seriesKey('FR') === 'DE_Z2'
  && seriesKey('ES') === 'DE_Z3' && seriesKey('UK') === 'UK',
  ['DE', 'NL', 'FR', 'ES', 'UK'].map(c => c + '→' + seriesKey(c)));
t('★ 反向对照：同一件货在 DE 与 FR 取不同列，金额必须不同（证明按目的地取列承重）',
  quote('DE', mk('材料包'), mt('材料包')).fee !== quote('FR', mk('材料包'), mt('材料包')).fee,
  { de: quote('DE', mk('材料包'), mt('材料包')).fee, fr: quote('FR', mk('材料包'), mt('材料包')).fee });
t('★ 静默陷阱：官方 cur 表没有 NL，但 NL 必须能报价且币种 = EUR（不能误判成「不支持」）',
  !(EU.cur && EU.cur.NL) && curOf(seriesKey('NL')) === 'EUR' && quote('NL', mk('材料包'), mt('材料包')).fee > 0,
  { curTable: EU.cur, nlFee: quote('NL', mk('材料包'), mt('材料包')).fee });
t('币种：德国仓各分区都报 EUR，英国报 GBP',
  ['DE', 'NL', 'FR', 'ES'].every(c => quote(c, mk('材料包'), mt('材料包')).cur === 'EUR')
  && quote('UK', mk('材料包'), mt('材料包')).cur === 'GBP');

/* ---------- 6. 档内单调 + 燃油 ---------- */
{
  let bad = [];
  EU.tierDefs.forEach((def, di) => {
    let at = 0;
    EU.tierDefs.forEach((d2, i2) => { if (i2 < di) at += d2.w.length; });
    const fees = def.w.map((g2, i2) => ({ g: g2, f: EU.std.DE[at + i2] }));
    for (let i = 1; i < fees.length; i++) if (fees[i].f < fees[i - 1].f - 1e-9) bad.push(def.key + ':' + fees[i].g);
  });
  t('同分段内费率不随重量档下降（逐档非递减）', bad.length === 0, bad);
}
t('燃油被乘上：DE 材料包 fee = 10.01 × 1.015 = 10.16',
  quote('DE', mk('材料包'), mt('材料包')).fee === 10.16, quote('DE', mk('材料包'), mt('材料包')));
t('产物自检的燃油率与费率卡一致',
  JP.selfCheck.mcfRateCard.fuelPct === EU_FUEL, JP.selfCheck.mcfRateCard);
t('产物自检的费率卡生效日与费率卡一致',
  JP.selfCheck.mcfRateCard.effective === R.euEff, JP.selfCheck.mcfRateCard);
t('★ 燃油率读自费率卡顶层 euFuelPct，不是代码里的兜底默认值',
  JP.selfCheck.mcfRateCard.fuelPctSource === 'rateCard.euFuelPct',
  JP.selfCheck.mcfRateCard.fuelPctSource);
t('★ UPO 口径：费率卡只有 1 UPO 价，多件订单必须显式记 mcfUpoApprox（不假装精确）',
  Array.isArray(JP.selfCheck.mcfUpoApprox)
  && JP.orders.filter(o => o.logisticsBasis === 'MCF' && o.units > 1)
       .every(o => JP.selfCheck.mcfUpoApprox.some(x => x.orderId === o.orderId)),
  { upoApprox: JP.selfCheck.mcfUpoApprox, units: JP.orders.filter(o => o.logisticsBasis === 'MCF').map(o => o.units) });
t('UPO 口径写进产物 mcfRule（可追溯）', /1 UPO/.test(JP.mcfRule || ''));
t('本期 MCF 单都是 1 件（1 UPO 表用对，无近似）',
  JP.orders.filter(o => o.logisticsBasis === 'MCF').every(o => o.units === 1)
  && (JP.selfCheck.mcfUpoApprox || []).length === 0,
  JP.orders.filter(o => o.logisticsBasis === 'MCF').map(o => o.units));
t('多件报价会带 upoWarning（Python 侧用 2 件探针实测，不依赖当期有没有 2 件单）',
  !!JP.selfCheck.mcfUpoProbe && !!JP.selfCheck.mcfUpoProbe.upo2Warning,
  JP.selfCheck.mcfUpoProbe);

/* ---------- 7. 与利润模型的接口 ---------- */
t('MCF 行的 logisticsFee == 明细各件 fee × 件数之和',
  JP.orders.filter(o => o.logisticsBasis === 'MCF' && o.logisticsFee != null).every(o => {
    const sum = o.logisticsDetail.reduce((a, d) => a + (d.fee || 0) * d.num, 0);
    return Math.abs(sum - o.logisticsFee) < 0.011;
  }),
  JP.orders.filter(o => o.logisticsBasis === 'MCF').map(o => ({ oid: o.orderId.slice(-6), fee: o.logisticsFee })));
t('MCF 口径下 9 月 DE 完整毛利已含 MCF 那单（不再是 null）',
  JP.months.some(m => m.ym === '2026-09' && m.grossProfit != null && m.logisticsFee > 106),
  JP.months.map(m => ({ ym: m.ym, log: m.logisticsFee, gross: m.grossProfit })));

console.log(results.join('\n'));
console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
console.log('费率卡：' + R.ver + ' · EU 生效 ' + R.euEff + ' · 燃油 ' + EU_FUEL + '% · 尺寸表 ' + Object.keys(DIMS).length + ' 个产品');
process.exit(fail ? 1 : 0);
