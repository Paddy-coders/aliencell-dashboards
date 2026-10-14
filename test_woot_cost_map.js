// test_woot_cost_map.js — Woot 成本经「产品关系管理」解析 回归（日 / 月 / 周三看板）
//
// 用户口径 (2026-10-13): 「woot 的销售额和采购价是对的，它们确实是独立存在的计算方式。
//   woot 的产品是 X1 40W 产品，你可以通过产品关系管理里面进行匹配。」
//   ⇒ Woot 行的成本**不应**要求用户再手工录一遍，而应经「产品关系管理」把 ASIN 匹配到产品名，
//     再取产品成本表的 costRMB(采购成本) 与 headRMB.US(US 头程)，÷ (CNY/USD) 折成 USD/台。
//   优先级: ① 手工「Woot 成本设置」pc_woot_cfg.cost[asin] ② 产品关系管理回退 ③ 都没有 → null(—)
//
// 本测试**不依赖任何真实 ASIN/映射**，全部动态从 product_cost_table.json / fx_rates.json 取:
//   取一个 costRMB>0 的产品 → 造一个合成 ASIN 映射到它 → 造一条 Woot 记录 → 断言三看板解析出的
//   unit/freight/毛利 与手工算的一致。真实 ASIN 那条(_map_cache.json 里若存在)额外核对一遍。
//
// 用法: node test_woot_cost_map.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896)
const fs = require('fs');
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';
const PRICE = 1380, ORDERS = 3, ADCOST = 411.5;   // 造数据用(口径与 test_woot_margin 一致)
const YM = '2026-09';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

// ---------- 动态取口径参数 ----------
const COST = JSON.parse(fs.readFileSync('product_cost_table.json', 'utf8')).products;
// fx_rates.json 结构: {fetchedAt, meta, rates: {ym: {币种: CNY/单位}}}
// (日看板 HF.months / 月看板 FX 都是这一个来源的 USD，所以三看板用同一汇率)
const FXR = JSON.parse(fs.readFileSync('fx_rates.json', 'utf8')).rates;
const ymLast = Object.keys(FXR).sort().pop();
const RATE = Number((FXR[ymLast] || {}).USD);
if (!(RATE > 0)) { console.error('FATAL 汇率取不到: ' + ymLast); process.exit(1); }
// 造一个合成 ASIN: 用「有 costRMB>0 且 headRMB.US>0」的产品
const SYN_NAME = Object.keys(COST).find(n => (COST[n].costRMB > 0) && (((COST[n].headRMB || {}).US) || 0) > 0);
const SYN_ASIN = 'B0TESTWOOT1';
const EXP_UNIT = COST[SYN_NAME].costRMB / RATE;
const EXP_FREIGHT = COST[SYN_NAME].headRMB.US / RATE;
const EXP_PROFIT = PRICE * ORDERS - (EXP_UNIT + EXP_FREIGHT) * ORDERS - ADCOST;

// 真实 ASIN(若本地映射缓存里有) —— 额外核对一次用户实案
let REAL = null;
try {
  const m = JSON.parse(fs.readFileSync('_map_cache.json', 'utf8'));
  const hit = (m.asinMap || []).find(x => x && x.name && COST[x.name] && COST[x.name].costRMB > 0);
  if (hit) REAL = { asin: hit.asin, name: hit.name, unit: COST[hit.name].costRMB / RATE,
    freight: ((COST[hit.name].headRMB || {}).US || 0) / RATE };
} catch (e) {}

const asinMapSeed = [{ asin: SYN_ASIN, name: SYN_NAME, series: '测试系列', country: 'US' }]
  .concat(REAL ? [{ asin: REAL.asin, name: REAL.name, series: '测试系列', country: 'US' }] : []);
const WOOT = [{ start: YM + '-01', end: YM + '-30', type: 'month', asin: SYN_ASIN,
  metrics: { orders: ORDERS, sales: 1899.99 * ORDERS, adCost: ADCOST, adClicks: 300, adOrders: 0, adImpr: 90000, adSales: 0 } }];

async function open(browser, file) {
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
  await ctx.addInitScript(([woot, am]) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(woot));
    localStorage.setItem('pc_asinmap', JSON.stringify(am));
    localStorage.removeItem('pc_woot_cfg');       // 关键: 不配手工成本 → 强制走回退链
  }, [WOOT, asinMapSeed]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { page, errs, ctx };
}

const UNIT_EXPR = asin => `(function(){ const c = wootUnitCost(${JSON.stringify(asin)});
  return { src: c && c.src, unit: c && c.unit, freight: c && c.freight }; })()`;
const MONTH_EXPR = asin => `(function(){ const c = wootUnitCost(${JSON.stringify(asin)});
  selChannel.clear(); selChannel.add('woot');
  const rows = ROWS.filter(r => selChannel.has(channelOf(r)));
  const a = aggMonth(${JSON.stringify(YM)}, rows);
  const out = { src: c && c.src, unit: c && c.unit, freight: c && c.freight, pSales: a.pSales, profit: profitOf(a) };
  selChannel.clear();
  return out; })()`;

(async () => {
  const browser = await chromium.launch();
  console.log(`== 目标: ${BASE} ==`);
  console.log(`   口径: 成本表「${SYN_NAME}」costRMB=${COST[SYN_NAME].costRMB} + US头程=${COST[SYN_NAME].headRMB.US} ÷ ${ymLast} USD ${RATE}`);
  console.log(`   期望 unit=${EXP_UNIT.toFixed(4)} freight=${EXP_FREIGHT.toFixed(4)} · 月 Woot 毛利=${EXP_PROFIT.toFixed(2)}`);

  // ============ ① 月看板: 回退解析 + Woot 行毛利 ============
  {
    console.log('-- ① 月看板 monthly.html --');
    const { page, errs, ctx } = await open(browser, 'monthly.html');
    const r = await page.evaluate(e => eval(e), MONTH_EXPR(SYN_ASIN));
    t('月·成本来源 = 产品关系管理(回退链 ②)', r.src === 'map', r);
    t('月·unit = costRMB ÷ 汇率', near(r.unit, EXP_UNIT, 0.01), { got: r.unit, exp: EXP_UNIT });
    t('月·freight = US头程 ÷ 汇率', near(r.freight, EXP_FREIGHT, 0.01), { got: r.freight, exp: EXP_FREIGHT });
    t('月·采购价收入 = 1380 × 订单量', near(r.pSales, PRICE * ORDERS), { got: r.pSales, exp: PRICE * ORDERS });
    t('月·Woot 毛利 = 收入 − 成本 − 头程 − 广告费', near(r.profit, EXP_PROFIT, 0.02), { got: r.profit, exp: EXP_PROFIT });
    t('月·毛利是数字不是 NaN', typeof r.profit === 'number' && !isNaN(r.profit), { got: r.profit });
    t('月·无页面错误', errs.length === 0, errs.slice(0, 2));
    if (REAL) {
      const rr = await page.evaluate(e => eval(e), UNIT_EXPR(REAL.asin));
      t(`月·实案 ${REAL.asin} → ${REAL.name} 解析成功`, rr.src === 'map', rr);
      t(`月·实案 ${REAL.asin} unit/freight 正确`, near(rr.unit, REAL.unit, 0.01) && near(rr.freight, REAL.freight, 0.01),
        { got: rr, exp: { unit: REAL.unit, freight: REAL.freight } });
    }
    await ctx.close();
  }

  // ============ ② 日看板 ============
  {
    console.log('-- ② 日看板 daily.html --');
    const { page, errs, ctx } = await open(browser, 'daily.html');
    const r = await page.evaluate(e => eval(e), UNIT_EXPR(SYN_ASIN));
    t('日·成本来源 = 产品关系管理(回退链 ②)', r.src === 'map', r);
    t('日·unit = costRMB ÷ 汇率', near(r.unit, EXP_UNIT, 0.01), { got: r.unit, exp: EXP_UNIT });
    t('日·freight = US头程 ÷ 汇率', near(r.freight, EXP_FREIGHT, 0.01), { got: r.freight, exp: EXP_FREIGHT });
    t('日·无页面错误', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ============ ③ 周看板 ============
  {
    console.log('-- ③ 周看板 product.html --');
    const { page, errs, ctx } = await open(browser, 'product.html');
    const r = await page.evaluate(e => eval(e), UNIT_EXPR(SYN_ASIN));
    t('周·成本来源 = 产品关系管理(回退链 ②)', r.src === 'map', r);
    t('周·unit = costRMB ÷ 汇率', near(r.unit, EXP_UNIT, 0.01), { got: r.unit, exp: EXP_UNIT });
    t('周·freight = US头程 ÷ 汇率', near(r.freight, EXP_FREIGHT, 0.01), { got: r.freight, exp: EXP_FREIGHT });
    t('周·无页面错误', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ============ ④ 护栏: 手工配置必须仍然优先 ============
  {
    console.log('-- ④ 手工「Woot 成本设置」优先级 --');
    const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
    await ctx.addInitScript(([woot, am, asin]) => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
      localStorage.setItem('pc_woot', JSON.stringify(woot));
      localStorage.setItem('pc_asinmap', JSON.stringify(am));
      localStorage.setItem('pc_woot_cfg', JSON.stringify({ cost: { [asin]: { unit: 620.5, freight: 38 } } }));
    }, [WOOT, asinMapSeed, SYN_ASIN]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE + '/monthly.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(e => eval(e), UNIT_EXPR(SYN_ASIN));
    t('月·配了手工成本时以手工为准(src=cfg, 620.5/38)', r.src === 'cfg' && near(r.unit, 620.5) && near(r.freight, 38), r);
    t('月·无页面错误', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
