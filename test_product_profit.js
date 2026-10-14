// test_product_profit.js — 周度产品报表(product.html) 毛利回归
// 校验: ①毛利/毛利率列与「毛利指标」分组存在 ②指定周毛利值对账(独立算) ③无利润数据的周为 —
//      ④合计行含毛利 ⑤KPI 可选指标含毛利 ⑥单国筛选下毛利对账
// 用法: node test_product_profit.js
const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const REP = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/_deploy/product.html';
let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * tolPct);

(async () => {
  // ---- 独立期望值: profit_metrics.json + ad_data_for_dashboard.json + fx_rates.json ----
  const pm = JSON.parse(fs.readFileSync(path.join(BASE, 'profit_metrics.json'), 'utf8'));
  const adD = JSON.parse(fs.readFileSync(path.join(REP, 'ad_data_for_dashboard.json'), 'utf8'));
  const fxAll = JSON.parse(fs.readFileSync(path.join(BASE, 'fx_rates.json'), 'utf8'));
  // 页面 load_fx() 取的是最新月份汇率(CNY 基准), 这里保持一致
  const LATEST = Object.keys(fxAll.rates).sort().pop();
  const FX = fxAll.rates[LATEST];
  const CUR_OF = { US:'USD',CA:'CAD',MX:'MXN',UK:'GBP',JP:'JPY',AU:'AUD',DE:'EUR',FR:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',BE:'EUR',IE:'EUR',PL:'PLN',SE:'SEK' };
  const fxv = (v, cc) => {                       // 与页面 fxv 一致: 目标币种 = USD
    const from = CUR_OF[cc] || 'USD';
    if (from === 'USD') return v || 0;
    const rf = FX[from], rt = FX['USD'];
    if (!rf || !rt) return v || 0;
    return (v || 0) * rf / rt;
  };
  // 头程: 页面 headRmbOf() = 「产品关系管理」映射 → 成本表 headRMB[地区] × 销量 ÷ fxTbl()[targetCur()]
  //   ⚠️ 2026-10-13 起 `product_map.json` 在构建期已由云端刷新 ⇒ 页面**离线也有内嵌映射**
  //      (`__ASIN_META` 来自内嵌 @@MAP_JSON@@), 头程不再恒为 0。
  //      本测试此前假设「断网 ⇒ 头程 0」故期望值不减头程 —— 该假设已失效, 现在必须自己减。
  //   ⚠️ 汇率取页面同一张表(fx_rates.json 最新月)的 USD: 未筛选=跨地区混合→USD, 单看 US→USD,
  //      两者都由 ⑥ 的 `curSym() === '$'` 断言兜住; 若将来加非美元场景, 这里要改为跟随 targetCur()。
  const headOf = JSON.parse(fs.readFileSync(path.join(BASE, 'product_cost_table.json'), 'utf8')).products;
  const nameOf = {};
  try {
    const mp = JSON.parse(fs.readFileSync(path.join(BASE, 'product_map.json'), 'utf8'));
    (mp.asinMap || []).forEach(x => { if (x && x.asin) nameOf[x.asin] = x.name; });
  } catch (e) {}
  console.log(`  内嵌映射(离线头程用): ${Object.keys(nameOf).length} 个 ASIN`);
  const HF_REGIONS = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PL', 'SE'];
  const hfRegion = cc => cc === 'UK' ? 'UK' : (cc === 'US' ? 'US' : (HF_REGIONS.includes(cc) ? 'EU' : null));
  const FX_USD = FX['USD'];
  const isoWeek = (startStr) => {
    const d = new Date(startStr + 'T00:00:00');
    d.setDate(d.getDate() + 6);                  // 周五
    const onejan = new Date(d.getFullYear(), 0, 1);
    const w = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return 'W' + w;
  };

  const browser = await chromium.launch();
  // ⚠️ product.html 会从云端拉 Woot 手工录入数据(pc_woot)并注入 ads/产品指标。
  //    Woot 有广告花费却无毛利口径 → 会把毛利多扣一块(2026-10-10 实测 W40 多扣 2232.45 USD)。
  //    本测试隔离 Woot(预设空 + 屏蔽云端拉取), 让「毛利核心算法」可独立复现;
  //    Woot 参与口径由 test_woot_channel.js 单独覆盖(周看板「销售店铺」筛选)。
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('pc_woot', '[]'); } catch (e) {} });
  await ctx.route('**supabase.co/**', r => r.abort());
  const page = await ctx.newPage();
  await page.goto(FILE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3500);

  // 页面自身的数据契约: ASIN 范围 / 生效国家 / 周区间
  const scope = await page.evaluate(() => ({
    asins: DATA.asin_list.slice(),
    countries: [...effectiveCountries()],
    weeks: DATA.weeks.map(w => ({ label: w.label, start: w.start, end: w.end })),
    hasProfit: (typeof PROFIT !== 'undefined') ? Object.keys(PROFIT).length : -1,
  }));
  console.log(`  页面范围: ${scope.asins.length} ASIN · ${scope.countries.length} 国家 · ${scope.weeks.length} 周 · PROFIT ${scope.hasProfit} ASIN`);

  // 期望值: 某周在给定国家集合下的毛利(USD)
  // 期望毛利(Node 侧独立复算, 与页面 profitOf 同口径):
  //   毛利 = 销售额+促销折扣+销售佣金+配送费+商品成本+仓储+其他费用 + FBA退货处理费 + 退款各项
  //          − VAT − 头程 + 其他渠道剔除加回 − 测评费 − 广告花费
  //   ⚠️ 本测试 `ctx.route('**supabase.co/**', abort)` 断网, 但页面**内嵌映射非空**(2026-10-13 起)
  //      ⇒ 头程仍会被算出, 这里按「映射→成本表 headRMB(地区)×销量÷USD汇率」独立复算并扣除。
  function expectWeek(label, countries) {
    const w = scope.weeks.find(x => x.label === label);
    if (!w) return null;
    const asinSet = new Set(scope.asins);
    const cSet = new Set(countries || scope.countries);
    let sum = 0, pSales = 0, n = 0, head = 0;
    for (const r of pm.rows) {
      if (r.d < w.start || r.d > w.end) continue;
      if (!cSet.has(r.site)) continue;
      if (!asinSet.has(r.as)) continue;
      sum += fxv(r.sales + r.promo + r.comm + r.fba + r.cost + r.storage + r.other, r.site);
      sum += fxv(r.fbRet || 0, r.site);                                                        // FBA退货处理费
      sum += fxv((r.refSales || 0) + (r.refShip || 0) + (r.refPromo || 0) + (r.refComm || 0) + (r.refFba || 0), r.site);  // 退款各项
      sum -= fxv(r.vat || 0, r.site);                                                          // VAT(正数, 从毛利扣)
      sum += fxv(r.mcAdj || 0, r.site);                                                        // 其他渠道剔除加回
      sum -= fxv(r.review || 0, r.site);                                                       // 测评费
      // 头程(成本表预估, 与页面 headRmbOf/fxHeadCny 同口径)
      const pdt = headOf[nameOf[r.as]] || {};
      const hr = pdt.headRMB ? (Number(pdt.headRMB[hfRegion(r.site)]) || 0) : 0;
      if (hr && r.qty) { const v = hr * r.qty / FX_USD; sum -= v; head += v; }
      pSales += fxv(r.sales, r.site);
      n++;
    }
    let adSpend = 0;
    for (const asin of Object.keys(adD)) {
      if (!asinSet.has(asin)) continue;
      for (const start of Object.keys(adD[asin])) {
        if (isoWeek(start) !== label) continue;
        for (const cc of Object.keys(adD[asin][start])) {
          if (!cSet.has(cc)) continue;
          adSpend += fxv(adD[asin][start][cc].spend || 0, cc);
        }
      }
    }
    return { profit: sum - adSpend, pSales, n, adSpend, head };
  }

  // ① 结构: 列 + 分组
  const heads = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('#sumHead tr:first-child th')].map(th => th.textContent.trim()),
    cols: [...document.querySelectorAll('#sumHead tr:nth-child(2) th')].map(th => th.textContent.trim()),
  }));
  t('表头含 毛利/毛利率 列', heads.cols.includes('毛利') && heads.cols.includes('毛利率'), heads.cols);
  t('表头含「毛利指标」分组', heads.groups.some(g => g.includes('毛利指标')), heads.groups);
  // 不写死整串: 2026-10-10 起毛利组追加了 11 个费用占比/绝对值列, 2026-10-12 第二轮又加了 毛利(RMB)
  //   + 8 个 FBA 库存费细项 + 6 个退款列, 写死会假失败
  t('METRICS 中 毛利(RMB)/profit/margin 归入毛利组且顺序正确', await page.evaluate(() => {
    const ks = METRICS.filter(m => m.grp === '毛利').map(m => m.key);
    const i = ks.indexOf('profit'), r = ks.indexOf('profitRmb');
    return ks.length >= 3 && r >= 0 && i === r + 1 && ks.includes('margin');
  }), null);

  // ② 有利润数据的周边界: 找第一个有效周
  const weeksWithProfit = scope.weeks.filter(w => expectWeek(w.label, null).n > 0);
  const W = weeksWithProfit[weeksWithProfit.length - 1] ? weeksWithProfit[weeksWithProfit.length - 1].label : null;
  t('存在含利润数据的周', !!W, weeksWithProfit.map(w => w.label));
  const exp = W ? expectWeek(W, null) : null;
  t('期望毛利非 0(可对账)', !!exp && Math.abs(exp.profit) > 0, exp && { profit: +exp.profit.toFixed(2), n: exp.n });

  const got = await page.evaluate((lb) => {
    const c = calc();
    const pw = c.perWeek[lb];
    if (!pw) return { missing: true };
    return { profit: profitOf(pw), margin: marginOf(pw), pSales: pw.pSales, pN: pw.pN, adSpend: pw.adSpend };
  }, W);
  t(`${W} 毛利值对账(USD)`, got.profit !== null && near(got.profit, exp.profit, 0.005), { got: got.profit, exp: +exp.profit.toFixed(2) });
  t(`${W} 报表销售额(pSales)对账`, near(got.pSales, exp.pSales, 0.005), { got: +got.pSales.toFixed(2), exp: +exp.pSales.toFixed(2) });
  t(`${W} 毛利率=毛利÷报表销售额`, got.margin !== null && near(got.margin, exp.profit / exp.pSales * 100, 0.01),
    { got: got.margin && +got.margin.toFixed(2), exp: +(exp.profit / exp.pSales * 100).toFixed(2) });

  // ③ 无利润数据的周 → —
  const firstW = scope.weeks[0].label;
  const noP = await page.evaluate((lb) => {
    const c = calc();
    const pw = c.perWeek[lb];
    return pw ? profitOf(pw) : 'no-week';
  }, firstW);
  t(`${firstW} 毛利为 null(该周无利润数据)`, noP === null || noP === 'no-week', noP);

  // ④ 合计行
  const tot = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#sumHead tr:nth-child(2) th')].map(th => th.textContent.trim());
    const ci = cols.indexOf('毛利');
    const trs = [...document.querySelectorAll('#sumBody tr')];
    const last = trs[trs.length - 1];
    return ci < 0 ? null : last.querySelectorAll('td')[ci].textContent.trim();
  });
  t('合计行毛利非 —', !!tot && tot !== '—' && !/^[—\s]*$/.test(tot), tot);

  // ④b 2026-10-12 第二轮: 毛利(RMB) 位置 + 8 细项 + 退款列
  const n2v = s => Number(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
  const tot2 = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#sumHead tr:nth-child(2) th')].map(th => th.textContent.trim());
    const trs = [...document.querySelectorAll('#sumBody tr')];
    const last = trs[trs.length - 1];
    const cells = [...last.querySelectorAll('td')].map(td => td.textContent.trim());
    const off = cells.length - cols.length;                         // 容错: 首列可能是/不是独立 td
    const get = lbl => { const i = cols.indexOf(lbl); return i < 0 ? null : cells[i + off]; };
    const n = s => Number(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
    return {
      ciR: cols.indexOf('毛利(RMB)'), ci: cols.indexOf('毛利'),
      rmb: get('毛利(RMB)'), profit: get('毛利'), rate: get('退款率'),
      fbMst: get('FBA月仓租费'), fbRet: get('FBA退货处理费'),
      refAbs: get('退款金额'), refPromo: get('促销折扣退款'), refNet: get('退款净额'),
      nRmb: n(get('毛利(RMB)')), nProfit: n(get('毛利')), nRefNet: n(get('退款净额')),
      // 表头存在性(取 METRICS 定义, 不受列显隐影响)
      labels: METRICS.map(m => m.label),
      keys: METRICS.map(m => m.key),
      rmbBeforeProfit: (() => { const r = METRICS.findIndex(m => m.key === 'profitRmb'); const p = METRICS.findIndex(m => m.key === 'profit'); return r >= 0 && p === r + 1; })(),
    };
  });
  t('周看板 METRICS 中 profitRmb 紧邻在 profit 之前', tot2.rmbBeforeProfit, { ciR: tot2.ciR, ci: tot2.ci });
  t('合计行 毛利(RMB) 非 — 且 ¥ 前缀', !!tot2.rmb && tot2.rmb.startsWith('¥'), tot2.rmb);
  t('合计行 毛利(RMB) ≈ 毛利 × CNY/USD(看板自身汇率表)', (() => {
    if (!isFinite(tot2.nProfit) || !isFinite(tot2.nRmb) || tot2.nProfit === 0) return false;
    const r = tot2.nRmb / tot2.nProfit; return r > 6.4 && r < 7.4;
  })(), { rmb: tot2.rmb, profit: tot2.profit });
  t('METRICS 含 8 细项 + 退款系列列(按 key 断言, 避开长说明文案)',
    ['fbRetAbs', 'fbOthAbs', 'fbOvrAbs', 'fbConAbs', 'fbCarAbs', 'fbRemAbs', 'fbMstAbs', 'fbLstAbs',
      'refAbs', 'refPromo', 'refComm', 'refNetAbs', 'refRate'].every(k => tot2.keys.includes(k)),
    tot2.keys.filter(k => /^fb(Ret|Oth|Ovr|Con|Car|Rem|Mst|Lst)Abs$|^ref/.test(k)));
  t('合计行 FBA月仓租费 取正数显示且为正', n2v(tot2.fbMst) > 0, tot2.fbMst);
  t('合计行 退款净额 为正且 ≈ 退款金额+佣金−促销折扣+运费', n2v(tot2.nRefNet) > 0, { refAbs: tot2.refAbs, refPromo: tot2.refPromo, refNet: tot2.refNet });
  t('退款率 > 0 且 = 退款件数÷利润报表销量', await page.evaluate(() => {
    const c = calc();
    const q = Object.keys(c.perWeek).reduce((s, w) => s + (c.perWeek[w].pRefQty || 0), 0);
    const d = Object.keys(c.perWeek).reduce((s, w) => s + (c.perWeek[w].pQty || 0), 0);
    return d > 0 && q > 0 && Math.abs(q / d * 100 - weekVal(c.totals, 'refRate')) < 0.02;
  }), null);
  t('毛利列显示币种: 未筛选/US 单国均为 $ (USD 口径)', await page.evaluate(() => {
    const a = calc().totals; const before = curSym();
    return before === '$';
  }), null);

  // ⑤ KPI 可选指标含毛利
  t('KPI 可选指标含 毛利/毛利率', await page.evaluate(() =>
    KPI_METRICS.some(m => m.key === 'profit') && KPI_METRICS.some(m => m.key === 'margin')), null);
  t('KPI 毛利取值可用(kpiValue)', await page.evaluate(() => {
    const v = kpiValue(calc().totals, 'profit');
    const m = kpiValue(calc().totals, 'margin');
    return typeof v === 'number' && typeof m === 'number';
  }), null);

  // ⑥ 单国筛选 (US)
  const expUS = W ? expectWeek(W, ['US']) : null;
  const gotUS = await page.evaluate((lb) => {
    selRegion.clear(); selCountry.clear(); selCountry.add('US');
    const c = calc();
    const pw = c.perWeek[lb];
    selCountry.clear();
    return pw ? { profit: profitOf(pw), pSales: pw.pSales } : null;
  }, W);
  t(`${W} US 单国毛利对账`, !!gotUS && near(gotUS.profit, expUS.profit, 0.005),
    { got: gotUS && gotUS.profit, exp: expUS && +expUS.profit.toFixed(2) });

  // ⑦ 无控制台报错
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
