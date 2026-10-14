// test_woot_margin.js — Woot 毛利口径回归（日 / 月 / 周三看板）
// 用户口径: 采购价 1,380 USD/台(= Woot 付我们的供货价, 收入侧); 报表 sales 是零售价, 不能当收入。
//   Woot 毛利 = 采购价 × 订单量 − 产品成本 × 订单量 − 运费 × 订单量 − Woot 广告费
//
// 成本来源(2026-10-10 起两层, 2026-10-13 确认): ①手工「Woot 成本设置」pc_woot_cfg.cost[asin] **优先**
//   ②「产品关系管理」asinMap → 产品名 → product_cost_table.json 的 costRMB/headRMB 折 USD
//   ③两层都没有 ⇒ 毛利 = —(null)（**不按 0 成本算**, 否则毛利虚高）
//
// 校验三类场景(三个看板各跑一遍):
//   A 手工没配 + 映射里也没有  → 单看 Woot 毛利 = —(null); 合并 = 官方店铺 − Woot 广告费
//   B 手工没配 + 映射能解析    → 单看 Woot 毛利 = 用**成本表+汇率独立算**的值; 合并 = 官方 + Woot
//   C 手工配了成本            → 单看 Woot 毛利 = 手工公式值(必须压过 B 的映射值); 官方店铺不受影响
// 用法: node test_woot_margin.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896)
//   ⚠️ 本测试把云端拦成空数组(模拟「云端没拉到」) ⇒ 页面只能靠**内嵌映射**解析成本。
//      2026-10-13 起 `product_map.json` 由构建期刷新(不再恒空), 所以场景 B 在离线也能解析 ——
//      这正是「看板首屏/离线也要算对头程与 Woot 成本」的目的, 不是回归。
const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// 口径参数(测试自己算期望值, 不读看板内部值)
const PRICE = 1380, UNIT = 620.5, FREIGHT = 38, ADCOST = 518.8, ORDERS = 1;
const DAY = '2026-09-10';               // 属 W37(周六 09-05 ~ 周五 09-11)
const ASIN = 'B0H69JJZ1M';
const UNMAPPED = 'B0NOSUCHASIN';        // 故意不在映射里 → 场景 A
const EXP_WOOT_PROFIT = PRICE * ORDERS - (UNIT + FREIGHT) * ORDERS - ADCOST;   // = 202.7
const wootDay = asin => ({ start: DAY, end: DAY, type: 'day', asin,
  metrics: { orders: ORDERS, sales: 1899.99, adCost: ADCOST, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } });
const WOOT_DAY = wootDay(ASIN);
const WOOT_DAY_NOMAP = wootDay(UNMAPPED);
const CFG = { price: PRICE, cost: { [ASIN]: { unit: UNIT, freight: FREIGHT } } };

// ---- 场景 B 的期望值: 成本表 + 内嵌映射 + 汇率, 独立复算(与看板 wootCostFromMap 同口径) ----
const TBL = JSON.parse(fs.readFileSync(path.join(DIR, 'product_cost_table.json'), 'utf8')).products;
const NAME_OF = (() => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'product_map.json'), 'utf8'));
  const o = {}; (m.asinMap || []).forEach(x => { if (x && x.asin) o[x.asin] = x.name; });
  return o;
})();
const RATE = (() => {                    // 看板统一取「最新月份 CNY/USD」
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, 'fx_rates.json'), 'utf8')).rates;
  const ym = Object.keys(fx).sort().pop();
  return Number((fx[ym] || {}).USD);
})();
const PROD = TBL[NAME_OF[ASIN]] || {};
const MAP_UNIT = Number(PROD.costRMB || 0) / RATE;
const MAP_FRE = Number((PROD.headRMB || {}).US || 0) / RATE;
const EXP_MAP_PROFIT = PRICE * ORDERS - (MAP_UNIT + MAP_FRE) * ORDERS - ADCOST;

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

// 开一个页面: cfg=null 表示不注入 pc_woot_cfg(模拟「手工成本还没配」)
async function openPage(browser, file, cfg, woot) {
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
  await ctx.addInitScript(([w, c]) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
    if (c) localStorage.setItem('pc_woot_cfg', JSON.stringify(c));
  }, [woot || [WOOT_DAY], cfg]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { page, errs, ctx };
}

(async () => {
  const browser = await chromium.launch();
  console.log(`== 目标: ${BASE} ==`);
  console.log(`   手工口径 Woot 毛利 = ${PRICE}×${ORDERS} − (${UNIT}+${FREIGHT})×${ORDERS} − ${ADCOST} = ${EXP_WOOT_PROFIT}`);
  console.log(`   映射口径 Woot 毛利 = ${PRICE}×${ORDERS} − (${MAP_UNIT.toFixed(2)}+${MAP_FRE.toFixed(2)})×${ORDERS} − ${ADCOST} = ${EXP_MAP_PROFIT.toFixed(2)}`
    + `  [${NAME_OF[ASIN] || '（映射里没有）'} · 汇率 ${RATE}]`);

  // 前置: 场景 B 必须有真数据, 否则整条断言会变得没有意义
  t('前置: 成本表里能查到该 ASIN 的产品(场景 B 可对账)',
    !!PROD.costRMB && MAP_UNIT > 0, { 产品: NAME_OF[ASIN], costRMB: PROD.costRMB, RATE });

  // ==================== ① 周看板 product.html ====================
  {
    console.log('-- ① 周看板 product.html --');
    const VIEWS = (page) => page.evaluate((wk) => {
      const setCh = a => { selChannel.clear(); a.forEach(x => selChannel.add(x)); };
      const prof = lb => { const c = calc(); return c.perWeek[lb] ? profitOf(c.perWeek[lb]) : 'no-week'; };
      const marg = lb => { const c = calc(); return c.perWeek[lb] ? marginOf(c.perWeek[lb]) : 'no-week'; };
      setCh(['woot']);   const woot = prof(wk), wootM = marg(wk);
      setCh(['amazon']); const amz = prof(wk);
      setCh([]);         const merged = prof(wk);
      setCh([]);
      const hasWootCfg = typeof WOOT_PRICE === 'number';
      return { wk, woot, wootM, amz, merged, hasWootCfg };
    }, 'W37');

    // ---- A 手工没配 + 映射里也没有 → —(null) ----
    const a = await openPage(browser, 'product.html', null, [WOOT_DAY_NOMAP]);
    const noMap = await VIEWS(a.page);
    t('周·A 两处都没配: 单看 Woot 毛利为 —(null)', noMap.woot === null, noMap);
    t('周·A 两处都没配: 合并 = 官方店铺 − Woot 广告费(无成本口径, 只扣了广告费)',
      near(noMap.merged, noMap.amz - ADCOST, 0.02), { merged: noMap.merged, amz: noMap.amz, wootAd: ADCOST });
    t('周·A 无页面错误', a.errs.length === 0, a.errs.slice(0, 2));
    await a.ctx.close();

    // ---- B 手工没配 + 映射能解析 → 用成本表独立算的值 ----
    const m = await openPage(browser, 'product.html', null);
    const mapRes = await VIEWS(m.page);
    t('周·B 未配手工成本: 单看 Woot 毛利 = 成本表算出的值', near(mapRes.woot, EXP_MAP_PROFIT, 0.02),
      { got: mapRes.woot, exp: +EXP_MAP_PROFIT.toFixed(2), unit: +MAP_UNIT.toFixed(2), freight: +MAP_FRE.toFixed(2) });
    t('周·B 未配手工成本: 合并毛利 = 官方店铺 + Woot 毛利', near(mapRes.merged, mapRes.amz + EXP_MAP_PROFIT, 0.02),
      { merged: mapRes.merged, amz: mapRes.amz, woot: +EXP_MAP_PROFIT.toFixed(2) });
    t('周·B 无页面错误', m.errs.length === 0, m.errs.slice(0, 2));
    await m.ctx.close();

    // ---- C 手工配了成本 → 手工优先, 且官方店铺不受影响 ----
    const b = await openPage(browser, 'product.html', CFG);
    const cfg = await VIEWS(b.page);
    t('周·C 配成本: 单看 Woot 毛利 = 手工公式值', near(cfg.woot, EXP_WOOT_PROFIT), { got: cfg.woot, exp: EXP_WOOT_PROFIT });
    t('周·C 配成本: Woot 毛利率 = 毛利 ÷ 采购价收入', near(cfg.wootM, EXP_WOOT_PROFIT / (PRICE * ORDERS) * 100, 0.02),
      { got: cfg.wootM, exp: EXP_WOOT_PROFIT / (PRICE * ORDERS) * 100 });
    t('周·C 手工成本压过映射成本(≠ B 的映射值)', !near(cfg.woot, EXP_MAP_PROFIT, 0.02),
      { manual: cfg.woot, map: +EXP_MAP_PROFIT.toFixed(2) });
    t('周·C 单看官方店铺毛利不受 Woot 成本配置影响', near(cfg.amz, mapRes.amz), { with: cfg.amz, without: mapRes.amz });
    t('周·C 合并毛利 = 官方店铺 + Woot 毛利', near(cfg.merged, cfg.amz + EXP_WOOT_PROFIT, 0.02),
      { merged: cfg.merged, amz: cfg.amz, woot: EXP_WOOT_PROFIT });
    t('周·C 无页面错误', b.errs.length === 0, b.errs.slice(0, 2));
    await b.ctx.close();
  }

  // ==================== ② 日看板 daily.html ====================
  {
    console.log('-- ② 日看板 daily.html --');
    const VIEWS = (page) => page.evaluate((d) => {
      const setCh = a => { selChannel.clear(); a.forEach(x => selChannel.add(x)); };
      const mv = () => { const a = aggRows(d, null, null); return metricVals(a); };
      setCh(['woot']);   const woot = mv();
      setCh(['amazon']); const amz = mv();
      setCh([]);         const merged = mv();
      setCh([]);
      return { woot, amz, merged };
    }, DAY);

    const a = await openPage(browser, 'daily.html', null, [WOOT_DAY_NOMAP]);
    const noMap = await VIEWS(a.page);
    t('日·A 两处都没配: 单看 Woot 毛利为 —(null)', noMap.woot.profit === null, noMap.woot);
    t('日·A 两处都没配: 合并 = 官方店铺 − Woot 广告费',
      near(noMap.merged.profit, noMap.amz.profit - ADCOST, 0.02), { merged: noMap.merged.profit, amz: noMap.amz.profit, wootAd: ADCOST });
    t('日·A 无页面错误', a.errs.length === 0, a.errs.slice(0, 2));
    await a.ctx.close();

    const m = await openPage(browser, 'daily.html', null);
    const mapRes = await VIEWS(m.page);
    t('日·B 未配手工成本: 单看 Woot 毛利 = 成本表算出的值', near(mapRes.woot.profit, EXP_MAP_PROFIT, 0.02),
      { got: mapRes.woot.profit, exp: +EXP_MAP_PROFIT.toFixed(2) });
    t('日·B 未配手工成本: 合并毛利 = 官方店铺 + Woot 毛利', near(mapRes.merged.profit, mapRes.amz.profit + EXP_MAP_PROFIT, 0.02),
      { merged: mapRes.merged.profit, amz: mapRes.amz.profit, woot: +EXP_MAP_PROFIT.toFixed(2) });
    t('日·B 无页面错误', m.errs.length === 0, m.errs.slice(0, 2));
    await m.ctx.close();

    const b = await openPage(browser, 'daily.html', CFG);
    const cfg = await VIEWS(b.page);
    t('日·C 配成本: 单看 Woot 毛利 = 手工公式值', near(cfg.woot.profit, EXP_WOOT_PROFIT), { got: cfg.woot.profit, exp: EXP_WOOT_PROFIT });
    t('日·C 手工成本压过映射成本', !near(cfg.woot.profit, EXP_MAP_PROFIT, 0.02), { manual: cfg.woot.profit, map: +EXP_MAP_PROFIT.toFixed(2) });
    t('日·C 单看官方店铺毛利不受成本配置影响', near(cfg.amz.profit, mapRes.amz.profit), { with: cfg.amz.profit, without: mapRes.amz.profit });
    t('日·C 合并毛利 = 官方店铺 + Woot 毛利', near(cfg.merged.profit, cfg.amz.profit + EXP_WOOT_PROFIT, 0.02),
      { merged: cfg.merged.profit, amz: cfg.amz.profit, exp: cfg.amz.profit + EXP_WOOT_PROFIT });
    t('日·C 无页面错误', b.errs.length === 0, b.errs.slice(0, 2));
    await b.ctx.close();
  }

  // ==================== ③ 月看板 monthly.html ====================
  {
    console.log('-- ③ 月看板 monthly.html --');
    const VIEWS = (page) => page.evaluate((ym) => {
      const setCh = a => { selChannel.clear(); a.forEach(x => selChannel.add(x)); };
      const mv = () => {
        const rows = ROWS.filter(r => !selChannel.size || selChannel.has(channelOf(r)));
        const a = aggMonth(ym, rows);
        return { profit: profitOf(a), margin: marginOf(a), pSales: a.pSales, pN: a.pN, adCost: a.adCost };
      };
      setCh(['woot']);   const woot = mv();
      setCh(['amazon']); const amz = mv();
      setCh([]);         const merged = mv();
      setCh([]);
      return { woot, amz, merged };
    }, '2026-09');

    const a = await openPage(browser, 'monthly.html', null, [WOOT_DAY_NOMAP]);
    const noMap = await VIEWS(a.page);
    t('月·A 两处都没配: 单看 Woot 毛利为 —(null)', noMap.woot.profit === null, noMap.woot);
    t('月·A 两处都没配: 合并 = 官方店铺 − Woot 广告费',
      near(noMap.merged.profit, noMap.amz.profit - ADCOST, 0.02), { merged: noMap.merged.profit, amz: noMap.amz.profit, wootAd: ADCOST });
    t('月·A 无页面错误', a.errs.length === 0, a.errs.slice(0, 2));
    await a.ctx.close();

    const m = await openPage(browser, 'monthly.html', null);
    const mapRes = await VIEWS(m.page);
    t('月·B 未配手工成本: 单看 Woot 毛利 = 成本表算出的值', near(mapRes.woot.profit, EXP_MAP_PROFIT, 0.02),
      { got: mapRes.woot.profit, exp: +EXP_MAP_PROFIT.toFixed(2) });
    t('月·B 未配手工成本: 合并毛利 = 官方店铺 + Woot 毛利', near(mapRes.merged.profit, mapRes.amz.profit + EXP_MAP_PROFIT, 0.02),
      { merged: mapRes.merged.profit, amz: mapRes.amz.profit, woot: +EXP_MAP_PROFIT.toFixed(2) });
    t('月·B 无页面错误', m.errs.length === 0, m.errs.slice(0, 2));
    await m.ctx.close();

    const b = await openPage(browser, 'monthly.html', CFG);
    const cfg = await VIEWS(b.page);
    t('月·C 配成本: 单看 Woot 毛利 = 手工公式值', near(cfg.woot.profit, EXP_WOOT_PROFIT), { got: cfg.woot.profit, exp: EXP_WOOT_PROFIT });
    t('月·C 手工成本压过映射成本', !near(cfg.woot.profit, EXP_MAP_PROFIT, 0.02), { manual: cfg.woot.profit, map: +EXP_MAP_PROFIT.toFixed(2) });
    t('月·C 单看官方店铺毛利不受成本配置影响', near(cfg.amz.profit, mapRes.amz.profit), { with: cfg.amz.profit, without: mapRes.amz.profit });
    t('月·C 合并毛利 = 官方店铺 + Woot 毛利', near(cfg.merged.profit, cfg.amz.profit + EXP_WOOT_PROFIT, 0.02),
      { merged: cfg.merged.profit, amz: cfg.amz.profit, woot: EXP_WOOT_PROFIT });
    t('月·C 无页面错误', b.errs.length === 0, b.errs.slice(0, 2));
    await b.ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
