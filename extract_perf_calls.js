const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 所有 GetAdvPerformanceList 调用点
let idx = -1, count = 0;
while ((idx = s.indexOf('GetAdvPerformanceList', idx+1)) >= 0 && count < 10) {
  console.log('=== @' + idx + ' ===');
  console.log(s.slice(Math.max(0,idx-500), idx+200).replace(/\n/g,' '));
  console.log('');
  count++;
}
// 所有 GetAdvPerformanceReport 调用点
idx = -1; count = 0;
while ((idx = s.indexOf('GetAdvPerformanceReport', idx+1)) >= 0 && count < 4) {
  console.log('=== Report @' + idx + ' ===');
  console.log(s.slice(Math.max(0,idx-600), idx+150).replace(/\n/g,' '));
  console.log('');
  count++;
}
