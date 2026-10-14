// _probe_daily.js — 读日看板合计行（诊断用，勿入回归）
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
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
  // 看板会把云端 wootCfg 规范化成 {price, cost}(键排序 + price 兜底 1380) 再比对 → 种子必须同形, 否则 reload
  const normCfg = (c) => {
    const price = (c && c.price) ? c.price : 1380;
    const cost = {};
    Object.keys((c && c.cost) || {}).sort().forEach(k => { cost[k] = c.cost[k]; });
    return { price, cost };
  };
  const wootCfg = cloud.wootCfg ? normCfg(cloud.wootCfg) : null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2400, height: 1000 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot || []));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || null));
  }, { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg });
  const stub = { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg };
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 200)));
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: stub }]) }));
  await page.goto('file:///' + path.join(BASE, '_deploy/daily.html'), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(12000);
  const out = await page.evaluate(() => {
    const r = {};
    // 表格
    const tbl = document.querySelector('table');
    if (tbl) {
      const rows = [...tbl.querySelectorAll('tr')];
      r.nRows = rows.length;
      const head = rows[0] ? rows[0].innerText.replace(/\t/g, '|').replace(/\s+/g, ' ').slice(0, 1200) : null;
      r.head = head;
      // 合计行
      const totIdx = rows.findIndex(tr => /合计/.test(tr.innerText));
      if (totIdx >= 0) {
        r.totalRow = [...rows[totIdx].querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim());
      }
      const firstBody = rows[1] ? [...rows[1].querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : null;
      r.firstBody = firstBody;
    }
    try { r.metrics = (typeof METRICS !== 'undefined') ? METRICS.map(m => m.key + '/' + (m.label || m.short || '')) : null; } catch (e) { r.metrics = String(e); }
    try { r.dispCur = (typeof DISP_CUR !== 'undefined') ? DISP_CUR : null; } catch (e) { }
    try { r.nDays = (typeof DATA !== 'undefined' && DATA.days) ? Object.keys(DATA.days).length : null; } catch (e) { }
    return r;
  });
  console.log('DISP_CUR:', out.dispCur, ' 天数:', out.nDays, ' 表格行数:', out.nRows);
  console.log('METRICS:', JSON.stringify(out.metrics));
  console.log('表头:', out.head);
  console.log('首行:', JSON.stringify(out.firstBody));
  console.log('合计行:', JSON.stringify(out.totalRow));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
