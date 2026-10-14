const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
function dump(kw, before, after, max) {
  let idx = -1, count = 0;
  while ((idx = s.indexOf(kw, idx+1)) >= 0 && count < (max||10)) {
    console.log(`=== ${kw} @${idx} ===`);
    console.log(s.slice(Math.max(0,idx-before), Math.min(s.length, idx+after)).replace(/\n/g,' '));
    console.log('');
    count++;
  }
}
// ClassType 赋值
dump('ClassType:', 200, 300, 12);
console.log('####################');
// this.ClassType =
dump('this.ClassType=', 100, 200, 12);
