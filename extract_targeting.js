const fs = require('fs');
const s = fs.readFileSync('chunk_09d9.js','utf8');

function dump(label, kw, before, after, max) {
  let idx = -1, count = 0;
  while ((idx = s.indexOf(kw, idx+1)) >= 0 && count < (max||10)) {
    console.log(`=== ${label} @${idx} ===`);
    console.log(s.slice(Math.max(0,idx-before), Math.min(s.length, idx+after)).replace(/\n/g,' '));
    console.log('');
    count++;
  }
}

// 1. adTypeEnum 定义
dump('adTypeEnum', 'adTypeEnum', 200, 600, 3);
// 2. TargetingType
dump('TargetingType', 'TargetingType', 300, 300, 8);
// 3. hasKeywordData
dump('hasKeywordData', 'hasKeywordData', 400, 400, 4);
// 4. AdGroupBidKw.GetList
dump('BidKw', 'AdGroupBidKw.GetList', 1500, 300, 4);
// 5. AdGroupQuery.GetList
dump('Query', 'AdGroupQuery.GetList', 1200, 300, 4);
