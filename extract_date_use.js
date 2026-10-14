const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
const seg = s.slice(265000, 545000);
// this.Date 使用位置
let idx = -1, count = 0;
const uses = [];
while ((idx = seg.indexOf('this.Date', idx+1)) >= 0 && count < 30) {
  const ctx = seg.slice(Math.max(0,idx-80), idx+120).replace(/\n/g,' ');
  uses.push('@' + (265000+idx) + ': ' + ctx);
  count++;
}
console.log('this.Date 使用次数:', uses.length);
for (const u of uses.slice(0, 12)) console.log(u + '\n---');
