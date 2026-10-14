// test_orphan_totals.js — 周看板「孤儿单元补进合计」回归（2026-10-12 用户决策「补进合计，不改行数」）
//
// 背景：周看板骨架 = 广告周报表 DATA.asin_list；利润报表里另有 ASIN 不在骨架中，
//   它们在「合计层」（KPI 卡 + 表格合计行）必须被计入，但**不许产生表格行**、**不许越过任何筛选维度**。
//   该逻辑在 integrate_profit.py 的注入点「calc: 孤儿单元补进合计」里（一段 IIFE，直接读 PROFIT）。
//
// ⚠️ 为什么必须用「合成假孤儿」而不是拿线上真数据断言：
//   当期实际的 8 个孤儿 ASIN 全是 0 值 ⇒ 真数据下这块代码**无论对错数值都不变**，
//   只有造出非 0 的孤儿才能让它红。所以本测试自己往 PROFIT 里插两个假孤儿。
//
// 断言（7 项）：
//   ① 合计层精确 +(−150)：两个假孤儿（−100 / −50）必须**恰好**影响 −150
//      —— 若实现里对共享的 perWeek 累加器二次累加，会变成 −200/−250，本项即红
//   ② 无关列不受影响（报表销售额 pSales 不变）
//   ③ 表格行数不变（行数只由周维度决定）
//   ④ 合并看（全部）含孤儿
//   ⑤ 单看官方店铺含孤儿 ⑥ 单看 Woot **不含**孤儿
//   ⑦ 周 / 国家 维度对齐（W40 含、W39 不含；US 含、DE 不含）
// 反向对照（必须做，否则无法排除"恰好该视图为空"的假通过）：
//   ⑧ 把渠道护栏那一行删掉后，单看 Woot 必须**出现**孤儿污染值（证明护栏承重）
//
// 用法: node test_orphan_totals.js [product.html 路径，默认 _deploy/product.html]

const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SRC = process.argv[2] || path.join(BASE, '_deploy', 'product.html');
const TMP_BASE = path.join(BASE, '_tmp_orph_base.html');   // 原样 + 两个假孤儿
const TMP_NOGUARD = path.join(BASE, '_tmp_orph_noguard.html'); // 同上 + 删掉渠道护栏（反向对照）

// 两个假孤儿：同一个周(W40)同一个站点(US)，金额 −100 / −50
const FAKE_ORPHANS =
  '"B0ZZORPH1":{"weeks":{"W40":{"US":{"sales":0,"promo":0,"comm":0,"fba":0,"cost":0,"storage":-100,"other":0,"n":3,"qty":0}}}},' +
  '"B0ZZORPH2":{"weeks":{"W40":{"US":{"sales":0,"promo":0,"comm":0,"fba":0,"cost":0,"storage":-50,"other":0,"n":2,"qty":0}}}},';
const DELTA = 150;                                   // 期望影响绝对值
const GUARD = "    if (typeof selChannel !== 'undefined' && selChannel.size && !selChannel.has('amazon')) return;";

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b) => Math.abs(a - b) < 0.01;

// 页面内：按维度探测合计层
const PROBE = () => {
  const out = {};
  const reset = () => { selChannel.clear(); selAsin.clear(); selWeek.clear(); selCountry.clear(); selRegion.clear(); };
  const snap = (tag, fn) => { reset(); if (fn) fn(); const c = calc(); const tt = c.totals;
    out[tag] = { profit: profitOf(tt), sales: tt.pSales }; };
  snap('merged', null);
  snap('amazonOnly', () => selChannel.add('amazon'));
  snap('wootOnly', () => selChannel.add('woot'));
  snap('weekW40', () => selWeek.add('W40'));
  snap('weekW39', () => selWeek.add('W39'));
  snap('ctryUS', () => selCountry.add('US'));
  snap('ctryDE', () => selCountry.add('DE'));
  snap('oneAsin', () => { if (DATA.asin_list.length) selAsin.add(DATA.asin_list[0]); });
  reset();
  out.rows = document.querySelectorAll('#sumBody tr').length;   // 15 周 + 合计行
  out.weeks = DATA.weeks.length;
  return out;
};

(async () => {
  // ---------- 造两个临时副本 ----------
  const html = fs.readFileSync(SRC, 'utf-8');
  if (html.indexOf('orphanProfit') < 0) { console.log('  FAIL 源文件不含 orphanProfit（未注入孤儿块？）'); process.exit(1); }
  const MARK = 'const PROFIT = {';
  if (html.indexOf(MARK) < 0) { console.log('  FAIL 找不到 const PROFIT 锚点'); process.exit(1); }
  const withOrphans = html.replace(MARK, MARK + FAKE_ORPHANS, 1);
  if (html.indexOf(GUARD) < 0) { console.log('  FAIL 找不到渠道护栏行（实现变了？）'); process.exit(1); }
  fs.writeFileSync(TMP_BASE, withOrphans);
  fs.writeFileSync(TMP_NOGUARD, withOrphans.replace(GUARD,
    "    // [反向对照] 故意移除渠道护栏 —— 单看 Woot 必须因此出现孤儿污染", 1));

  const fileUrl = p => 'file:///' + p.split('\\').join('/');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2200, height: 1100 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  });
  await ctx.route('**/rest/v1/mapping*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { catalog: [], asinMap: [], woot: [], wootCfg: null } }])
  }));

  async function load(file) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await page.goto(fileUrl(file), { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForTimeout(9000);
    return { page, errs };
  }

  const a = await load(SRC);          // 基准（无假孤儿）
  const base = await a.page.evaluate(PROBE);
  const b = await load(TMP_BASE);     // 有假孤儿 + 有护栏
  const withOr = await b.page.evaluate(PROBE);
  const c = await load(TMP_NOGUARD);  // 反向对照：无护栏
  const noGuard = await c.page.evaluate(PROBE);

  console.log('  基准合计毛利 %s · 报表销售额 %s · 行数 %d',
    base.merged.profit === null ? 'null' : base.merged.profit.toFixed(2),
    base.merged.sales.toFixed(2), base.rows);
  console.log('  含假孤儿   %s · 报表销售额 %s · 行数 %d',
    withOr.merged.profit === null ? 'null' : withOr.merged.profit.toFixed(2),
    withOr.merged.sales.toFixed(2), withOr.rows);

  // ① 合计层精确 +(−150)：两个孤儿必须恰好影响 −150（二次累加会变成 −200/−250）
  t('① 合计层精确受 −150 影响（两个孤儿不得被重复累加）',
    base.merged.profit !== null && withOr.merged.profit !== null &&
    near(base.merged.profit - withOr.merged.profit, DELTA),
    { base: base.merged.profit, withOr: withOr.merged.profit, delta: base.merged.profit - withOr.merged.profit });
  // ② 无关列不受影响
  t('② 报表销售额不受孤儿影响',
    near(base.merged.sales, withOr.merged.sales),
    { base: base.merged.sales, withOr: withOr.merged.sales });
  // ③ 行数不变（表格行数 = 周数 + 1 合计行，与 ASIN 无关）
  t('③ 表格行数不变（不改行数）',
    base.rows === withOr.rows && base.rows === base.weeks + 1,
    { base: base.rows, withOr: withOr.rows, weeks: base.weeks });
  // ④ 合并看含孤儿
  t('④ 合并看（全部）含孤儿', near(base.merged.profit - withOr.merged.profit, DELTA),
    { base: base.merged.profit, withOr: withOr.merged.profit });
  // ⑤ 单看官方店铺含孤儿
  t('⑤ 单看官方店铺含孤儿', near(base.amazonOnly.profit - withOr.amazonOnly.profit, DELTA),
    { base: base.amazonOnly.profit, withOr: withOr.amazonOnly.profit });
  // ⑥ 单看 Woot 不含孤儿
  t('⑥ 单看 Woot 不含孤儿（不得凭空多出亚马逊侧费用）',
    withOr.wootOnly.profit === base.wootOnly.profit,
    { base: base.wootOnly.profit, withOr: withOr.wootOnly.profit });
  // ⑦ 周 / 国家 维度对齐
  const w40 = near(base.weekW40.profit - withOr.weekW40.profit, DELTA);
  const w39 = withOr.weekW39.profit === base.weekW39.profit;
  const us = near(base.ctryUS.profit - withOr.ctryUS.profit, DELTA);
  const de = withOr.ctryDE.profit === base.ctryDE.profit;
  const one = withOr.oneAsin.profit === base.oneAsin.profit;
  t('⑦a 周维度对齐：W40 含孤儿 / W39 不含', w40 && w39,
    { w40: [base.weekW40.profit, withOr.weekW40.profit], w39: [base.weekW39.profit, withOr.weekW39.profit] });
  t('⑦b 国家维度对齐：US 含孤儿 / DE 不含', us && de,
    { us: [base.ctryUS.profit, withOr.ctryUS.profit], de: [base.ctryDE.profit, withOr.ctryDE.profit] });
  t('⑦c 筛选单个 ASIN 时孤儿被排除', one,
    { base: base.oneAsin.profit, withOr: withOr.oneAsin.profit });

  // ⑧ 反向对照：删掉护栏后，单看 Woot 必须出现孤儿污染（证明护栏承重，而不是"恰好视图为空"）
  const polluted = noGuard.wootOnly.profit !== null &&
    Math.abs(noGuard.wootOnly.profit - (base.wootOnly.profit === null ? 0 : base.wootOnly.profit)) > 1;
  t('⑧ 反向对照：删掉渠道护栏后 单看 Woot 被污染（证明护栏承重）', polluted,
    { guarded: withOr.wootOnly.profit, noGuard: noGuard.wootOnly.profit });

  const allErrs = [...a.errs, ...b.errs, ...c.errs];
  t('⑨ 三个副本均无 JS 错误', allErrs.length === 0, allErrs.slice(0, 2));

  await browser.close();
  try { fs.unlinkSync(TMP_BASE); fs.unlinkSync(TMP_NOGUARD); } catch (e) {}

  console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FATAL', e);
  try { fs.unlinkSync(TMP_BASE); fs.unlinkSync(TMP_NOGUARD); } catch (x) {}
  process.exit(1);
});
