// 临时探针: 各周毛利与费用占比对照(定位异常列) —— 不入回归
// 用法: node _probe_wk_ratios.js [file:///.../product.html]
const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fetchJson(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, timeout: 15000 }, s => {
      const b = []; s.on('data', c => b.push(c));
      s.on('end', () => { try { res(JSON.parse(Buffer.concat(b).toString('utf8'))); } catch (e) { rej(e); } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej);
  });
}
(async () => {
  const FILE = process.argv[2] || 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html';
  const cloud = (await fetchJson(SB_URL))[0].data;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 2200, height: 1100 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  }, { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.route('**/rest/v1/mapping*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [], woot: [], wootCfg: cloud.wootCfg || null } }])
  }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(9000);

  const out = await page.evaluate(() => {
    const g = (o, k) => (o && typeof o[k] === 'number') ? o[k] : 0;
    const c = calc();
    const rows = [];
    for (const lb of Object.keys(c.perWeek).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
      const w = c.perWeek[lb];
      const S = g(w, 'pSales'), cost = g(w, 'pCost'), fba = g(w, 'pFba'), other = g(w, 'pOther'),
        storage = g(w, 'pStorage'), promo = g(w, 'pPromo'), comm = g(w, 'pComm'), vat = g(w, 'pVat'), head = g(w, 'pHead'),
        ad = g(w, 'adSpend');
      const pct = (x) => S > 0 ? (x / S * 100) : null;
      rows.push({
        lb: lb, n: g(w, 'pN'), qty: g(w, 'pQty'), S: S, bizSales: g(w, 'sales'), sessions: g(w, 'sessions'),
        cost: cost, fba: fba, other: other, storage: storage, promo: promo, comm: comm, vat: vat, head: head, ad: ad,
        gross: S + promo + comm + fba + cost + storage + other,
        profit: profitOf(w),
        costPct: pct(cost), fbaPct: pct(fba), otherPct: pct(other), storagePct: pct(storage),
        promoPct: pct(promo), commPct: pct(comm), adPct: pct(ad), headPct: pct(head),
      });
    }
    return rows;
  });

  const cols = [
    ['S(报表销售额)', 'S', 12], ['毛利', 'profit', 11], ['毛利率%', null, 9],
    ['成本', 'cost', 11], ['成本%', 'costPct', 9],
    ['FBA(配送费)', 'fba', 10], ['FBA%', 'fbaPct', 8],
    ['其他费用', 'other', 9], ['其他%', 'otherPct', 8],
    ['仓储', 'storage', 8], ['仓储%', 'storagePct', 8],
    ['promo', 'promo', 10], ['promo%', 'promoPct', 8], ['comm', 'comm', 10], ['comm%', 'commPct', 8],
    ['广告费', 'ad', 10], ['广告%', 'adPct', 8], ['头程', 'head', 9], ['qty', 'qty', 5],
  ];
  const fmt = (v, w) => (v === null || v === undefined) ? '—'.padStart(w) : (Math.abs(v) >= 1000 ? Number(v).toFixed(0) : Number(v).toFixed(2)).padStart(w);
  console.log('周'.padEnd(4) + cols.map(([h, , w]) => h.padStart(w)).join(''));
  for (const r of out) {
    r['毛利率%'] = r.S > 0 ? r.profit / r.S * 100 : null;
    console.log(r.lb.padEnd(4) + cols.map(([, k, w]) => fmt(r[k], w)).join(''));
  }
  console.log('\n说明: 成本% = 商品成本 ÷ 利润报表销售额; FBA% = 配送费 ÷ 报表销售额(均为原符号, 费用为负)');
  if (errs.length) console.log('页面错误:', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
