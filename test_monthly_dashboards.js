// 月度数据看板 + 月度目标追踪看板 测试
// 用法: NODE_PATH=... node test_monthly_dashboards.js
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
  // 预取云端映射, 注入 localStorage (与云端一致 → cloudMapSync 不触发 reload)
  // 同时注入云端 Woot(data.woot): 缺这一项时页面的 cloudWootSync 会写本机后 location.reload(),
  // 测试中途丢执行上下文 → elementHandle.click 报 "Cannot find context" / 30s 超时（既有 flaky 根因）。
  let mapData = { catalog: [], asinMap: [], woot: [] };
  try {
    const rows = await fetchJson('https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1',
      { 'apikey': 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s', 'Authorization': 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s' });
    mapData = rows[0].data;
    console.log('云端映射: ' + mapData.asinMap.length + ' 条 | Woot: ' + ((mapData.woot || []).length) + ' 条');
  } catch (e) { console.log('警告: 云端映射获取失败, 使用空映射'); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // ⚠️ pc_woot_cfg 必须一起种(2026-10-10 Woot 成本上云后新增的坑): 云端 mapping 里现在有 wootCfg,
  //   只种 pc_woot 会让页面的 cloudWootSync 判定"本机没有 / 云端有" → 写本机缓存 + **location.reload()**,
  //   测试中途页面重载 → elementHandle.click 报 "Element is not attached to the DOM",
  //   或点击生效但选中态被重载清掉(表现为「系列单选生效」莫名 FAIL)。两边种子必须与云端一致。
  await ctx.addInitScript((md) => {
    localStorage.setItem('pc_catalog', JSON.stringify(md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(md.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(md.woot || []));
    // pc_woot_cfg 必须**复刻看板的规范化结果**(键顺序 {price, cost} + price 兜底 1380) ——
    //   看板 cloudWootSync 比的是 JSON.stringify 字符串, 直接种原始对象会因键顺序/兜底不同而永不相等,
    //   于是每次加载都 write+location.reload() → 测试中途重载
    const c = md.wootCfg && typeof md.wootCfg === 'object' ? md.wootCfg : null;
    localStorage.setItem('pc_woot_cfg', JSON.stringify(c ? {
      price: Number(c.price) > 0 ? Number(c.price) : 1380,
      cost: (c.cost && typeof c.cost === 'object') ? c.cost : {},
    } : null));
  }, mapData);

  // ================= 月度数据看板 =================
  console.log('\n===== monthly.html =====');
  {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + path.join(BASE, 'monthly.html'));
    await page.waitForTimeout(600);

    ok(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0] : ''));
    ok((await page.title()).includes('月度数据看板'), '页面标题正确');

    // 月份行
    const rowTexts = await page.$$eval('#tableWrap tbody tr', trs => trs.map(t => t.textContent));
    ok(rowTexts.some(t => t.includes('2026年7月')), '表格含 2026年7月 行');
    { // 当前自然月动态断言 (硬编码月份会随时间过期)
      const now = new Date();
      const curYm = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
      ok(rowTexts.some(t => t.includes(curYm) && t.includes('进行中')), curYm + ' 标注进行中');
    }
    ok(rowTexts.some(t => t.includes('2026年6月') && t.includes('部分月')), '2026年6月 标注部分月');
    ok(rowTexts.some(t => t.includes('合计')), '表格含合计行');

    // KPI 卡
    const kpiCount = await page.$$eval('.kpi', els => els.length);
    ok(kpiCount === 5, 'KPI 5 卡显示 (实际 ' + kpiCount + ')');
    const kpiText = await page.$eval('#kpiRow', el => el.textContent);
    ok(/订单量/.test(kpiText) && /销售额/.test(kpiText), 'KPI 含订单量/销售额');

    // 7月订单量 > 0 (取 7月行的订单量列)
    const julUnits = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
      for (const tr of trs) if (tr.textContent.includes('2026年7月')) {
        const tds = [...tr.querySelectorAll('td')];
        // 列序: 月份, sessions, mob, brw, pv, units(第5列 idx5), ...
        return tds[5].textContent;
      }
      return '';
    });
    ok(julUnits && julUnits !== '—' && Number(julUnits.replace(/,/g, '')) > 0, '2026年7月 订单量 > 0 (值=' + julUnits + ')');

    // 筛选联动: 选系列 X1系列 → 国家面板非 US 置灰
    await page.click('#ddSeries .dd-btn');
    await page.waitForTimeout(200);
    const seriesOpt = await page.$$('#ddSeriesList .dd-opt');
    let clicked = false;
    for (const o of seriesOpt) {
      const t = await o.textContent();
      if (t.includes('X1系列')) { await o.click(); clicked = true; break; }
    }
    ok(clicked, '选择产品系列 X1系列');
    await page.waitForTimeout(300);
    const dimCountries = await page.evaluate(() => {
      // 打开国家面板读取 (无数据国家已隐藏, 不再置灰)
      const list = document.querySelectorAll('#ddCountryList .dd-opt');
      return [...list].filter(o => o.className.includes('dim')).length;
    });
    const visCountries = await page.$$eval('#ddCountryList .dd-opt', els => els.length);
    ok(visCountries >= 1 && visCountries < 13, '选 X1系列 后无数据国家隐藏 (可见 ' + visCountries + '/13)');
    ok(dimCountries === 0, '无数据国家隐藏后无置灰项 (dim=' + dimCountries + ')');
    const badge = await page.$eval('#rangeBadge', el => el.textContent);
    ok(badge.includes('个月'), '范围角标更新: ' + badge);

    // 单击唯一已选项 = 清空 (选项点击后面板保持展开, 仅在关闭时才点按钮)
    const seriesOpen = await page.$eval('#ddSeries', el => el.classList.contains('open'));
    if (!seriesOpen) await page.click('#ddSeries .dd-btn');
    await page.waitForTimeout(200);
    const selOpt = await page.$$eval('#ddSeriesList .dd-opt.sel', els => els.map(e => e.textContent));
    ok(selOpt.length === 1 && selOpt[0].includes('X1系列'), '系列单选生效 (sel=' + JSON.stringify(selOpt) + ')');
    // 再点一次同项 → 清空
    for (const o of await page.$$('#ddSeriesList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('X1系列')) { await o.click(); break; }
    }
    await page.waitForTimeout(200);
    const summary = await page.$eval('#ddSeriesSummary', el => el.textContent);
    ok(summary === '全部', '单击唯一已选系列 → 清空回全部 (summary=' + summary + ')');

    // 月份筛选: 只选 2026年7月 (选项文本为 "2026年7月", 非ym格式)
    await page.click('#ddMonth .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddMonthList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('2026年7月')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);
    const rowCount = await page.$$eval('#tableWrap tbody tr', trs => trs.filter(t => t.textContent.includes('2026年') && !t.textContent.includes('合计')).length);
    ok(rowCount === 1, '只选 2026-07 → 仅 1 个月度行 (实际 ' + rowCount + ')');

    // 地区筛选 (NA/EU/UK/JP/AU 五地区, 在国家之前)
    // 先确保国家面板关闭
    const cOpenPre = await page.$eval('#ddCountry', el => el.classList.contains('open'));
    if (cOpenPre) { await page.click('#ddCountry .dd-btn'); await page.waitForTimeout(150); }
    await page.click('#ddRegion .dd-btn');
    await page.waitForTimeout(200);
    const regionOptsM = await page.$$eval('#ddRegionList .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
    // 有数据地区动态计算(勿硬编码): 地区下拉只显示 ROWS 中出现过的地区
    const expectRegions = await page.evaluate(() => [...new Set(ROWS.map(r => regionOf(r.cc)))].sort());
    const expectNames = { NA: '北美地区', EU: '欧盟', UK: '英国', JP: '日本', AU: '澳大利亚' };
    ok(regionOptsM.length === expectRegions.length, '地区筛选只显示有数据地区 ' + expectRegions.join('+') + ' (实际 ' + regionOptsM.length + ': ' + regionOptsM.join(' / ') + ')');
    expectRegions.forEach(rc => ok(regionOptsM.some(t => t.includes(expectNames[rc] || rc) && t.includes(rc)), '地区含「' + (expectNames[rc] || rc) + ' ' + rc + '」'));
    const hiddenRcs = ['UK', 'JP', 'AU'].filter(rc => !expectRegions.includes(rc));
    ok(!regionOptsM.some(t => hiddenRcs.some(rc => t.includes(expectNames[rc]))), '无数据地区 ' + (hiddenRcs.join('/') || '无') + ' 隐藏');
    // 选北美地区 NA → 自动选中该地区内有数据的国家
    for (const o of await page.$$('#ddRegionList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('北美地区')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);
    const regionSelM = await page.evaluate(() => selRegion.size === 1 && selRegion.has('NA'));
    const regionSumM = await page.$eval('#ddRegionSummary', el => el.textContent);
    ok(regionSelM && /^已选 1\/\d+ 项$/.test(regionSumM), '地区选中 NA (摘要=' + regionSumM + ')');
    const ctrySelR = await page.evaluate(() => selCountry.size > 0 && selCountry.has('US'));
    const ctrySumR = await page.$eval('#ddCountrySummary', el => el.textContent);
    ok(ctrySelR && /^已选 \d+\/\d+ 项$/.test(ctrySumR), '选 NA → 国家自动选中(含US) (摘要=' + ctrySumR + ')');
    // 再点一次北美地区 → 清空
    const rOpenM = await page.$eval('#ddRegion', el => el.classList.contains('open'));
    if (!rOpenM) await page.click('#ddRegion .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddRegionList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('北美地区')) { await o.click(); break; }
    }
    await page.waitForTimeout(200);
    const regionSumM2 = await page.$eval('#ddRegionSummary', el => el.textContent);
    ok(regionSumM2 === '全部', '单击唯一已选地区 → 清空回全部: ' + regionSumM2);
    // 反向联动: 选国家 美国 → 地区自动同步为 NA
    await page.click('#ddCountry .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('美国')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);
    const regionSelUS = await page.evaluate(() => selRegion.size === 1 && selRegion.has('NA'));
    const regionSumUS = await page.$eval('#ddRegionSummary', el => el.textContent);
    ok(regionSelUS && /^已选 1\/\d+ 项$/.test(regionSumUS), '选 美国 → 地区自动=NA (摘要=' + regionSumUS + ')');
    // 清回国家: 单击唯一已选美国
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('美国')) { await o.click(); break; }
    }
    await page.waitForTimeout(200);
    // 关闭国家面板 (后续 Ctrl 多选测试会再次点开)
    const cOpenEnd = await page.$eval('#ddCountry', el => el.classList.contains('open'));
    if (cOpenEnd) await page.click('#ddCountry .dd-btn');

    // Ctrl 多地区: 先选美国, 再到地区面板 Ctrl+点欧盟 → NA+EU, 国家自动=US/CA/DE
    await page.click('#ddCountry .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('美国')) { await o.click(); break; }
    }
    await page.waitForTimeout(150);
    // 选美国后国家列表只剩 NA 内国家(德国隐藏), 需经地区面板 Ctrl 追加欧盟
    const cOptsNA = await page.$$eval('#ddCountryList .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
    ok(!cOptsNA.some(t => t.includes('德国')), '选美国后国家列表隐藏地区外国家(无德国)');
    const rOpenMlt = await page.$eval('#ddRegion', el => el.classList.contains('open'));
    if (!rOpenMlt) await page.click('#ddRegion .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddRegionList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('欧盟')) { await o.click({ modifiers: ['Control'] }); break; }
    }
    await page.waitForTimeout(300);
    const ctryMulti = await page.evaluate(() => selCountry.has('US') && selCountry.has('DE'));
    const countrySummary = await page.$eval('#ddCountrySummary', el => el.textContent);
    ok(ctryMulti && /^已选 \d+\/\d+ 项$/.test(countrySummary), 'Ctrl+地区 多选 → 国家含 US+DE (摘要=' + countrySummary + ')');
    const regionMulti = await page.evaluate(() => selRegion.has('NA') && selRegion.has('EU'));
    const regionSumMulti = await page.$eval('#ddRegionSummary', el => el.textContent);
    ok(regionMulti && /^已选 2\/\d+ 项$/.test(regionSumMulti), 'Ctrl+多选地区 → NA+EU (摘要=' + regionSumMulti + ')');
    // 关闭地区面板
    const rOpenEnd2 = await page.$eval('#ddRegion', el => el.classList.contains('open'));
    if (rOpenEnd2) await page.click('#ddRegion .dd-btn');

    // KPI 卡替换: 点第一张卡的 ✎ 再选指标
    await page.click('.kpi-edit >> nth=0');
    await page.waitForTimeout(200);
    const ddOpen = await page.$eval('.kpi-dropdown.open', el => !!el).catch(() => false);
    ok(!!ddOpen, 'KPI 下拉可打开');
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 300);
    await page.waitForTimeout(150);

    // ASIN 联动: 选一个 ASIN → 系列收窄
    // 先清国家: 打开国家面板 → 单击唯一已选的美国 → 清空
    const countryOpen = await page.$eval('#ddCountry', el => el.classList.contains('open'));
    if (!countryOpen) await page.click('#ddCountry .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('美国')) { await o.click(); break; }
    }
    await page.waitForTimeout(200);
    // 再打开 ASIN 面板选第一项
    const asinOpen = await page.$eval('#ddAsin', el => el.classList.contains('open'));
    if (!asinOpen) await page.click('#ddAsin .dd-btn');
    await page.waitForTimeout(200);
    const firstAsin = await page.$eval('#ddAsinList .dd-opt .opt-name', el => el.textContent.trim());
    await page.click('#ddAsinList .dd-opt >> nth=0');
    await page.waitForTimeout(300);
    // ASIN 收窄体现在系列选项列表范围 (scope), 摘要仅反映手动选择
    const serOpen2 = await page.$eval('#ddSeries', el => el.classList.contains('open'));
    if (!serOpen2) await page.click('#ddSeries .dd-btn');
    await page.waitForTimeout(200);
    const seriesOptsAfterAsin = await page.$$eval('#ddSeriesList .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
    ok(seriesOptsAfterAsin.length >= 1 && seriesOptsAfterAsin.length <= 3,
      '选 ASIN(' + firstAsin + ') 后系列选项收窄 (' + seriesOptsAfterAsin.length + ' 个: ' + seriesOptsAfterAsin.join(',') + ')');

    await page.close();
  }

  // ================= 月度目标追踪看板 =================
  console.log('\n===== target.html =====');
  {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + path.join(BASE, 'target.html'));
    await page.waitForTimeout(600);
    // ⚠️ 2026-10-12：target 默认平台已改为「🌐 全部平台」（会影响地区列文案与行数）；
    // 本段断言全部基于 **Amazon 目标视图** ⇒ 显式钉住平台。
    await page.evaluate(() => { setPlatform('amazon'); });
    await page.waitForTimeout(500);

    ok(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0] : ''));
    ok((await page.title()).includes('月度目标追踪'), '页面标题正确');

    const bannerVisible = await page.$eval('#sampleBanner', el => el.style.display !== 'none');
    ok(!bannerVisible, '正式目标表时示例提示条隐藏');

    const targetRows = await page.$$eval('#tableWrap tbody tr', trs => trs.filter(t => !t.textContent.includes('合计') && !t.textContent.includes('暂无目标') && !t.textContent.includes('无目标行')));
    ok(targetRows.length >= 20, '目标行渲染 (实际 ' + targetRows.length + ' 条)');
    ok(targetRows.some(t => t.includes('合计')) === false, '合计行单独存在');

    const allText = await page.$eval('#tableWrap', el => el.textContent);
    ok(allText.includes('合计'), '含合计行');
    // 人民币 & 广告占比
    ok(allText.includes('¥'), '销售额为人民币¥显示');
    ok(allText.includes('目标占比') && allText.includes('实际占比'), '含广告占比目标/实际列');
    ok(allText.includes('占比') && (allText.includes('达标') || allText.includes('超标')), '广告占比有达标/超标判定');
    // 地区筛选 (NA/EU/UK/JP/AU 五地区口径, US/CA/MX 合并为 NA; 仅渲染有数据/目标的地区)
    const regionOpts = await page.$$eval('#ddCountryList .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
    ok(regionOpts.length >= 2 && regionOpts.length <= 5, '地区选项为地区口径 (实际 ' + regionOpts.length + ': ' + regionOpts.join(' / ') + ')');
    ok(regionOpts.some(t => t.includes('北美地区') && t.includes('NA')), '含「北美地区 NA」');
    ok(regionOpts.some(t => t.includes('欧盟') && t.includes('EU')), '含「欧盟 EU」');
    ok(!regionOpts.some(t => t.includes('美国') || t.includes('加拿大') || t.includes('墨西哥') || t.includes('德国') || t.includes('法国')), 'US/CA/MX/DE/FR 不再独立出现 (合并为地区)');
    ok(allText.includes('北美地区'), '表格地区列含「北美地区」(NA 目标行)');
    // 状态种类
    ok(allText.includes('未匹配'), '含「未匹配」状态 (测试产品)');
    const hasOngoingSt = allText.includes('领先') || allText.includes('落后');
    ok(hasOngoingSt, '含进行中状态 (领先/落后)');
    ok(allText.includes('2026-08'), '含 2026-08 目标 (进行中月)');
    ok(/预测/.test(allText) || allText.includes('—'), '预测列存在');

    // 进度条
    const bars = await page.$$eval('.prog .bar', els => els.length);
    ok(bars > 10, '进度条渲染 (实际 ' + bars + ' 个)');

    // KPI 8 卡
    const kpiCount = await page.$$eval('#kpiRow .kpi', els => els.length);
    ok(kpiCount === 8, 'KPI 8 卡 (实际 ' + kpiCount + ')');
    const kpiText = await page.$eval('#kpiRow', el => el.textContent);
    ok(/目标销量/.test(kpiText) && /销量完成率/.test(kpiText) && /销售额完成率/.test(kpiText), 'KPI 含目标/实际/完成率');
    ok(/目标广告占比/.test(kpiText) && /实际广告占比/.test(kpiText), 'KPI 含广告占比目标/实际');

    // 7月已完结目标应有达标或未达标判定
    ok(allText.includes('达标') || allText.includes('未达标'), '已完结月有达标/未达标判定');

    // 筛选联动: 选地区 欧盟EU → 仅显示 EU 目标行 (NA 行被过滤)
    await page.click('#ddCountry .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('欧盟')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);
    const rowsAfterEU = await page.$$eval('#tableWrap tbody tr', trs => trs.filter(t => !t.textContent.includes('合计') && !t.textContent.includes('无目标行')).map(t => t.textContent));
    ok(rowsAfterEU.length > 0 && rowsAfterEU.every(t => t.includes('欧盟 EU')), '选 欧盟EU 后仅剩 EU 目标行 (实际 ' + rowsAfterEU.length + ' 行)');

    // 清回全部 (面板仍展开, 仅在关闭时才点按钮)
    const cOpen2 = await page.$eval('#ddCountry', el => el.classList.contains('open'));
    if (!cOpen2) await page.click('#ddCountry .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddCountryList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('欧盟')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);

    // 月份筛选: 只看 2026-08
    await page.click('#ddMonth .dd-btn');
    await page.waitForTimeout(200);
    for (const o of await page.$$('#ddMonthList .dd-opt')) {
      const t = await o.textContent();
      if (t.includes('2026-08')) { await o.click(); break; }
    }
    await page.waitForTimeout(300);
    const julGone = await page.$$eval('#tableWrap tbody tr', trs => trs.some(t => t.textContent.includes('2026-07') && !t.textContent.includes('合计')));
    ok(!julGone, '只选 2026-08 后 7月目标行隐藏');

    // 产品名筛选联动: 选一个产品名 → 目标行只剩该产品
    await page.click('#ddName .dd-btn');
    await page.waitForTimeout(200);
    const nameOpt = await page.$eval('#ddNameList .dd-opt .opt-name', el => el.textContent.trim());
    await page.click('#ddNameList .dd-opt >> nth=0');
    await page.waitForTimeout(300);
    const rowsFiltered = await page.$$eval('#tableWrap tbody tr', trs => trs.filter(t => t.textContent.includes('2026-08') && !t.textContent.includes('合计')).map(t => t.textContent));
    const badRows = rowsFiltered.filter(t => !t.includes(nameOpt)).map(t => t.replace(/\s+/g, ' ').slice(0, 100));
    if (badRows.length) console.log('    [debug] 不含 ' + nameOpt + ' 的行:', JSON.stringify(badRows));
    ok(rowsFiltered.length >= 1 && rowsFiltered.every(t => t.includes(nameOpt)), '选产品名(' + nameOpt + ') 后目标行收窄且仅该产品 (实际 ' + rowsFiltered.length + ' 行)');

    await page.close();
  }

  // ================= 壳页面 =================
  console.log('\n===== index.html (壳) =====');
  {
    const page = await ctx.newPage();
    // 认证守卫(2026-08-25上线): 注入 wb_auth stub + auth 校验返回 200, 否则同步守卫重定向 login.html 导致 .nav-item 不存在
    await page.route('**/auth/v1/user', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"email":"test@aliencell.com","role":"viewer"}' }));
    await page.addInitScript(() => {
      try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'stub-token', refresh_token: 'stub-refresh', expires_at: Date.now() + 3600000, user: { email: 'test@aliencell.com' }, role: 'viewer' })); } catch (e) {}
    });
    await page.goto('file:///' + path.join(BASE, '_deploy', 'index.html'));
    await page.waitForTimeout(500);
    const navItems = await page.$$eval('.nav-item', els => els.map(e => e.textContent));
    // 导航项数会随看板增加而变（JoyBuy 入口 2026-09 加入后由 5 → 6），
    // 因此断言「>=5 且五个核心入口都在」，不再写死数量（写死必然过期）。
    const CORE_NAV = ['每日数据', '广告周度分析', '周度汇总数据', '月度数据', '月度目标追踪'];
    const missingNav = CORE_NAV.filter(k => !navItems.some(t => t.includes(k)));
    ok(navItems.length >= 5 && missingNav.length === 0,
      '导航含 5 个核心看板 (实际 ' + navItems.length + ' 项: ' + navItems.map(t => t.trim()).join('/') + ')');
    ok(navItems.some(t => t.includes('月度数据')), '导航含「月度数据」');
    ok(navItems.some(t => t.includes('月度目标追踪')), '导航含「月度目标追踪」');
    const targetIdx = navItems.findIndex(t => t.includes('月度目标追踪'));
    await page.click('.nav-item >> nth=' + targetIdx);
    await page.waitForTimeout(800);
    const frameSrc = await page.$eval('#frame', el => el.getAttribute('src'));
    ok(typeof frameSrc === 'string' && frameSrc.startsWith('target.html'), '点击月度目标追踪 → iframe 加载 target.html (实际 ' + frameSrc + ')'); // ?v= 版本号 2026-09-14 起存在
    await page.close();
  }

  await browser.close();
  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
