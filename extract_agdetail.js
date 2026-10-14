const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// @314437 组件：找出它调用哪些 API
const seg = s.slice(305000, 340000);
let idx = -1, count = 0;
const found = [];
while ((idx = seg.indexOf('.GetList', idx+1)) >= 0 && count < 50) {
  const m = seg.slice(Math.max(0,idx-50), idx+8).match(/([A-Za-z]+\.GetList)/);
  if (m) found.push({ at: 305000+idx, name: m[1] });
  count++;
}
const uniq = {};
found.forEach(f => { uniq[f.name] = uniq[f.name] || []; uniq[f.name].push(f.at); });
for (const [k, v] of Object.entries(uniq)) console.log(k, '->', v.join(','));
console.log('---');
// 广告组详情组件数据字段
idx = seg.indexOf('adGroupData');
if (idx >= 0) {
  console.log('adGroupData @' + (305000+idx));
  console.log(seg.slice(Math.max(0,idx-200), idx+300).replace(/\n/g,' '));
}
