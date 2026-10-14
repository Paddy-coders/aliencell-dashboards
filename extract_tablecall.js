const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 所有 Report.GetAdvPerformanceList 调用，找回调含 tableData 的
let idx = -1, count = 0;
while ((idx = s.indexOf('Report.GetAdvPerformanceList', idx+1)) >= 0) {
  const after = s.slice(idx, idx+400);
  if (after.includes('tableData')) {
    console.log('=== TABLE CALL @' + idx + ' ===');
    console.log(s.slice(idx-3000, idx+100).replace(/\n/g,' '));
    console.log('');
  }
  count++;
}
console.log('total occurrences:', count);
