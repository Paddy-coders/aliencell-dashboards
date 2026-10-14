// 生成示例月度目标 monthly_targets.json (基于实际数据推算, 仅用于预览看板逻辑)
// 目标销售额为人民币(RMB), 按每月1号汇率折算; 附带目标广告占比(adShare %)
// 用法: node gen_sample_targets.js
const fs = require('fs');
const https = require('https');

const SPECIAL_ASIN = { 'X1-SBV-片段2': 'B0H69JJZ1M', 'X1-SB-定投旗舰店-LC-B2B': 'B0H69JJZ1M', 'X1-SB-定投旗舰店首页-B2B': 'B0H69JJZ1M' };
function extractAsin(it) {
  const a = (it.Asin || '').trim(); if (a) return a;
  const c = (it.CampaignName || it.Name || '').trim();
  if (SPECIAL_ASIN[c]) return SPECIAL_ASIN[c];
  const m = c.match(/B0[A-Z0-9]{8}/); return m ? m[0] : null;
}
const CUR_OF = { US:'USD', CA:'CAD', MX:'MXN', UK:'GBP', JP:'JPY', AU:'AUD', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', NL:'EUR', BE:'EUR', IE:'EUR', PL:'PLN', SE:'SEK' };
// 地区: NA=北美(US/CA/MX), EU=欧盟9国, UK/JP/AU 独立 (目标 country 列为地区代码)
const REGION_OF = { US:'NA', CA:'NA', MX:'NA', UK:'UK', JP:'JP', AU:'AU', DE:'EU', FR:'EU', IT:'EU', ES:'EU', NL:'EU', BE:'EU', IE:'EU', PL:'EU', SE:'EU' };
function regionOf(cc) { return REGION_OF[cc] || cc; }

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' }, headers || {}) }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const bufs = []; res.on('data', c => bufs.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
// 每月1号 → CNY 汇率 (遇非工作日回退), 缓存 fx_rates.json (与 build_monthly_dashboards.py 共用)
async function fxRate(ym, cur) {
  const cacheFile = __dirname + '/fx_rates.json';
  let cache = { rates: {}, meta: {} };
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
  cache.rates = cache.rates || {}; cache.meta = cache.meta || {};
  if (cache.rates[ym] && cache.rates[ym][cur]) return cache.rates[ym][cur];
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const first = new Date(Date.UTC(y, m - 1, 1));
  for (let i = 0; i < 7; i++) {
    const d = new Date(first.getTime() - i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    try {
      const j = await fetchJson('https://api.frankfurter.dev/v1/' + ds + '?base=' + cur + '&symbols=CNY');
      const r = j && j.rates && j.rates.CNY;
      if (r) {
        cache.rates[ym] = cache.rates[ym] || {};
        cache.rates[ym][cur] = r;
        cache.meta[ym + '|' + cur] = j.date || ds;
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1), 'utf8');
        return r;
      }
    } catch (e) { /* 尝试前一天 */ }
  }
  throw new Error('汇率获取失败: ' + ym + ' ' + cur);
}

(async () => {
  // 1. 云端产品映射
  const rows = await fetchJson('https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1',
    { 'apikey': 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s', 'Authorization': 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s' });
  const map = rows[0].data;
  console.log('云端映射:', map.asinMap.length, '条');

  // 2. 日数据按 月×国家×ASIN 聚合 (units/sales + 广告花费)
  const daily = JSON.parse(fs.readFileSync(__dirname + '/daily_data.json', 'utf8'));
  const agg = {};
  for (const d of Object.keys(daily.days)) {
    const ym = d.slice(0, 7);
    for (const r of daily.days[d].biz || []) {
      const k = ym + '|' + (r.site || 'US') + '|' + r.asin;
      agg[k] = agg[k] || { units: 0, sales: 0, cost: 0 };
      agg[k].units += Number(r.units_ordered) || 0;
      agg[k].sales += Number(r.ordered_product_sales_amount) || 0;
    }
    for (const [cc, items] of Object.entries(daily.days[d].ads || {})) {
      for (const it of items) {
        const a = extractAsin(it); if (!a) continue;
        const k = ym + '|' + cc + '|' + a;
        agg[k] = agg[k] || { units: 0, sales: 0, cost: 0 };
        agg[k].cost += Number((it.Report || {}).Cost) || 0;
      }
    }
  }

  // 3. 汇率 (7/8月 USD; 数据涉及的国家币种全部取)
  const ccSet = new Set();
  for (const k of Object.keys(agg)) { const cc = k.split('|')[1]; if (agg[k].sales || agg[k].cost) ccSet.add(cc); }
  const curs = [...new Set([...ccSet].map(c => CUR_OF[c] || 'USD'))].sort();
  const fx = {};
  for (const ym of ['2026-07', '2026-08']) {
    fx[ym] = {};
    for (const cur of curs) fx[ym][cur] = await fxRate(ym, cur);
    console.log('汇率 ' + ym + ': ' + curs.map(c => c + '→CNY ' + fx[ym][c]).join(', '));
  }
  const toCny = (ym, cc, v) => (fx[ym][CUR_OF[cc] || 'USD'] || 0) * v;

  // 4. 按产品名汇总 7月实际 (按地区聚合, 折算人民币, 含广告花费)
  const byProduct = {};
  for (const [k, v] of Object.entries(agg)) {
    const [ym, cc, asin] = k.split('|');
    if (ym !== '2026-07') continue;
    const m = map.asinMap.find(x => x.asin === asin && (x.country || 'EU') === cc);
    if (!m) continue;
    const pk = regionOf(cc) + '|' + m.series + '|' + m.name;
    byProduct[pk] = byProduct[pk] || { units: 0, salesCny: 0, costCny: 0 };
    byProduct[pk].units += v.units;
    byProduct[pk].salesCny += toCny(ym, cc, v.sales);
    byProduct[pk].costCny += toCny(ym, cc, v.cost);
  }

  // 5. 生成目标: 7月=实际×0.9 (达标展示), 8月=实际×1.2 (领先/落后展示)
  //    广告占比: 7月目标=实际占比+5pp (达标展示), 8月目标=实际占比-8pp (超标展示)
  const targets = [];
  const mappedProducts = new Set(map.asinMap.filter(x => (x.country || 'EU') === 'US').map(x => regionOf('US') + '|' + x.series + '|' + x.name));
  for (const pk of mappedProducts) {
    if (!byProduct[pk]) byProduct[pk] = { units: 0, salesCny: 0, costCny: 0 };
  }
  for (const [pk, v] of Object.entries(byProduct)) {
    const [cc, series, name] = pk.split('|');
    const isHost = /主机/.test(name);
    const baseU = v.units > 0 ? v.units : (isHost ? 5 : 2);
    const baseS = v.salesCny > 0 ? v.salesCny : (isHost ? 8000 : 1200) * fx['2026-07'].USD;
    const share = v.salesCny > 0 ? v.costCny / v.salesCny * 100 : 20;
    const julyU = Math.ceil(baseU * 0.9);
    const julyS = Math.round(baseS * 0.9);
    const augU = Math.ceil(baseU * 1.2);
    const augS = Math.round(baseS * 1.2);
    const julyShare = Math.round((share + 5) * 10) / 10;   // 实际占比+5pp → 达标
    const augShare = Math.max(Math.round((share - 8) * 10) / 10, 4); // 实际占比-8pp → 超标
    if (julyU > 0 || julyS > 0) targets.push({ month: '2026-07', country: cc, product: name, units: julyU, sales: julyS, adShare: julyShare });
    if (augU > 0 || augS > 0) targets.push({ month: '2026-08', country: cc, product: name, units: augU, sales: augS, adShare: augShare });
  }
  // 系列级目标示例 (X1 Lite 系列 整体)
  const liteAsins = map.asinMap.filter(x => x.series === 'X1 Lite系列').map(x => x.asin);
  let liteU7 = 0, liteS7 = 0, liteC7 = 0;
  for (const [k, v] of Object.entries(agg)) {
    const [ym, cc, asin] = k.split('|');
    if (ym === '2026-07' && cc === 'US' && liteAsins.includes(asin)) { liteU7 += v.units; liteS7 += toCny(ym, cc, v.sales); liteC7 += toCny(ym, cc, v.cost); }
  }
  if (liteU7 > 0) {
    const sh = liteS7 > 0 ? liteC7 / liteS7 * 100 : 20;
    targets.push({ month: '2026-07', country: 'NA', product: 'X1 Lite系列', units: Math.ceil(liteU7 * 0.9), sales: Math.round(liteS7 * 0.9), adShare: Math.round((sh + 5) * 10) / 10 });
    targets.push({ month: '2026-08', country: 'NA', product: 'X1 Lite系列', units: Math.ceil(liteU7 * 1.2), sales: Math.round(liteS7 * 1.2), adShare: Math.max(Math.round((sh - 8) * 10) / 10, 4) });
  }
  // 未匹配示例 (展示未匹配警示)
  targets.push({ month: '2026-08', country: 'NA', product: '不存在的测试产品', units: 100, sales: 50000, adShare: 30 });

  const out = { sample: true, note: '示例目标(按7月实际推算, 销售额为人民币): 7月=实际×0.9, 8月=实际×1.2; 广告占比7月=实际+5pp, 8月=实际-8pp; country 为地区代码(NA=US/CA/MX, EU=欧盟); 上传正式目标表后替换', targets };
  fs.writeFileSync(__dirname + '/monthly_targets.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('OK monthly_targets.json:', targets.length, '条示例目标 (人民币)');
  console.log(targets.slice(0, 4).map(t => `${t.month} ${t.country} ${t.product}: ${t.units}件 / ¥${t.sales} / 占比≤${t.adShare}%`).join('\n'));
})();
