// test_ratio_cols.js — 日/月看板「费用占比列」(成本%/FBA%/promotion%/仓储%/头程%/其他费用%) 功能验证
// 口径: 占比分母=利润报表销售额; 除成本外其他费用同时给绝对值; 头程=成本表RMB×销量÷(CNY/USD)
// 期望值在 Node 侧用 profit_metrics.json + product_cost_table.json + fx_rates.json 独立计算
// 用法: node test_ratio_cols.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const REP = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33';   // 周报链路目录(weekly_all_data.json 在此)
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.05 : tol);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }, timeout: 15000 }, res => {
      const bufs = []; res.on('data', c => bufs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  // ---------- 云端数据(预注入防 reload) ----------
  const cloud = (await fetchJson(SB_URL))[0].data;
  const mapData = { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [] };

  // ---------- Node 侧独立计算期望值 ----------
  const pm = JSON.parse(fs.readFileSync(path.join(BASE, 'profit_metrics.json'), 'utf8'));
  const tbl = JSON.parse(fs.readFileSync(path.join(BASE, 'product_cost_table.json'), 'utf8'));
  const fxRates = JSON.parse(fs.readFileSync(path.join(BASE, 'fx_rates.json'), 'utf8')).rates;
  const nameOf = {}; (mapData.asinMap || []).forEach(x => { nameOf[x.asin] = x.name; });
  const EU = ['DE','FR','IT','ES','NL','BE','IE','PL','SE'];
  const regionOf = s => s === 'UK' ? 'UK' : (s === 'US' ? 'US' : (EU.includes(s) ? 'EU' : null));

  // 挑一个美国利润行较多的日期
  const byDay = {};
  pm.rows.forEach(r => { if (r.site === 'US' && r.sales > 0) (byDay[r.d] = byDay[r.d] || []).push(r); });
  const day = Object.keys(byDay).sort((a, b) => byDay[b].length - byDay[a].length)[0];
  const rows = byDay[day];
  const ym = day.slice(0, 7);
  const cnyPerUsd = fxRates[ym].USD;
  const exp = { pSales: 0, pFba: 0, pPromo: 0, pCost: 0, pStorage: 0, pOther: 0, pHead: 0 };
  rows.forEach(r => {
    exp.pSales += r.sales; exp.pFba += r.fba; exp.pPromo += r.promo; exp.pCost += r.cost;
    exp.pStorage += r.storage; exp.pOther += r.other;
    const p = tbl.products[nameOf[r.as]];
    const rg = regionOf(r.site);
    if (p && rg && p.headRMB[rg]) exp.pHead += p.headRMB[rg] * r.qty / cnyPerUsd;
  });
  console.log('样本: ' + day + ' US ' + rows.length + ' 行 · 期望 pSales=' + exp.pSales.toFixed(2)
    + ' pHead=' + exp.pHead.toFixed(2) + ' 成本%=' + (-exp.pCost / exp.pSales * 100).toFixed(2));

  // ---------- 页面 ----------
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 960 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.md.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot || []));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || null));
  }, { md: mapData, woot: [], wootCfg: null });   // woot 种子与下方拦截响应一致(全空) → 签名相同不 reload
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // 云端拦截: 映射用真实数据, woot 与本地种子一致(全空) → 防 cloudWootSync 写缓存后 reload
  const cloudStub = { catalog: mapData.catalog, asinMap: mapData.asinMap, woot: [], wootCfg: null };
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: cloudStub }]) }));

  // ================= 日看板 =================
  await page.goto('file:///' + BASE + '/daily.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(6000);   // 等 cloudWootSync 落定(若触发 reload 也等它完成)
  console.log('-- 日看板 daily.html --');
  const dv = await page.evaluate((arg) => {
    selCountry.clear(); selCountry.add('US');
    const a = aggRows(arg.day, selCountry, selAsin);
    const v = metricVals(a);
    selCountry.clear();
    const labels = METRICS.map(m => m.label);
    return { v, labels, tot: null };
  }, { day });

  t('列含 成本%', dv.labels.includes('成本%'), dv.labels);
  t('列含 FBA / FBA%', dv.labels.includes('FBA') && dv.labels.includes('FBA%'));
  t('列含 promotion / promotion%', dv.labels.includes('promotion') && dv.labels.includes('promotion%'));
  t('列含 仓储 / 仓储%', dv.labels.includes('仓储') && dv.labels.includes('仓储%'));
  t('列含 头程 / 头程%', dv.labels.includes('头程') && dv.labels.includes('头程%'));
  t('列含 其他费用 / 其他费用%', dv.labels.includes('其他费用') && dv.labels.includes('其他费用%'));
  t('成本% 数值正确', near(dv.v.costPct, -exp.pCost / exp.pSales * 100, 0.05), { got: dv.v.costPct, want: -exp.pCost / exp.pSales * 100 });
  t('FBA 绝对值正确', near(dv.v.fbaAbs, -exp.pFba, 0.05), { got: dv.v.fbaAbs, want: -exp.pFba });
  t('FBA% 正确', near(dv.v.fbaPct, -exp.pFba / exp.pSales * 100, 0.05));
  t('promotion 绝对值正确', near(dv.v.promoAbs, -exp.pPromo, 0.05));
  t('promotion% 正确', near(dv.v.promoPct, -exp.pPromo / exp.pSales * 100, 0.05));
  t('头程绝对值正确(RMB×qty÷CNY汇率)', near(dv.v.headAbs, exp.pHead, 0.05), { got: dv.v.headAbs, want: exp.pHead });
  t('头程% 正确', near(dv.v.headPct, exp.pHead / exp.pSales * 100, 0.05));
  t('其他费用 绝对值正确', near(dv.v.otherAbs, -exp.pOther, 0.05));
  t('其他费用% 正确', near(dv.v.otherPct, -exp.pOther / exp.pSales * 100, 0.05));

  // 合计行
  const dtot = await page.evaluate(() => {
    selCountry.clear(); selCountry.add('US'); renderTable();
    const tds = [...document.querySelectorAll('.total-row td')];
    selCountry.clear(); renderTable();
    return tds.map(x => x.textContent.trim());
  });
  t('合计行渲染且非全 —', dtot.length > 5 && dtot.some(x => /%/.test(x)), dtot.slice(0, 6));

  // ================= 月看板 =================
  // ⚠️ 不能用 sales>0 过滤: 零销售但有费用的利润行也会进看板合计(会被算进占比分子)
  const mrows = pm.rows.filter(r => r.site === 'US');
  const byMonth = {};
  mrows.forEach(r => { (byMonth[r.d.slice(0, 7)] = byMonth[r.d.slice(0, 7)] || []).push(r); });
  const mo = Object.keys(byMonth).sort((a, b) => byMonth[b].length - byMonth[a].length)[0];
  const mexp = { pSales: 0, pFba: 0, pPromo: 0, pCost: 0, pStorage: 0, pOther: 0, pHead: 0 };
  byMonth[mo].forEach(r => {
    mexp.pSales += r.sales; mexp.pFba += r.fba; mexp.pPromo += r.promo; mexp.pCost += r.cost;
    mexp.pStorage += r.storage; mexp.pOther += r.other;
    const p = tbl.products[nameOf[r.as]];
    if (p && p.headRMB.US) mexp.pHead += p.headRMB.US * r.qty / fxRates[mo].USD;   // 月看板 FX 为 CNY 基准
  });
  console.log('-- 月看板 monthly.html -- 样本 ' + mo + ' US ' + byMonth[mo].length + ' 行 · 期望头程 ' + mexp.pHead.toFixed(2));

  await page.goto('file:///' + BASE + '/monthly.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(6000);
  const mv = await page.evaluate((arg) => {
    selMonth.clear(); selCountry.clear(); selCountry.add('US');
    const a = aggMonth(arg.mo, filteredRows());
    const labels = METRICS.map(m => m.short);
    const totRow = (() => { renderTable(); const tds = [...document.querySelectorAll('.total-row td')]; return tds.map(x => x.textContent.trim()); })();
    selMonth.clear(); selCountry.clear(); renderTable();
    return { v: Object.fromEntries(['costPct', 'fbaAbs', 'fbaPct', 'promoAbs', 'promoPct', 'storageAbs', 'storagePct', 'headAbs', 'headPct', 'otherAbs', 'otherPct']
      .map(k => [k, monthVal(a, k)])), labels, totRow };
  }, { mo });

  t('月看板含 成本%', mv.labels.includes('成本%'), mv.labels.slice(-13));
  t('月看板含 FBA / FBA%', mv.labels.includes('FBA') && mv.labels.includes('FBA%'));
  t('月看板含 promotion / promotion%', mv.labels.includes('promotion') && mv.labels.includes('promotion%'));
  t('月看板含 仓储 / 仓储%', mv.labels.includes('仓储') && mv.labels.includes('仓储%'));
  t('月看板含 头程 / 头程%', mv.labels.includes('头程') && mv.labels.includes('头程%'));
  t('月看板含 其他费用 / 其他费用%', mv.labels.includes('其他费用') && mv.labels.includes('其他费用%'));
  t('月看板 成本% 正确', near(mv.v.costPct, -mexp.pCost / mexp.pSales * 100, 0.05), { got: mv.v.costPct, want: -mexp.pCost / mexp.pSales * 100 });
  t('月看板 FBA 绝对值正确', near(mv.v.fbaAbs, -mexp.pFba, 0.05));
  t('月看板 promotion% 正确', near(mv.v.promoPct, -mexp.pPromo / mexp.pSales * 100, 0.05));
  t('月看板 头程绝对值正确(RMB×qty÷CNY汇率)', near(mv.v.headAbs, mexp.pHead, 0.05), { got: mv.v.headAbs, want: mexp.pHead });
  t('月看板 头程% 正确', near(mv.v.headPct, mexp.pHead / mexp.pSales * 100, 0.05));
  t('月看板 其他费用% 正确', near(mv.v.otherPct, -mexp.pOther / mexp.pSales * 100, 0.05));
  t('月看板合计行含占比', mv.totRow.some(x => /%/.test(x)), mv.totRow.slice(-8));

  // ================= 周报看板 (product.html) =================
  // 取一个有利润数据的 (ASIN, 周, US) 单元, Node 侧独立算期望
  // 周六~周五为一周; 周标签 = 该周周五所在 ISO 周 (与 Python week_label 一致)
  const wkLabel = d => {
    const dt = new Date(d + 'T00:00:00Z');
    const off = (dt.getUTCDay() + 1) % 7;                 // 周六=0, 周日=1, ... 周五=6
    dt.setUTCDate(dt.getUTCDate() - off + 6);             // → 该周的周五
    return 'W' + isoWeek(dt);
  };
  function isoWeek(dt) { const t = new Date(dt); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); }
  const wAgg = {};
  pm.rows.filter(r => r.site === 'US').forEach(r => {
    const k = r.as + '|' + wkLabel(r.d);
    (wAgg[k] = wAgg[k] || []).push(r);
  });
  // 只挑有销售额的单元(否则占比两侧都是 null, 断言没意义)
  const wkSales = k => wAgg[k].reduce((s, r) => s + (r.sales || 0), 0);
  // ⚠️ 采样必须落在「周报自身覆盖的周」内: 利润报表可能已有比周报更晚的周(周报源 weekly_all_data.json 由周一自动化更新),
  //    那种周在页面上 asinWeekData() 返回 null → 4 个占比断言全部 got:null 的假失败(2026-10-12 踩过)
  const wkValid = (() => {
    try {
      const ws = JSON.parse(fs.readFileSync(REP + '/weekly_all_data.json', 'utf8'));
      return new Set(ws.map(w => wkLabel(w.end)));
    } catch (e) { console.log('  (警告) 周报周范围读取失败, 不做周过滤:', e.message); return null; }
  })();
  const wCand = Object.keys(wAgg).filter(k => wkSales(k) > 0 && (!wkValid || wkValid.has(k.split('|')[1])));
  if (!wCand.length) throw new Error('周报采样为空: 利润报表周与周报周无交集');
  const wKey = wCand.sort((a, b) => wkSales(b) - wkSales(a))[0];
  const [wAsin, wWeek] = wKey.split('|');
  const wexp = { pSales: 0, pFba: 0, pCost: 0, pHead: 0, pOther: 0 };
  wAgg[wKey].forEach(r => {
    wexp.pSales += r.sales; wexp.pFba += r.fba; wexp.pCost += r.cost; wexp.pOther += r.other;
    const p = tbl.products[nameOf[r.as]];
    if (p && p.headRMB.US) wexp.pHead += p.headRMB.US * r.qty / 6.7045;   // 周报 FX 为单套 CNY 汇率
  });
  console.log('-- 周报 product.html -- 样本 ' + wAsin + ' ' + wWeek + ' US ' + wAgg[wKey].length + ' 行 · 期望头程 ' + wexp.pHead.toFixed(2));

  const wPage = await ctx.newPage();
  const werrs = [];
  wPage.on('pageerror', e => werrs.push(String(e)));
  await wPage.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: cloudStub }]) }));
  await wPage.goto('file:///' + BASE + '/_deploy/product.html', { waitUntil: 'load', timeout: 90000 });
  await wPage.waitForTimeout(6000);
  const wv = await wPage.evaluate((arg) => {
    selCountry.clear(); selCountry.add('US'); selWeek.clear(); selWeek.add(arg.week);
    const a = asinWeekData(arg.asin, arg.week);
    const labels = METRICS.map(m => m.short);
    calc();
    const idx = METRICS.findIndex(m => m.key === 'headPct');
    return { v: Object.fromEntries(['costPct', 'fbaAbs', 'fbaPct', 'promoPct', 'storagePct', 'headAbs', 'headPct', 'otherPct']
      .map(k => [k, weekVal(a, k)])), labels, nCols: METRICS.length, idx };
  }, { asin: wAsin, week: wWeek });

  t('周报含 成本%', wv.labels.includes('成本%'), wv.labels.slice(-14));
  t('周报含 FBA / FBA%', wv.labels.includes('FBA') && wv.labels.includes('FBA%'));
  t('周报含 promotion / promotion%', wv.labels.includes('promotion') && wv.labels.includes('promotion%'));
  t('周报含 仓储 / 仓储%', wv.labels.includes('仓储') && wv.labels.includes('仓储%'));
  t('周报含 头程 / 头程%', wv.labels.includes('头程') && wv.labels.includes('头程%'));
  t('周报含 其他费用 / 其他费用%', wv.labels.includes('其他费用') && wv.labels.includes('其他费用%'));
  t('周报 成本% 正确', near(wv.v.costPct, -wexp.pCost / wexp.pSales * 100, 0.05), { got: wv.v.costPct, want: -wexp.pCost / wexp.pSales * 100 });
  t('周报 FBA 绝对值正确', near(wv.v.fbaAbs, -wexp.pFba, 0.05), { got: wv.v.fbaAbs, want: -wexp.pFba });
  t('周报 头程绝对值正确', near(wv.v.headAbs, wexp.pHead, 0.05), { got: wv.v.headAbs, want: wexp.pHead });
  t('周报 头程% 正确', near(wv.v.headPct, wexp.pHead / wexp.pSales * 100, 0.05));
  t('周报 其他费用% 正确', near(wv.v.otherPct, -wexp.pOther / wexp.pSales * 100, 0.05));
  t('周报无 JS 错误', werrs.length === 0, werrs.slice(0, 2));

  await browser.close();
  console.log('\n结果: ' + pass + ' pass / ' + fail + ' fail' + (errs.length ? ' · JS错误: ' + errs[0] : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
