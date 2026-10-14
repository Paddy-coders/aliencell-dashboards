// _audit_live_cost.js — 审计「线上页面里的商品成本/头程」是否 = 落库 profit_metrics.json
// 只读, 不入回归。用法: node _audit_live_cost.js
const fs = require('fs');

const LIVE = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host';
const pm = JSON.parse(fs.readFileSync('profit_metrics.json', 'utf8'));
const pmRows = pm.rows || [];

// 落库: 按 ASIN 汇总 cost / costErp
const byAsin = {};
for (const r of pmRows) {
  const k = String(r.as || '').toUpperCase();
  const o = byAsin[k] || (byAsin[k] = { cost: 0, erp: 0, q: 0, miss: 0, n: 0 });
  o.cost += Number(r.cost) || 0;
  o.erp += Number(r.costErp) || 0;
  o.q += (Number(r.qty) || 0) + (Number(r.mqty) || 0);
  o.miss += Number(r.miss) || 0;
  o.n++;
}
const tot = Object.values(byAsin).reduce((a, o) => ({
  cost: a.cost + o.cost, erp: a.erp + o.erp, q: a.q + o.q, miss: a.miss + o.miss,
  n: a.n + o.n }), { cost: 0, erp: 0, q: 0, miss: 0, n: 0 });

function grabJson(src, varName) {
  const i = src.indexOf('const ' + varName + ' = ');
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  // 用括号配对找结尾(字符串内 {} 会干扰, 这里用简易扫描 + JSON.parse 校验)
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(src.slice(start, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}

const cmp = (label, a, b, unit) => {
  const d = a - b;
  const ok = Math.abs(d) < 1e-6;
  console.log(String(ok ? '  ✅ ' : '  ❌ ') + label + '  线上 ' + a.toFixed(2) + ' / 落库 ' + b.toFixed(2) +
    (ok ? '' : '  差 ' + (d > 0 ? '+' : '') + d.toFixed(2)) + (unit ? ' ' + unit : ''));
  return ok;
};

(async () => {
  console.log('落库 profit_metrics.json: costSource=' + pm.costSource +
    ' | 行 ' + pmRows.length + ' | 商品成本合计 ' + tot.cost.toFixed(2) +
    ' | 易仓原值合计 ' + tot.erp.toFixed(2) + ' | miss=' + tot.miss);

  // ---------- 1. 线上 monthly.html ----------
  const mh = await (await fetch(LIVE + '/monthly.html', { cache: 'no-store' })).text();
  const M = grabJson(mh, 'DATA');
  const mRows = (M && M.rows) || [];
  const mByAsin = {}; let mCost = 0, mHead = 0, mQty = 0, mMiss = 0, zeroP = 0;
  for (const r of mRows) {
    const k = String(r.asin || '').toUpperCase();
    const c = Number(r.pCost) || 0;
    const h = Number(r.pMhead) || 0;
    mCost += c; mHead += h; mQty += Number(r.pQty) || 0; mMiss += Number(r.pMiss) || 0;
    mByAsin[k] = (mByAsin[k] || 0) + c;
    if (!c && (Number(r.pQty) || 0) > 0) zeroP++;
  }
  console.log('\n【线上 monthly.html】载荷行 ' + mRows.length + ' · 商品成本合计 ' + mCost.toFixed(2) +
    ' · 头程合计 ' + mHead.toFixed(2) + ' · pQty ' + mQty + ' · pMiss ' + mMiss);
  let okA = true;
  for (const k of Object.keys(byAsin)) {
    const a = +(mByAsin[k] || 0), b = +byAsin[k].cost;
    if (Math.abs(a - b) > 1e-6) { okA = false; console.log('  ❌ ' + k + ' 线上 ' + a.toFixed(2) + ' vs 落库 ' + b.toFixed(2)); }
  }
  console.log('  ✅ ' + (okA ? '逐 ASIN 商品成本与落库完全一致 (' + Object.keys(byAsin).length + ' 个 ASIN)' : '存在不一致(见上)'));
  console.log('  ℹ️ 线上头程合计 ' + mHead.toFixed(2) + (mHead ? ' ⇒ 内嵌映射在线上页生效(非 0)' : ' ⚠️ 头程为 0 ⇒ 内嵌映射可能没生效'));

  // ---------- 2. 线上 daily.html ----------
  const dh = await (await fetch(LIVE + '/daily.html', { cache: 'no-store' })).text();
  const D = grabJson(dh, 'PROFIT');
  const dRows = (D && D.rows) || [];
  const dByAsin = {}; let dCost = 0;
  for (const r of dRows) {
    const k = String(r.as || '').toUpperCase();
    dCost += Number(r.cost) || 0;
    dByAsin[k] = (dByAsin[k] || 0) + (Number(r.cost) || 0);
  }
  console.log('\n【线上 daily.html】PROFIT 行 ' + dRows.length + ' · costSource=' + (D && D.costSource) +
    ' · 商品成本合计 ' + dCost.toFixed(2));
  let okB = true;
  for (const k of Object.keys(byAsin)) {
    const a = +(dByAsin[k] || 0), b = +byAsin[k].cost;
    if (Math.abs(a - b) > 1e-6) { okB = false; console.log('  ❌ ' + k + ' 线上 ' + a.toFixed(2) + ' vs 落库 ' + b.toFixed(2)); }
  }
  console.log('  ✅ ' + (okB ? '逐 ASIN 商品成本与落库完全一致' : '存在不一致(见上)'));

  // ---------- 3. 口径文案 ----------
  console.log('\n【口径文案是否已上线】');
  console.log('  daily  PROFIT.note 含「成本表 costRMB」: ' + /成本表 costRMB/.test(D && D.note || ''));
  console.log('  monthly 含「不再取易仓 productCostTotal」: ' + /不再取易仓/.test(mh));
  console.log('  monthly 含旧句「Woot 手工录入数据不参与毛利计算」: ' + /Woot 手工录入数据不参与毛利计算/.test(mh) + ' (应为 false)');

  // ---------- 4. 汇总 ----------
  console.log('\n================ 结论 ================');
  console.log('  商品成本(成本表口径)合计: ' + tot.cost.toFixed(2) + '   易仓原值合计: ' + tot.erp.toFixed(2) +
    '   差 ' + (tot.cost - tot.erp).toFixed(2));
  console.log('  线上=落库: monthly ' + (okA ? 'YES' : 'NO') + ' / daily ' + (okB ? 'YES' : 'NO'));
})().catch(e => { console.error('ERR', e); process.exit(1); });
