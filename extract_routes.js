const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 找路由定义: path / name 包含 admanagement 附近
// 先找 'newId' 使用处
let idx = -1, count = 0;
while ((idx = s.indexOf('newId', idx+1)) >= 0 && count < 8) {
  console.log('=== newId @' + idx + ' ===');
  console.log(s.slice(Math.max(0,idx-120), idx+120).replace(/\n/g,' '));
  console.log('');
  count++;
}
// 路由 path 定义
idx = -1; count = 0;
while ((idx = s.indexOf('path:"/admanagement', idx+1)) >= 0 && count < 15) {
  const ctx = s.slice(Math.max(0,idx-60), idx+160).replace(/\n/g,' ');
  console.log('ROUTE: ' + ctx);
  console.log('');
  count++;
}
