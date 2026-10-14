const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 提取 getList_chart 完整函数 @253300 附近
console.log(s.slice(253300, 255800).replace(/\n/g,' '));
console.log('\n\n===== adType / adId 赋值处 =====');
// 找 import.adType 的赋值：搜索 "adType:"
let idx = -1, count=0;
while ((idx = s.indexOf('adType:', idx+1)) >= 0 && count < 20) {
  console.log('@' + idx + ': ' + s.slice(Math.max(0,idx-150), idx+150).replace(/\n/g,' '));
  console.log('');
  count++;
}
