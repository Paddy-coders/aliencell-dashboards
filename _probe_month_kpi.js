// _probe_month_kpi.js — 读月看板各月 KPI(毛利/毛利率/销售额), 用于口径变更后的量化记录(一次性探针)
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
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
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
    selMonth.clear(); selCountry.clear(); selAsin.clear(); selSeries.clear(); selName.clear();
    const ks = MONTHS.map(m => m.ym);
    const pick = (o, keys) => {
      const r = {};
      for (const k of keys) { try { r[k] = monthVal(o, k); } catch (e) { r[k] = 'ERR'; } }
      return r;
    };
    const res = {};
    for (const m of ks) {
      const a = aggMonth(m, filteredRows());
      res[m] = pick(a, ['pSales', 'pCost', 'profit', 'margin', 'costPct']);
      // 兜底: 若上面的键名不存在, 把可枚举的键列出来供诊断
      if (res[m].profit === undefined || res[m].profit === 'ERR') {
        res[m]._keys = Object.keys(a).slice(0, 40);
      }
    }
    return { ks, res };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log('pageerror:', errs);
  await browser.close();
})();
