// test_target_platform.js — target.html 平台筛选(🌐全部平台 / Amazon / JoyBuy / 速卖通) + JoyBuy 月度数据注入 回归测试
//
// 覆盖：
//   ① 页面无 JS 报错；平台下拉含四项；**默认 = 🌐 全部平台**（用户 2026-10-12 要求：进去默认展示所有站点平台数据之和）
//   ② 全部平台视图：= Amazon 目标行 + JoyBuy 实际行；KPI 8 卡；站点口径地区列；ASIN 筛选隐藏；合计行区分目标/实际
//   ③ 切 Amazon：无回归（KPI 8 卡含广告占比、目标行数、地区/月份维度、ASIN 筛选恢复）
//   ④ 切 JoyBuy：KPI 后两卡换成 店铺流量/加购、目标列为空、表格按实际数据展示、地区列显示站点
//   ⑤ JoyBuy 数值正确性：表格销售额合计 = joybuy_monthly.json 站点口径（按站点×月核对）
//   ⑥ 切速卖通：显示「尚未接入」占位、0 数据行、无 KPI
//   ⑦ 切回 🌐 全部平台 / Amazon：内容恢复（证明平台切换不破坏原视图）
//   ⑧ JoyBuy 下国家/系列筛选生效且无报错
//
// 用法：NODE_PATH=... node test_target_platform.js
// 说明：只读本地 file:// 页面；云端 mapping 请求被本地假响应拦截，绝不触达生产数据。
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/target.html';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; fails.push(name); console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}
function lg(t) { console.log(t); }

(async () => {
  // 期望值：直接读构建产物（动态推导，不硬编码随时间变化的数据）
  const jby = JSON.parse(fs.readFileSync(path.join(BASE, 'joybuy_monthly.json'), 'utf8'));
  const tgtAll = JSON.parse(fs.readFileSync(path.join(BASE, 'monthly_targets.json'), 'utf8')).targets || [];
  const amzTargets = tgtAll.filter(t => !String(t.platform || '').trim() || String(t.platform).toLowerCase() === 'amazon').length;
  // 「全部平台」下的 JoyBuy 实际行 = (ym, 站点, 系列, 产品名) 去重后的组数
  const jbyGroupKeys = new Set((jby.rows || []).map(r => [r.ym, r.cc, r.series, r.name].join('|')));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // 云端只读接口一律拦成本地假响应（避免测试随线上数据漂移 / 触达生产）
  let cloudHits = 0;
  await ctx.route('**/rest/v1/mapping*', route => {
    cloudHits++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('wb_auth', JSON.stringify({ access_token: 't', user: { email: 't@example.com' } })); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const optTexts = (sel) => page.$$eval(sel + ' .dd-opt', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const kpiText = () => page.$eval('#kpiRow', e => e.textContent.replace(/\s+/g, ' ').trim());
  const rowsOf = () => page.$$eval('#tableWrap tbody tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim())));
  // 平台下拉顺序：🌐全部平台 / 🅰️Amazon / 🛒JoyBuy / 🧧速卖通
  const pickPlat = async (key) => {
    await page.click('#ddPlatform .dd-btn');
    await page.waitForTimeout(150);
    const idx = { all: 0, amazon: 1, joybuy: 2, aliexpress: 3 }[key];
    await page.evaluate(i => {
      const opts = document.querySelectorAll('#ddPlatformList .dd-opt');
      if (opts[i]) opts[i].click();
    }, idx);
    await page.waitForTimeout(500);
  };

  lg('===== ① 加载 + 平台下拉 =====');
  const platOpts = await optTexts('#ddPlatformList');
  ok(platOpts.length === 4, '平台下拉含 4 项', platOpts.join(' / '));
  ok(/全部平台/.test(platOpts[0] || ''),
    '首项为「🌐 全部平台」（所有站点平台数据之和）', platOpts[0] || '(空)');
  ok(/Amazon/.test(platOpts[1] || '') && /JoyBuy/.test(platOpts[2] || '') && /速卖通/.test(platOpts[3] || ''),
    '其余三项为 Amazon/JoyBuy/速卖通', platOpts.slice(1).join(' / '));
  const platSummary0 = await page.$eval('#ddPlatformSummary', e => e.textContent.trim());
  ok(/全部平台/.test(platSummary0), '默认平台 = 🌐 全部平台（不是 Amazon）', platSummary0);
  ok(errors.length === 0, '加载无 JS 报错', errors.join(' | ') || '(none)');

  lg('\n===== ② 全部平台视图（默认进入即所有站点平台之和）=====');
  const allRows = await rowsOf();
  const allBody = allRows.slice(0, -1);
  const allTotalRow = allRows[allRows.length - 1] || [];
  const allSiteRows = allBody.filter(r => /·/.test(r[1] || ''));
  const allKpiCount = await page.$$eval('#kpiRow .kpi', e => e.length);
  const allBadge = await page.$eval('#rangeBadge', e => e.textContent.trim());
  ok(allKpiCount === 8, '全部平台 KPI 8 卡（含广告占比）', String(allKpiCount));
  ok(allBody.length === amzTargets + jbyGroupKeys.size,
    '全部平台行数 = Amazon 目标行 + JoyBuy 实际行',
    allBody.length + ' = ' + amzTargets + ' + ' + jbyGroupKeys.size);
  ok(allSiteRows.length === jbyGroupKeys.size,
    'JoyBuy 站点行（地区列带「·」）齐全', allSiteRows.length + ' / ' + jbyGroupKeys.size);
  const allSiteCells = [...new Set(allSiteRows.map(r => r[1]))].sort();
  ok(allSiteCells.some(r => /DE|NL|FR|UK/.test(r)), '站点行地区列显示「地区 · 站点」', allSiteCells.join(','));
  ok(/条目标/.test(allTotalRow[2] || '') && /条实际行/.test(allTotalRow[2] || ''),
    '合计行区分「N 条目标 + M 条实际行」', allTotalRow[2] || '');
  ok(/全部平台/.test(allBadge) && /实际行/.test(allBadge), 'rangeBadge 标为全部平台（含实际行）', allBadge);
  ok(await page.$eval('#ddAsin', e => e.style.display === 'none'),
    '全部平台下 ASIN 筛选隐藏（亚马逊维度，混平台下不适用）');
  ok(/全部平台/.test(await page.$eval('#platBanner', e => e.textContent)), '全部平台顶部有口径说明条');
  // JoyBuy 行应带「流量 PDP UV」副行；Amazon 行不应带
  ok(allSiteRows.some(r => /流量\s*[\d,]+/.test(r[5] || '')), 'JoyBuy 行在销量列带「流量」副行');

  lg('\n===== ③ Amazon 视图无回归 =====');
  await pickPlat('amazon');
  const amzKpi = await kpiText();
  const amzKpiCount = await page.$$eval('#kpiRow .kpi', e => e.length);
  ok(amzKpiCount === 8, 'Amazon KPI 8 卡', String(amzKpiCount));
  ok(/目标广告占比/.test(amzKpi) && /实际广告占比/.test(amzKpi), 'Amazon KPI 含广告占比两卡');
  ok(/目标销量/.test(amzKpi) && /销售额完成率/.test(amzKpi), 'Amazon KPI 含目标销量/销售额完成率');
  const amzRows = await rowsOf();
  const amzTotalRow = amzRows[amzRows.length - 1] || [];
  ok(amzRows.length >= amzTargets * 0.9, 'Amazon 目标行数正常(含合计行)', 'rows=' + amzRows.length + ' 目标=' + amzTargets);
  ok(/条目标/.test(amzTotalRow[2] || '') && !/实际行/.test(amzTotalRow[2] || ''),
    'Amazon 合计行仍为「N 条目标」(不带实际行)', amzTotalRow[2] || '');
  const amzRegions = [...new Set(amzRows.slice(0, -1).map(r => r[1]))].sort();
  ok(amzRegions.some(r => /NA|EU|UK/.test(r)), 'Amazon 地区列仍为地区口径(NA/EU/UK)', amzRegions.join(','));
  ok(amzRegions.every(r => !/·/.test(r)), 'Amazon 视图无站点口径行（未被 JoyBuy 污染）');
  const amzHasAsinDD = await page.$eval('#ddAsin', e => e.style.display !== 'none');
  ok(amzHasAsinDD, 'Amazon 下 ASIN 筛选可见');

  lg('\n===== ④ 切 JoyBuy =====');
  await pickPlat('joybuy');
  const jbyKpi = await kpiText();
  const jbyKpiCount = await page.$$eval('#kpiRow .kpi', e => e.length);
  const jbyRows = await rowsOf();
  const jbyBody = jbyRows.slice(0, -1);
  ok(jbyKpiCount === 8, 'JoyBuy KPI 仍 8 卡（后两卡换指标）', String(jbyKpiCount));
  ok(/店铺流量/.test(jbyKpi) && /加购/.test(jbyKpi), 'JoyBuy KPI 后两卡 = 店铺流量/加购', jbyKpi.slice(-90));
  ok(!/实际广告占比/.test(jbyKpi), 'JoyBuy 不再显示广告占比卡');
  ok(jbyBody.length > 0, 'JoyBuy 表格有数据行(无目标时按实际展示)', 'rows=' + jbyBody.length);
  ok(/条实际行/.test((jbyRows[jbyRows.length - 1] || [])[2] || ''), 'JoyBuy 合计行标为「N 条实际行」', (jbyRows[jbyRows.length - 1] || [])[2] || '');
  const jbyRegionCells = [...new Set(jbyBody.map(r => r[1]))].sort();
  ok(jbyRegionCells.every(r => /·/.test(r)), 'JoyBuy 地区列显示「地区 · 站点」', jbyRegionCells.join(','));
  const jbyHasAsinDD = await page.$eval('#ddAsin', e => e.style.display !== 'none');
  ok(!jbyHasAsinDD, 'JoyBuy 下 ASIN 筛选隐藏(非亚马逊维度)');
  const jbyUvShown = jbyBody.some(r => /流量\s*[\d,]+/.test(r[5] || ''));
  ok(jbyUvShown, 'JoyBuy 实际销量列带「流量 PDP UV」副行');
  ok(/JoyBuy 数据来自/.test(await page.$eval('#platBanner', e => e.textContent)), 'JoyBuy 顶部有口径说明条');

  lg('\n===== ⑤ JoyBuy 数值核对 =====');
  // 取表格里 2026-09 × 欧盟 · DE 的产品行，按销售额求和，与 joybuy_monthly.json 站点口径比
  const sepDe = jbyBody.filter(r => /2026-09/.test(r[0]) && /DE/.test(r[1]));
  const expDe = jby.siteTotals.find(s => s.ym === '2026-09' && s.cc === 'DE') || {};
  const sumCny = sepDe.reduce((s, r) => {
    const m = (r[9] || '').match(/¥([\d,]+)/);
    return s + (m ? Number(m[1].replace(/,/g, '')) : 0);
  }, 0);
  const fx = await page.evaluate(() => (FX['2026-09'] || {}).EUR);
  const expCny = Math.round((expDe.sales || 0) * fx);
  ok(sepDe.length > 0, '2026-09 DE 有产品行', sepDe.length + ' 行');
  ok(Math.abs(sumCny - expCny) <= Math.max(2, expCny * 0.02),
    '2026-09 DE 各产品行销售额合计 = 站点口径 × 汇率',
    '表格 ' + sumCny + ' vs 期望 ' + expCny + ' (' + (expDe.sales || 0) + ' EUR × ' + fx + ')');
  // UK 9 月流量（PDP UV）应等于站点口径
  const sepUk = jbyBody.filter(r => /2026-09/.test(r[0]) && /UK/.test(r[1]));
  const sumUv = sepUk.reduce((s, r) => { const m = (r[5] || '').match(/流量\s*([\d,]+)/); return s + (m ? Number(m[1].replace(/,/g, '')) : 0); }, 0);
  const expUkUv = Math.round((jby.siteTotals.find(s => s.ym === '2026-09' && s.cc === 'UK') || {}).sessions || 0);
  ok(Math.abs(sumUv - expUkUv) <= Math.max(3, expUkUv * 0.03), '2026-09 UK 产品行流量合计 = 站点口径',
    '表格 ' + sumUv + ' vs 期望 ' + expUkUv);

  lg('\n===== ⑥ 切速卖通 =====');
  await pickPlat('aliexpress');
  const aliText = await page.$eval('#tableWrap', e => e.textContent.replace(/\s+/g, ' ').trim());
  const aliKpi = await page.$$eval('#kpiRow .kpi', e => e.length);
  ok(/尚未接入|待接入/.test(aliText), '速卖通显示未接入占位提示', aliText.slice(0, 70));
  ok(aliKpi === 0, '速卖通无 KPI 卡(无数据)', String(aliKpi));

  lg('\n===== ⑦ 切回 🌐 全部平台 =====');
  await pickPlat('all');
  const backAll = await rowsOf();
  ok(backAll.length === allRows.length, '切回全部平台行数与初始一致', backAll.length + ' vs ' + allRows.length);
  ok(/全部平台/.test(await page.$eval('#ddPlatformSummary', e => e.textContent)), '平台摘要恢复为全部平台');
  ok(errors.length === 0, '切换全程无 JS 报错', errors.join(' | ') || '(none)');

  lg('\n===== ⑧ 切 Amazon 再验证恢复 =====');
  await pickPlat('amazon');
  const backRows = await rowsOf();
  ok(backRows.length === amzRows.length, '切回 Amazon 行数与首次一致', backRows.length + ' vs ' + amzRows.length);
  ok(/目标广告占比/.test(await kpiText()), '切回 Amazon KPI 恢复广告占比卡');
  ok(await page.$eval('#ddAsin', e => e.style.display !== 'none'), '切回 Amazon 后 ASIN 筛选恢复可见');

  lg('\n===== ⑨ JoyBuy 筛选联动 =====');
  await pickPlat('joybuy');
  const platBefore = (await rowsOf()).length;
  await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(150);
  const cOpt = await optTexts('#ddCountryList');
  ok(cOpt.length === 2 && cOpt.some(t => /EU|欧盟/.test(t)) && cOpt.some(t => /UK|英国/.test(t)),
  'JoyBuy 地区下拉 = 欧盟 + 英国', cOpt.join(' / '));
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('#ddCountryList .dd-opt')].find(e => /UK|英国/.test(e.textContent));
    if (o) o.click();
  });
  await page.waitForTimeout(400);
  const afterCountry = await rowsOf();
  const onlyUk = afterCountry.slice(0, -1).every(r => /UK/.test(r[1]));
  ok(afterCountry.length > 0 && afterCountry.length < platBefore && onlyUk, 'JoyBuy 选「英国」后只剩 UK 行',
    afterCountry.length + ' 行 / ' + platBefore);
  // 系列筛选
  await page.click('#ddSeries .dd-btn');
  await page.waitForTimeout(150);
  const sOpts = await optTexts('#ddSeriesList');
  ok(sOpts.length > 0, 'JoyBuy 产品系列下拉有选项', sOpts.slice(0, 5).join(' / '));
  await page.evaluate(() => {
    const o = document.querySelector('#ddSeriesList .dd-opt');
    if (o) o.click();
  });
  await page.waitForTimeout(400);
  const afterSeries = await rowsOf();
  ok(afterSeries.length > 0 && afterSeries.length <= afterCountry.length, 'JoyBuy 选某系列后行数收窄',
    afterSeries.length + ' <= ' + afterCountry.length);
  ok(errors.length === 0, '全流程无 JS 报错', errors.join(' | ') || '(none)');

  lg('\n云端 mapping 请求被本地拦截次数: ' + cloudHits + '（未触达真实 Supabase）');
  lg('合计 ' + (pass + fail) + ' 项，通过 ' + pass + '，失败 ' + fail);
  if (fails.length) { lg('失败项: ' + fails.join('; ')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.error('FATAL: ' + e.message); process.exitCode = 1; });
