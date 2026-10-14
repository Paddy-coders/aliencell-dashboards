// test_week_fx.js — 周看板「逐月汇率」回归（2026-10-12 用户决策「改逐月吧，数据要统一」）
//
// 背景：周看板原先**全表统一用最新月份**那一张汇率表（FX），而日/月看板是「按发生月份折算」。
//   于是 6 月的周也套 10 月汇率 ⇒ 与日/月看板差 196.51 元。本轮改成：
//     FX_WK[周] = 该周 7 天**逐日所属月份汇率**的等权平均（周内金额均匀分布假设 ⇒ 与逐日折算等价）
//   折算层 fxv() / fxHeadCny() / rmbRateOf() 一律走 fxTbl()（该周逐月表 > 最新月份表兜底）。
//
// ⚠️ 为什么必须有这个测试：逐月改了以后，**单表的月份恰好覆盖全窗口时数值不变**（静默），
//   而且改错的话只会表现为「毛利(RMB) 差几十块」—— 极难被人眼发现。所以这里：
//   · 期望值**从 fx_rates.json 自算**（不写死任何汇率数字，数据每月更新也不会假红）
//   · 加一条**反向对照**：把某一周的汇率整体 ×1.1，该周 RMB 必须精确 ×1.1（证明真的在读 FX_WK）
//
// 用法: node test_week_fx.js [product.html 路径，默认 _deploy/product.html]

const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SRC = process.argv[2] || path.join(BASE, '_deploy', 'product.html');
const FX_FILE = path.join(BASE, 'fx_rates.json');
const TMP_SCALED = path.join(BASE, '_tmp_fxwk_scaled.html');
const SCALE_WK = 'W40';
const SCALE = 1.1;

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}

// ---------- 测试侧复刻「逐周汇率」口径（期望值从 fx_rates.json 自算） ----------
const fxCache = JSON.parse(fs.readFileSync(FX_FILE, 'utf-8'));
const RATES = fxCache.rates || {};
function tblFor(ym) {
  if (RATES[ym]) return RATES[ym];
  const older = Object.keys(RATES).filter(k => k <= ym).sort();
  if (older.length) return RATES[older[older.length - 1]];
  const all = Object.keys(RATES).sort();
  return all.length ? RATES[all[0]] : {};
}
function daysBetween(s, e) {
  const out = [];
  let d = new Date(s + 'T00:00:00Z');
  const end = new Date(e + 'T00:00:00Z');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function expectedWeekTbl(w) {
  const tbls = daysBetween(w.start, w.end).map(x => tblFor(x.slice(0, 7)));
  const curs = new Set();
  tbls.forEach(b => Object.keys(b).forEach(k => curs.add(k)));
  const out = {};
  curs.forEach(c => {
    const v = tbls.map(b => b[c]).filter(x => x);
    if (v.length) out[c] = Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(6));
  });
  return out;
}

// 页面内探针（返回逐周 / 合计 / KPI 三方数值，供交叉校验）
const PROBE = (scaleWk, scale) => {
  if (scaleWk && FX_WK[scaleWk]) {
    Object.keys(FX_WK[scaleWk]).forEach(c => { FX_WK[scaleWk][c] = FX_WK[scaleWk][c] * scale; });
  }
  const c = calc();
  const per = {};
  Object.keys(c.perWeek).forEach(k => {
    const p = c.perWeek[k];
    per[k] = { profit: p.pN > 0 ? profitOf(p) : null, rmb: p.pN > 0 ? profitRmbOf(p) : null,
               head: p.pN > 0 ? (p.pHead || 0) : 0, pN: p.pN, rate: rmbRateOf(p) };
  });
  return {
    weeks: DATA.weeks.map(w => ({ label: w.label, start: w.start, end: w.end })),
    fxwk: FX_WK,
    fxLatestRates: FX,
    targetCur: targetCur(),
    perWeek: per,
    totalProfit: profitOf(c.totals),
    totalRmb: c.totals.pRmb,
    kpiRmb: kpiValue(c.totals, 'profitRmb'),
    tblWhenNoWeek: (function () { const keep = FX_CUR_WK; FX_CUR_WK = null; const r = fxTbl(); FX_CUR_WK = keep; return r[targetCur()]; })(),
    rows: document.querySelectorAll('#sumBody tr').length,
  };
};

(async () => {
  const html = fs.readFileSync(SRC, 'utf-8');
  for (const mark of ['const FX_WK = ', 'let FX_CUR_WK = null;', 'function fxTbl()', 'function rmbRateOf(o)']) {
    if (html.indexOf(mark) < 0) { console.log('  FAIL 源文件缺少 `' + mark + '`（逐月汇率未注入？）'); process.exit(1); }
  }
  // 反向对照副本：把 SCALE_WK 的汇率整体 ×SCALE（插在 FX_CUR_WK 声明前，确保在 calc 之前生效）
  const anchor = 'let FX_CUR_WK = null;';
  const patch = "Object.keys(FX_WK['" + SCALE_WK + "']).forEach(function(c){ FX_WK['" + SCALE_WK + "'][c] *= " + SCALE + "; });\n" + anchor;
  fs.writeFileSync(TMP_SCALED, html.replace(anchor, patch, 1));

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

  const errsAll = [];
  async function run(file, arg) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errsAll.push(String(e).slice(0, 160)));
    await page.goto(fileUrl(file), { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForTimeout(9000);
    const o = await page.evaluate(PROBE, [arg && arg.wk, arg && arg.scale]);
    await page.close();
    return o;
  }

  const base = await run(SRC, null);
  const scaled = await run(TMP_SCALED, { wk: SCALE_WK, scale: SCALE });

  // 去重后的周（label → {start,end}）
  const wkMap = {};
  base.weeks.forEach(w => { if (!wkMap[w.label]) wkMap[w.label] = w; });
  const labels = Object.keys(base.fxwk);

  console.log('  周数 %d · FX_WK 周数 %d · 目标币种 %s · 合计毛利 %s · 合计毛利RMB %s',
    Object.keys(wkMap).length, labels.length, base.targetCur,
    base.totalProfit === null ? 'null' : base.totalProfit.toFixed(2),
    base.totalRmb === null ? 'null' : base.totalRmb.toFixed(2));

  // ① FX_WK 覆盖全部周
  const missing = Object.keys(wkMap).filter(k => labels.indexOf(k) < 0);
  t('① FX_WK 覆盖 DATA.weeks 的每一周', missing.length === 0, { missing });

  // ② 每周汇率 = 该周 7 天逐日所属月份汇率的等权平均（从 fx_rates.json 自算）
  const badTbl = [];
  Object.keys(wkMap).forEach(k => {
    const exp = expectedWeekTbl(wkMap[k]);
    const got = base.fxwk[k] || {};
    Object.keys(exp).forEach(cur => {
      if (got[cur] === undefined || Math.abs(got[cur] - exp[cur]) > 1e-5) badTbl.push(k + '/' + cur + ' got=' + got[cur] + ' exp=' + exp[cur]);
    });
  });
  t('② 每周汇率 == 该周逐日所属月份汇率的等权平均', badTbl.length === 0, badTbl.slice(0, 4));

  // ③ 确实存在「跨月周」：至少一周的汇率既不等于其起始月、也不等于其结束月（证明混合真的发生）
  const crossWeeks = Object.keys(wkMap).filter(k => {
    const w = wkMap[k], got = base.fxwk[k], a = tblFor(w.start.slice(0, 7)), b = tblFor(w.end.slice(0, 7));
    const same = (x, y) => Object.keys(y).every(c => Math.abs((x[c] || 0) - y[c]) < 1e-9);
    return !same(got, a) && !same(got, b);
  });
  t('③ 存在跨月周（其汇率是两个月汇率的混合，而非单取某月）', crossWeeks.length > 0,
    { crossWeeks: crossWeeks.slice(0, 5), weeks: Object.keys(wkMap) });

  // ④ 逐周 RMB = 该周毛利 × 该周汇率
  const badPer = [];
  Object.keys(base.perWeek).forEach(k => {
    const p = base.perWeek[k];
    if (p.profit === null || p.rate === null) return;
    if (Math.abs(p.rmb - p.profit * p.rate) > 0.02) badPer.push({ w: k, rmb: p.rmb, exp: p.profit * p.rate });
  });
  t('④ 逐周 毛利(RMB) == 该周毛利 × 该周月份汇率', badPer.length === 0, badPer.slice(0, 3));

  // ⑤ 合计毛利RMB == Σ 逐周毛利RMB（不能拿合计毛利 × 单一汇率）
  const sumRmb = Object.keys(base.perWeek).reduce((s, k) => s + (base.perWeek[k].rmb || 0), 0);
  t('⑤ 合计毛利(RMB) == Σ 逐周毛利(RMB)', Math.abs(sumRmb - base.totalRmb) < 0.05,
    { sumRmb, totalRmb: base.totalRmb });
  const single = base.totalProfit === null ? null : base.totalProfit * base.fxLatestRates[base.targetCur];
  t('⑤b 合计毛利(RMB) 不等于「合计毛利 × 最新月份单张汇率」（否则等于没改）',
    single === null || Math.abs(single - base.totalRmb) > 1,
    { singleRate: single, perMonth: base.totalRmb, diff: single === null ? null : single - base.totalRmb });

  // ⑥ KPI 卡与合计行同源（都走逐周累加）
  t('⑥ KPI 毛利(RMB) == 合计层逐周累加值', Math.abs((base.kpiRmb || 0) - (base.totalRmb || 0)) < 0.05,
    { kpiRmb: base.kpiRmb, totalRmb: base.totalRmb });

  // ⑦ 兜底：无周上下文时 fxTbl() 回退到最新月份表
  t('⑦ 无周上下文时回退到最新月份表（不会取到 undefined）',
    base.tblWhenNoWeek !== undefined && base.tblWhenNoWeek !== null &&
    Math.abs(base.tblWhenNoWeek - base.fxLatestRates[base.targetCur]) < 1e-9,
    { fallback: base.tblWhenNoWeek, latest: base.fxLatestRates[base.targetCur] });

  // ⑧ 反向对照：把 SCALE_WK 整周汇率 ×1.1 后，该周「外币部分」的 RMB 必须精确 ×1.1
  //    ⚠️ 2026-10-13 起周看板的毛利里含**头程**(成本表 headRMB, 是**人民币固定额**):
  //       profitOf = A(外币部分, 随汇率交叉折算) − pHead(目标币种, = headCny/rate)
  //       ⇒ 毛利(RMB) = rate×(A − headCny/rate) = rate×A − headCny
  //       所以「RMB 精确 ×1.1」只对**外币部分**成立 —— 必须把头程(headCny)加回去再比,
  //       否则会像 2026-10-13 一样得到 1.0959 的假失败。头程的 CNY 恒定性由 ⑧d 单独守住。
  const b = base.perWeek[SCALE_WK], s = scaled.perWeek[SCALE_WK];
  const headCny = x => (x && x.head ? x.head * x.rate : 0);      // 目标币种头程 → 人民币(与周无关的常数)
  t('⑧ 反向对照：缩放该周汇率 ⇒ 该周「外币部分」RMB 精确 ×' + SCALE + '（证明真的读 FX_WK）',
    b && s && b.rmb !== null && Math.abs((s.rmb + headCny(s)) / (b.rmb + headCny(b)) - SCALE) < 1e-6,
    { base: b && b.rmb, scaled: s && s.rmb, headCny: b && +headCny(b).toFixed(2),
      ratio: (b && s && b.rmb !== null) ? (s.rmb + headCny(s)) / (b.rmb + headCny(b)) : null });
  t('⑧b 反向对照：该周「外币部分」毛利(目标币种) 不受汇率缩放影响（整周同倍缩放 ⇒ 交叉汇率不变）',
    b && s && b.profit !== null && Math.abs((s.profit + (s.head || 0)) - (b.profit + (b.head || 0))) < 0.05,
    { base: b && b.profit, scaled: s && s.profit, head: b && b.head });
  t('⑧d 头程是人民币固定额 ⇒ 缩放汇率时「目标币种头程」反比缩小、其 RMB 值恒定',
    b && s && b.head > 0 && Math.abs(s.head * s.rate - b.head * b.rate) < 0.05 &&
    Math.abs(s.head / b.head - 1 / SCALE) < 1e-6,
    { headBase: b && b.head, headScaled: s && s.head, cnyBase: b && +(b.head * b.rate).toFixed(2),
      cnyScaled: s && +(s.head * s.rate).toFixed(2) });
  t('⑧c 反向对照：其他周的 RMB 不受影响',
    Object.keys(base.perWeek).filter(k => k !== SCALE_WK).every(k => {
      const x = base.perWeek[k], y = scaled.perWeek[k];
      if (!x || !y) return true;
      return x.rmb === null ? y.rmb === null : Math.abs(x.rmb - y.rmb) < 1e-6;
    }), { scaledWeek: SCALE_WK });

  // ⑨ 行数不变（周数 + 合计行）
  t('⑨ 表格行数 = 周数 + 1（合计行）', base.rows === base.weeks.length + 1,
    { rows: base.rows, weeks: base.weeks.length });

  // ⑩ 无 JS 错误
  t('⑩ 三份副本均无 JS 报错', errsAll.length === 0, errsAll.slice(0, 2));

  try { fs.unlinkSync(TMP_SCALED); } catch (e) { /* ignore */ }

  console.log('\n结果: %d pass, %d fail', pass, fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
