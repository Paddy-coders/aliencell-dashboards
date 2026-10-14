// test_woot_rowprice.js — 「采购价每行可填」专项回归（日 / 月 / 周三看板 + woot.html 录入）
// 用户口径（2026-10-10 补充）:
//   ① Woot 数据并入现有看板, 只多一个「销售店铺」条件; Woot + 官方店铺 = 原看板数据(只是拆开看)
//   ② Aliencell官方店铺 = 去 Woot
//   ③ **采购价以每行可填来进行, 上传数据时一次性填好**
//   ⇒ 毛利 = Σ(该行采购价 × 该行订单量) − 产品成本 × 订单量 − 运费 × 订单量 − Woot 广告费
//      同一 ASIN 不同批次采购价不同也要算准 → 必须聚合「采购价收入」而不是「某个单价 × 订单量」
// 本测试用「同一 ASIN 同一周两个不同采购价」做核心断言, 并校验:
//   A. 逐行价聚合正确(≠ 任一单价 × 总量)
//   B. 未填价的行 → 退回「默认采购价」
//   C. 改默认价只影响未填价的行(填了价的行不动)
//   D. 单看官方店铺不受采购价影响(采购价只属 Woot 侧)
//   E. woot.html: 表头识别「采购价」列 / 列表逐行可改 / 导出 CSV 带采购价 / 手动添加带采购价
// 用法: node test_woot_rowprice.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896)
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrqwatg//**';                       // 占位, 下面用真 URL
const SUPA_RE = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// ---------- 口径参数(测试自己算期望值, 不读看板内部值) ----------
const ASIN_A = 'B0H69JJZ1M';            // 逐行采购价(两行两个价)
const ASIN_B = 'B0FN3NPF7Y';            // 不填采购价 → 用默认价
const PRICE_A1 = 1000, PRICE_A2 = 1200; // A 的两行单价
const COST_A = { unit: 100, freight: 20 };   // A 单台成本 120
const COST_B = { unit: 200, freight: 50 };   // B 单台成本 250
const DEF_PRICE = 1380, DEF_PRICE2 = 1500;   // 默认采购价(可被逐行价覆盖)
const AD_A1 = 100, AD_A2 = 200, AD_B = 300;

const D1 = '2026-09-10', D2 = '2026-09-11';  // 同属 W37(周六 09-05 ~ 周五 09-11)
const WK = 'W37', YM = '2026-09';

const WOOT = [
  { start: D1, end: D1, type: 'day', asin: ASIN_A, price: PRICE_A1,
    metrics: { orders: 1, sales: 1899.99, adCost: AD_A1, adClicks: 10, adOrders: 0, adImpr: 1000, adSales: 0 } },
  { start: D2, end: D2, type: 'day', asin: ASIN_A, price: PRICE_A2,
    metrics: { orders: 2, sales: 3799.98, adCost: AD_A2, adClicks: 20, adOrders: 0, adImpr: 2000, adSales: 0 } },
  { start: D1, end: D1, type: 'day', asin: ASIN_B,             // ← 故意不填 price
    metrics: { orders: 1, sales: 1899.99, adCost: AD_B, adClicks: 30, adOrders: 0, adImpr: 3000, adSales: 0 } },
];
const CFG  = { price: DEF_PRICE,  cost: { [ASIN_A]: COST_A, [ASIN_B]: COST_B } };
const CFG2 = { price: DEF_PRICE2, cost: { [ASIN_A]: COST_A, [ASIN_B]: COST_B } };

// ---------- 期望值 ----------
const mul = (o) => o.unit + o.freight;
// A: 1 台 @1000 + 2 台 @1200 → 收入 3400, 成本 120×3=360, 广告 100+200=300
const A_REV = PRICE_A1 * 1 + PRICE_A2 * 2;                   // 3400
const A_PROFIT = A_REV - mul(COST_A) * 3 - (AD_A1 + AD_A2);   // 3400 − 360 − 300 = 2740
// B: 1 台 @默认价 → 收入 = 默认价, 成本 250, 广告 300
const bRev = (def) => def * 1;
const bProfit = (def) => bRev(def) - mul(COST_B) * 1 - AD_B;
// 合计(W37 / 2026-09 全量)
const TOT_REV = (def) => A_REV + bRev(def);
const TOT_PROFIT = (def) => A_PROFIT + bProfit(def);
// 单日
const D1_REV = (def) => PRICE_A1 * 1 + bRev(def);
const D1_PROFIT = (def) => (PRICE_A1 - mul(COST_A)) * 1 - AD_A1 + bProfit(def);
const D2_REV = PRICE_A2 * 2;
const D2_PROFIT = (PRICE_A2 - mul(COST_A)) * 2 - AD_A2;

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (tol === undefined ? 0.02 : tol);
const nearR = (a, b, tol) => near(a, b, (tol === undefined ? 0.02 : tol) * Math.max(1, Math.abs(b)));

async function openBoard(browser, file, cfg, woot) {
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
  await ctx.addInitScript(([w, c]) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
    if (c) localStorage.setItem('pc_woot_cfg', JSON.stringify(c));
  }, [woot, cfg]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(SUPA_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { page, errs, ctx };
}

(async () => {
  const browser = await chromium.launch();
  console.log('== 目标: ' + BASE + ' ==');
  console.log('   A 行采购价: ' + PRICE_A1 + '×1 + ' + PRICE_A2 + '×2 = 收入 ' + A_REV +
              '  ⇒ 毛利 ' + A_REV + ' − ' + mul(COST_A) + '×3 − ' + (AD_A1 + AD_A2) + ' = ' + A_PROFIT);
  console.log('   B 未填价 ⇒ 用默认价 ' + DEF_PRICE + ' → 收入 ' + bRev(DEF_PRICE) + ' ⇒ 毛利 ' + bProfit(DEF_PRICE));

  // ==================== ① 周看板 product.html ====================
  {
    console.log('-- ① 周看板 product.html --');
    const VIEWS = (page, def) => page.evaluate((a) => {
      const setCh = x => { selChannel.clear(); x.forEach(y => selChannel.add(y)); };
      const pr = asin => { const d = asinWeekData(asin, a.wk); return d ? profitOf(d) : 'no-data'; };
      const mg = asin => { const d = asinWeekData(asin, a.wk); return d ? marginOf(d) : 'no-data'; };
      const ps = asin => { const d = asinWeekData(asin, a.wk); return d ? d.pSales : 'no-data'; };
      setCh(['woot']);
      const out = { woot: pr(null), wootM: null, wootP: null, amz: null };
      // 合计 = 全部 ASIN 的周合计
      const c = calc(); const tot = c.perWeek[a.wk];
      out.woot = profitOf(tot); out.wootM = marginOf(tot); out.wootP = tot.pSales;
      out.a = { profit: pr(a.asinA), rev: ps(a.asinA), margin: mg(a.asinA) };
      out.b = { profit: pr(a.asinB), rev: ps(a.asinB) };
      setCh(['amazon']);
      out.amz = profitOf(calc().perWeek[a.wk]);
      setCh([]);
      out.merged = profitOf(calc().perWeek[a.wk]);
      setCh([]);
      return out;
    }, { wk: WK, asinA: ASIN_A, asinB: ASIN_B });

    const b1 = await openBoard(browser, 'product.html', CFG, WOOT);
    const r1 = await VIEWS(b1.page);
    t('周·单看 Woot 合计毛利 = Σ(逐行价×订单量) − 成本 − 广告', near(r1.woot, TOT_PROFIT(DEF_PRICE)),
      { got: r1.woot, exp: TOT_PROFIT(DEF_PRICE) });
    t('周·单看 Woot 收入 = 逐行价合计(不是任一单价×总量)', near(r1.wootP, TOT_REV(DEF_PRICE)),
      { got: r1.wootP, exp: TOT_REV(DEF_PRICE), wrong_if_avg: PRICE_A2 * 4 + bRev(DEF_PRICE) });
    t('周·单看 Woot 毛利率 = 毛利 ÷ 逐行价收入', near(r1.wootM, TOT_PROFIT(DEF_PRICE) / TOT_REV(DEF_PRICE) * 100),
      { got: r1.wootM, exp: TOT_PROFIT(DEF_PRICE) / TOT_REV(DEF_PRICE) * 100 });
    t('周·A(两个不同采购价)收入 = 1000×1 + 1200×2', near(r1.a.rev, A_REV), { got: r1.a.rev, exp: A_REV });
    t('周·A 毛利 = 逐行收入 − 成本 − 广告', near(r1.a.profit, A_PROFIT), { got: r1.a.profit, exp: A_PROFIT });
    t('周·B(未填价)收入 = 默认价 1380 × 1', near(r1.b.rev, bRev(DEF_PRICE)), { got: r1.b.rev, exp: bRev(DEF_PRICE) });
    t('周·B 毛利 = 默认价 − 成本 − 广告', near(r1.b.profit, bProfit(DEF_PRICE)), { got: r1.b.profit, exp: bProfit(DEF_PRICE) });
    t('周·合并毛利 = 官方店铺 + Woot 合计毛利', near(r1.merged, r1.amz + TOT_PROFIT(DEF_PRICE)),
      { merged: r1.merged, amz: r1.amz, woot: TOT_PROFIT(DEF_PRICE) });
    t('周·无页面错误', b1.errs.length === 0, b1.errs.slice(0, 3));
    await b1.ctx.close();

    // 改默认价 → 只影响未填价的 B
    const b2 = await openBoard(browser, 'product.html', CFG2, WOOT);
    const r2 = await VIEWS(b2.page);
    t('周·改默认价 1380→1500: A(已填价)收入不变', near(r2.a.rev, A_REV), { got: r2.a.rev, exp: A_REV });
    t('周·改默认价: A 毛利不变', near(r2.a.profit, A_PROFIT), { got: r2.a.profit, exp: A_PROFIT });
    t('周·改默认价: B(未填价)收入 = 1500', near(r2.b.rev, bRev(DEF_PRICE2)), { got: r2.b.rev, exp: bRev(DEF_PRICE2) });
    t('周·改默认价: 合计 = 新默认价口径', near(r2.woot, TOT_PROFIT(DEF_PRICE2)), { got: r2.woot, exp: TOT_PROFIT(DEF_PRICE2) });
    t('周·改默认价: 官方店铺毛利不受任何影响', near(r2.amz, r1.amz), { now: r2.amz, before: r1.amz });
    t('周·改默认价: 无页面错误', b2.errs.length === 0, b2.errs.slice(0, 3));
    await b2.ctx.close();
  }

  // ==================== ② 日看板 daily.html ====================
  {
    console.log('-- ② 日看板 daily.html --');
    const VIEWS = (page) => page.evaluate((a) => {
      const setCh = x => { selChannel.clear(); x.forEach(y => selChannel.add(y)); };
      const mv = (d, asins) => metricVals(aggRows(d, null, asins ? new Set(asins) : null));
      setCh(['woot']);
      const out = {
        d1: mv(a.d1, null), d2: mv(a.d2, null),
        d1A: mv(a.d1, [a.asinA]), d1B: mv(a.d1, [a.asinB]),
        d1Amz: null, d1Merged: null,
      };
      setCh(['amazon']); out.d1Amz = mv(a.d1, null);
      setCh([]);         out.d1Merged = mv(a.d1, null);
      setCh([]);
      return out;
    }, { d1: D1, d2: D2, asinA: ASIN_A, asinB: ASIN_B });

    const b1 = await openBoard(browser, 'daily.html', CFG, WOOT);
    const r1 = await VIEWS(b1.page);
    t('日·09-10 单看 Woot 毛利 = 逐行口径', near(r1.d1.profit, D1_PROFIT(DEF_PRICE)), { got: r1.d1.profit, exp: D1_PROFIT(DEF_PRICE) });
    t('日·09-11 单看 Woot 毛利 = 1200×2 − 成本 − 广告', near(r1.d2.profit, D2_PROFIT), { got: r1.d2.profit, exp: D2_PROFIT });
    t('日·09-11 毛利率 = 毛利 ÷ 1200×2', near(r1.d2.margin, D2_PROFIT / D2_REV * 100), { got: r1.d2.margin });
    t('日·09-10 按 ASIN_A 过滤: 毛利 = 1000 − 成本 − 广告', near(r1.d1A.profit, (PRICE_A1 - mul(COST_A)) - AD_A1),
      { got: r1.d1A.profit, exp: (PRICE_A1 - mul(COST_A)) - AD_A1 });
    t('日·09-10 按 ASIN_B 过滤: 用默认价 + 自己的成本', near(r1.d1B.profit, bProfit(DEF_PRICE)),
      { got: r1.d1B.profit, exp: bProfit(DEF_PRICE) });
    t('日·09-10 合并毛利 = 官方店铺 + Woot', near(r1.d1Merged.profit, r1.d1Amz.profit + D1_PROFIT(DEF_PRICE)),
      { merged: r1.d1Merged.profit, amz: r1.d1Amz.profit, woot: D1_PROFIT(DEF_PRICE) });
    t('日·无页面错误', b1.errs.length === 0, b1.errs.slice(0, 3));
    await b1.ctx.close();

    const b2 = await openBoard(browser, 'daily.html', CFG2, WOOT);
    const r2 = await VIEWS(b2.page);
    t('日·改默认价: 09-11(全是已填价行)毛利不变', near(r2.d2.profit, D2_PROFIT), { got: r2.d2.profit, exp: D2_PROFIT });
    t('日·改默认价: 09-10 只有 B 变(合计 = 1000 行 + 1500 行)', near(r2.d1.profit, D1_PROFIT(DEF_PRICE2)),
      { got: r2.d1.profit, exp: D1_PROFIT(DEF_PRICE2) });
    t('日·改默认价: 无页面错误', b2.errs.length === 0, b2.errs.slice(0, 3));
    await b2.ctx.close();
  }

  // ==================== ③ 月看板 monthly.html ====================
  {
    console.log('-- ③ 月看板 monthly.html --');
    const VIEWS = (page) => page.evaluate((a) => {
      const setCh = x => { selChannel.clear(); x.forEach(y => selChannel.add(y)); };
      const mv = (asins) => {
        const rows = ROWS.filter(r => (!selChannel.size || selChannel.has(channelOf(r)))
          && (!asins || asins.indexOf(r.asin) >= 0));
        const g = aggMonth(a.ym, rows);
        return { profit: profitOf(g), margin: marginOf(g), pSales: g.pSales };
      };
      setCh(['woot']); const out = { woot: mv(null), a: mv([a.asinA]), b: mv([a.asinB]) };
      setCh(['amazon']); out.amz = mv(null);
      setCh([]);         out.merged = mv(null);
      setCh([]);
      return out;
    }, { ym: YM, asinA: ASIN_A, asinB: ASIN_B });

    const b1 = await openBoard(browser, 'monthly.html', CFG, WOOT);
    const r1 = await VIEWS(b1.page);
    t('月·单看 Woot 毛利 = 逐行口径', near(r1.woot.profit, TOT_PROFIT(DEF_PRICE)), { got: r1.woot.profit, exp: TOT_PROFIT(DEF_PRICE) });
    t('月·单看 Woot 收入 = Σ(逐行价×订单量)', near(r1.woot.pSales, TOT_REV(DEF_PRICE)), { got: r1.woot.pSales, exp: TOT_REV(DEF_PRICE) });
    t('月·A 收入 = 1000×1 + 1200×2', near(r1.a.pSales, A_REV), { got: r1.a.pSales, exp: A_REV });
    t('月·A 毛利 = 逐行收入 − 成本 − 广告', near(r1.a.profit, A_PROFIT), { got: r1.a.profit, exp: A_PROFIT });
    t('月·B 用默认价', near(r1.b.pSales, bRev(DEF_PRICE)), { got: r1.b.pSales, exp: bRev(DEF_PRICE) });
    t('月·合并毛利 = 官方店铺 + Woot', near(r1.merged.profit, r1.amz.profit + TOT_PROFIT(DEF_PRICE)),
      { merged: r1.merged.profit, amz: r1.amz.profit });
    t('月·无页面错误', b1.errs.length === 0, b1.errs.slice(0, 3));
    await b1.ctx.close();

    const b2 = await openBoard(browser, 'monthly.html', CFG2, WOOT);
    const r2 = await VIEWS(b2.page);
    t('月·改默认价: A 不受影响', near(r2.a.profit, A_PROFIT), { got: r2.a.profit, exp: A_PROFIT });
    t('月·改默认价: B 用 1500', near(r2.b.pSales, bRev(DEF_PRICE2)), { got: r2.b.pSales, exp: bRev(DEF_PRICE2) });
    t('月·改默认价: 无页面错误', b2.errs.length === 0, b2.errs.slice(0, 3));
    await b2.ctx.close();
  }

  // ==================== ④ woot.html 录入 ====================
  {
    console.log('-- ④ woot.html 录入(采购价列 / 逐行改 / 导出 / 手动添加) --');
    const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
      localStorage.removeItem('pc_woot');
      localStorage.removeItem('pc_woot_cfg');
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.route(SUPA_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
    await page.goto(BASE + '/woot.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);

    // (a) 表头含「采购价」→ 逐行读入
    const csvWith = [
      '开始日期,结束日期,子ASIN,采购价,订单量,销售额,广告花费,广告点击,广告订单,广告曝光,广告销售额',
      `${D1},${D1},${ASIN_A},${PRICE_A1},1,1899.99,${AD_A1},10,0,1000,0`,
      `${D2},${D2},${ASIN_A},${PRICE_A2},2,3799.98,${AD_A2},20,0,2000,0`,
      `${D1},${D1},${ASIN_B},,1,1899.99,${AD_B},30,0,3000,0`,      // ← 采购价留空
    ].join('\n');
    const p1 = await page.evaluate((txt) => {
      document.getElementById('wText').value = txt;
      parseInput(txt, false);
      return (pendingPreview || []).map(e => ({ asin: e.asin, price: e.price, orders: e.metrics.orders }));
    }, csvWith);
    t('woot·表头认「采购价」列: 3 行都解析出来', p1.length === 3, p1);
    t('woot·A 第 1 行采购价 = 1000', p1[0] && p1[0].price === PRICE_A1, p1[0]);
    t('woot·A 第 2 行采购价 = 1200(同 ASIN 不同价)', p1[1] && p1[1].price === PRICE_A2, p1[1]);
    t('woot·B 空采购价 → 不写 price(留给默认价)', p1[2] && p1[2].price === undefined, p1[2]);

    // 确认导入 → 列表出现可编辑采购价输入框
    const listInfo = await page.evaluate(() => {
      confirmPreview();
      const rows = [...document.querySelectorAll('#listWrap tbody tr')];
      const inputs = [...document.querySelectorAll('#listWrap input[oninput^="onRowPrice"]')];
      const rev = entries.reduce((s, e) => s + rowRev(e), 0);
      const sumCell = document.getElementById('sumRev');
      return {
        nEntries: entries.length, nPriceInput: inputs.length,
        prices: entries.map(e => e.price === undefined ? null : e.price),
        rev, sumText: sumCell ? sumCell.textContent : '',
        defaultUsed: entries.filter(e => !(Number(e.price) > 0)).length,
      };
    });
    t('woot·确认导入后 3 条记录', listInfo.nEntries === 3, listInfo);
    t('woot·列表每行都有采购价输入框(含未填的行)', listInfo.nPriceInput === 3, listInfo);
    t('woot·列表采购价合计 = 1000×1 + 1200×2 + 默认1380×1',
      near(listInfo.rev, A_REV + DEF_PRICE), { got: listInfo.rev, exp: A_REV + DEF_PRICE });

    // (b) 逐行改价 → 只动这一行
    const afterEdit = await page.evaluate(() => {
      const i = entries.findIndex(e => e.asin === 'B0FN3NPF7Y');
      onRowPrice(i, '1500');
      return { price: entries[i].price, rev: entries.reduce((s, e) => s + rowRev(e), 0),
               sumText: (document.getElementById('sumRev') || {}).textContent || '' };
    });
    t('woot·逐行改价生效(B → 1500)', afterEdit.price === 1500, afterEdit);
    t('woot·改价后合计收入同步(A_REV + 1500)', near(afterEdit.rev, A_REV + 1500), afterEdit);
    t('woot·合计格同步刷新', near(Number(String(afterEdit.sumText).replace(/[,\s]/g, '')), A_REV + 1500), afterEdit);

    // (c) 清空某行采购价 → 回到默认价
    const afterClear = await page.evaluate(() => {
      const i = entries.findIndex(e => e.asin === 'B0FN3NPF7Y');
      onRowPrice(i, '');
      return { price: entries[i].price, rev: entries.reduce((s, e) => s + rowRev(e), 0) };
    });
    t('woot·清空该行采购价后回落默认价 1380', afterClear.price === undefined && near(afterClear.rev, A_REV + DEF_PRICE), afterClear);

    // (d) 导出 CSV 带采购价列
    const csv = await page.evaluate(async () => {
      const oc = URL.createObjectURL;
      URL.createObjectURL = (b) => { window.__blob = b; return 'blob:stub'; };
      const ok = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      try { exportCsv(); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ok; }
      return window.__blob ? await window.__blob.text() : '';
    });
    const head = (csv.split('\n')[0] || '').replace(/^\uFEFF/, '');
    const bodyLines = csv.split('\n').slice(1);
    t('woot·导出 CSV 含「采购价」列', head.indexOf('采购价') >= 0, head);
    // 记录按日期倒序 → 精确找「09-10 + ASIN_A」那一行看采购价列(第 6 列, 值 = 1000)
    const rowD1 = bodyLines.find(l => l.indexOf(D1) >= 0 && l.indexOf(ASIN_A) >= 0) || '';
    t('woot·导出 CSV 该行采购价列 = 1000', rowD1.split(',')[5] === '1000', rowD1);
    t('woot·导出 CSV 未填价的行该列留空', (bodyLines.find(l => l.indexOf(ASIN_B) >= 0) || '').split(',')[5] === '',
      bodyLines.find(l => l.indexOf(ASIN_B) >= 0));

    // (e) 重新导入自己导出的 CSV → 采购价不丢(往返一致)
    const roundTrip = await page.evaluate(async (txt) => {
      document.getElementById('wText').value = txt;
      parseInput(txt, false);
      const got = (pendingPreview || []).map(e => e.asin + ':' + (e.price === undefined ? '-' : e.price));
      cancelPreview();
      return got;
    }, csv);
    t('woot·导出→重导 采购价往返不丢', roundTrip.length === 3 && roundTrip.includes('B0H69JJZ1M:1000') && roundTrip.includes('B0H69JJZ1M:1200') && roundTrip.includes('B0FN3NPF7Y:-'),
      roundTrip);

    // (f) 手动添加带采购价
    const manual = await page.evaluate(() => {
      const before = entries.length;
      document.getElementById('mType').value = 'day';
      document.getElementById('mStart').value = '2026-09-12';
      document.getElementById('mAsin').value = 'B0H69JJZ1M';
      document.getElementById('mPrice').value = '1100';
      document.getElementById('mOrders').value = '1';
      document.getElementById('mSales').value = '1899.99';
      addManual();
      const last = entries.find(e => e.start === '2026-09-12');
      return { n: entries.length - before, price: last ? last.price : null,
               cleared: document.getElementById('mPrice').value };
    });
    t('woot·手动添加带采购价 1100', manual.n === 1 && manual.price === 1100, manual);
    t('woot·添加后采购价输入框已清空', manual.cleared === '', manual);

    // (g) 云端保存报文带 wootCfg(成本设置) 且 woot 记录带 price
    const saved = await page.evaluate(async () => {
      let body = null;
      const of = window.fetch;
      window.fetch = async (u, o) => {
        if (String(u).indexOf('/rest/v1/mapping') >= 0 && o && o.method === 'PATCH') body = o.body;
        return { ok: true, status: 200, json: async () => ([{ data: {} }]) };
      };
      try { await cloudSave(false); } finally { window.fetch = of; }
      if (!body) return null;
      const j = JSON.parse(body);
      return { hasCfg: !!(j.data && j.data.wootCfg), nWoot: (j.data.woot || []).length,
               prices: (j.data.woot || []).filter(e => Number(e.price) > 0).length };
    });
    t('woot·云端报文带 wootCfg', !!saved && saved.hasCfg === true, saved);
    t('woot·云端记录保留每行采购价', !!saved && saved.prices >= 2, saved);

    t('woot·无页面错误', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
