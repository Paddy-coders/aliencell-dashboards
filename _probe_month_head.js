// _probe_month_head.js — 核对线上月看板的「头程」(页面侧按成本表 headRMB 计算) 是否非 0 且与独立手算一致
// 只读, 不入回归。
const fs = require('fs');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, timeout: 15000 }, res => {
      const bufs = []; res.on('data', c => bufs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  const cloud = (await fetchJson(SB_URL))[0].data;
  const stub = { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [], woot: [], wootCfg: null };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 960 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify([]));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(null));
  }, stub);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: stub }]) }));

  await page.goto('file:///' + BASE + '/monthly.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(6000);

  const out = await page.evaluate(() => {
    const res = { months: [], headRmbOf: {}, embedMapN: 0, err: null };
    try {
      res.embedMapN = (typeof EMBED_MAP !== 'undefined' && EMBED_MAP) ? (EMBED_MAP.asinMap || []).length : -1;
    } catch (e) { res.embedMapN = 'ERR:' + e.message; }
    selMonth.clear(); selCountry.clear(); selChannel.clear(); selPlatform.clear(); selRegion.clear();
    if (selAsin) selAsin.clear(); if (selSeries) selSeries.clear(); if (selName) selName.clear();
    const all = filteredRows();
    const ms = [...new Set(all.map(r => String(r.ym).slice(0, 7)))].filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
    for (const ym of ms) {
      const a = aggMonth(ym, filteredRows());
      if (!a) { res.months.push({ ym, null: true }); continue; }
      res.months.push({ ym, pHead: a.pHead, pCost: a.pCost, pSales: a.pSales, pQty: a.pQty, pN: a.pN,
        profit: monthVal(a, 'profit'), margin: monthVal(a, 'margin'), costPct: monthVal(a, 'costPct') });
    }
    for (const a of ['B0H69JJZ1M', 'B0H75HMBF5', 'B0H6QGKLJK', 'B0H6QNBPNF']) {
      try { res.headRmbOf[a] = { US: headRmbOf(a, 'US'), UK: headRmbOf(a, 'UK'), DE: headRmbOf(a, 'DE') }; }
      catch (e) { res.headRmbOf[a] = 'ERR:' + e.message; }
    }
    return res;
  });

  console.log('内嵌映射 asinMap 条数(线上页面):', out.embedMapN);
  console.log('headRmbOf 抽样(页面内解析成本表头程 RMB/台):');
  console.log(JSON.stringify(out.headRmbOf, null, 1));
  console.log('\n各月页面侧聚合 (USD):');
  for (const m of out.months) {
    if (m.null) { console.log('  ' + m.ym + '  (无行)'); continue; }
    const f = (x) => (x === null || x === undefined) ? '—' : Number(x).toFixed(2);
    console.log('  ' + m.ym + '  销售额 ' + f(m.pSales) +
      '  商品成本 ' + f(m.pCost) +
      '  头程 ' + f(m.pHead) +
      '  毛利 ' + f(m.profit) + ' (' + (m.margin === null || m.margin === undefined ? '—' : (m.margin * 100).toFixed(1) + '%') + ')' +
      '  成本% ' + (m.costPct === null || m.costPct === undefined ? '—' : (m.costPct * 100).toFixed(2) + '%') +
      '  件数 ' + m.pQty + '  利润报表行 ' + m.pN);
  }
  console.log('\npageerror:', errs.length ? errs : '无');
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
