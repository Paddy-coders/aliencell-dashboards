/* test_monthly_platform.js — 月度数据看板「🌐 平台」筛选回归（2026-10-13）
 *
 * 需求（用户 2026-10-13）：月度数据面板里引入了 JoyBuy 平台的数据，是否可以增加平台的筛选条件。
 *
 * 断言策略（刻意不硬编码业务数字）：
 *   · 加和关系用**页面自己**的三个视图互相验证（全部 = Amazon + JoyBuy），
 *     直接调页面内的 calcKpis() 拿精确值，而不是从字符串里抠数字。
 *   · 与源数据对账时动态读 joybuy_monthly.json（行数/sessions/系列），不写死。
 *   · 渲染层单独断言（KPI 卡与表格合计行的「—」），避免只看计算结果漏掉渲染缺陷。
 *
 * 两个必须的桩（否则测的是别的状态）：
 *   ① 认证守卫：file:// 无 wb_auth 会跳 login.html。
 *   ② 云端同步：真连 Supabase 会在比对后 location.reload()，把点击后的 evaluate 打断
 *      （报 Execution context was destroyed）→ 拦 mapping 接口 + 预注入 pc_woot='[]'。
 *
 * 另有一个易踩的交互点：筛选下拉**选中后不会自动收起**，所以「打开下拉」必须先判 open 状态，
 * 否则第二次点 .dd-btn 是把已经打开的面板关掉 → 后续点击超时（本脚本用 openDD() 统一处理）。
 *
 * 用法：node test_monthly_platform.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const AUTH = JSON.stringify({ access_token: 't', refresh_token: 't', email: 't@example.com', exp: Date.now() + 864e5 });
const JBY = JSON.parse(fs.readFileSync(path.join(BASE, 'joybuy_monthly.json'), 'utf8'));
const JBP = JSON.parse(fs.readFileSync(path.join(BASE, 'joybuy_profit.json'), 'utf8'));

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS | ' + name + (detail !== undefined ? ' | ' + detail : '')); }
  else { fail++; bad.push(name + (detail !== undefined ? '  → ' + detail : '')); console.log('FAIL | ' + name + (detail !== undefined ? ' | ' + detail : '')); }
}
const num = (s) => Number(String(s).replace(/[^0-9.\-]/g, ''));

// 页面内取数（calcKpis 是顶层函数，可直接调）
const SNAP = () => {
  const k = calcKpis();
  return {
    tot: { sessions: k.tot.sessions, sales: k.tot.sales, units: k.tot.units, orders: k.tot.orders, adCost: k.tot.adCost },
    // 毛利(2026-10-13 起 JoyBuy 也有): 期望值一律「动态读 joybuy_profit.json」, 不写死数字
    profit: monthVal(k.tot, 'profit'),
    margin: monthVal(k.tot, 'margin'),
    pN: k.tot.pN,
    platSummary: (document.getElementById('ddPlatformSummary') || {}).textContent || '',
    platOptions: [...document.querySelectorAll('#ddPlatformList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    platSel: [...document.querySelectorAll('#ddPlatformList .dd-opt.sel')].map(o => o.innerText.trim()),
    hasAllBtn: !!document.querySelector('#ddPlatform .dd-tools .btn'),
    kpis: [...document.querySelectorAll('#kpiRow .kpi')].map(c => ({
      label: (c.querySelector('.kpi-label') || {}).innerText.trim(),
      value: (c.querySelector('.kpi-value') || {}).innerText.trim(),
    })),
    seriesOptions: [...document.querySelectorAll('#ddSeriesList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    asinText: (document.getElementById('ddAsinList') || {}).innerText.replace(/\s+/g, ' ').trim(),
    regionOptions: [...document.querySelectorAll('#ddRegionList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    totalRow: (() => {
      const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(r => /合计/.test(r.innerText));
      return tr ? [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : null;
    })(),
    nan: ((document.body.innerText || '').match(/NaN/g) || []).length,
    undef: ((document.body.innerText || '').match(/undefined/g) || []).length,
  };
};
const kpiOf = (s, label) => { const h = s.kpis.find(x => x.label.indexOf(label) >= 0); return h ? h.value : '(缺)'; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  await ctx.route('**/rest/v1/mapping*', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]),
  }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.addInitScript(a => {
    try { localStorage.setItem('wb_auth', a); localStorage.setItem('pc_woot', '[]'); } catch (e) {}
  }, AUTH);

  // 下拉选中后不自动收起 → 统一「确保是打开状态再点选项」
  const openDD = async (id) => {
    const isOpen = await page.evaluate(i => { const el = document.getElementById(i); return !!el && el.classList.contains('open'); }, id);
    if (!isOpen) { await page.click('#' + id + ' .dd-btn'); await page.waitForTimeout(140); }
  };
  const pickPlatform = async (idx) => {
    await openDD('ddPlatform');
    await page.click(`#ddPlatformList .dd-opt:nth-child(${idx})`);
    await page.waitForTimeout(450);
  };

  await page.goto('file:///' + path.resolve(BASE, 'monthly.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  if (/login\.html/.test(page.url())) { console.log('FATAL: 被认证守卫重定向（未注入 wb_auth）'); process.exit(1); }

  // ================= ① 结构 =================
  const s0 = await page.evaluate(SNAP);
  ok(s0.platSummary === '全部平台', '①默认平台 = 全部平台', s0.platSummary);
  ok(/全部/.test(s0.platSummary), '①默认摘要满足「全部」不变式', s0.platSummary);
  ok(s0.platOptions.length === 2, '①平台下拉 2 项（Amazon / JoyBuy）', s0.platOptions.length);
  ok(/Amazon/.test(s0.platOptions[0] || ''), '①首项 = Amazon', s0.platOptions[0]);
  ok(/JoyBuy/.test(s0.platOptions[1] || ''), '①次项 = JoyBuy', s0.platOptions[1]);
  const jbRows = JBY.rows.length;
  ok(new RegExp('\\(\\s*' + jbRows + '\\s*行').test(s0.platOptions[1] || ''), '①JoyBuy 项标注行数 = joybuy_monthly.json', s0.platOptions[1] + ' vs ' + jbRows);
  ok(s0.platSel.length === 0, '①默认无平台被选中（空集 = 全部）', s0.platSel.join(','));
  ok(s0.hasAllBtn, '①存在「看全部平台」按钮');
  ok(s0.regionOptions.length > 0, '①地区下拉正常渲染', s0.regionOptions.length);

  const all = s0.tot;
  ok(all.sales > 0 && all.sessions > 0, '①默认视图有数据', 'sales=' + all.sales.toFixed(2));

  // ================= ② 只看 JoyBuy =================
  await pickPlatform(2);
  const sJb = await page.evaluate(SNAP);
  ok(/JoyBuy/.test(sJb.platSummary) && !/Amazon/.test(sJb.platSummary), '②切换后摘要 = 🛒 JoyBuy', sJb.platSummary);
  ok(sJb.platSel.length === 1, '②仅一项选中', sJb.platSel.join(','));
  const jb = sJb.tot;

  // 与源数据对账（sessions 不受币种影响，可直接比；页面显示四舍五入故用容差 1）
  const jbSrcSessions = JBY.rows.reduce((a, r) => a + (+r.sessions || 0), 0);
  ok(Math.abs(jb.sessions - jbSrcSessions) <= 1, '②JoyBuy Sessions = joybuy_monthly.json 合计',
    jb.sessions.toFixed(1) + ' vs ' + jbSrcSessions.toFixed(1));
  ok(jb.sales > 0, '②JoyBuy 销售额 > 0（数据确实并进来了）', '$' + jb.sales.toFixed(2));
  ok(jb.units > 0, '②JoyBuy 订单量 > 0', jb.units);

  // Amazon 专属指标必须显示 —（不是 0，也不是被摊薄的值）
  ok(kpiOf(sJb, '广告花费') === '—', '②单看 JoyBuy 广告花费显示 —', kpiOf(sJb, '广告花费'));
  ok(kpiOf(sJb, 'ROAS') === '—', '②单看 JoyBuy ROAS 显示 —', kpiOf(sJb, 'ROAS'));
  // 广告占比曾是唯一例外：只判 bizOk ⇒ JoyBuy 有销售额却无广告时显示 0.00%，与同行其它广告列（都是 —）自相矛盾
  const adShare = await page.evaluate(() => {
    const pure = monthVal({ ym: '2026-08', sales: 100, adCost: 0, bizRows: 1, adRows: 0, pN: 0 }, 'ad_share');
    const tbl = document.querySelector('#tableWrap table');
    if (!tbl) return { pure, cell: '(无表格)' };
    const headRows = tbl.querySelectorAll('thead tr');
    const heads = [...headRows[headRows.length - 1].querySelectorAll('th')];
    const idx = heads.findIndex(h => /广告占比/.test(h.innerText));
    const tr = [...tbl.querySelectorAll('tbody tr')].find(r => /合计/.test(r.innerText));
    const cells = tr ? [...tr.querySelectorAll('th,td')] : [];
    return { pure, idx, cell: idx >= 0 && cells[idx + 1] ? cells[idx + 1].innerText.trim() : '(取不到)' };
  });
  ok(adShare.pure === null, '②无广告数据时「广告占比」取值为 null（不再是 0）', String(adShare.pure));
  ok(adShare.cell === '—', '②单看 JoyBuy 合计行「广告占比」列显示 —', 'idx=' + adShare.idx + ' cell=' + adShare.cell);
  // ---- JoyBuy 毛利（2026-10-13 新增: 账单口径完整毛利）----
  // 期望值一律动态读 joybuy_profit.json，并经页面自己的 fxv() 折到目标币种（不写死数字）
  const jbProfMonths = (JBP.months || []).filter(m => m.grossProfit !== null && m.grossProfit !== undefined);
  const jbProjInfo = await page.evaluate((ms) => {
    let exp = 0, expSales = 0;
    for (const m of ms) {
      const cc = String(m.site || '').replace('-Site', '');
      exp += fxv(m.grossProfit, cc, m.ym);
      expSales += fxv(m.goods, cc, m.ym);
    }
    return { exp, expSales, expMargin: expSales > 0 ? exp / expSales * 100 : null };
  }, jbProfMonths.map(m => ({ site: m.site, ym: m.ym, grossProfit: m.grossProfit, goods: m.goods })));
  ok(jbProfMonths.length > 0, '②joybuy_profit.json 有可用的完整毛利记录（数据源非空）',
    jbProfMonths.map(m => m.ym + '/' + m.site).join(' '));
  ok(sJb.profit !== null && Math.abs(sJb.profit - jbProjInfo.exp) < 0.05,
    '②单看 JoyBuy 毛利 = 账单完整毛利（折目标币种）',
    (sJb.profit === null ? '—' : '$' + sJb.profit.toFixed(2)) + ' vs $' + jbProjInfo.exp.toFixed(2));
  ok(sJb.margin !== null && Math.abs(sJb.margin - jbProjInfo.expMargin) < 0.02,
    '②单看 JoyBuy 毛利率 = 完整毛利 ÷ 账单货款（不是 GMV）',
    (sJb.margin === null ? '—' : sJb.margin.toFixed(2) + '%') + ' vs ' + jbProjInfo.expMargin.toFixed(2) + '%');
  // 反向对照：没有账单数据的站点必须留白（不按 0 成本/0 毛利算）
  const noBill = await page.evaluate(() => {
    const a = aggMonth('2026-09', ROWS.filter(r => platOf(r) === 'joybuy' && r.cc === 'NL'));
    return { pN: a.pN, profit: monthVal(a, 'profit') };
  });
  ok(noBill.pN === 0 && noBill.profit === null, '②无账单站点(NL)的 JoyBuy 毛利显示 —（不按 0 算）',
    'pN=' + noBill.pN + ' profit=' + String(noBill.profit));
  // 渲染层：合计行的毛利/毛利率不再是 —
  ok(sJb.totalRow && !sJb.totalRow.slice(-2).some(v => v === '—'), '②合计行毛利/毛利率列不再是 —',
    sJb.totalRow ? JSON.stringify(sJb.totalRow.slice(-3)) : '(无合计行)');
  // 按表头精确取「毛利 / 毛利率」两列（⚠️ 不能用 /毛利/ 找，'毛利(RMB)' 会先命中）
  const jbCells = await page.evaluate(() => {
    const tbl = document.querySelector('#tableWrap table');
    if (!tbl) return null;
    const headRows = tbl.querySelectorAll('thead tr');
    const heads = [...headRows[headRows.length - 1].querySelectorAll('th')].map(h => h.innerText.replace(/\s+/g, ' ').trim());
    const iP = heads.findIndex(h => h === '毛利'), iM = heads.findIndex(h => h === '毛利率');
    const tr = [...tbl.querySelectorAll('tbody tr')].find(r => /合计/.test(r.innerText));
    const cells = tr ? [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : [];
    return { iP, iM, p: cells[iP + 1], m: cells[iM + 1] };
  });
  ok(jbCells && jbCells.iP >= 0 && jbCells.iM >= 0, '②表格存在「毛利」「毛利率」列', JSON.stringify(jbCells && { iP: jbCells.iP, iM: jbCells.iM }));
  ok(jbCells && jbCells.p !== '—' && Math.abs(num(jbCells.p) - jbProjInfo.exp) < 0.05,
    '②合计行「毛利」单元格 = 账单完整毛利', (jbCells && jbCells.p) + ' vs $' + jbProjInfo.exp.toFixed(2));
  ok(jbCells && jbCells.m !== '—' && Math.abs(num(jbCells.m) - jbProjInfo.expMargin) < 0.02,
    '②合计行「毛利率」单元格 = 完整毛利 ÷ 账单货款', (jbCells && jbCells.m) + ' vs ' + jbProjInfo.expMargin.toFixed(2) + '%');
  ok(sJb.nan === 0 && sJb.undef === 0, '②JoyBuy 视图无 NaN/undefined', 'NaN=' + sJb.nan + ' undef=' + sJb.undef);

  // 系列下拉必须出现 JoyBuy 自带系列（它没有 ASIN，映射表里查不到 —— 曾经会全落「无」）
  const jbSeries = [...new Set(JBY.rows.map(r => r.series).filter(Boolean))];
  const missSeries = jbSeries.filter(x => !sJb.seriesOptions.some(o => o.indexOf(x) >= 0));
  ok(missSeries.length === 0, '②产品系列下拉含全部 JoyBuy 系列（无 ASIN 也选得到）',
    missSeries.length ? '缺 ' + missSeries.join(',') : jbSeries.join(' / '));
  ok(/无匹配|无 ASIN|无匹配的 ASIN/.test(sJb.asinText), '②JoyBuy 视图 ASIN 下拉提示无匹配', sJb.asinText.slice(0, 40));

  // ================= ③ 只看 Amazon =================
  await pickPlatform(1);
  const sAmz = await page.evaluate(SNAP);
  ok(/Amazon/.test(sAmz.platSummary) && !/JoyBuy/.test(sAmz.platSummary), '③切换后摘要 = 🅰️ Amazon', sAmz.platSummary);
  const amz = sAmz.tot;
  ok(amz.adCost > 0, '③Amazon 视图有广告花费', '$' + amz.adCost.toFixed(2));
  ok(amz.sales > jb.sales * 10, '③Amazon 销售额远大于 JoyBuy（口径没串）', '$' + amz.sales.toFixed(2));
  const amzSeriesHit = jbSeries.filter(x => sAmz.seriesOptions.includes(x));
  // 断言方式(2026-10-13 修正): 必须用**精确相等**, 不能用 indexOf 子串匹配。
  //   两侧的系列命名体系本来就不同 —— JoyBuy 数据里是「X1 / X1 Lite / E1」,
  //   亚马逊侧映射(catalog/asinMap)是「X1系列 / X1 Lite系列 / E1系列」;
  //   子串匹配会让 "X1" 命中 "X1系列" 造成假失败。而旧写法之所以一直"通过",
  //   是因为当时内嵌映射为空、Amazon 视图的下拉根本没有系列项 ⇒ 断言是**空过**的。
  //   用精确相等后, 该断言才真正在守「JoyBuy 的系列标签没漏进 Amazon 视图」。
  ok(amzSeriesHit.length === 0, '③Amazon 视图的系列下拉不含 JoyBuy 的系列标签(精确匹配)', amzSeriesHit.join(',') || '(无)', amzSeriesHit.length ? '' : '');

  // ================= ④ 加和关系（全部平台 = Amazon + JoyBuy） =================
  await openDD('ddPlatform');
  await page.click('#ddPlatform .dd-tools .btn');   // 看全部平台
  await page.waitForTimeout(450);
  const sAll = await page.evaluate(SNAP);
  ok(sAll.platSummary === '全部平台', '④「看全部平台」按钮生效', sAll.platSummary);
  const rel = (a, b, c, tol) => Math.abs(a - (b + c)) <= tol;
  ok(rel(sAll.tot.sessions, amz.sessions, jb.sessions, 0.05), '④全部平台 Sessions = Amazon + JoyBuy',
    sAll.tot.sessions.toFixed(1) + ' vs ' + (amz.sessions + jb.sessions).toFixed(1));
  ok(rel(sAll.tot.sales, amz.sales, jb.sales, 0.05), '④全部平台 销售额 = Amazon + JoyBuy',
    '$' + sAll.tot.sales.toFixed(2) + ' vs $' + (amz.sales + jb.sales).toFixed(2));
  ok(rel(sAll.tot.units, amz.units, jb.units, 0.05), '④全部平台 订单量 = Amazon + JoyBuy',
    sAll.tot.units + ' vs ' + (amz.units + jb.units));
  ok(Math.abs(sAll.tot.adCost - amz.adCost) < 0.05, '④全部平台广告花费 = Amazon（不被 JoyBuy 摊薄）',
    '$' + sAll.tot.adCost.toFixed(2) + ' vs $' + amz.adCost.toFixed(2));
  // 毛利自 2026-10-13 起 JoyBuy 也有了 ⇒ 「全部平台」应为两平台**相加**（旧口径是只等于 Amazon）
  ok(rel(sAll.profit, sAmz.profit, sJb.profit, 0.05), '④全部平台 毛利 = Amazon + JoyBuy（不再只等于 Amazon）',
    '$' + (sAll.profit === null ? '—' : sAll.profit.toFixed(2)) + ' vs $' +
    (((sAmz.profit || 0) + (sJb.profit || 0))).toFixed(2));
  ok(kpiOf(sAll, '广告花费') !== '—', '④全部平台广告花费正常显示（非 —）', kpiOf(sAll, '广告花费'));

  // ================= ⑤ 与地区筛选正交 =================
  await pickPlatform(2);
  const euIdx = (await page.evaluate(SNAP)).regionOptions.findIndex(o => /欧盟/.test(o));
  if (euIdx >= 0) {
    await openDD('ddRegion');
    await page.click(`#ddRegionList .dd-opt:nth-child(${euIdx + 1})`);
    await page.waitForTimeout(500);
    const sJbEu = await page.evaluate(SNAP);
    const euCcs = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PL', 'SE'];
    const srcEu = JBY.rows.filter(r => euCcs.indexOf(r.cc) >= 0).reduce((a, r) => a + (+r.sessions || 0), 0);
    ok(Math.abs(sJbEu.tot.sessions - srcEu) <= 1.5, '⑤JoyBuy + 地区=欧盟 → 仅欧盟站点（UK 被排除）',
      sJbEu.tot.sessions.toFixed(1) + ' vs 源欧盟 ' + srcEu.toFixed(1));
    ok(sJbEu.tot.sessions < jb.sessions, '⑤选欧盟后 Sessions 确实变少（筛选真的生效）',
      sJbEu.tot.sessions.toFixed(1) + ' < ' + jb.sessions.toFixed(1));
    // 复位：地区回全部
    await openDD('ddRegion');
    await page.click('#ddRegion .dd-tools .btn');
    await page.waitForTimeout(450);
  } else {
    ok(false, '⑤找不到「欧盟」地区选项（地区下拉结构变了）');
  }

  // ================= ⑥ 稳健性 =================
  const sEnd = await page.evaluate(SNAP);
  ok(sEnd.nan === 0 && sEnd.undef === 0, '⑥全程无 NaN/undefined', 'NaN=' + sEnd.nan + ' undef=' + sEnd.undef);
  ok(errs.length === 0, '⑥加载与交互全程无 JS 报错', errs.slice(0, 2).join(' | ') || '(none)');

  // 模板与产物都带平台筛选（只改模板不重建会 FAIL）
  const tpl = fs.readFileSync(path.join(BASE, 'monthly_dashboard_template.html'), 'utf8');
  const out = fs.readFileSync(path.join(BASE, 'monthly.html'), 'utf8');
  for (const [label, src] of [['模板', tpl], ['monthly.html', out]]) {
    ok(src.indexOf('id="ddPlatform"') >= 0 && src.indexOf('platOf') >= 0, '⑥' + label + ' 含平台筛选结构', '');
    const calls = (src.match(/rowMatch\(r,\s*\{\s*channel:\s*selChannel,/g) || []).length;
    const withPlat = (src.match(/rowMatch\(r,\s*\{\s*channel:\s*selChannel,\s*plat:\s*selPlatform,/g) || []).length;
    ok(calls > 0 && calls === withPlat, '⑥' + label + ' rowMatch 无漏传 plat', calls + '/' + withPlat);
  }

  await ctx.close();
  await browser.close();
  console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  if (bad.length) { console.log('\n失败明细:'); bad.forEach(b => console.log('  ✗ ' + b)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
