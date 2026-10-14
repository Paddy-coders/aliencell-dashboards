// 临时探针: 拆解指定周的毛利构成(按 国家×ASIN), 定位异常驱动项 —— 不入回归
// 用法: node _probe_w36.js [W36] [file:///.../product.html]
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
  const WEEK = process.argv[2] || 'W36';
  const FILE = process.argv[3] || 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html';
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

  const out = await page.evaluate((WEEK) => {
    const g = (o, k) => (o && typeof o[k] === 'number') ? o[k] : 0;
    const recs = [];
    const globals = { sales: 0, promo: 0, comm: 0, fba: 0, cost: 0, storage: 0, other: 0, n: 0, qty: 0, ad: 0, head: 0, vat: 0, profit: 0, refSales: 0, refPromo: 0, refComm: 0, refShip: 0, refFba: 0, fbRet: 0, fbOth: 0, fbOvr: 0, fbCon: 0, fbCar: 0, fbRem: 0, fbMst: 0, fbLst: 0, mcAdj: 0, mcCost: 0, mcHead: 0, mcShip: 0 };
    // 遍历每个 ASIN 的每周数据(PROFIT 侧的等效字段在 asinWeekData 里)
    for (const asin of Object.keys(__ASIN_META)) {
      const rec = (typeof asinWeekData === 'function') ? null : null;
      void rec;
    }
    // 直接用 PROFIT 原始表按 国家×ASIN 拆
    for (const asin of Object.keys(PROFIT)) {
      const pw = PROFIT[asin].weeks ? PROFIT[asin].weeks[WEEK] : null;
      if (!pw) continue;
      for (const cc of Object.keys(pw)) {
        const p = pw[cc];
        const s = g(p, 'sales'), fba = g(p, 'fba'), cost = g(p, 'cost');
        const row = {
          asin: asin, cc: cc,
          name: (__ASIN_META[asin] && (__ASIN_META[asin].name || __ASIN_META[asin].title)) || '',
          sales: s, promo: g(p, 'promo'), comm: g(p, 'comm'), fba: fba, cost: cost,
          storage: g(p, 'storage'), other: g(p, 'other'), n: g(p, 'n'), qty: g(p, 'qty'),
          refSales: g(p, 'refSales'), refPromo: g(p, 'refPromo'), refComm: g(p, 'refComm'),
          refShip: g(p, 'refShip'), refFba: g(p, 'refFba'),
          fbRet: g(p, 'fbRet'), fbOth: g(p, 'fbOth'), fbOvr: g(p, 'fbOvr'), fbCon: g(p, 'fbCon'),
          fbCar: g(p, 'fbCar'), fbRem: g(p, 'fbRem'), fbMst: g(p, 'fbMst'), fbLst: g(p, 'fbLst'),
          mcqty: g(p, 'mqty'), mcost: g(p, 'mcost'), mhead: g(p, 'mhead'), mship: g(p, 'mship'),
          head: g(p, 'head'), vat: g(p, 'vat'),
        };
        row.gross = row.sales + row.promo + row.comm + row.fba + row.cost + row.storage + row.other + row.refSales + row.refPromo + row.refComm + row.refShip - row.vat;
        row.fbaPct = row.sales > 0 ? row.fba / row.sales * 100 : null;
        row.costPct = row.sales > 0 ? row.cost / row.sales * 100 : null;
        recs.push(row);
      }
    }
    // 该周页面口径的毛利/广告
    const c = calc();
    const w = c.perWeek[WEEK] || null;
    const wk = w ? {
      sales: w.pSales, profit: profitOf(w), ad: w.adSpend, n: w.pN, qty: g(w, 'pQty'),
      fba: g(w, 'pFba'), cost: g(w, 'pCost'), other: g(w, 'pOther'), storage: g(w, 'pStorage'),
      promo: g(w, 'pPromo'), comm: g(w, 'pComm'), vat: g(w, 'pVat'), head: g(w, 'pHead'),
      bizSales: w.sales, sessions: w.sessions, units: w.units, orders: w.orders,
    } : null;
    return { recs: recs, wk: wk, metaCount: Object.keys(__ASIN_META).length, profitAsins: Object.keys(PROFIT).length };
  }, WEEK);

  const f = (v, w = 12) => (v === null || v === undefined) ? '—'.padStart(w) : Number(v).toFixed(2).padStart(w);
  console.log('周:', WEEK, '| __ASIN_META:', out.metaCount, '| PROFIT ASIN 数:', out.profitAsins);
  console.log('页面口径:', JSON.stringify(out.wk, null, 0));
  console.log('');
  const recs = out.recs.slice().sort((a, b) => a.gross - b.gross);
  console.log('【按 gross(利润报表明细之和) 升序 —— 越负越可疑】');
  console.log('ASIN'.padEnd(13), 'CC'.padEnd(3), 'sales'.padStart(11), 'promo'.padStart(10), 'comm'.padStart(10), 'fba'.padStart(11), 'cost'.padStart(11), 'storage'.padStart(9), 'other'.padStart(10), 'gross'.padStart(12), 'fba%'.padStart(8), 'cost%'.padStart(8), 'qty'.padStart(4));
  for (const r of recs) {
    console.log(r.asin.padEnd(13), r.cc.padEnd(3), f(r.sales, 11), f(r.promo, 10), f(r.comm, 10), f(r.fba, 11), f(r.cost, 11),
      f(r.storage, 9), f(r.other, 10), f(r.gross, 12), f(r.fbaPct, 8), f(r.costPct, 8), String(r.qty).padStart(4));
  }
  const agg = {};
  for (const r of recs) {
    const k = r.cc;
    if (!agg[k]) agg[k] = { sales: 0, promo: 0, comm: 0, fba: 0, cost: 0, storage: 0, other: 0, gross: 0, qty: 0 };
    for (const kk of ['sales', 'promo', 'comm', 'fba', 'cost', 'storage', 'other', 'gross', 'qty']) agg[k][kk] += r[kk];
  }
  console.log('');
  console.log('【按国家汇总】');
  console.log('CC'.padEnd(4), 'sales'.padStart(12), 'fba'.padStart(11), 'cost'.padStart(12), 'other'.padStart(11), 'gross'.padStart(12), 'fba%'.padStart(8), 'cost%'.padStart(8), 'qty'.padStart(5));
  for (const cc of Object.keys(agg).sort()) {
    const a = agg[cc];
    console.log(cc.padEnd(4), f(a.sales, 12), f(a.fba, 11), f(a.cost, 12), f(a.other, 11), f(a.gross, 12),
      f(a.sales > 0 ? a.fba / a.sales * 100 : null, 8), f(a.sales > 0 ? a.cost / a.sales * 100 : null, 8), String(a.qty).padStart(5));
  }
  const T = { sales: 0, fba: 0, cost: 0, other: 0, gross: 0, qty: 0, promo: 0, comm: 0, storage: 0 };
  for (const r of recs) for (const k of Object.keys(T)) T[k] += (r[k] || 0);
  console.log('合计', f(T.sales, 12), f(T.fba, 11), f(T.cost, 12), f(T.other, 11), f(T.gross, 12),
    f(T.sales > 0 ? T.fba / T.sales * 100 : null, 8), f(T.sales > 0 ? T.cost / T.sales * 100 : null, 8), String(T.qty).padStart(5));
  if (errs.length) console.log('\n页面错误:', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
