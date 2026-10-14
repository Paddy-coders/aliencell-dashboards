// 验证: 1) daily.html 销售额列(表头/数值/合计)  2) ad.html 活动下拉副标题显示范围内实际ASIN
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const results = [];
function t(name, ok, extra) { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); }

(async () => {
  const browser = await chromium.launch();

  // ===== 1. 每日看板销售额 =====
  const p1 = await browser.newPage({ viewport: { width: 1720, height: 960 } });
  await p1.goto(BASE + '/daily.html', { waitUntil: 'load', timeout: 90000 });
  await p1.waitForTimeout(2500);
  const d = await p1.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const rows = [...document.querySelectorAll('#tableWrap tbody tr')];
    // 取有销售额的最新一天, 计算期望值 (与看板同口径: 默认视图按每月1号汇率折算为 USD)
    let expect = null, expectDay = null;
    for (let i = DAYS.length - 1; i >= 0; i--) {
      const day = DATA.days[DAYS[i]];
      const mo = DAYS[i].slice(0, 7);
      const conv = (v, site) => {
        const num = Number(v) || 0; if (!num) return 0;
        const cur = CUR_OF[site] || 'USD';
        if (cur === 'USD') return num;
        const r = (FX.months[mo] || {})[cur];
        return r === undefined ? num : num * r;
      };
      const sum = (day.biz || []).reduce((s, r) => s + conv(r.ordered_product_sales_amount, r.site || 'US'), 0);
      if (sum > 0) { expect = sum; expectDay = DAYS[i]; break; }
    }
    const colIdx = heads.indexOf('销售额');
    // 找到该日期所在行(首列含 MM-DD)
    const rowCells = {};
    rows.forEach(tr => {
      const tds = [...tr.querySelectorAll('td')];
      if (!tds.length) return;
      rowCells[tds[0].textContent.trim().slice(0, 5)] = tds.map(td => td.textContent.trim());
    });
    const totalRow = document.querySelector('#tableWrap tr.total-row');
    return {
      heads, colIdx, expect, expectDay,
      expectRowCells: rowCells[expectDay ? expectDay.slice(5) : ''] || [],
      totalCells: totalRow ? [...totalRow.querySelectorAll('td')].map(td => td.textContent.trim()) : [],
    };
  });
  t('daily 表头含「销售额」', d.colIdx >= 0, d.heads);
  if (d.colIdx >= 0) {
    const cellTxt = d.expectRowCells[d.colIdx]; // 行首列也是日期, 与 heads 对齐
    t('daily 当日销售额有值(非—)', cellTxt && cellTxt !== '—' && cellTxt.includes('$'), cellTxt);
    const num = cellTxt ? parseFloat(cellTxt.replace(/[$,]/g, '')) : null;
    t('daily 当日销售额与源数据一致', num !== null && Math.abs(num - d.expect) < 0.01, { cell: cellTxt, expect: d.expect, day: d.expectDay });
    const totTxt = d.totalCells[d.colIdx];
    t('daily 合计行销售额有值', totTxt && totTxt !== '—' && totTxt.includes('$'), totTxt);
  }
  // 列选择面板含销售额
  const hasColOpt = await p1.evaluate(() => [...document.querySelectorAll('#ddColList .opt-name')].some(x => x.textContent.includes('销售额')));
  t('daily 列选择面板含「销售额」', hasColOpt);
  await p1.close();

  // ===== 2. 广告看板活动副标题 =====
  const p2 = await browser.newPage({ viewport: { width: 1720, height: 960 } });
  await p2.goto(BASE + '/ad.html', { waitUntil: 'load', timeout: 90000 });
  await p2.waitForTimeout(2500);
  const a = await p2.evaluate(() => {
    // 找一个 bad=1 场景: 选系列后, 活动元数据 ASIN 不在范围内但活动仍在候选
    const out = { checked: 0, subOk: 0, examples: [] };
    const seriesSet = new Set();
    DATA.records.forEach(r => { const m = asinMetaOf(r.asin); if (m.series) seriesSet.add(m.series); });
    for (const s of seriesSet) {
      resetSelForTest();
      selSeries.add(s);
      buildCampaignOptions();
      const opts = [...document.querySelectorAll('#ddCampaignList .dd-opt')];
      for (const o of opts) {
        const sub = o.querySelector('.opt-sub') ? o.querySelector('.opt-sub').textContent : '';
        out.checked++;
        const m = sub.match(/US\s*·\s*(B0[A-Z0-9]{8})/);
        if (m) {
          // 副标题中的 ASIN 必须属于该系列(或为"等N个ASIN"格式)
          const meta = asinMetaOf(m[1]);
          if (meta.series === s) out.subOk++;
          else out.examples.push({ series: s, sub });
        }
      }
      if (out.examples.length && out.checked > 500) break;
    }
    resetSelForTest();
    return out;
    function resetSelForTest() { selCountry.clear(); selWeek.clear(); selAsin.clear(); selType.clear(); selState.clear(); selCampaigns.clear(); selSeries.clear(); selName.clear(); }
  });
  t('ad 活动副标题 ASIN 均属于所选系列', a.examples.length === 0, { checked: a.checked, bad: a.examples.slice(0, 3) });
  // 无产品筛选时副标题保持元数据 ASIN
  const subMeta = await p2.evaluate(() => {
    buildCampaignOptions();
    const o = document.querySelector('#ddCampaignList .dd-opt .opt-sub');
    return o ? o.textContent : '';
  });
  t('ad 无筛选时副标题为元数据 ASIN', /B0[A-Z0-9]{8}/.test(subMeta), subMeta);
  await p2.close();

  await browser.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} pass`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
