// 云端冒烟: 线上三看板 国家→系列/产品名 双重过滤
// 用真实云端数据(不拦截 supabase): 选一个"该国系列集 ⊂ 全部系列"的国家,
// 断言系列下拉 == 该国系列集(含无), 且不含该国无数据的系列
const { chromium } = require('./playwright-auth');

const BASE = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link';
const COLLECT = `
function __collectAsins() {
  const m = {};
  const add = (c, a) => { if (a) (m[c] = m[c] || new Set()).add(a); };
  if (typeof DAYS !== 'undefined') {
    for (const d of DAYS) {
      const day = DATA.days[d];
      if (!day) continue;
      for (const r of day.biz) add(r.site || r.user_account || 'US', r.asin);
      for (const [cc, items] of Object.entries(day.ads)) for (const it of items) add(cc, extractAsin(it));
    }
  } else if (Array.isArray(DATA.records)) {
    DATA.records.forEach(r => add(r.country, r.asin));
  } else if (Array.isArray(DATA.asin_list)) {
    DATA.asin_list.forEach(a => {
      const as = DATA.asins[a];
      if (!as || !as.weeks) return;
      Object.entries(as.weeks).forEach(([wl, ccMap]) => {
        if (!ccMap) return;
        Object.keys(ccMap).forEach(c => add(c, a));
      });
    });
  }
  return m;
}
`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${cond ? '' : ' | ' + JSON.stringify(extra)}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const targets = [
    { url: '/daily.html', label: 'daily' },
    { url: '/ad.html', label: 'ad' },
    { url: '/product.html', label: 'product' }
  ];
  for (const t of targets) {
    console.log(`\n===== 线上 ${t.label} =====`);
    await page.goto(BASE + t.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200); // 等 cloudMapSync 完成

    // 收集: 全部系列 / 各国系列集 / 各国ASIN
    const info = await page.evaluate((COLLECT) => {
      eval(COLLECT);
      const m = __collectAsins();
      const allSeriesSet = new Set();
      const countrySeries = {};
      for (const [c, asins] of Object.entries(m)) {
        const s = new Set();
        for (const a of asins) { const sr = asinMetaOf(a).series; s.add(sr); allSeriesSet.add(sr); }
        countrySeries[c] = [...s].sort();
      }
      let allS = [];
      try { if (typeof seriesList !== 'undefined') allS = seriesList.slice().sort(); } catch (e) {}
      try { if (typeof allSeries === 'function' && allS.length === 0) allS = allSeries().slice().sort(); } catch (e) {}
      if (allS.length === 0) allS = [...allSeriesSet].sort();
      return { allSeries: allS, countrySeries, countries: Object.keys(countrySeries) };
    }, COLLECT);
    check(`${t.label}: 数据可读(${info.countries.length}国/${info.allSeries.length}系列)`, info.countries.length > 0 && info.allSeries.length > 0, info);

    // 找差异国家: 该国系列集 ⊂ 全部系列
    let diffC = null, diffSeries = null;
    for (const c of info.countries) {
      const cs = info.countrySeries[c];
      const missing = info.allSeries.filter(s => !cs.includes(s));
      if (missing.length > 0) { diffC = c; diffSeries = missing; break; }
    }

    if (diffC) {
      // 选差异国家 → 系列下拉
      const opts = await page.evaluate(({COLLECT, c}) => {
        eval(COLLECT);
        selCountry.clear(); selCountry.add(c); selSeries.clear(); selName.clear();
        if (typeof renderAll === 'function') renderAll();
        buildSeriesOptions();
        return [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(e => e.textContent.trim());
      }, {COLLECT, c: diffC});
      const exp = info.countrySeries[diffC];
      check(`${t.label}: 选${diffC} 系列下拉==该国系列集(${exp.join(',')})`, JSON.stringify(opts) === JSON.stringify(exp), { got: opts, exp });
      // 该国无数据的系列不在下拉 (双重过滤核心)
      const leak = diffSeries.filter(s => opts.includes(s));
      check(`${t.label}: 选${diffC} 不含无数据系列(${diffSeries.join(',')})`, leak.length === 0, { got: opts, leak });
      // 产品名下拉也按 国家+系列 过滤: 选该国第一个系列
      const s0 = exp.find(x => x !== '无') || exp[0];
      if (s0) {
        const nopts = await page.evaluate(({COLLECT, c, s}) => {
          eval(COLLECT);
          selCountry.clear(); selCountry.add(c); selSeries.clear(); selSeries.add(s); selName.clear();
          if (typeof renderAll === 'function') renderAll();
          buildNameOptions();
          return [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(e => e.textContent.trim());
        }, {COLLECT, c: diffC, s: s0});
        // 期望: 该国该系列 ASIN 的产品名
        const expN = await page.evaluate(({COLLECT, c, s}) => {
          eval(COLLECT);
          const m = __collectAsins();
          const out = new Set();
          for (const a of m[c] || []) { const meta = asinMetaOf(a); if (meta.series === s) out.add(meta.name); }
          return [...out].sort();
        }, {COLLECT, c: diffC, s: s0});
        check(`${t.label}: ${diffC}+${s0} 产品名下拉==期望(${expN.join(',')})`, JSON.stringify(nopts) === JSON.stringify(expN), { got: nopts, exp: expN });
      }
    } else {
      console.log(`NOTE: ${t.label} 所有国家系列集相同, 无法验证差异(可选)`, info.countrySeries);
      // 仍验证: 选第一个国家, 下拉 ⊆ 全部系列
      const c0 = info.countries[0];
      const opts = await page.evaluate(({COLLECT, c}) => {
        eval(COLLECT);
        selCountry.clear(); selCountry.add(c); selSeries.clear(); selName.clear();
        if (typeof renderAll === 'function') renderAll();
        buildSeriesOptions();
        return [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(e => e.textContent.trim());
      }, {COLLECT, c: c0});
      const subset = opts.every(o => info.allSeries.includes(o) || o === '无');
      check(`${t.label}: 选${c0} 系列下拉均为有效系列`, subset, { got: opts, all: info.allSeries });
    }
  }

  check('全程无 JS 错误', errors.length === 0, { errors });
  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n========== 云端冒烟: ${results.length - fails.length}/${results.length} PASS ==========`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
