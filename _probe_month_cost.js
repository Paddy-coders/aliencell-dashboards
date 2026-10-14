// _probe_month_cost.js — 排查「月看板 商品成本」与 profit_metrics.json 的差异来源(一次性探针, 不入回归)
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

  const info = await page.evaluate(() => {
    selMonth.clear(); selCountry.clear(); selCountry.add('US');
    const all = filteredRows();
    const keys = all.length ? Object.keys(all[0]) : [];
    // 找月份字段
    const mKey = keys.includes('m') ? 'm' : (keys.includes('ym') ? 'ym' : (keys.includes('month') ? 'month' : null));
    const months = [...new Set(all.map(r => String(r[mKey])))].filter(x => /^\d{4}-\d{2}/.test(x)).sort();
    const mo = '2026-09';
    const rows = all.filter(r => String(r[mKey]).slice(0, 7) === mo);
    const per = {}; let sales = 0, pSales = 0, pCost = 0, pQty = 0, n = 0;
    rows.forEach(r => {
      sales += Number(r.sales) || 0; pSales += Number(r.pSales) || 0;
      pCost += Number(r.pCost) || 0; pQty += Number(r.pQty) || 0; n++;
      per[r.asin] = { c: Number(r.pCost) || 0, s: Number(r.pSales) || 0 };
    });
    return { keys, mKey, months, mo, n, sales, pSales, pCost, pQty, per, costPct: -pCost / pSales * 100 };
  });
  fs.writeFileSync('_probe_page_month.json', JSON.stringify(info));
  console.log('写盘 _probe_page_month.json');
  console.log(JSON.stringify(info, null, 1).slice(0, 1200));
  console.log('pageerror:', errs);
  await browser.close();
})();
