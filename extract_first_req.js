const fs = require('fs');
const d = JSON.parse(fs.readFileSync('probe_urls.json','utf8'));
console.log('总条数:', d.length);
// 打印第一条完整结构
console.log('--- 第一条 ---');
console.log(JSON.stringify(d[0], null, 1).slice(0, 1500));
