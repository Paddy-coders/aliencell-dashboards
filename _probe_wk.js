// _probe_wk.js — 周看板 KPI 构成探针（诊断用，勿入回归）
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const DEPLOY = path.join(BASE, '_deploy');
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
  const cloud = (await fetchJson(SB_URL))[0].data;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 1000 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot || []));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || null));
  }, cloud);
  const stub = { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg: cloud.wootCfg || null };
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 200)));
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: stub }]) }));
  await page.goto('file:///' + path.join(DEPLOY, 'product.html'), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(() => {
    const r = {};
    r.weeksAll = (typeof WEEKS !== 'undefined') ? WEEKS.length : null;
    try { r.weekLabels = (typeof WEEKS !== 'undefined') ? WEEKS.map(w => w.label) : null; } catch (e) { r.weekLabels = String(e); }
    r.adsWeeks = Object.keys(ADS || {}).length ? [...new Set(Object.values(ADS).flatMap(v => Object.keys(v.weeks || {})))].sort() : [];
    // ADS 逐周合计（未换算，原币种混合）
    const adByWeekRaw = {};
    for (const a in ADS) for (const lab in (ADS[a].weeks || {})) for (const cc in ADS[a].weeks[lab]) {
      const s = Number((ADS[a].weeks[lab][cc] || {}).spend) || 0;
      adByWeekRaw[lab] = (adByWeekRaw[lab] || 0) + s;
    }
    r.adByWeekRaw = adByWeekRaw;
    r.adRawTotal = Object.values(adByWeekRaw).reduce((a, b) => a + b, 0);
    try {
      const c = calc();
      r.calcAdSpend = c.totals ? c.totals.adSpend : null;
      r.calcSales = c.totals ? c.totals.sales : null;
      r.calcOrders = c.totals ? c.totals.orders : null;
      r.calcPSales = c.totals ? c.totals.pSales : null;
      r.calcPVat = c.totals ? c.totals.pVat : null;
      r.calcProfit = (c.totals && c.totals.pN) ? (typeof profitOf === 'function' ? profitOf(c.totals) : null) : null;
      r.weeksInCalc = c.rows ? c.rows.length : null;
      r.calcWeekLabels = c.rows ? c.rows.map(x => x.label || x.w || x.week) : null;
    } catch (e) { r.calcErr = String(e).slice(0, 300); }
    try { r.targetCur = (typeof targetCur === 'function') ? targetCur() : null; } catch (e) { r.targetCur = String(e); }
    try { r.fx = (typeof FX !== 'undefined') ? FX : null; } catch (e) { }
    r.metrics = (typeof METRICS !== 'undefined') ? METRICS.map(m => m.key) : null;
    return r;
  });
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
