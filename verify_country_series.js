// 验证: 选国家后 产品系列/产品名 下拉双重过滤（国家×系列）
// 对三个看板(daily/ad/product)统一断言:
//   1. 选国家 c1 → 系列下拉 == 该国ASIN映射到的系列集(含无)
//   2. 选国家 c2(另一国) → 系列下拉不同(排除 c1 专属系列)
//   3. 选无专属系列的国家 c3 → 系列下拉只剩「无」(用户需求: 全部取无)
//   4. 选 c1 + 系列 → 产品名下拉 == 该国该系列ASIN的产品名集(含无)
// 测试映射动态构造: 找 c1 专属 ASIN→X1/手机支架A, c2 专属 ASIN→X2/数据线C, 其余→无
const { chromium } = require('./playwright-auth');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8903;
const ROOT = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${cond ? '' : ' | ' + JSON.stringify(extra)}`);
}

// 页面内通用收集: 每个国家下有数据的 ASIN 集合 (兼容 daily/ad/product 数据结构)
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

async function seriesOf(page) {
  return page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(e => e.textContent.trim()));
}
async function namesOf(page) {
  return page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(e => e.textContent.trim()));
}
// 页面内: 选国家后 系列下拉 (清空其他筛选)
async function pickCountrySeries(page, c) {
  return page.evaluate(({COLLECT, c}) => {
    eval(COLLECT);
    selCountry.clear(); selCountry.add(c); selSeries.clear(); selName.clear();
    if (typeof renderAll === 'function') renderAll();
    buildSeriesOptions();
    return [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(e => e.textContent.trim());
  }, {COLLECT, c});
}
// 页面内: 选国家+系列后 产品名下拉
async function pickCountryName(page, c, s) {
  return page.evaluate(({COLLECT, c, s}) => {
    eval(COLLECT);
    selCountry.clear(); selCountry.add(c); selSeries.clear(); selSeries.add(s); selName.clear();
    if (typeof renderAll === 'function') renderAll();
    buildNameOptions();
    return [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(e => e.textContent.trim());
  }, {COLLECT, c, s});
}
// 页面内: 某国家 c 下某 ASIN 是否有数据
async function asinInCountry(page, c, a) {
  return page.evaluate(({COLLECT, c, a}) => {
    eval(COLLECT);
    const m = __collectAsins();
    return (m[c] || new Set()).has(a);
  }, {COLLECT, c, a});
}
// 页面内: 期望系列集 = 选国家后 该国ASIN映射的系列集合(排序)
async function expSeriesOf(page, c) {
  return page.evaluate(({COLLECT, c}) => {
    eval(COLLECT);
    const m = __collectAsins();
    const s = new Set();
    for (const a of m[c] || []) s.add(asinMetaOf(a).series);
    return [...s].sort();
  }, {COLLECT, c});
}
// 页面内: 期望产品名集 = 国家+系列 下 ASIN 映射的产品名集合(排序)
async function expNamesOf(page, c, s) {
  return page.evaluate(({COLLECT, c, s}) => {
    eval(COLLECT);
    const m = __collectAsins();
    const out = new Set();
    for (const a of m[c] || []) {
      const meta = asinMetaOf(a);
      if (meta.series === s) out.add(meta.name);
    }
    return [...out].sort();
  }, {COLLECT, c, s});
}
// 页面内: 全部系列列表
async function allSeriesOf(page) {
  return page.evaluate(() => {
    if (typeof seriesList !== 'undefined') return seriesList.slice().sort();
    if (typeof allSeries === 'function') return allSeries().slice().sort();
    return [];
  });
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('https://oovvqvgrjqwogjwswaxx.supabase.co/**', r => r.abort());
  await page.route('**/product_map.json', r => r.abort());

  // ===== 1. 打开 daily 收集数据分布 =====
  await page.goto(`http://127.0.0.1:${PORT}/daily.html`, { waitUntil: 'networkidle', timeout: 40000 });
  const dist = await page.evaluate((COLLECT) => {
    eval(COLLECT);
    const m = __collectAsins();
    const out = {};
    for (const [c, s] of Object.entries(m)) out[c] = [...s];
    return { countryAsins: out, allAsins: [...new Set(Object.values(m).flatMap(x => [...x]))] };
  }, COLLECT);
  const { countryAsins, allAsins } = dist;
  console.log('国家数:', Object.keys(countryAsins).length, '总ASIN数:', allAsins.length);

  // ===== 2. 动态构造映射 =====
  const countries = Object.keys(countryAsins);
  let c1 = null, c2 = null, c3 = null, a_c1 = null, a_c2 = null;
  for (const c of countries) {
    const only = countryAsins[c].filter(a => !Object.entries(countryAsins).some(([cc, asins]) => cc !== c && asins.includes(a)));
    if (only.length) { c1 = c; a_c1 = only[0]; break; }
  }
  for (const c of countries) {
    if (c === c1) continue;
    const only = countryAsins[c].filter(a => !Object.entries(countryAsins).some(([cc, asins]) => cc !== c && asins.includes(a)));
    if (only.length) { c2 = c; a_c2 = only[0]; break; }
  }
  for (const c of countries) {
    if (c === c1 || c === c2) continue;
    if (!countryAsins[c].includes(a_c1) && !countryAsins[c].includes(a_c2)) { c3 = c; break; }
  }
  check('数据分布: 找到 c1/c2/a_c1/a_c2', !!(c1 && c2 && a_c1 && a_c2), { c1, c2, a_c1, a_c2 });
  if (!c1 || !c2 || !a_c1 || !a_c2) { await browser.close(); server.close(); process.exit(1); }

  const TEST_CATALOG = [{ series: 'X1', name: '手机支架A' }, { series: 'X2', name: '数据线C' }];
  const TEST_ASINMAP = [
    { asin: a_c1, series: 'X1', name: '手机支架A', country: 'EU' },
    { asin: a_c2, series: 'X2', name: '数据线C', country: 'US' }
  ];
  await page.evaluate(([cat, amap]) => {
    localStorage.setItem('pc_catalog', JSON.stringify(cat));
    localStorage.setItem('pc_asinmap', JSON.stringify(amap));
  }, [TEST_CATALOG, TEST_ASINMAP]);

  // ===== 3. 逐看板测试 =====
  const targets = [
    { url: '/daily.html', label: 'daily' },
    { url: '/ad.html', label: 'ad' },
    { url: '/product.html', label: 'product' }
  ];
  for (const t of targets) {
    console.log(`\n===== ${t.label} =====`);
    await page.goto(`http://127.0.0.1:${PORT}${t.url}`, { waitUntil: 'networkidle', timeout: 40000 });

    const metaOk = await page.evaluate(({a1, a2}) => {
      const m1 = asinMetaOf(a1), m2 = asinMetaOf(a2);
      return m1.series === 'X1' && m2.series === 'X2';
    }, {a1: a_c1, a2: a_c2});
    check(`${t.label}: 测试映射生效(X1/X2)`, metaOk);

    // c1: 系列下拉 == 期望(含X1)
    const opts1 = await pickCountrySeries(page, c1);
    const exp1 = await expSeriesOf(page, c1);
    check(`${t.label}: 选${c1} 系列下拉==期望(${exp1.join(',')})`, JSON.stringify(opts1) === JSON.stringify(exp1), { got: opts1, exp: exp1 });
    check(`${t.label}: 选${c1} 含 X1`, opts1.includes('X1'));

    // c2: 若该国无 a_c1 数据 → 下拉不含 X1 (双重过滤)
    const opts2 = await pickCountrySeries(page, c2);
    const hasX1 = await asinInCountry(page, c2, a_c1);
    if (hasX1) check(`${t.label}: 选${c2} 含 X1 (该国也有a_c1数据, 合理)`, opts2.includes('X1'));
    else check(`${t.label}: 选${c2} 不含 X1 (双重过滤生效)`, !opts2.includes('X1'), { got: opts2 });

    // c3(如有): 系列下拉只剩「无」
    if (c3) {
      const opts3 = await pickCountrySeries(page, c3);
      check(`${t.label}: 选${c3} 系列下拉全部取无`, opts3.length === 1 && opts3[0] === '无', { got: opts3 });
    }

    // c1 + X1: 产品名下拉 == 期望
    const nopts = await pickCountryName(page, c1, 'X1');
    const expN = await expNamesOf(page, c1, 'X1');
    check(`${t.label}: ${c1}+X1 产品名下拉==期望(${expN.join(',')})`, JSON.stringify(nopts) === JSON.stringify(expN), { got: nopts, exp: expN });

    // c1 + 「无」: 产品名下拉只剩「无」
    const nopts2 = await pickCountryName(page, c1, '无');
    check(`${t.label}: ${c1}+无 产品名下拉只剩无`, nopts2.length === 1 && nopts2[0] === '无', { got: nopts2 });

    // 清空: 系列下拉恢复全部
    const optsAll = await page.evaluate((COLLECT) => {
      eval(COLLECT);
      selCountry.clear(); selSeries.clear(); selName.clear();
      if (typeof renderAll === 'function') renderAll();
      buildSeriesOptions();
      return [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(e => e.textContent.trim());
    }, COLLECT);
    const allS = await allSeriesOf(page);
    const missing = allS.filter(x => !optsAll.includes(x));
    check(`${t.label}: 清空国家 系列下拉恢复全部(${allS.length})`, missing.length === 0, { got: optsAll, exp: allS });
  }

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n========== 结果: ${results.length - fails.length}/${results.length} PASS ==========`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
