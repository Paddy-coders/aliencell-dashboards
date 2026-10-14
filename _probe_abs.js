// _probe_kpi.js — 通用 KPI 卡片探针：读日/月/周三看板顶部 KPI 卡片文本（诊断用，勿入回归）
// 用法: node _probe_kpi.js daily.html monthly.html product.html
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
const normCfg = (c) => {
  const price = (c && c.price) ? c.price : 1380;
  const cost = {};
  Object.keys((c && c.cost) || {}).sort().forEach(k => { cost[k] = c.cost[k]; });
  return { price, cost };
};

(async () => {
  const cloud = (await fetchJson(SB_URL))[0].data;
  const wootCfg = cloud.wootCfg ? normCfg(cloud.wootCfg) : null;
  const files = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const f of files) {
    const ctx = await browser.newContext({ viewport: { width: 2400, height: 1200 } });
    await ctx.addInitScript((arg) => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
      localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
      localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
      localStorage.setItem('pc_woot', JSON.stringify(arg.woot || []));
      localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || null));
    }, { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg });
    const stub = { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg };
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: stub }]) }));
    await page.goto('file:///' + f, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForTimeout(11000);
    const out = await page.evaluate(() => {
      const grab = () => {
        const nodes = [...document.querySelectorAll('[class*=kpi], [id*=kpi], [class*=card], [id*=card]')];
        const seen = new Set(); const arr = [];
        nodes.forEach(n => {
          const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 90) return;
          if (seen.has(t)) return; seen.add(t); arr.push(t);
        });
        return arr.slice(0, 40);
      };
      const r = { cards: grab() };
      const t0 = document.querySelector('table');
      if (t0) { const trs=[...t0.querySelectorAll('tr')]; if (trs[0]) r.head = [...trs[0].querySelectorAll('th,td')].map(c=>c.innerText.replace(/\s+/g,' ').trim()); }
      // 表格合计行
      const tbl = document.querySelector('table');
      if (tbl) {
        const rows = [...tbl.querySelectorAll('tr')];
        const ti = rows.findIndex(tr => /合计|总计/.test(tr.innerText));
        if (ti >= 0) r.totalRow = [...rows[ti].querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim()).slice(0, 40);
      }
      try { r.nWeeks = (typeof WEEKS !== 'undefined') ? WEEKS.length : null; } catch (e) { }
      try { r.nDays = (typeof DATA !== 'undefined' && DATA.days) ? Object.keys(DATA.days).length : null; } catch (e) { }
      return r;
    });
    console.log('================ ' + f + ' ================');
    console.log(JSON.stringify(out, null, 1).slice(0, 3500));
    if (errs.length) console.log('PAGEERR:', errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
