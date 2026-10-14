// 周度汇总看板(product.html) 地区筛选验证
// 用法: node test_product_region.js
//
// ⚠️ 2026-10-10 重写：原断言写的是「5 个地区固定 + 范围外国家置灰」，但看板后来改成
//    「只显示**有数据**的地区 + 选地区后**隐藏**范围外国家（不是置灰）」，
//    于是 5 项恒 FAIL（dim 永远是 0）。这里改为锁定当前真实语义，并全部动态取值，不写死地区数。
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = path.join(__dirname, '_deploy');
let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
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
  } catch (e) { console.log('警告: 云端映射获取失败'); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript((md) => {
    localStorage.setItem('pc_catalog', JSON.stringify(md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(md.asinMap));
  }, mapData);

  console.log('\n===== product.html (周度汇总) =====');
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///' + path.join(BASE, 'product.html'));
  await page.waitForTimeout(1200);

  ok(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0] : ''));
  ok(await page.$('#ddRegion') !== null, '存在地区筛选 ddRegion');

  // 期望的「有数据的地区」集合（动态，不写死）
  const exp = await page.evaluate(() => {
    const set = new Set(DATA.countries.filter(c => c.hasData).map(c => regionOf(c.code)));
    const ctryIn = (rc) => DATA.countries.filter(c => c.hasData && regionOf(c.code) === rc).map(c => c.code).sort();
    return { regions: [...set].sort(), NA: ctryIn('NA'), EU: ctryIn('EU'), UK: ctryIn('UK') };
  });

  // ① 地区选项 = 有数据的地区（无数据地区隐藏）
  await page.click('#ddRegion .dd-btn');
  await page.waitForTimeout(250);
  const regionOpts = await page.$$eval('#ddRegionList .dd-opt .opt-name', els => els.map(e => e.textContent.trim()));
  const shownCodes = regionOpts.map(t => (t.match(/\b(NA|EU|UK|JP|AU)\b/) || [])[1]).filter(Boolean).sort();
  ok(shownCodes.length === exp.regions.length && shownCodes.join() === exp.regions.join(),
    '地区选项 = 有数据的地区 (实际 ' + regionOpts.join(' / ') + ', 期望 ' + exp.regions.join(',') + ')');
  ok(regionOpts.some(t => t.includes('北美地区') && t.includes('NA')), '含「北美地区 NA」');
  ok(regionOpts.some(t => t.includes('欧盟') && t.includes('EU')), '含「欧盟 EU」');
  // 无数据地区必须隐藏（若哪天 JP/AU 有数据了，本断言自动不再要求隐藏它们）
  const noDataRegions = ['JP', 'AU'].filter(rc => !exp.regions.includes(rc));
  ok(noDataRegions.every(rc => !shownCodes.includes(rc)),
    '无数据地区已隐藏 (' + (noDataRegions.join(',') || '无') + ')');

  // ② 选北美地区 NA → 自动勾选地区内有数据的国家；国家面板只列北美国家
  for (const o of await page.$$('#ddRegionList .dd-opt')) {
    const t = await o.textContent();
    if (t.includes('北美地区')) { await o.click(); break; }
  }
  await page.waitForTimeout(400);
  const st1 = await page.evaluate(() => ({
    regions: [...selRegion], countries: [...selCountry].sort(),
    ctrySum: document.getElementById('ddCountrySummary').textContent
  }));
  ok(st1.regions.length === 1 && st1.regions[0] === 'NA', '选 NA 后地区集 = {NA} (' + st1.regions.join(',') + ')');
  ok(st1.countries.join() === exp.NA.join(), '选 NA 后自动勾选北美有数据国家 (' + st1.countries.join(',') + ')');
  const cOpen = await page.$eval('#ddCountry', el => el.classList.contains('open'));
  if (!cOpen) await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(250);
  const ctryListed = await page.$$eval('#ddCountryList .dd-opt', els => els.map(e => (e.dataset.code || '')).filter(Boolean).sort());
  ok(ctryListed.length > 0 && ctryListed.every(c => exp.NA.includes(c)),
    '选 NA 后国家面板只列北美国家 (实际 ' + ctryListed.join(',') + ')');
  // 有数据的非北美国家（如 DE/UK）不应出现在列表里 —— 是"隐藏"而不是"置灰"
  const nonNAWithData = [...exp.EU, ...exp.UK].filter(c => !exp.NA.includes(c));
  ok(nonNAWithData.every(c => !ctryListed.includes(c)),
    '选 NA 后范围外国家不出现 (非置灰; 检查 ' + (nonNAWithData.join(',') || '无') + ')');

  await page.click('#ddCountry .dd-btn'); // 关闭
  await page.waitForTimeout(200);
  const kpiText = await page.$eval('#kpiRow', el => el.textContent).catch(() => '');
  ok(kpiText.length > 0, '选 NA 后 KPI 仍渲染');

  // ③ 反向联动: 选国家 美国 → 地区自动收成 NA，地区面板只列 NA
  await page.evaluate(() => { selRegion.clear(); selCountry.clear(); syncAndRender(); });
  await page.waitForTimeout(200);
  const cOpen2 = await page.$eval('#ddCountry', el => el.classList.contains('open'));
  if (!cOpen2) await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(200);
  for (const o of await page.$$('#ddCountryList .dd-opt')) {
    const t = await o.textContent();
    if (t.includes('美国')) { await o.click(); break; }
  }
  await page.waitForTimeout(400);
  const st2 = await page.evaluate(() => ({ regions: [...selRegion], countries: [...selCountry].sort() }));
  ok(st2.countries.length === 1 && st2.countries[0] === 'US', '选美国后国家集 = {US}');
  ok(st2.regions.length === 1 && st2.regions[0] === 'NA', '选美国后地区自动 = {NA}');
  const rOpen2 = await page.$eval('#ddRegion', el => el.classList.contains('open'));
  if (!rOpen2) await page.click('#ddRegion .dd-btn');
  await page.waitForTimeout(250);
  const regionShown2 = await page.$$eval('#ddRegionList .dd-opt .opt-name', els => els.map(e => (e.textContent.match(/\b(NA|EU|UK|JP|AU)\b/) || [])[1]).filter(Boolean));
  // 地区面板 = 产品范围(ASIN/系列/产品名)内有数据的地区，**不随国家选择收窄** —— 这样选完 US 仍能直接跳到 EU/UK。
  // (国家面板是反向的: 选了地区就只列该地区国家。两者不对称是刻意的，不是 bug。)
  ok(regionShown2.sort().join() === exp.regions.join(),
    '选美国后地区面板仍列出全部有数据地区 (实际 ' + regionShown2.join(',') + ')');

  // ④ 生效国家集合确实收窄
  const eff = await page.evaluate(() => [...effectiveCountries()].sort());
  ok(eff.length === 1 && eff[0] === 'US', '生效国家 = {US} (实际 ' + eff.join(',') + ')');

  await browser.close();
  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
