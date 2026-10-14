// 回归: BuyBox 占有率口径 —— 任何页面渲染出的 BuyBox 单元格都必须落在 0~100%
// 背景: product.html 的 asinWeekData() 曾用 acc.bbCount++(每国家+1) 作分母,
//       而分子是该国家各天 bb 的求和 → 某 ASIN 一周 7 天各 100% 被显示成 700%。
//       修复: acc.bbCount += (d.bb_cnt || 1)  (见 HANDOVER §8-16)
const { chromium } = require('./playwright-auth');
const BASE = process.env.BUYBOX_BASE || 'http://127.0.0.1:8899';   // 可指向线上: BUYBOX_BASE=https://xxx.app.workbuddy.host
const PRODUCT_URL = process.env.PRODUCT_URL || `${BASE}/product.html`;
const MONTHLY_URL = process.env.MONTHLY_URL || `${BASE}/monthly.html`;
const results = [];
function t(name, ok, extra) { results.push({ name, ok, extra }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }

// 扫描所有表格中表头含 BuyBox 的列(注意双行表头: 分组行 + 指标行, 需按 colspan 计算偏移)
async function scanBuyBox(page, tag) {
  return page.evaluate((tag) => {
    const out = [];
    document.querySelectorAll('table').forEach((tb, ti) => {
      const headRows = [...tb.querySelectorAll('thead tr')];
      if (!headRows.length) return;
      const last = headRows[headRows.length - 1];
      const hcells = [...last.querySelectorAll('th,td')];
      const bodyRows = [...tb.querySelectorAll('tbody tr')];
      if (!bodyRows.length) return;
      const nbody = bodyRows[0].querySelectorAll('td').length;
      const offset = nbody - hcells.length;
      hcells.forEach((hc, j) => {
        if (!/buy\s*box/i.test(hc.textContent)) return;
        const col = offset + j;
        bodyRows.forEach((tr) => {
          const tds = tr.querySelectorAll('td');
          if (!tds[col]) return;
          const txt = tds[col].textContent.trim();
          const v = parseFloat(txt.replace(/[%,\s]/g, ''));
          out.push({ tag, table: ti, text: txt, val: isNaN(v) ? null : v, rowHead: (tds[0].textContent || '').trim().slice(0, 24) });
        });
      });
    });
    return out;
  }, tag);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.route('https://oovvqvgrjqwogjwswaxx.supabase.co/**', r => r.abort());
  await page.route('**/product_map.json', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept().catch(() => {}));

  // ---- 1) 渲染层: product.html (周度汇总) ----
  await page.goto(PRODUCT_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  let cells = await scanBuyBox(page, 'product.html');
  t('product.html: 找到 BuyBox 列', cells.length > 0, { cells: cells.length });
  let over = cells.filter(c => c.val !== null && (c.val > 100 || c.val < 0));
  t('product.html: 全周 BuyBox 均 ∈ 0~100%', over.length === 0, over.length ? { over: over.slice(0, 8), n: over.length } : { max: Math.max(...cells.map(c => c.val)) });

  // ---- 2) 逻辑层: 直接跑页面内 calc(), 逐周校验 BuyBox ----
  const calcRes = await page.evaluate(() => {
    const c = calc();
    const bad = [];
    for (const [lab, pw] of Object.entries(c.perWeek)) {
      const v = pw.bbCount ? pw.bbSum / pw.bbCount : null;
      if (v !== null && v > 100.0001) bad.push({ lab, v: +v.toFixed(2), bbSum: +pw.bbSum.toFixed(1), bbCount: pw.bbCount });
    }
    const totV = c.totals.bbCount ? c.totals.bbSum / c.totals.bbCount : null;
    return { bad, totV: totV === null ? null : +totV.toFixed(2), totBbCount: c.totals.bbCount };
  });
  t('product.html: calc() 逐周 BuyBox ≤100%', calcRes.bad.length === 0, calcRes.bad.length ? { bad: calcRes.bad } : calcRes);

  // ---- 3) 单选每个 ASIN 后逐周 BuyBox 仍 ≤100% ----
  const asinBad = await page.evaluate(async () => {
    const CL = window.CLICKABLE || null;
    const bad = [];
    const asins = DATA.asin_list.slice();
    for (const a of asins) {
      // 通过页面自身的筛选状态直接验证: 单选该 ASIN 后每题周值
      if (typeof selAsin !== 'undefined') { selAsin.clear(); selAsin.add(a); }
      if (typeof syncAndRender === 'function') syncAndRender();
      else if (typeof render === 'function') render();
      const c = calc();
      for (const [lab, pw] of Object.entries(c.perWeek)) {
        const v = pw.bbCount ? pw.bbSum / pw.bbCount : null;
        if (v !== null && v > 100.0001) bad.push({ asin: a, lab, v: +v.toFixed(2) });
      }
    }
    if (typeof selAsin !== 'undefined') selAsin.clear();
    if (typeof syncAndRender === 'function') syncAndRender(); else if (typeof render === 'function') render();
    return { bad: bad.slice(0, 10), n: bad.length, asins: asins.length };
  });
  t('product.html: 逐个 ASIN 单选路径 BuyBox ≤100%', asinBad.n === 0, asinBad);

  // ---- 4) 渲染层: monthly.html (月度) ----
  await page.goto(MONTHLY_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  const mCells = await scanBuyBox(page, 'monthly.html');
  t('monthly.html: 找到 BuyBox 列', mCells.length > 0, { cells: mCells.length });
  const mOver = mCells.filter(c => c.val !== null && (c.val > 100 || c.val < 0));
  t('monthly.html: 各月 BuyBox 均 ∈ 0~100%', mOver.length === 0, mOver.length ? { over: mOver.slice(0, 8), n: mOver.length } : { max: Math.max(...mCells.map(c => c.val)) });

  // ---- 5) 口径一致性: product 与 monthly 的 BuyBox 极值应接近(同为日均值口径) ----
  const pMax = Math.max(...cells.map(c => c.val));
  const mMax = Math.max(...mCells.map(c => c.val));
  t('product/monthly BuyBox 极值同量级(口径一致)', Math.abs(pMax - mMax) < 60, { productMax: pMax, monthlyMax: mMax });

  t('无页面 JS 错误', errors.length === 0, errors.length ? { errors: errors.slice(0, 5) } : undefined);
  await browser.close();
  const bad = results.filter(r => !r.ok).length;
  console.log(`\n结果: ${results.length - bad}/${results.length} 通过` + (bad ? '  ❌' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
