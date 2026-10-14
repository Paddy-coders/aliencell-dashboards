const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
// 表格视图调用 @1403151 - 提取请求构建全貌（往前 2500 字符）
let idx = s.indexOf('t.tableData=e.data.data.Items,t.page.count=e.data.data.TotalCount');
console.log('=== TABLE VIEW @' + idx + ' ===');
console.log(s.slice(idx-2600, idx+80).replace(/\n/g,' '));
