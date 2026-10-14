// 同参数对照：--shops UK --days 30 下，HTTP 模式 vs 浏览器模式的差异定位
const fs = require('fs');
const H = JSON.parse(fs.readFileSync(process.argv[2] || '_bak/_test_httpmode.json', 'utf8')).shops.UK;  // http-session
const C = JSON.parse(fs.readFileSync(process.argv[3] || '_bak/_t_cdp.json', 'utf8')).shops.UK;           // cdp-browser

const dtOf = r => r.dt || r.date || r.statDate || r.day;
const byDate = l => { const m = {}; (l || []).forEach(r => { const d = dtOf(r); if (d) m[d] = r; }); return m; };

console.log('范围 H: ' + H.trafficTrend.currentData.length + ' 天  C: ' + C.trafficTrend.currentData.length + ' 天');

console.log('\n════ 1. 逐日趋势（同参数，应完全一致）════');
['trafficTrend', 'productTrend', 'transactionTrend'].forEach(name => {
  const a = byDate(H[name] && H[name].currentData), b = byDate(C[name] && C[name].currentData);
  const days = Object.keys(a).filter(d => b[d]);
  let badKeys = {};
  days.forEach(d => {
    Object.keys(b[d]).forEach(k => {
      if (k === 'dt' || k === 'date') return;
      const x = Number(a[d][k]), y = Number(b[d][k]);
      if (!isFinite(x) && !isFinite(y)) return;
      if (Math.abs((x || 0) - (y || 0)) > 1e-6) (badKeys[k] = badKeys[k] || []).push(d + ':' + x + '≠' + y);
    });
  });
  const ks = Object.keys(badKeys);
  console.log('  ' + name.padEnd(18) + days.length + ' 天重叠 → ' +
    (ks.length ? '✗ 不一致字段: ' + ks.map(k => k + '(' + badKeys[k].length + '天)').join(', ') : '✓ 全一致'));
  if (ks.length) ks.slice(0, 3).forEach(k => console.log('      ' + k + ' 例: ' + badKeys[k].slice(0, 4).join('  ')));
});

console.log('\n════ 2. 明细类条数（差异最大的地方）════');
console.log('  ' + '数据集'.padEnd(16) + 'HTTP'.padEnd(10) + '浏览器');
const cnt = (x) => {
  if (!x) return 0;
  if (Array.isArray(x.data)) return x.data.length;
  if (x.data && typeof x.data === 'object') return Object.keys(x.data).length;
  return 0;
};
[['skuDetail'], ['searchTerms'], ['channels']].forEach(([k]) => {
  const h = H[k], c = C[k];
  const hn = cnt(h), cn = cnt(c);
  console.log('  ' + k.padEnd(16) + String(hn).padEnd(10) + cn + (hn === cn ? '  ✓' : '  ✗ 差 ' + (hn - cn)));
});

console.log('\n════ 3. SKU 集合差异 ════');
const skuOf = x => (x && (x.data || []).map ? (x.data || []).map(r => r.skuId || r.sku || r.itemId) : []);
const hs = new Set(skuOf(H.skuDetail).filter(Boolean));
const cs = new Set(skuOf(C.skuDetail).filter(Boolean));
console.log('  HTTP 独有 ' + [...hs].filter(x => !cs.has(x)).length + ' 个: ' + [...hs].filter(x => !cs.has(x)).slice(0, 12).join(', '));
console.log('  浏览器独有 ' + [...cs].filter(x => !hs.has(x)).length + ' 个: ' + [...cs].filter(x => !hs.has(x)).slice(0, 12).join(', '));
console.log('  交集 ' + [...hs].filter(x => cs.has(x)).length + ' 个');

console.log('\n════ 4. skuWeekly 对照 ════');
const W = x => (x && x.skuWeekly) || {};
const hw = W(H), cw = W(C);
console.log('  HTTP 格数: ' + (hw.cells ? hw.cells.length : JSON.stringify(Object.keys(hw).slice(0, 5))) +
  '  |  浏览器格数: ' + (cw.cells ? cw.cells.length : JSON.stringify(Object.keys(cw).slice(0, 5))));
console.log('  HTTP 结构键: ' + JSON.stringify(Object.keys(hw)));
console.log('  浏览器结构键: ' + JSON.stringify(Object.keys(cw)));
if (hw.cells && cw.cells) {
  const key = c => c.skuId + '@' + c.weekKey;
  const hm = {}; hw.cells.forEach(c => hm[key(c)] = c);
  const cm = {}; cw.cells.forEach(c => cm[key(c)] = c);
  const overlap = Object.keys(hm).filter(k => cm[k]);
  let pdpH = 0, pdpC = 0;
  overlap.forEach(k => { pdpH += Number(hm[k].popPdpUv) || 0; pdpC += Number(cm[k].popPdpUv) || 0; });
  console.log('  重叠格 ' + overlap.length + '，其中 popPdpUv 合计 H=' + pdpH + ' C=' + pdpC +
    (pdpH === pdpC ? '  ✓' : '  ✗ 比值 ' + (pdpC ? (pdpH / pdpC).toFixed(2) : '-')));
  const bad = overlap.filter(k => Math.abs((Number(hm[k].popPdpUv) || 0) - (Number(cm[k].popPdpUv) || 0)) > 1e-6);
  console.log('  逐格不一致: ' + bad.length + '/' + overlap.length);
  bad.slice(0, 5).forEach(k => console.log('      ' + k + ': H=' + hm[k].popPdpUv + ' C=' + cm[k].popPdpUv));
}

console.log('\n════ 5. summary 对照 ════');
['trafficSummary', 'transactionSummary', 'productSummary'].forEach(k => {
  const h = (H[k] && H[k].data) || {}, c = (C[k] && C[k].data) || {};
  const keys = [...new Set([...Object.keys(h), ...Object.keys(c)])];
  const diff = keys.filter(x => {
    const a = h[x], b = c[x];
    if (typeof a === 'number' || typeof b === 'number') return Math.abs((Number(a) || 0) - (Number(b) || 0)) > 1e-6;
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  console.log('  ' + k.padEnd(18) + (diff.length ? '✗ ' + diff.map(d => d + '(H=' + JSON.stringify(h[d]) + ' C=' + JSON.stringify(c[d]) + ')').join(' ') : '✓ 全一致'));
});
