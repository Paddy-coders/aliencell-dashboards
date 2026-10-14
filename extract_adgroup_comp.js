const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 广告组详情组件范围 @265095 到 @540000，找所有 GetList 调用
const seg = s.slice(265000, 545000);
let idx = -1, count = 0;
const found = [];
while ((idx = seg.indexOf('.GetList', idx+1)) >= 0 && count < 40) {
  const start = Math.max(0, idx-60);
  const act = seg.slice(start, idx+8);
  const m = act.match(/([A-Za-z]+\.GetList)/);
  if (m) found.push(m[1]);
  count++;
}
// 去重输出
console.log('GetList 调用:', [...new Set(found)].join(', '));
console.log('---');
// 找 tab 定义：搜索 activeName / componentObj / tabChange
for (const kw of ['componentObj', 'tabChange', 'activeName']) {
  let i2 = seg.indexOf(kw);
  console.log(kw + ' @ ' + (i2>=0?265000+i2:'-'));
}
