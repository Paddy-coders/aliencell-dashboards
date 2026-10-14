// 筛选确认栏 + KPI 图表化 功能测试（daily/monthly/target）
// 用法: NODE_PATH=<node workspace> node test_confirm_bar.js
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = __dirname;
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      const bufs = []; res.on('data', c => bufs.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  let mapData = { catalog: [], asinMap: [] };
  try {
    const rows = await fetchJson('https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1',
      { 'apikey': 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s', 'Authorization': 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s' });
    mapData = rows[0].data;
    console.log('云端映射: ' + mapData.asinMap.length + ' 条');
  } catch (e) { console.log('警告: 云端映射获取失败, 使用空映射'); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript((md) => {
    localStorage.setItem('pc_catalog', JSON.stringify(md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(md.asinMap));
    // ⚠️ 稳定化修复（2026-10-12 补）：必须预注入 pc_woot（空数组）。
    // 否则页面的 cloudWootSync 拉到云端 Woot 数据后写缓存并 location.reload()，
    // 会在「Ctrl 多选」中途把页面刷掉 → 选中被清空（摘要回落成「全部」）→ 后续点击拿不到元素直接崩。
    localStorage.setItem('pc_woot', JSON.stringify([]));
  }, mapData);
  const page = await ctx.newPage();
  // ⚠️ 稳定化修复（2026-10-12 补）：把所有云端**只读**接口拦成本地空响应。
  // 页面见到空映射/空 Woot 会自行 return（不覆盖本地、不 reload）；否则一旦云端数据与本地不一致，
  // 页面会「写缓存 → location.reload()」，把点击序列打断（症状：点击时元素消失、选中被清空、Protocol error）。
  await ctx.route('**://oovvqvgrjqwogjwswaxx.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // 通用: 打开下拉 → 点全选 → 验证; 点清空 → 验证; 单选/Ctrl多选 → 验证
  async function testDropdown(page, label, ddId, summaryId) {
    console.log('  -- ' + label);
    await page.click('#' + ddId + ' > .dd-btn');
    await page.waitForTimeout(150);
    const panelOpen = await page.$eval('#' + ddId, el => el.classList.contains('open'));
    ok(panelOpen, label + ': 面板展开');

    // 初始摘要
    let sum = await page.$eval('#' + summaryId, el => el.textContent.trim());
    ok(sum === '全部' || /^已选/.test(sum), label + ': 初始摘要正常 (' + sum + ')');

    const optCount = await page.$$eval('#' + ddId + ' .dd-opt:not(.dim)', els => els.length);

    // 全选
    await page.click('#' + ddId + ' .dd-tools .btn.primary');
    await page.waitForTimeout(150);
    sum = await page.$eval('#' + summaryId, el => el.textContent.trim());
    ok(/^已选 \d+\/\d+ 项$/.test(sum), label + ': 全选后摘要=' + sum);
    const checkedCount = await page.$$eval('#' + ddId + ' .dd-opt input:checked', els => els.length);
    ok(checkedCount > 0 && checkedCount === optCount, label + ': 全选后 checkbox 全勾 (' + checkedCount + '/' + optCount + ')');

    // 清空
    await page.click('#' + ddId + ' .dd-tools .btn:not(.primary)');
    await page.waitForTimeout(150);
    sum = await page.$eval('#' + summaryId, el => el.textContent.trim());
    ok(sum === '全部', label + ': 清空后摘要=' + sum);
    const checkedAfter = await page.$$eval('#' + ddId + ' .dd-opt input:checked', els => els.length);
    ok(checkedAfter === 0, label + ': 清空后无勾选');

    // 单选
    await page.click('#' + ddId + ' .dd-opt:not(.dim)');
    await page.waitForTimeout(150);
    sum = await page.$eval('#' + summaryId, el => el.textContent.trim());
    ok(/^已选 1\/\d+ 项$/.test(sum), label + ': 单选摘要=' + sum);

    // Ctrl 多选
    if (optCount >= 2) {
      await page.keyboard.down('Control');
      await page.click('#' + ddId + ' .dd-opt:not(.dim) >> nth=1');
      await page.keyboard.up('Control');
      await page.waitForTimeout(150);
      sum = await page.$eval('#' + summaryId, el => el.textContent.trim());
      ok(/^已选 2\/\d+ 项$/.test(sum), label + ': Ctrl多选摘要=' + sum);
    }

    // 恢复: 清空
    await page.click('#' + ddId + ' .dd-tools .btn:not(.primary)');
    await page.click('#' + ddId + ' > .dd-btn'); // 收起
    await page.waitForTimeout(100);
  }

  // ================= daily.html =================
  console.log('\n===== daily.html 筛选确认栏 =====');
  await page.goto('file:///' + path.join(BASE, '_deploy', 'daily.html'));
  await page.waitForTimeout(800);
  await testDropdown(page, '国家下拉', 'ddCountry', 'ddCountrySummary');
  await testDropdown(page, 'ASIN下拉', 'ddAsin', 'ddAsinSummary');
  await testDropdown(page, '系列下拉', 'ddSeries', 'ddSeriesSummary');

  // ================= monthly.html =================
  console.log('\n===== monthly.html 筛选确认栏 =====');
  await page.goto('file:///' + path.join(BASE, '_deploy', 'monthly.html'));
  await page.waitForTimeout(800);
  await testDropdown(page, '月份下拉', 'ddMonth', 'ddMonthSummary');
  await testDropdown(page, '地区下拉', 'ddRegion', 'ddRegionSummary');
  await testDropdown(page, '国家下拉', 'ddCountry', 'ddCountrySummary');

  // 地区全选 → 国家自动同步
  await page.click('#ddRegion > .dd-btn');
  await page.waitForTimeout(150);
  await page.click('#ddRegion .dd-tools .btn.primary');
  await page.waitForTimeout(200);
  const cSum = await page.$eval('#ddCountrySummary', el => el.textContent.trim());
  ok(/^已选 \d+/.test(cSum), 'monthly: 地区全选→国家自动同步 (' + cSum + ')');
  await page.click('#ddRegion .dd-tools .btn:not(.primary)');
  await page.click('#ddRegion > .dd-btn');

  // ================= target.html =================
  console.log('\n===== target.html 筛选确认栏 =====');
  await page.goto('file:///' + path.join(BASE, '_deploy', 'target.html'));
  await page.waitForTimeout(800);
  // ⚠️ 2026-10-12：target 默认平台已改为「🌐 全部平台」，该视图下 **ASIN 筛选是隐藏的**
  //（亚马逊维度，混平台下不适用）⇒ 本段要测 ASIN 下拉必须先钉住 Amazon。
  await page.evaluate(() => { setPlatform('amazon'); });
  await page.waitForTimeout(500);
  await testDropdown(page, '月份下拉', 'ddMonth', 'ddMonthSummary');
  await testDropdown(page, '地区下拉', 'ddCountry', 'ddCountrySummary');
  await testDropdown(page, 'ASIN下拉', 'ddAsin', 'ddAsinSummary');

  console.log('\n===== target.html KPI 图表化 =====');
  const kpiCount = await page.$$eval('.kpi', els => els.length);
  ok(kpiCount === 8, 'KPI 卡片共 ' + kpiCount + ' 张 (期望8)');
  const kpiWithSvg = await page.$$eval('.kpi', els => els.filter(e => e.querySelector('svg')).length);
  ok(kpiWithSvg === 8, '全部 KPI 卡含 SVG 图表 (' + kpiWithSvg + '/8)');
  // 环形图 2 张（销量/销售额完成率）: svg 内含 2 个 circle
  const rings = await page.$$eval('.kpi svg', els => els.filter(s => s.querySelectorAll('circle').length === 2).length);
  ok(rings === 2, '环形完成率图 x' + rings + ' (期望2)');
  // 柱状图 6 张: svg 内含 rect
  const bars = await page.$$eval('.kpi svg', els => els.filter(s => s.querySelector('rect')).length);
  ok(bars === 6, '柱状图 x' + bars + ' (期望6)');
  // 完成率卡片文本含 %
  const pctTexts = await page.$$eval('.kpi', els => els.filter(e => /%$/.test((e.querySelector('.kpi-value')||{}).textContent || '')).length);
  ok(pctTexts >= 2, '完成率卡片显示百分比 x' + pctTexts);

  await browser.close();
  console.log('\n========== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e.message); process.exit(1); });
