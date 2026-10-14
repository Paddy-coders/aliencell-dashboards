// 诊断: G18 ⓒ 单台偏差的原始行(只读, 不进回归)
const fs = require('fs');
const pm = JSON.parse(fs.readFileSync('profit_metrics.json', 'utf8'));
const rows = pm.rows || pm.data || [];
const target = process.argv[2] || 'B0H6QDFV5F';
console.log('字段:', Object.keys(rows[0] || {}).join(', '));
const hit = rows.filter(r => r.as === target);
const live = hit.filter(r => (r.qty || 0) || (r.mqty || 0) || (r.costErp || 0));
console.log('命中', hit.length, '| 有数据', live.length);
const per = [];
for (const r of live) {
  const u = r.qty > 0 ? Math.abs(r.costErp || 0) / r.qty : null;
  if (u !== null) per.push(u);
  console.log([r.ym || r.month || r.d || r.date, r.site,
    'qty=' + r.qty, 'mqty=' + (r.mqty || 0),
    'cost=' + (+(r.cost || 0)).toFixed(2), 'costErp=' + (+(r.costErp || 0)).toFixed(2),
    'erp单台=' + (u === null ? '-' : u.toFixed(2))].join('  '));
}
if (per.length) {
  const s = per.slice().sort((a, b) => a - b);
  console.log('erp单台 列表(升序):', s.map(x => x.toFixed(2)).join(', '));
  console.log('中位数(取上中位)=', s[Math.floor(s.length / 2)].toFixed(2),
              '| 均值=', (s.reduce((a, b) => a + b, 0) / s.length).toFixed(2));
}
const q = live.reduce((a, r) => a + (r.qty || 0) + (r.mqty || 0), 0);
const c = live.reduce((a, r) => a + (r.cost || 0), 0);
console.log('合计 件数=', q, ' 成本表成本=', c.toFixed(2), ' 表单台=', (c / q).toFixed(2));
