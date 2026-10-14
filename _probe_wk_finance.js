// 临时探针: 读周看板各周毛利构成(头程/入境费/多渠道/剔除/测评费) —— 不入回归
// 用法: node _probe_wk_finance.js [file:///.../product.html]
// 从云端映射表拉 pc_asinmap 注入 localStorage(头程需要 ASIN→产品名 才查得到成本表)
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
  console.log('云端映射: catalog %d · asinMap %d', (cloud.catalog || []).length, (cloud.asinMap || []).length);
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
    const c = calc(); const rows = [];
    for (const lb of Object.keys(c.perWeek)) {
      const w = c.perWeek[lb];
      rows.push({ lb: lb, pN: w.pN, profit: profitOf(w), gross: w.pSales + w.pPromo + w.pComm + w.pFba + w.pCost + w.pStorage + w.pOther,
        vat: g(w, 'pVat'), head: g(w, 'pHead'), adj: g(w, 'pMcAdj'), rev: g(w, 'pReview'), inb: g(w, 'pInb'),
        mqty: g(w, 'pMqty'), mloss: -(g(w, 'pMcost') + g(w, 'pMhead') + g(w, 'pMship')), ad: w.adSpend });
    }
    const t = c.totals;
    return { metaCount: Object.keys(__ASIN_META).length, rows: rows,
      tot: { pN: t.pN, qty: g(t, 'pQty'), sales: g(t, 'pSales'), vat: g(t, 'pVat'), head: g(t, 'pHead'), adj: g(t, 'pMcAdj'),
             rev: g(t, 'pReview'), inb: g(t, 'pInb'), mqty: g(t, 'pMqty'), mloss: -(g(t, 'pMcost') + g(t, 'pMhead') + g(t, 'pMship')),
             ad: t.adSpend, profit: profitOf(t) } };
  });
  const f = (v) => (v === null || v === undefined) ? '    —    ' : Number(v).toFixed(2).padStart(10);
  console.log('__ASIN_META:', out.metaCount);
  console.log('周   |     毛利     |  毛利率基(gross)  |      VAT    |     头程     | 剔除加回 | 测评费 |  入境费(展示) | 多渠道 | 多渠道损失 |   广告费');
  for (const w of out.rows) {
    console.log(w.lb.padEnd(4), '|', f(w.pN ? w.profit : null), '|', f(w.gross), '|', f(w.vat), '|', f(w.head), '|',
      f(w.adj), '|', f(w.rev), '|', f(w.inb), '|', String(w.mqty).padStart(6), '|', f(w.mloss), '|', f(w.ad));
  }
  const t = out.tot;
  console.log('TOT ', '|', f(t.profit), '|', '          ', '|', f(t.vat), '|', f(t.head), '|', f(t.adj), '|', f(t.rev), '|',
    f(t.inb), '|', String(t.mqty).padStart(6), '|', f(t.mloss), '|', f(t.ad));
  console.log('totals: pQty=%s pSales=%s', t.qty, t.sales.toFixed(2));
  if (errs.length) console.log('PAGEERR:', errs.slice(0, 3));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
