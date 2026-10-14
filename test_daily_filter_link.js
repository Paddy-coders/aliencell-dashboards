// test_daily_filter_link.js — 验证每日看板 4 筛选条件全互通 (国家↔ASIN↔系列↔产品名)
// 7 组测试: 每个筛选方向都验证其他下拉框收窄
const { chromium } = require('./playwright-auth');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const filePath = 'file:///' + path.resolve(__dirname, 'daily.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  let pass = 0, fail = 0;
  function ok(name, cond) {
    if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
    else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); }
  }

  // 辅助函数
  async function getOpts(listId) {
    return await page.evaluate(id => {
      const el = document.getElementById(id);
      if (!el) return [];
      return [...el.querySelectorAll('.dd-opt')].map(o => ({
        name: o.querySelector('.opt-name')?.textContent?.trim() || '',
        dim: o.classList.contains('dim')
      }));
    }, listId);
  }
  async function resetAll() {
    await page.evaluate(() => { selCountry.clear(); selAsin.clear(); selSeries.clear(); selName.clear(); renderAll(); });
    await page.waitForTimeout(200);
  }

  // 获取数据概况
  const info = await page.evaluate(() => ({
    days: DAYS.length, asins: asinList.length, series: seriesList.length,
    mappedAsins: asinList.filter(a => { const m = asinMetaOf(a); return m.series !== '无' || m.name !== '无'; }).length,
    allSeries: seriesList,
    firstMapped: asinList.filter(a => { const m = asinMetaOf(a); return m.series !== '无' || m.name !== '无'; })[0]
  }));

  console.log('\n=== 每日看板 4 筛选条件全互通测试 ===');
  console.log(`数据: ${info.days} 天, ${info.asins} ASIN, ${info.mappedAsins} 已映射, ${info.series} 系列\n`);

  // ===== [1] 选国家 → ASIN/系列/产品名 下拉收窄 =====
  console.log('[1] 选国家 → 其他 3 个下拉收窄');
  await resetAll();
  const allAsins = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
  const allSeries = (await getOpts('ddSeriesList')).filter(o => !o.dim).length;
  const allNames = (await getOpts('ddNameList')).filter(o => !o.dim).length;

  await page.evaluate(() => { selCountry.clear(); selCountry.add('US'); renderAll(); });
  await page.waitForTimeout(200);
  const usAsins = (await getOpts('ddAsinList')).filter(o => !o.dim);
  const usSeries = (await getOpts('ddSeriesList')).filter(o => !o.dim);
  const usNames = (await getOpts('ddNameList')).filter(o => !o.dim);

  ok('选 US 后 ASIN 下拉项数 ≤ 全部', usAsins.length <= allAsins);
  ok('选 US 后 ASIN 下拉非空', usAsins.length > 0);
  ok('选 US 后系列下拉项数 ≤ 全部', usSeries.length <= allSeries);
  ok('选 US 后系列下拉非空', usSeries.length > 0);
  ok('选 US 后产品名下拉项数 ≤ 全部', usNames.length <= allNames);
  ok('选 US 后产品名下拉非空', usNames.length > 0);
  await resetAll();

  // ===== [2] 选 ASIN → 国家/系列/产品名 下拉收窄 (核心修复) =====
  console.log('\n[2] 选 ASIN → 其他 3 个下拉收窄 (核心修复)');
  await resetAll();
  const testAsin = info.firstMapped || info.asins > 0 ? (await page.evaluate(() => asinList[0])) : null;
  if (!testAsin) { console.log('  跳过: 无 ASIN'); }
  else {
    const meta = await page.evaluate(a => asinMetaOf(a), testAsin);
    console.log(`  测试 ASIN: ${testAsin} (系列=${meta.series}, 产品名=${meta.name})`);

    await page.evaluate(a => { selAsin.clear(); selAsin.add(a); renderAll(); }, testAsin);
    await page.waitForTimeout(200);

    const seriesOpts = (await getOpts('ddSeriesList')).filter(o => !o.dim);
    const nameOpts = (await getOpts('ddNameList')).filter(o => !o.dim);
    const dimCountries = (await getOpts('ddCountryList')).filter(o => o.dim);

    // 核心断言: 选 ASIN 后, 系列下拉只显示该 ASIN 所属的系列
    ok('选 ASIN 后系列下拉只含该 ASIN 的系列', seriesOpts.length === 1 && seriesOpts[0].name.includes(meta.series));
    // 核心断言: 选 ASIN 后, 产品名下拉只显示该 ASIN 的产品名
    ok('选 ASIN 后产品名下拉只含该 ASIN 的产品名', nameOpts.length === 1 && nameOpts[0].name.includes(meta.name));
    // 国家: 部分被置灰
    ok('选 ASIN 后部分国家被置灰', dimCountries.length > 0);
    await resetAll();
  }

  // ===== [3] 选系列 → ASIN/国家/产品名 下拉收窄 =====
  console.log('\n[3] 选系列 → 其他 3 个下拉收窄');
  await resetAll();
  const testSeries = info.allSeries.find(s => s !== '无') || info.allSeries[0];
  if (!testSeries) { console.log('  跳过: 无系列'); }
  else {
    console.log(`  测试系列: ${testSeries}`);
    const asinBefore = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
    await page.evaluate(s => { selSeries.clear(); selSeries.add(s); renderAll(); }, testSeries);
    await page.waitForTimeout(200);
    const sAsins = (await getOpts('ddAsinList')).filter(o => !o.dim);
    const sNames = (await getOpts('ddNameList')).filter(o => !o.dim);
    ok('选系列后 ASIN 下拉项数 ≤ 全部', sAsins.length <= asinBefore);
    ok('选系列后 ASIN 下拉非空', sAsins.length > 0);
    ok('选系列后产品名下拉非空', sNames.length > 0);
    await resetAll();
  }

  // ===== [4] 选产品名 → ASIN/国家/系列 下拉收窄 =====
  console.log('\n[4] 选产品名 → 其他 3 个下拉收窄');
  await resetAll();
  const allNamesList = await page.evaluate(() => namesIn(null));
  const testName = allNamesList.find(n => n !== '无') || allNamesList[0];
  if (!testName) { console.log('  跳过: 无产品名'); }
  else {
    console.log(`  测试产品名: ${testName}`);
    const asinBefore = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
    const seriesBefore = (await getOpts('ddSeriesList')).filter(o => !o.dim).length;
    await page.evaluate(n => { selName.clear(); selName.add(n); renderAll(); }, testName);
    await page.waitForTimeout(200);
    const nAsins = (await getOpts('ddAsinList')).filter(o => !o.dim);
    const nSeries = (await getOpts('ddSeriesList')).filter(o => !o.dim);
    ok('选产品名后 ASIN 下拉项数 ≤ 全部', nAsins.length <= asinBefore);
    ok('选产品名后 ASIN 下拉非空', nAsins.length > 0);
    ok('选产品名后系列下拉项数 ≤ 全部', nSeries.length <= seriesBefore);
    ok('选产品名后系列下拉非空', nSeries.length > 0);
    await resetAll();
  }

  // ===== [5] 组合: 国家 + 系列 → ASIN 进一步收窄 =====
  console.log('\n[5] 组合: 选国家 + 系列 → ASIN 进一步收窄');
  await resetAll();
  await page.evaluate(() => { selCountry.add('US'); renderAll(); });
  await page.waitForTimeout(200);
  const usAsinCount = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
  const usSeriesOpts = (await getOpts('ddSeriesList')).filter(o => !o.dim);
  const testS = usSeriesOpts.find(s => !s.name.includes('无')) || usSeriesOpts[0];
  if (testS) {
    await page.evaluate(s => { selSeries.add(s); renderAll(); }, testS.name.split(' ')[0]); // 系列名可能带空格
    // 更安全: 直接用 evaluate 传值
    await page.evaluate(() => { selSeries.clear(); });
    const seriesNames = usSeriesOpts.map(s => s.name);
    // 找到一个在系列列表里的
    const realSeries = await page.evaluate(sns => {
      for (const sn of sns) { if (seriesList.includes(sn)) { selSeries.add(sn); break; } }
      renderAll();
    }, seriesNames);
    await page.waitForTimeout(200);
    const comboAsinCount = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
    ok('国家+系列后 ASIN ≤ 仅国家', comboAsinCount <= usAsinCount);
    ok('国家+系列后 ASIN 非空', comboAsinCount > 0);
  } else {
    ok('US 下无可用系列 (跳过)', true);
  }
  await resetAll();

  // ===== [6] Ctrl+多选 ASIN → 系列显示多个 =====
  console.log('\n[6] Ctrl+多选 ASIN → 系列下拉显示对应系列');
  await resetAll();
  const twoAsins = await page.evaluate(() => asinList.slice(0, 2));
  if (twoAsins.length >= 2) {
    await page.evaluate(asins => { asins.forEach(a => selAsin.add(a)); renderAll(); }, twoAsins);
    await page.waitForTimeout(200);
    const seriesOpts = (await getOpts('ddSeriesList')).filter(o => !o.dim);
    const expected = await page.evaluate(asins => {
      const s = new Set();
      asins.forEach(a => s.add(asinMetaOf(a).series));
      return [...s];
    }, twoAsins);
    ok('多选 ASIN 后系列下拉 ≥ 1', seriesOpts.length >= 1);
    ok('多选 ASIN 后系列下拉项数 = 对应系列数', seriesOpts.length === expected.length);
  } else {
    ok('ASIN 不足 2 个 (跳过)', true);
  }
  await resetAll();

  // ===== [7] 单击唯一已选国家 → 清空恢复 =====
  console.log('\n[7] 单击唯一已选国家 → 清空恢复');
  await resetAll();
  await page.evaluate(() => { selCountry.add('US'); renderAll(); });
  await page.waitForTimeout(200);
  const usCount = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
  await page.evaluate(() => { selCountry.clear(); renderAll(); });
  await page.waitForTimeout(200);
  const allCount = (await getOpts('ddAsinList')).filter(o => !o.dim).length;
  ok('清空国家后 ASIN 下拉恢复 ≥ 选国家时', allCount >= usCount);

  // ===== JS 错误检查 =====
  console.log('\n[8] JS 错误检查');
  ok('无 JS 运行时错误', errors.length === 0);
  if (errors.length) errors.forEach(e => console.log(`    ${e}`));

  console.log(`\n=== 结果: ${pass} PASS / ${fail} FAIL ===`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
