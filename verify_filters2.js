// 验证: ①每日/周度看板筛选交互统一(单击=单选替换, Ctrl+单击=多选追加/取消) ②每日国家↔ASIN联动隐藏 ③系列/产品名搜索 ④映射入口移到左侧导航
const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8899';
const results = [];
function t(name, ok, extra) { results.push({ name, ok, extra }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept().catch(() => {}));
  // 注意: 事件对象必须在页面内构造(直接构造字面量), 不能通过 evaluate 第二参传入(方法无法序列化)
  const click = (set, key, ctrl) => `handleOptClick(${ctrl ? '{ ctrlKey:true, metaKey:true, stopPropagation(){} }' : '{ ctrlKey:false, metaKey:false, stopPropagation(){} }'}, ${set}, '${key}', renderAll)`;

  // ==================== 1) 每日看板 daily.html ====================
  await page.goto(BASE + '/daily.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 1a. 注入产品映射 → 系列/产品名可用
  await page.evaluate(() => {
    localStorage.setItem('pc_catalog', JSON.stringify([
      { series: 'X1', name: '手机支架A' }, { series: 'X1', name: '手机支架B' }, { series: 'X2', name: '充电器C' }
    ]));
    localStorage.setItem('pc_asinmap', JSON.stringify([
      { asin: 'B0H69JJZ1M', series: 'X1', name: '手机支架A' },
      { asin: 'B0H68YLB2S', series: 'X1', name: '手机支架B' },
      { asin: 'B0HCXVRB21', series: 'X2', name: '充电器C' }
    ]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 1b. 默认全部
  let st = await page.evaluate(() => ({
    c: document.getElementById('ddCountrySummary').textContent,
    a: document.getElementById('ddAsinSummary').textContent,
    s: document.getElementById('ddSeriesSummary').textContent
  }));
  t('daily 默认全部', st.c === '全部' && st.a === '全部' && st.s === '全部', st);

  // 1c. 单击 US = 单选替换; ASIN 联动隐藏(仅 US 有数据)
  await page.evaluate(click('selCountry', 'US', false));
  await page.waitForTimeout(200);
  const usAsinsUI = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  const usAsinsExpect = await page.evaluate(() => {
    const out = new Set();
    for (const d of DAYS) { const { biz, ads } = filterRows(d, new Set(['US']), null); for (const r of biz) out.add(r.asin); for (const it of Object.values(ads).flat()) { const a = extractAsin(it); if (a) out.add(a); } }
    return asinList.filter(a => out.has(a));
  });
  t('daily 选US后ASIN列表仅含US有数据项(隐藏其余)', JSON.stringify(usAsinsUI) === JSON.stringify(usAsinsExpect) && usAsinsUI.length > 0, { ui: usAsinsUI.length, expect: usAsinsExpect.length });
  const countryCandsAfterAsin = await page.evaluate(() => [...document.querySelectorAll('#ddCountryList .dd-opt')].length);
  t('daily 选US后国家列表仍显示全部(无ASIN限制时13国)', countryCandsAfterAsin === 13, { countryCandsAfterAsin });

  // 1d. 单击唯一已选项 → 清空回全部
  await page.evaluate(click('selCountry', 'US', false));
  const cleared = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('daily 再单击唯一US→清空回全部', cleared === '全部', { cleared });

  // 1e. Ctrl+单击 = 多选追加
  await page.evaluate(click('selCountry', 'US', false));
  await page.evaluate(click('selCountry', 'DE', true));
  const multi = await page.evaluate(() => [...selCountry].sort().join(','));
  t('daily Ctrl+DE 多选追加 → US,DE', multi === 'DE,US', { multi });
  // Ctrl 再点 US → 取消(多选移除)
  await page.evaluate(click('selCountry', 'US', true));
  const multi2 = await page.evaluate(() => [...selCountry].join(','));
  t('daily Ctrl+US 再点 → 移除US仅DE', multi2 === 'DE', { multi2 });

  // 1f. 反向联动: 选 ASIN → 国家列表仅显示该 ASIN 有数据的国家(隐藏其余)
  await page.evaluate(() => { selCountry.clear(); renderAll(); });
  await page.evaluate(click('selAsin', 'B0H69JJZ1M', false));
  await page.waitForTimeout(200);
  const cntsUI = await page.evaluate(() => [...document.querySelectorAll('#ddCountryList .dd-opt .opt-name')].map(o => o.textContent.replace(/\s+/g, ' ').trim().split(' ').pop()));
  const cntsExpect = await page.evaluate(() => {
    const out = new Set();
    for (const d of DAYS) { const { biz, ads } = filterRows(d, null, new Set(['B0H69JJZ1M'])); for (const r of biz) out.add(r.site || 'US'); for (const cc of Object.keys(ads)) out.add(cc); }
    return allCountries.filter(c => out.has(c));
  });
  t('daily 选ASIN后国家列表仅显示有数据国家(隐藏其余)', JSON.stringify(cntsUI) === JSON.stringify(cntsExpect) && cntsUI.length > 0 && cntsUI.length < 13, { ui: cntsUI, expect: cntsExpect });

  // 1g. 系列搜索框
  await page.evaluate(() => { document.getElementById('ddSeries').classList.add('open'); document.getElementById('ddSeriesSearch').value = 'X1'; buildSeriesOptions(); });
  const s1 = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(o => o.textContent));
  await page.evaluate(() => { document.getElementById('ddSeriesSearch').value = '支架'; buildSeriesOptions(); });
  const s2 = await page.evaluate(() => document.getElementById('ddSeriesList').textContent);
  t('daily 系列搜索 X1→仅X1; 支架→无匹配', s1.length === 1 && s1[0] === 'X1' && s2.includes('无匹配'), { s1, s2: s2.slice(0, 30) });

  // 1h. 产品名搜索(级联保持): 选系列X1 → 产品名仅A/B; 再搜索'支架B'→仅手机支架B
  await page.evaluate(() => { document.getElementById('ddSeriesSearch').value = ''; buildSeriesOptions(); });
  await page.evaluate(() => { selAsin.clear(); });
  await page.evaluate(click('selSeries', 'X1', false));
  await page.evaluate(() => { document.getElementById('ddName').classList.add('open'); document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  const n0 = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(o => o.textContent));
  await page.evaluate(() => { document.getElementById('ddNameSearch').value = '支架B'; buildNameOptions(); });
  const n1 = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(o => o.textContent));
  t('daily 选X1产品名仅A/B(级联); 搜索"支架B"→仅手机支架B', n0.length === 2 && !n0.includes('充电器C') && n1.length === 1 && n1[0] === '手机支架B', { n0, n1 });

  // 1i. 系列+国家双筛选 → ASIN 列表 = US有数据 ∩ X1
  await page.evaluate(() => { document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  await page.evaluate(click('selCountry', 'US', false));
  await page.waitForTimeout(200);
  const usX1 = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  const usX1Expect = await page.evaluate(() => {
    const meta = {};
    for (const a of asinList) meta[a] = asinMetaOf(a);
    const out = new Set();
    for (const d of DAYS) { const { biz, ads } = filterRows(d, new Set(['US']), null); for (const r of biz) if (meta[r.asin] && meta[r.asin].series === 'X1') out.add(r.asin); for (const it of Object.values(ads).flat()) { const a = extractAsin(it); if (a && meta[a] && meta[a].series === 'X1') out.add(a); } }
    return asinList.filter(a => out.has(a));
  });
  t('daily 系列X1+国家US → ASIN仅US∩X1', JSON.stringify(usX1) === JSON.stringify(usX1Expect), { ui: usX1, expect: usX1Expect });

  // ==================== 2) 周度汇总 product.html ====================
  await page.goto(BASE + '/product.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 2a. 默认全选 → 显示"全部"
  let ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 默认全选显示全部', ps === '全部', { ps });

  // 2b. 单击 US = 单选替换
  await page.evaluate(() => { document.getElementById('ddCountry').classList.add('open'); });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const us = opts.find(o => o.textContent.includes('US'));
    us.onclick({ preventDefault() {}, stopPropagation() {} });
  });
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 单击US→已选1/N(单选替换)', /^已选 1\//.test(ps), { ps });

  // 2c. Ctrl+单击 DE → 多选追加
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const de = opts.find(o => o.textContent.includes('DE'));
    de.onclick({ ctrlKey: true, metaKey: true, preventDefault() {}, stopPropagation() {} });
  });
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product Ctrl+DE→已选2/N(多选追加)', /^已选 2\//.test(ps), { ps });

  // 2d. 单击唯一已选项 → 清空回全部
  await page.evaluate(() => { document.getElementById('ddCountry').classList.add('open'); });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const us = opts.find(o => o.textContent.includes('US'));
    us.onclick({ preventDefault() {}, stopPropagation() {} }); // {US,DE} → {US}
  });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddCountryList .dd-opt')];
    const us = opts.find(o => o.textContent.includes('US'));
    us.onclick({ preventDefault() {}, stopPropagation() {} }); // {US} → 空=全部
  });
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 再单击唯一US→清空回全部', ps === '全部', { ps });

  // 2e. ASIN 下拉同样逻辑: 单击唯一已选项清空
  await page.evaluate(() => { document.getElementById('ddAsin').classList.add('open'); });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')];
    opts[0].onclick({ preventDefault() {}, stopPropagation() {} }); // 单选第一个
  });
  await page.waitForTimeout(300);
  let as = await page.evaluate(() => document.getElementById('ddAsinSummary').textContent);
  t('product ASIN单击→已选1/N', /^已选 1\//.test(as), { as });
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')];
    opts[0].onclick({ preventDefault() {}, stopPropagation() {} }); // 唯一已选项再点 → 清空
  });
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddAsinSummary').textContent);
  t('product ASIN再单击唯一→清空回全部', as === '全部', { as });

  // ==================== 3) 壳页面 index.html ====================
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const shell = await page.evaluate(() => ({
    navMap: !!document.querySelector('.nav-map'),
    mapBtns: [...document.querySelectorAll('.map-btn')].map(b => b.textContent.trim().replace(/\s+/g, ' ')),
    bottomBar: !!document.querySelector('.bottom-bar'),
    mapStatus: document.getElementById('mapStatus').textContent,
    btnBackHidden: document.getElementById('btnBack').style.display === 'none'
  }));
  t('映射入口在左侧导航(无底部栏)', shell.navMap && !shell.bottomBar && shell.mapBtns.length === 2 && shell.btnBackHidden, shell);

  await page.evaluate(() => openMapping('asin'));
  await page.waitForTimeout(600);
  const inMap = await page.evaluate(() => ({ src: document.getElementById('frame').src.split('/').pop(), back: document.getElementById('btnBack').style.display }));
  t('点ASIN匹配管理→iframe加载mapping.html并显示返回', inMap.src === 'mapping.html#asin' && inMap.back === '', inMap);

  await page.evaluate(() => backFromMapping());
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ src: document.getElementById('frame').src.split('/').pop() }));
  t('返回看板→回到原看板(ad)', back.src === 'ad.html', back);

  // ==================== 4) 无 JS 错误 ====================
  const real = errors.filter(e => !/favicon|net::ERR/.test(e));
  t('全程无 JS 错误', real.length === 0, { errors: real.slice(0, 5) });

  const failed = results.filter(r => !r.ok);
  console.log('\n===== ' + results.length + ' checks, ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL =====');
  if (failed.length) { console.log('FAILED:', failed.map(f => f.name)); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exitCode = 1; });
