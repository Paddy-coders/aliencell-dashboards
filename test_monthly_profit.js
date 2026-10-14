// test_monthly_profit.js — 月度看板(monthly.html) 毛利回归
// 校验: ①毛利/毛利率列 + 「毛利指标」分组 ②指定月毛利值对账(独立算) ③2026-06 无毛利(数据自07起)
//      ④合计行含毛利 ⑤KPI 可选指标含毛利且可取 ⑥单国(US)筛选下对账
// 用法: node test_monthly_profit.js
const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/monthly.html';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * tolPct);

(async () => {
  const pm = JSON.parse(fs.readFileSync(path.join(BASE, 'profit_metrics.json'), 'utf8'));
  const dd = JSON.parse(fs.readFileSync(path.join(BASE, 'daily_data.json'), 'utf8'));
  const tbl = JSON.parse(fs.readFileSync(path.join(BASE, 'product_cost_table.json'), 'utf8'));
  // 「ASIN→产品名」映射: 头程按产品名查成本表, 与页面 asinMetaOf 同源(云端 asinMap)。
  //   预注入 + 拦云端(而不是 abort) → 头程可被独立复算, 同时防 cloudWootSync 写缓存触发 reload。
  let asinMap = [];
  try {
    asinMap = (await new Promise((resolve, reject) => {
      const req = require('https').get(SB_URL, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, timeout: 15000 }, res => {
        const bufs = []; res.on('data', c => bufs.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    }))[0].data.asinMap || [];
  } catch (e) { console.log('  (云端映射拉取失败, 头程按 0 计: ' + String((e && e.message) || e) + ')'); }
  const nameOf = {}; asinMap.forEach(x => { if (x && x.asin) nameOf[x.asin] = x.name; });
  const EU_SITES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PL', 'SE'];
  const regOf = s => s === 'UK' ? 'UK' : (s === 'US' ? 'US' : (EU_SITES.includes(s) ? 'EU' : null));

  const browser = await chromium.launch();
  // 与周报同理: 隔离 Woot 手工数据, 让毛利核心算法可独立复现
  const ctx = await browser.newContext();
  await ctx.addInitScript((arg) => {
    try { localStorage.setItem('pc_woot', '[]'); localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap || [])); } catch (e) {}
  }, { asinMap });
  await ctx.route('**rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { asinMap: asinMap, catalog: [], woot: [], wootCfg: null } }]) }));
  const page = await ctx.newPage();
  await page.goto(FILE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);

  // 数据契约: 页面自身的汇率表 / 生效国家 / 月份
  const scope = await page.evaluate(() => ({
    FX: FX,
    countries: (function () { return allCountries.slice(); })(),
    months: MONTHS.map(m => m.ym),
    rows: ROWS.length,
    profitRows: ROWS.filter(r => (r.pN || 0) > 0).length,
  }));
  console.log(`  页面范围: ${scope.rows} 行(其中含毛利 ${scope.profitRows}) · ${scope.countries.length} 国家 · 月份 ${scope.months.join(',')}`);

  // 期望值: 某月毛利(USD) = Σ(利润各项 − VAT − 头程 + 剔除加回 − 测评费) − Σ(daily_data 广告花费)
  //   口径与 build_profit_metrics.py / 页面 profitOf 三方对齐(2026-10-12 定稿)
  function expectMonth(ym, countries) {
    const cSet = new Set(countries || scope.countries);
    const fx = (cc) => {                        // CNY 基准交叉汇率 → USD
      const from = scope.FX[ym] ? (scope.FX[ym][{ US:'USD',CA:'CAD',MX:'MXN',UK:'GBP',JP:'JPY',AU:'AUD',DE:'EUR',FR:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',BE:'EUR',IE:'EUR',PL:'PLN',SE:'SEK' }[cc] || 'USD']) : null;
      const to = scope.FX[ym] ? scope.FX[ym]['USD'] : null;
      if (cc === 'US') return 1;
      if (!from || !to) return 1;
      return from / to;
    };
    // 头程(USD) = 成本表头程RMB × 销量 ÷ (CNY per USD); 页面 convHead 同口径
    const cnyPerUsd = (scope.FX[ym] || {}).USD;
    const headUsd = (r) => {
      const p = tbl.products && tbl.products[nameOf[r.as]];
      const rg = regOf(r.site);
      if (!p || !rg || !cnyPerUsd) return 0;
      return (Number((p.headRMB || {})[rg]) || 0) * (Number(r.qty) || 0) / cnyPerUsd;
    };
    let sum = 0, pSales = 0;
    for (const r of pm.rows) {
      if (r.d.slice(0, 7) !== ym) continue;
      if (!cSet.has(r.site)) continue;
      const k = fx(r.site);
      sum += (r.sales + r.promo + r.comm + r.fba + r.cost + r.storage + r.other) * k;
      sum -= (r.vat || 0) * k;        // EU/UK 增值税
      sum -= headUsd(r);              // 头程 — 已是 USD, 不再乘 k
      sum += (r.mcAdj || 0) * k;      // 其他渠道订单剔除加回
      sum -= (r.review || 0) * k;     // 测评费
      pSales += r.sales * k;
    }
    let adCost = 0;
    // ⚠️ 月度看板的广告花费只统计能归属到 ASIN 的条目。归属规则必须与
    //    ad_asin_rules.py（唯一权威规则源）保持一致。
    //    2026-10-10 起 SB 品牌推广不再整块丢弃：活动名里没有 ASIN 时走「系列兜底」，
    //    且兜底**按站点区分** —— 同一个 SKU 在 US 与欧洲是两个不同 ASIN
    //    （US ACD-X1-40W-NA → B0H69JJZ1M；DE ACD-X1-40W-EU → B0HH8J6SSL），
    //    所以这里必须把 cc 传进归属函数，否则会漏掉/归错欧洲的 SB 花费。
    const SPECIAL = { 'X1-SBV-片段2': 'B0H69JJZ1M', 'X1-SB-定投旗舰店-LC-B2B': 'B0H69JJZ1M', 'X1-SB-定投旗舰店首页-B2B': 'B0H69JJZ1M' };
    const ASIN_RE = /B0[A-Z0-9]{8}/;
    const X1_FB = { US: 'B0H69JJZ1M', CA: 'B0H69JJZ1M', MX: 'B0H69JJZ1M' };
    const extractAsin = (it, cc) => {
      const a = String(it.Asin || '').trim();
      if (a) return a;
      const c = String(it.CampaignName || it.Name || '').trim();
      if (!c) return null;
      const m = ASIN_RE.exec(c);
      if (m) return m[0];
      if (SPECIAL[c]) return SPECIAL[c];
      if (/X1\d/i.test(c)) return null;   // X140 等另一条产品线，不吃 X1 兜底
      const key = c + ' ' + String(it.PortfolioName || '');
      if (/lite/i.test(key)) return 'B0H9YBM4H1';
      if (/X1(?!\d)/i.test(key)) return X1_FB[String(cc || '').toUpperCase()] || 'B0HH8J6SSL';
      return null;
    };
    for (const d of Object.keys(dd.days)) {
      if (d.slice(0, 7) !== ym) continue;
      const ads = dd.days[d].ads || {};
      for (const cc of Object.keys(ads)) {
        if (!cSet.has(cc)) continue;
        const k = fx(cc);
        for (const it of ads[cc]) {
          if (!extractAsin(it, cc)) continue;
          adCost += ((it.Report || {}).Cost || 0) * k;
        }
      }
    }
    return { profit: sum - adCost, pSales, adCost };
  }

  // ① 结构
  const heads = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('#tableWrap thead tr:first-child th')].map(th => th.textContent.trim()),
    cols: [...document.querySelectorAll('#tableWrap thead tr:nth-child(2) th')].map(th => th.textContent.trim()),
  }));
  t('表头含 毛利/毛利率 列', heads.cols.includes('毛利') && heads.cols.includes('毛利率'), heads.cols);
  t('表头含「毛利指标」分组', heads.groups.some(g => g.includes('毛利指标')), heads.groups);
  // 毛利组含 毛利(RMB)/profit/margin 且顺序为 毛利(RMB) → 毛利 → 毛利率(2026-10-12 第二轮起 毛利RMB 插在毛利前);
  // 之后可继续追加费用占比列(成本%/FBA%/promotion%/仓储%/头程%/其他费用%)与 8 细项/退款列
  t('METRICS 中 毛利(RMB)/profit/margin 归入毛利组且顺序正确', await page.evaluate(() => {
    const ks = METRICS.filter(m => m.grp === '毛利').map(m => m.key);
    const i = ks.indexOf('profit'), r = ks.indexOf('profitRmb');
    return ks.length >= 3 && r >= 0 && i === r + 1 && ks.includes('margin');
  }), null);

  // ② 数值对账 (取利润数据覆盖的完整月, 优先 2026-08)
  const monthsWithProfit = scope.months.filter(ym => pm.rows.some(r => r.d.slice(0, 7) === ym));
  const M = monthsWithProfit.includes('2026-08') ? '2026-08' : monthsWithProfit[monthsWithProfit.length - 1];
  t('存在含利润数据的月份', !!M, monthsWithProfit);
  const exp = expectMonth(M, null);
  const got = await page.evaluate((ym) => {
    const a = aggMonth(ym, filteredRows());
    return { profit: profitOf(a), margin: marginOf(a), pSales: a.pSales, pN: a.pN, adCost: a.adCost };
  }, M);
  t(`${M} 毛利值对账(USD)`, got.profit !== null && near(got.profit, exp.profit, 0.005), { got: got.profit, exp: +exp.profit.toFixed(2) });
  t(`${M} 报表销售额对账`, near(got.pSales, exp.pSales, 0.005), { got: +got.pSales.toFixed(2), exp: +exp.pSales.toFixed(2) });
  t(`${M} 毛利率=毛利÷报表销售额`, got.margin !== null && near(got.margin, exp.profit / exp.pSales * 100, 0.01),
    { got: got.margin && +got.margin.toFixed(2), exp: +(exp.profit / exp.pSales * 100).toFixed(2) });

  // ③ 2026-06 无利润数据 → —
  const jun = await page.evaluate(() => {
    const a = aggMonth('2026-06', filteredRows());
    return { profit: profitOf(a), pN: a.pN };
  });
  t('2026-06 毛利为 null(数据自 2026-07 起)', jun.profit === null && jun.pN === 0, jun);

  // ④ 合计行 (KPI 卡与表格合计共用 calcKpis().tot)
  //    ⚠️ 月表体每行是「1 个 frozen 月份 td + N 个指标 td」, 而表头 row2 只有 N 个 th
  //       ⇒ 取列必须补偏移量(此前写死 td[ci] 实际读到的是 ci-1 列, 恰好邻列非 —, 属"假通过")
  const totVals = await page.evaluate(() => {
    const { tot } = calcKpis();
    renderTable();
    const cols = [...document.querySelectorAll('#tableWrap thead tr:nth-child(2) th')].map(th => th.textContent.trim());
    const ci = cols.indexOf('毛利'), ciR = cols.indexOf('毛利(RMB)');
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const last = trs[trs.length - 1];
    const cells = [...last.querySelectorAll('td')];
    const off = cells.length - cols.length;                 // = 1 (月份列)
    return {
      kpi: monthVal(tot, 'profit'),
      cell: ci < 0 ? null : cells[ci + off].textContent.trim(),
      rmbCell: ciR < 0 ? null : cells[ciR + off].textContent.trim(),
      rmbKpi: monthVal(tot, 'profitRmb'),
      cols, ci, ciR, off,
    };
  });
  t('表头 毛利(RMB) 紧邻在 毛利 之前', totVals.ciR >= 0 && totVals.ci === totVals.ciR + 1, { ciR: totVals.ciR, ci: totVals.ci });
  t('合计行毛利非 —', !!totVals.cell && totVals.cell !== '—', totVals.cell);
  t('合计行毛利 与 KPI 毛利一致(同一累加口径)', (() => {
    const n = s => Number(String(s).replace(/[^0-9.\-]/g, ''));
    return Math.abs(n(totVals.cell) - totVals.kpi) < 0.02;
  })(), { cell: totVals.cell, kpi: +totVals.kpi.toFixed(2) });
  t('合计行 毛利(RMB) 非 — 且为 ¥ 前缀', !!totVals.rmbCell && totVals.rmbCell.startsWith('¥'), totVals.rmbCell);
  // 毛利(RMB) ≈ 毛利(USD) × CNY/USD(逐月折算, 允许 ±1% 的月份结构差)
  t('合计行 毛利(RMB) ≈ 毛利 × CNY/USD', (() => {
    const n = s => Number(String(s).replace(/[^0-9.\-]/g, ''));
    const a = n(totVals.rmbCell), b = n(totVals.cell);
    if (!isFinite(a) || !isFinite(b) || b === 0) return false;
    const rate = a / b;
    return rate > 6.4 && rate < 7.4;
  })(), totVals.rmbCell);
  t('KPI 取值口径=合计行口径', totVals.kpi !== null && totVals.cell !== null, totVals);

  // ⑤ KPI 可选指标
  t('KPI 可选指标含 毛利/毛利率', await page.evaluate(() =>
    KPI_METRICS.some(m => m.key === 'profit') && KPI_METRICS.some(m => m.key === 'margin')), null);

  // ⑥ 单国 (US)
  const expUS = expectMonth(M, ['US']);
  const gotUS = await page.evaluate((ym) => {
    selRegion.clear(); selCountry.clear(); selCountry.add('US'); selMonth.clear();
    const a = aggMonth(ym, filteredRows());
    selCountry.clear();
    return { profit: profitOf(a), pSales: a.pSales };
  }, M);
  t(`${M} US 单国毛利对账`, gotUS.profit !== null && near(gotUS.profit, expUS.profit, 0.005),
    { got: gotUS.profit, exp: +expUS.profit.toFixed(2) });

  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
