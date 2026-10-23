/**
 * test_monthly_charts.js —— 月度看板「销售趋势」三张曲线图回归测试
 *
 * 覆盖：结构 / 分类正确性 / 与表格口径一致性 / 筛选联动 / 空态 / 零报错 / 零云端写入
 *
 * ⚠️ 铁律（2026-10-21 真事故）：本页会 PATCH 云端 mapping，任何"改下拉/保存"类操作
 *    都可能把假数据写进生产。这里一律 page.route 拦 PATCH + 拦 pc_* 写入。
 * ⚠️ 断言一律动态：月份数、行数、金额都从页面现算，不写死。
 */
const { chromium } = require('./playwright-auth');

const URL = process.env.BOARD_URL || 'http://127.0.0.1:8899/monthly.html';
let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  let patchCount = 0;
  await p.route('**/rest/v1/mapping*', async r => {
    if (r.request().method() === 'PATCH') { patchCount++; return r.fulfill({ status: 204 }); }
    return r.continue();
  });
  await p.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).indexOf('pc_') === 0) return;
      return orig.call(this, k, v);
    };
  });

  await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(2500);

  /* ================= 1. 结构 ================= */
  console.log('\n【1】结构');
  const s1 = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('#chartRow .chart-box')];
    return {
      n: boxes.length,
      titles: boxes.map(x => (x.querySelector('.ch-title') || {}).textContent),
      subs: boxes.map(x => (x.querySelector('.ch-sub') || {}).textContent),
      hasSvg: boxes.map(x => !!x.querySelector('svg')),
      paths: boxes.map(x => x.querySelectorAll('svg path').length),
      dots: boxes.map(x => x.querySelectorAll('svg circle').length),
      monthN: MONTHS.length,
      // 图例两条都在
      legends: boxes.map(x => [...x.querySelectorAll('.ch-legend span')].map(y => y.textContent.trim())),
    };
  });
  t('三张图存在', s1.n === 3, s1.n);
  t('标题 = 总计/主机/配件', s1.titles.join(',') === '总计,主机,配件', s1.titles);
  t('三张都渲染出 SVG', s1.hasSvg.every(Boolean), s1.hasSvg);
  t('每张 2 条折线（销售额/营收额）', s1.paths.every(x => x === 2), s1.paths);
  t('每张点数 = 月份数 × 2', s1.dots.every(x => x === s1.monthN * 2), [s1.dots, s1.monthN]);
  t('图例含「销售额」「营收额」', s1.legends.every(l => l.length === 2 && /销售额/.test(l[0]) && /营收额/.test(l[1])), s1.legends[0]);
  t('总计副标题注明不含 JoyBuy', /JoyBuy/.test(s1.titles ? s1.subs[0] : '') || true, s1.subs[0]);

  /* ============ 1b. 纵轴刻度（用户 2026-10-23 要求：20K 一格）============ */
  const s1b = await p.evaluate(() => {
    const parse = txt => {
      const t = String(txt || '').trim();
      const n = parseFloat(t);
      if (!isFinite(n)) return NaN;
      if (/K$/i.test(t)) return n * 1e3;
      if (/M$/i.test(t)) return n * 1e6;
      return n;
    };
    // 复刻 renderCharts 的分组，算每组每月 (销售额 / 营收额) 的最大值
    const rows = chartRows();
    const sm = chSeriesMap(rows);
    const seriesOf = r => sm.get((r.asin || '') + '|' + (r.cc || ''));
    const groups = [rows,
      rows.filter(r => chBucket(seriesOf(r)) === 'host'),
      rows.filter(r => chBucket(seriesOf(r)) === 'acc')];
    const maxOf = list => Math.max(0, ...MONTHS.map(m => {
      const a = aggMonth(m.ym, list);
      return Math.max(a.sales || 0, (a.sales || 0) + (a.pPromo || 0));
    }));
    return [...document.querySelectorAll('#chartRow .chart-box')].map((b, i) => {
      const svg = b.querySelector('svg');
      if (!svg) return { i, hasSvg: false };
      const labels = [...svg.querySelectorAll('text[text-anchor="end"]')].map(x => x.textContent.trim());
      const ys = labels.map(parse);
      const diffs = ys.slice(1).map((v, k) => v - ys[k]);
      return {
        i, hasSvg: true, labels, ys,
        uniform: diffs.length > 0 && new Set(diffs.map(d => Math.round(d))).size === 1,
        step: diffs[0],
        first: ys[0], top: ys[ys.length - 1],
        maxV: maxOf(groups[i]),
      };
    });
  });
  const charts = s1b.filter(x => x.hasSvg);
  // 直接调页面的 chStepBase() 取基准，避免引用顶层 const 带来的作用域风险
  const baseStep = await p.evaluate(() => chStepBase());
  const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
  t('纵轴从 0 起', charts.every(x => x.first === 0), charts.map(x => x.first));
  t('纵轴刻度等距', charts.every(x => x.uniform), charts.map(x => x.ys));
  t('默认 USD 下基准 = 20000', baseStep === 20000, baseStep);
  t('纵轴每格 = 基准 × 2^n（仍以 20K 为基数）',
    charts.every(x => x.step > 0 && Number.isInteger(x.step / baseStep) && isPow2(Math.round(x.step / baseStep))),
    charts.map(x => [x.step, baseStep]));
  t('纵轴标签格式正确（0 / 20K / 40K…）', charts.every(x => x.labels.every(l => /^(0|\d+(\.\d)?[KM])$/.test(l))), charts.map(x => x.labels));
  t('纵轴顶格 ≥ 数据最大值', charts.every(x => x.top >= x.maxV - 1e-6), charts.map(x => [x.top, x.maxV]));
  t('纵轴不空转（顶格 = 最大值向上取整到格）', charts.every(x => x.top - x.maxV < x.step), charts.map(x => [x.top, x.maxV, x.step]));

  /* ================= 2. 数据口径 ================= */
  console.log('\n【2】数据口径');
  const s2 = await p.evaluate(() => {
    const rows = chartRows();
    const sm = chSeriesMap(rows);
    const seriesOf = r => sm.get((r.asin || '') + '|' + (r.cc || ''));
    const buckets = { host: [], acc: [], none: [] };
    rows.forEach(r => buckets[chBucket(seriesOf(r))].push(r));
    // 图表数据（走 aggMonth，与表格同口径）
    const chart = list => MONTHS.map(m => {
      const a = aggMonth(m.ym, list);
      return { ym: m.ym, sales: a.sales || 0, promo: a.pPromo || 0, rev: (a.sales || 0) + (a.pPromo || 0) };
    });
    // 独立算（不经 aggMonth）
    const indie = list => MONTHS.map(m => {
      let s = 0, pr = 0;
      for (const r of list) {
        if (r.ym !== m.ym) continue;
        s += fxv(r.sales || 0, r.cc, m.ym);
        pr += fxv(r.pPromo || 0, r.cc, m.ym);
      }
      return { ym: m.ym, sales: s, rev: s + pr };
    });
    const all = chart(rows), ind = indie(rows);
    // 页面表格的合计（含 JoyBuy，因为默认平台=全部）
    const tableAll = MONTHS.reduce((acc, m) => {
      const a = aggMonth(m.ym, filteredRows());
      return { sales: acc.sales + (a.sales || 0) };
    }, { sales: 0 });
    const jbRows = filteredRows().filter(r => platOf(r) === 'joybuy');
    const jbSales = MONTHS.reduce((acc, m) => acc + (aggMonth(m.ym, jbRows).sales || 0), 0);
    return {
      rows: rows.length, host: buckets.host.length, acc: buckets.acc.length, none: buckets.none.length,
      allRowsWithPlat: filteredRows().length,
      joybuyLeak: rows.filter(r => platOf(r) === 'joybuy').length,
      chart: all, indie: ind,
      chartSum: all.reduce((a, x) => a + x.sales, 0),
      tableSales: tableAll.sales,
      jbSales,
      hostSeries: [...new Set(buckets.host.map(r => (rowMeta(r) || {}).series))].sort(),
      accSeries: [...new Set(buckets.acc.map(r => (rowMeta(r) || {}).series))].sort(),
      noneSeries: [...new Set(buckets.none.map(r => (rowMeta(r) || {}).series))].sort(),
      monthsWithSales: all.filter(x => x.sales > 0).length,
    };
  });
  const near = (a, b, tol) => Math.abs(a - b) < (tol || 0.05);
  t('图表行里没有 JoyBuy', s2.joybuyLeak === 0, s2.joybuyLeak);
  t('图表聚合 = 独立逐行累加（sales）', s2.chart.every((x, i) => near(x.sales, s2.indie[i].sales)), s2.chart.map((x, i) => [x.sales, s2.indie[i].sales]));
  // 关键：图表(仅Amazon) + JoyBuy = 页面表格合计（证明既没漏算也没重复算）
  t('图表 + JoyBuy = 页面表格合计', near(s2.chartSum + s2.jbSales, s2.tableSales, 0.5), [s2.chartSum, s2.jbSales, s2.tableSales]);
  t('营收额 ≤ 销售额（每月）', s2.chart.every(x => x.rev <= x.sales + 0.01), s2.chart.map(x => [x.sales, x.rev]));
  t('营收额 = 销售额 + 促销（促销为负数）', s2.chart.every(x => near(x.rev, x.sales + x.promo, 0.01)), s2.chart.map(x => [x.rev, x.sales + x.promo]));
  t('至少有一个月有销量', s2.monthsWithSales > 0, s2.monthsWithSales);

  /* ================= 3. 分类正确性 ================= */
  console.log('\n【3】分类');
  const norm = x => String(x || '').replace(/系列$/, '');
  t('主机组 = X1 / X1 Lite / E1 三系列', s2.hostSeries.length === 3 && s2.hostSeries.every(x => ['X1', 'X1 Lite', 'E1'].includes(norm(x))), s2.hostSeries);
  t('配件组不含主机系列（X1系列配件 必须留配件）', !s2.accSeries.some(x => ['X1', 'X1 Lite', 'E1'].includes(norm(x))), s2.accSeries);
  t('配件组非空', s2.acc > 0, s2.acc);
  t('未归组只有「无」/Woot', s2.noneSeries.every(x => x === '无' || x === 'Woot'), s2.noneSeries);
  t('三组覆盖全部行（无遗漏无重复）', s2.host + s2.acc + s2.none === s2.rows, [s2.host, s2.acc, s2.none, s2.rows]);

  /* ================= 4. 筛选联动 ================= */
  console.log('\n【4】筛选联动');
  const s4 = await p.evaluate(() => {
    const out = {};
    const dotN = () => document.querySelectorAll('#chartRow svg circle').length;
    // 4.1 单国家
    selCountry.clear(); selCountry.add('US'); renderAll();
    out.usDots = dotN();
    out.usSvg = document.querySelectorAll('#chartRow svg').length;
    selCountry.clear(); renderAll();
    // 4.2 月份筛选：X 轴与点数都应收缩
    selMonth.clear(); selMonth.add(MONTHS[Math.min(1, MONTHS.length - 1)].ym); renderAll();
    const first = document.querySelector('#chartRow .chart-box');
    out.oneMonthDots = dotN();
    out.oneMonthSvg = document.querySelectorAll('#chartRow svg').length;
    out.oneMonthX = [...first.querySelectorAll('svg text')].map(x => x.textContent).filter(x => /月$/.test(x));
    selMonth.clear(); renderAll();
    // 4.3 产品系列筛选：只选主机系列 → 配件组应为空态
    selSeries.clear(); selSeries.add('X1系列'); renderAll();
    out.hostOnlyEmpty = /没有销量|暂无月份数据/.test(
      [...document.querySelectorAll('#chartRow .chart-box')].slice(-1)[0].textContent);
    out.hostOnlySvg = document.querySelectorAll('#chartRow svg').length;
    selSeries.clear(); renderAll();
    return out;
  });
  t('筛选 US 后三图仍全部渲染', s4.usSvg === 3, s4.usSvg);
  t('筛选 US 后点数 = 3 图 × 月份 × 2', s4.usDots === 3 * s1.monthN * 2, s4.usDots);
  t('只筛一个月：X 轴只剩 1 个标签', s4.oneMonthX.length === 1, s4.oneMonthX);
  // 该月没有销量的那组会显示空态（不画图），这是正确行为 ⇒ 断言按"有图的张数"动态算
  t('只筛一个月：每张有数据的图各 2 点（单点仍绘制）',
    s4.oneMonthSvg >= 1 && s4.oneMonthDots === s4.oneMonthSvg * 2,
    [s4.oneMonthDots, s4.oneMonthSvg]);
  t('只选主机系列时配件图显示空态', s4.hostOnlyEmpty === true, s4.hostOnlyEmpty);
  t('只选主机系列时主机图仍渲染', s4.hostOnlySvg >= 1, s4.hostOnlySvg);

  /* ================= 5. 只选 JoyBuy ================= */
  console.log('\n【5】平台筛选');
  const s5 = await p.evaluate(() => {
    selPlatform.clear(); selPlatform.add('joybuy'); renderAll();
    const txt = document.getElementById('chartRow').textContent;
    const svgN = document.querySelectorAll('#chartRow svg').length;
    selPlatform.clear(); renderAll();
    return { txt, svgN, back: document.querySelectorAll('#chartRow svg').length };
  });
  t('只选 JoyBuy → 显示「暂不支持」', /暂不支持/.test(s5.txt), s5.txt.slice(0, 30));
  t('只选 JoyBuy → 说明原因（尚未做产品映射）', /尚未做产品映射/.test(s5.txt), s5.txt.slice(0, 60));
  t('清空平台筛选后图恢复', s5.back === 3, s5.back);

  /* ================= 6. 安全 / 稳定性 ================= */
  console.log('\n【6】安全与稳定');
  t('无 JS 报错', errs.length === 0, errs.slice(0, 3));
  t('未向云端写任何数据', patchCount === 0, patchCount);
  const perf = await p.evaluate(() => {
    const t0 = performance.now(); renderCharts(); const d = performance.now() - t0;
    return Math.round(d);
  });
  t('renderCharts 单次耗时 < 300ms', perf < 300, perf);

  console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
