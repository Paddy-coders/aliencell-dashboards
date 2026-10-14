// 验证正式目标表版 target.html (playwright)
// 用法: NODE_PATH=... node test_target_official.js
const { https } = { https: require('https') };
const { chromium } = require('./playwright-auth');

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      const bufs = []; res.on('data', c => bufs.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  // 预取云端映射注入 (与真实使用一致)
  let mapData = { catalog: [], asinMap: [] };
  try {
    const rows = await fetchJson('https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1',
      { 'apikey': 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s', 'Authorization': 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s' });
    mapData = rows[0].data;
    console.log('云端映射: ' + mapData.asinMap.length + ' 条');
  } catch (e) { console.log('警告: 云端映射获取失败'); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript((md) => {
    localStorage.setItem('pc_catalog', JSON.stringify(md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(md.asinMap));
  }, mapData);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/target.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tableWrap tbody tr')];
    const tds = rows.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    const stats = {};
    tds.forEach(t => { if (t[6] !== undefined) stats[t[6]] = (stats[t[6]] || 0) + 1; });
    let matched = 0, unmatched = 0;
    tds.forEach(t => { if ((t[3] || '').includes('未找到')) unmatched++; else if (t[3]) matched++; });
    const regions = {}, months = {};
    tds.forEach(t => { if (t[1]) regions[t[1]] = (regions[t[1]] || 0) + 1; });
    tds.forEach(t => { if (t[0]) months[t[0].slice(0, 7)] = (months[t[0].slice(0, 7)] || 0) + 1; });
    return { total: rows.length, stats, matched, unmatched, regions, months,
      kpi: document.querySelectorAll('.kpi').length,
      hasSample: document.body.textContent.includes('示例目标') };
  });
  console.log('表格行数:', r.total, '| KPI 卡:', r.kpi, '| 残留示例标记:', r.hasSample);
  console.log('月份分布:', r.months);
  console.log('地区分布:', r.regions);
  console.log('匹配:', r.matched, '| 未匹配:', r.unmatched);
  console.log('状态分布:', r.stats);

  // 8月 NA X1主机+40W 样例行
  const sample = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(t => t.textContent.includes('2026-08') && t.textContent.includes('北美') && t.textContent.includes('X1主机+40W'));
    return tr ? [...tr.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
  });
  console.log('\n8月 NA X1主机+40W 行:', sample);

  // 地区下拉（修正选择器：target.html 的地区筛选 id 是 ddCountry，并没有 .ddRegion 这个 class
  // —— 原来写 .ddRegion 所以恒印 []，属诊断脚本自身的选择器 bug，与看板无关）
  const regionOpts = await page.evaluate(() => [...document.querySelectorAll('#ddCountryList .dd-opt .opt-name')].map(o => o.textContent.trim()));
  console.log('地区下拉:', regionOpts);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
})();
