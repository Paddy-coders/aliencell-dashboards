/* _probe_us_sep_profit.js — 诊断：为什么网页上「9 月美国毛利」是负数
 * 只读探针，不进回归。用法：node _probe_us_sep_profit.js [--woot]
 *   --woot: 额外把云端 woot/cfg 注入 localStorage.pc_woot（复现「用户浏览器」的状态）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const AUTH = JSON.stringify({ access_token: 't', refresh_token: 't', email: 't@example.com', exp: Date.now() + 864e5 });
const WITH_WOOT = process.argv.includes('--woot');

(async () => {
  let pcWoot = '[]', cloudMapN = null;
  if (WITH_WOOT) {
    // 只读拉云端 mapping 行的 woot 配置（与页面同源），不写回
    try {
      const row = await fetch('https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1', {
        headers: { apikey: 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s', Authorization: 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s' },
      }).then(r => r.json());
      const d = (row && row[0] && row[0].data) || {};
      cloudMapN = (d.asinMap && Object.keys(d.asinMap).length) || 0;
      const w = d.woot || d.wootCfg || null;
      if (w) pcWoot = JSON.stringify(Array.isArray(w) ? w : (w.rows || w.list || w));
      console.log('[probe] 云端 asinMap 条数 =', cloudMapN, '| pc_woot 注入条数 =', JSON.parse(pcWoot).length || Object.keys(JSON.parse(pcWoot)).length);
    } catch (e) { console.log('[probe] 云端读取失败:', e.message); }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  // 只放行 GET，禁止任何写云端（保护线上 mapping 数据）
  await ctx.route('**/rest/v1/mapping*', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    console.log('[probe] 已拦截一次非 GET 云端写:', route.request().method());
    return route.fulfill({ status: 403, contentType: 'application/json', body: '[]' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(a => {
    try {
      localStorage.setItem('wb_auth', a.auth);
      localStorage.setItem('pc_woot', a.pcw);
    } catch (e) {}
  }, { auth: AUTH, pcw: pcWoot });

  await page.goto('file:///' + path.resolve(BASE, 'monthly.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (/login\.html/.test(page.url())) { console.log('FATAL: 被认证守卫重定向'); process.exit(1); }

  // 1) 表头 + 表格前几行（看「9 月 美国」这一行到底显示什么）
  const tbl = await page.evaluate(() => {
    const t = document.querySelector('#tableWrap table');
    if (!t) return null;
    const heads = [...t.querySelectorAll('thead tr')].map(tr =>
      [...tr.querySelectorAll('th')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    const rows = [...t.querySelectorAll('tbody tr')].slice(0, 24).map(tr =>
      [...tr.querySelectorAll('th,td')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    return { headLast: heads[heads.length - 1], rows };
  });
  console.log('\n=== 表头(末行) ===\n' + (tbl ? tbl.headLast.map((h, i) => i + ':' + h).join(' | ') : '(无表)'));
  console.log('\n=== 表格前 24 行 ===');
  (tbl ? tbl.rows : []).forEach((r, i) => console.log(i, r.slice(0, 12).join(' | ')));

  // 2) 用页面自己的 aggMonth 逐 (月, 站点) 拆解毛利，重点看 US 2026-09
  const brk = await page.evaluate(() => {
    const KEYS = ['pSales','pPromo','pComm','pFba','pCost','pStorage','pOther','pFbRet',
      'pRefSales','pRefShip','pRefPromo','pRefComm','pRefFba','pVat','pHead','pMcAdj','pReview','adCost'];
    const out = [];
    const months = [...new Set(ROWS.map(r => r.ym))].sort();
    for (const ym of months) {
      for (const cc of ['US', 'DE', 'UK']) {
        const rows = ROWS.filter(r => platOf(r) === 'amazon' && r.cc === cc);
        const a = aggMonth(ym, rows);
        if (!a.sales && !a.pN) continue;
        const o = { ym, cc, pN: a.pN, pMiss: a.pMiss, sales: a.sales, adCost: a.adCost, qty: a.pQty };
        for (const k of KEYS) o[k] = a[k];
        o.profit = monthVal(a, 'profit');
        o.margin = monthVal(a, 'margin');
        out.push(o);
      }
    }
    return out;
  });
  console.log('\n=== 逐 (月,站点) 毛利拆解（页面 aggMonth，Amazon） ===');
  for (const o of brk) {
    console.log(`\n--- ${o.ym} ${o.cc} | pN=${o.pN} pMiss=${o.pMiss} sales=${o.sales.toFixed(2)} adCost=${o.adCost.toFixed(2)} qty=${o.qty} → 毛利=${o.profit === null ? '—' : o.profit.toFixed(2)} (${o.margin === null ? '—' : o.margin.toFixed(2) + '%'})`);
    console.log('    ' + ['pSales','pPromo','pComm','pFba','pCost','pStorage','pOther','pFbRet','pRefSales','pRefShip','pRefPromo','pRefComm','pRefFba','pVat','pHead','pMcAdj','pReview']
      .map(k => `${k}=${Number(o[k]).toFixed(2)}`).join(' '));
  }

  // 3) Woot 行注入情况（channel='woot' 的行 + 其 adCost 落在哪个月/站点）
  const woot = await page.evaluate(() => {
    const rows = ROWS.filter(r => r.channel === 'woot');
    const byKey = {};
    for (const r of rows) {
      const k = r.ym + ' ' + r.cc;
      byKey[k] = byKey[k] || { n: 0, adCost: 0, sales: 0, units: 0 };
      byKey[k].n++; byKey[k].adCost += (r.adCost || 0); byKey[k].sales += (r.sales || 0); byKey[k].units += (r.units || 0);
    }
    return { total: rows.length, byKey, sample: rows.slice(0, 6) };
  });
  console.log('\n=== Woot 行注入 === 总数 =', woot.total);
  for (const [k, v] of Object.entries(woot.byKey).sort()) {
    console.log(`   ${k}: 行=${v.n} adCost=${v.adCost.toFixed(2)} sales=${v.sales.toFixed(2)} units=${v.units}`);
  }
  if (woot.sample.length) console.log('   样例:', JSON.stringify(woot.sample[0]).slice(0, 400));

  // 4) 当前月度表格选中月 = ？直接取「合计」行
  const tot = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(r => /合计/.test(r.innerText));
    return tr ? [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : null;
  });
  console.log('\n=== 当前「合计」行 ===\n' + (tot ? tot.join(' | ') : '(无)'));

  console.log('\n=== pageerror ===');
  console.log(errs.length ? errs.join('\n') : '(无)');
  await browser.close();
})();
