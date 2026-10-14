// test_woot_channel.js — 周度产品报表(product.html)「销售店铺」渠道筛选回归
// 校验: ①控件存在且在筛选栏首位、选项=Aliencell官方店铺/Woot店铺 ②Woot 数据并入 US 后
//      合并 = 官方店铺 + Woot(逐指标对账) ③单看 Woot 的流量为 0(Woot 无流量数据)
//      ④毛利归属(2026-10-13 起: Woot 成本可由映射解析 ⇒ 单看 Woot 也有毛利; 官方店铺 = 合并) ⑤切渠道后 KPI/合计不出现 NaN
//      ⑥UI 单击=单选 / 「合并看（全部）」恢复
// 用法: node test_woot_channel.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896, 可用环境变量覆盖)
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// 逐日记录(带子 ASIN) —— 2026-09-10 属 W37(周六 09-05 ~ 周五 09-11)
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((w) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
  }, [WOOT_DAY]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.goto(BASE + '/product.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log(`== 测试目标: ${BASE}/product.html ==`);

  // ---------- ① 结构 ----------
  {
    console.log('-- ① 控件结构 --');
    const s = await page.evaluate(() => {
      const bar = document.querySelector('.filter-bar');
      return {
        ddExists: !!document.getElementById('ddChannel'),
        firstChildId: bar && bar.firstChild ? (bar.firstChild.id || '') : '',
        opts: [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => ({
          name: o.querySelector('.opt-name').textContent.trim(),
          dim: o.classList.contains('dim')
        })),
        summary: document.getElementById('ddChannelSummary') ? document.getElementById('ddChannelSummary').textContent : '',
        hasWootParts: Object.keys(DATA.wootParts || {}).length,
        hasWootAdParts: Object.keys(DATA.wootAdParts || {}).length,
      };
    });
    t('「销售店铺」下拉存在', s.ddExists, s);
    t('「销售店铺」位于筛选栏首位(地区之前)', s.firstChildId === 'ddChannel', s.firstChildId);
    t('选项 = Aliencell官方店铺 + Woot店铺', s.opts.map(o => o.name).join('|') === 'Aliencell官方店铺|Woot店铺', s.opts);
    t('两个渠道均有数据(不置灰)', s.opts.every(o => !o.dim), s.opts);
    t('默认汇总显示「全部（合并）」', s.summary === '全部（合并）', s.summary);
    t('Woot 已记录单独一份(wootParts + wootAdParts)', s.hasWootParts > 0 && s.hasWootAdParts > 0, s);
  }

  // ---------- ②③④ 数据口径 ----------
  {
    console.log('-- ② Woot 并入 / 逐指标对账 --');
    const r = await page.evaluate(() => {
      const out = {};
      // 动态发现候选(不写死 ASIN/周): 任意有 US 数据的 (asin, week)
      let cand = null;
      const wp = DATA.wootParts || {};
      for (const asin in wp) {
        for (const wk in (wp[asin].weeks || {})) {
          const c = wp[asin].weeks[wk].US;
          if (c && (Number(c.sales) > 0 || Number(c.orders) > 0)) { cand = { asin, wk }; break; }
        }
        if (cand) break;
      }
      out.cand = cand;
      if (!cand) return out;
      const setCh = arr => { window.selChannel.clear(); arr.forEach(x => window.selChannel.add(x)); };
      const snapWeek = (asin, wk) => {
        const v = window.asinWeekData(asin, wk);
        if (!v) return null;
        const g = k => Number(v[k]) || 0;
        return { sessions: g('sessions'), pv: g('pv'), units: g('units'), orders: g('orders'), sales: g('sales'),
                 adSpend: g('adSpend'), adClicks: g('adClicks'), adOrders: g('adOrders'),
                 adImpressions: g('adImpressions'), adSales: g('adSales'), pN: g('pN') };
      };
      setCh([]);          out.merged = snapWeek(cand.asin, cand.wk);
      setCh(['woot']);    out.woot = snapWeek(cand.asin, cand.wk);
      setCh(['amazon']);  out.amz = snapWeek(cand.asin, cand.wk);
      // 毛利(经 profitOf, 与页面显示同源)
      const c0 = window.calc();
      setCh(['woot']);    const cw = window.calc();
      setCh(['amazon']);  const ca = window.calc();
      setCh([]);
      const P = lb => (c0.perWeek[lb] ? window.profitOf(c0.perWeek[lb]) : 'no-week');
      const Pw = lb => (cw.perWeek[lb] ? window.profitOf(cw.perWeek[lb]) : 'no-week-woot');
      const Pa = lb => (ca.perWeek[lb] ? window.profitOf(ca.perWeek[lb]) : 'no-week-amz');
      out.profit = { merged: P(cand.wk), woot: Pw(cand.wk), amz: Pa(cand.wk) };
      // Woot 原始输入(对账基准)
      out.rawPart = JSON.parse(JSON.stringify(((DATA.wootParts[cand.asin] || {}).weeks[cand.wk] || {}).US || null));
      out.rawAd = JSON.parse(JSON.stringify((((DATA.wootAdParts[cand.asin] || {}).weeks[cand.wk] || {}).US) || null));
      // NaN 体检: 三种模式下 totals/perWeek 全字段
      const numBad = (obj) => Object.keys(obj || {}).filter(k => typeof obj[k] === 'number' && !isFinite(obj[k]));
      setCh([]);          const cm = window.calc();
      setCh(['woot']);    const cw2 = window.calc();
      setCh(['amazon']);  const ca2 = window.calc();
      setCh([]);
      const bad = {};
      bad.mergedTotals = numBad(cm.totals);
      bad.wootTotals = numBad(cw2.totals);
      bad.amzTotals = numBad(ca2.totals);
      bad.wootWeeks = Object.keys(cw2.perWeek).filter(lb => numBad(cw2.perWeek[lb]).length);
      bad.amzWeeks = Object.keys(ca2.perWeek).filter(lb => numBad(ca2.perWeek[lb]).length);
      out.nan = bad;
      return out;
    });
    if (!r.cand) { t('找到 Woot 候选(asin×周)', false, r); }
    else {
      const { merged, woot, amz, rawPart, rawAd, cand } = r;
      console.log(`  候选: ${cand.asin} × ${cand.wk}`);
      // 单看 Woot = 注入的 Woot 原始值
      t('单看 Woot: 销售额 = Woot 原始记录', near(woot.sales, rawPart.sales), { got: woot.sales, exp: rawPart.sales });
      t('单看 Woot: 订单/件数 = Woot 原始记录', near(woot.orders, rawPart.orders) && near(woot.units, rawPart.orders),
        { got: [woot.orders, woot.units], exp: rawPart.orders });
      t('单看 Woot: 广告花费/点击 = Woot 原始记录', near(woot.adSpend, rawAd.spend) && near(woot.adClicks, rawAd.clicks),
        { got: [woot.adSpend, woot.adClicks], exp: [rawAd.spend, rawAd.clicks] });
      // 合并 = 官方店铺 + Woot (逐指标)
      const keys = ['sessions', 'pv', 'units', 'orders', 'sales', 'adSpend', 'adClicks', 'adOrders', 'adImpressions', 'adSales'];
      const diffs = keys.filter(k => !near(amz[k] + woot[k], merged[k], 0.02));
      t('合并 = 官方店铺 + Woot(全部 10 项指标)', diffs.length === 0,
        diffs.map(k => k + ':' + (amz[k] + woot[k]) + '≠' + merged[k]));
      // Woot 无流量数据
      t('单看 Woot: 流量指标为 0(Woot 无 traffic 数据)', woot.sessions === 0 && woot.pv === 0, { sessions: woot.sessions, pv: woot.pv });
      t('单看官方店铺: 流量指标 = 合并(Woot 不影响流量)',
        near(amz.sessions, merged.sessions) && near(amz.pv, merged.pv), { amz: [amz.sessions, amz.pv], merged: [merged.sessions, merged.pv] });

      console.log('-- ④ 毛利归属 --');
      // ⚠️ 2026-10-13 起: Woot 成本经「产品关系管理」映射 → 成本表 costRMB 解析 ⇒ 单看 Woot **有**毛利,
      //    不再是 —(null)。(「两处都没配 ⇒ —」由 test_woot_margin.js 场景 A 守住)
      t('毛利归属: 单看 Woot 有毛利(成本经映射/成本表可解析)',
        r.profit.woot !== null && r.profit.woot !== 'no-week-woot', r.profit);
      t('毛利归属: 官方店铺 = 合并(本看板口径: 毛利键不参与渠道相减)',
        near(r.profit.amz, r.profit.merged), r.profit);
      t('利润行数 pN: 合并 = 官方 + Woot(Woot 行成本可解析 ⇒ 也算利润行)',
        merged.pN === amz.pN + woot.pN && woot.pN === 1, { merged: merged.pN, amz: amz.pN, woot: woot.pN });

      console.log('-- ⑤ NaN 体检 --');
      t('切渠道后 totals 无 NaN/Inf', r.nan.mergedTotals.length === 0 && r.nan.wootTotals.length === 0 && r.nan.amzTotals.length === 0,
        r.nan);
      t('切渠道后 perWeek 无 NaN/Inf', r.nan.wootWeeks.length === 0 && r.nan.amzWeeks.length === 0,
        { woot: r.nan.wootWeeks, amz: r.nan.amzWeeks });
      const bodyNaN = await page.evaluate(() => document.body.innerText.indexOf('NaN') >= 0);
      t('页面文本无 NaN', bodyNaN === false, bodyNaN);

      // ⑤b 形状护栏: wootPartAcc 的 acc 必须与 asinWeekData 的 acc **键集完全一致**。
      //   2026-10-10 加了 pQty/pHead 只改了 asinWeekData → 单看 Woot 时 calc() 里
      //   "totals.pQty += undefined" 变 NaN(上面的 NaN 体检查到的是症状, 这条查到的是病因)。
      //   断言集合相等而非硬编码键名 —— 以后再加字段自动覆盖, 不用回来改测试。
      const shape = await page.evaluate(({ asin, wk }) => {
        const a = window._asinWeekDataAll ? window._asinWeekDataAll(asin, wk) : null;
        const w = window.wootPartAcc ? window.wootPartAcc(asin, wk) : null;
        if (!a || !w) return { skip: true };
        const ka = Object.keys(a), kw = Object.keys(w);
        return { asin, wk, keys: ka.length,
                 missing: ka.filter(k => kw.indexOf(k) < 0),
                 extra: kw.filter(k => ka.indexOf(k) < 0) };
      }, { asin: cand.asin, wk: cand.wk });
      t('wootPartAcc 与 asinWeekData 键集一致(防新增字段漏同步 → NaN)',
        !!shape && !shape.skip && shape.missing.length === 0 && shape.extra.length === 0, shape);
      // 反证: 故意让 wootPartAcc 少一个键, 确认这条断言真的会红(不空转)
      const negCtl = await page.evaluate(({ asin, wk }) => {
        const orig = window.wootPartAcc;
        window.wootPartAcc = function(a, w2) { const o = orig(a, w2); if (o) delete o.pHead; return o; };
        const a = window._asinWeekDataAll(asin, wk), w = window.wootPartAcc(asin, wk);
        window.wootPartAcc = orig;
        if (!a || !w) return { skip: true };
        const ka = Object.keys(a), kw = Object.keys(w);
        return { missing: ka.filter(k => kw.indexOf(k) < 0) };
      }, { asin: cand.asin, wk: cand.wk });
      t('反证: 少一个键时形状断言会红(非空转)', !!negCtl && !negCtl.skip && negCtl.missing.length > 0, negCtl);
    }
  }

  // ---------- ⑥ UI 交互 ----------
  {
    console.log('-- ⑥ UI 交互(真实点击) --');
    const base = await page.evaluate(() => ({
      summary: document.getElementById('ddChannelSummary').textContent,
      adSpend: window.calc().totals.adSpend
    }));
    // 下拉选中后保持展开 → 用可见性判断决定是否需要先点开(不能盲目点 dd-btn, 会把它关掉)
    const options = page.locator('#ddChannelList .dd-opt');
    const ensureOpen = async () => {
      if (!(await options.first().isVisible().catch(() => false))) {
        await page.click('#ddChannel .dd-btn');
        await page.waitForTimeout(200);
      }
    };
    const pick = async (idx) => { await ensureOpen(); await options.nth(idx).click(); await page.waitForTimeout(300); };
    const n = await options.count();

    // 点「Woot店铺」(最后一项) —— 单击=单选
    await pick(n - 1);
    const afterWoot = await page.evaluate(() => ({
      summary: document.getElementById('ddChannelSummary').textContent,
      checked: [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => o.querySelector('input').checked),
      adSpend: window.calc().totals.adSpend
    }));
    t('点「Woot店铺」→ 汇总显示 Woot店铺', afterWoot.summary === 'Woot店铺', afterWoot);
    t('点「Woot店铺」→ 仅该项勾选', JSON.stringify(afterWoot.checked) === JSON.stringify([false, true]), afterWoot.checked);

    await pick(0);   // Aliencell官方店铺
    const afterAmz = await page.evaluate(() => ({
      summary: document.getElementById('ddChannelSummary').textContent,
      adSpend: window.calc().totals.adSpend
    }));
    t('点「Aliencell官方店铺」→ 汇总显示该名称', afterAmz.summary === 'Aliencell官方店铺', afterAmz);
    t('单看官方店铺的广告花费 < 合并(已剔除 Woot 广告费)', afterAmz.adSpend < base.adSpend,
      { amz: afterAmz.adSpend, merged: base.adSpend });

    await ensureOpen();
    await page.click('#ddChannel .dd-tools .btn');   // 合并看（全部）
    await page.waitForTimeout(300);
    const afterAll = await page.evaluate(() => ({
      summary: document.getElementById('ddChannelSummary').textContent,
      adSpend: window.calc().totals.adSpend
    }));
    t('点「合并看（全部）」→ 汇总恢复「全部（合并）」', afterAll.summary === '全部（合并）', afterAll);
    t('合并广告花费 = 官方店铺 + Woot', near(afterAll.adSpend, afterAmz.adSpend + afterWoot.adSpend, 0.05),
      { merged: afterAll.adSpend, amz: afterAmz.adSpend, woot: afterWoot.adSpend });
    t('恢复合并后与初始合并值一致', near(afterAll.adSpend, base.adSpend, 0.05), { after: afterAll.adSpend, base: base.adSpend });
  }

  console.log('-- ⑦ 页面错误 --');
  t('无页面 JS 错误', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
