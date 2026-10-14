const fs = require('fs');
const d = JSON.parse(fs.readFileSync('probe_urls.json','utf8'));
const apiCalls = [];
for (const x of d) {
  try {
    const body = JSON.parse(x.body);
    const action = x.actiontype || (body.actiontype) || '';
    // 从 header 找 actiontype? 没有就尝试 Content 里判断
    apiCalls.push({ action, body, raw: x });
  } catch (e) {}
}
// 打印关键接口的完整请求
const wanted = ['AdGroupBidKw.GetList','AdGroupPAT.GetList','AdGroupQuery.GetList','AdGroup.GetList','AdGroupNegKw.GetList','Campaign.GetList','ProductAd.GetList','AdGroup.GetFlatViewList','Report.GetAdvPerformanceList','Report.GetAdvPerformanceReport'];
for (const w of wanted) {
  const hits = apiCalls.filter(c => JSON.stringify(c.body).includes(w));
  if (hits.length) {
    console.log('=== ' + w + ' (' + hits.length + '次) ===');
    const b = hits[0].body;
    console.log(JSON.stringify(b).slice(0, 1200));
    console.log('');
  } else {
    console.log('=== ' + w + ' (未出现) ===');
  }
}
