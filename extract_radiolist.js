const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');
let idx = -1, count = 0;
while ((idx = s.indexOf('radioList:function', idx+1)) >= 0 && count < 12) {
  const before = s.slice(Math.max(0,idx-300), idx);
  const m = before.match(/(name:"[^"]+")/g);
  const lastMarker = m ? m[m.length-1] : '?';
  console.log('@' + idx + ' | ' + lastMarker);
  count++;
}
