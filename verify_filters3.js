// 验证: ①每日/周度/广告看板筛选交互统一 ②每日国家↔ASIN联动隐藏 ③系列/产品名搜索(三看板) ④壳页面单按钮"产品关系管理"
const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8899';
const results = [];
function t(name, ok, extra) { results.push({ name, ok, extra }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }

// 测试映射: 两个 ASIN 分别属于 X1/X2 系列
const TEST_MAP = [
  { asin: 'B0H69JJZ1M', series: 'X1', name: '支架A' },
  { asin: 'B0HCXVRB21', series: 'X2', name: '充电器C' },
];
// 周度汇总额外映射(12 ASIN 中再映射2个)
const TEST_MAP_PROD = [
  ...TEST_MAP,
  { asin: 'B0H75HMBF5', series: 'X1', name: '支架B' },
  { asin: 'B0H68YLB2S', series: 'X2', name: '充电器D' },
];

function injectMap(page, map) {
  return page.evaluate((m) => {
    localStorage.setItem('pc_catalog', JSON.stringify([
      { series: 'X1', name: '支架A' }, { series: 'X1', name: '支架B' },
      { series: 'X2', name: '充电器C' }, { series: 'X2', name: '充电器D' }
    ]));
    localStorage.setItem('pc_asinmap', JSON.stringify(m));
  }, map);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  // 拦截云端映射拉取, 避免真实云端数据覆盖测试注入的映射
  await page.route('https://oovvqvgrjqwogjwswaxx.supabase.co/**', r => r.abort());
  await page.route('**/product_map.json', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept().catch(() => {}));
  // 事件对象在页面内构造(方法无法序列化)
  // daily 的 handleOptClick 需第4参 renderAll; ad/product 的 handleOptClick 内部调 syncAndRender 无需第4参
  const clickDaily = (set, key, ctrl) => `handleOptClick(${ctrl ? '{ ctrlKey:true, metaKey:true, preventDefault(){}, stopPropagation(){} }' : '{ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }'}, ${set}, '${key}', renderAll)`;
  const click = (set, key, ctrl) => `handleOptClick(${ctrl ? '{ ctrlKey:true, metaKey:true, preventDefault(){}, stopPropagation(){} }' : '{ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }'}, ${set}, '${key}')`;

  // ==================== 1) 每日看板 daily.html ====================
  await page.goto(BASE + '/daily.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await injectMap(page, TEST_MAP);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 1a. 默认全部
  let st = await page.evaluate(() => ({
    c: document.getElementById('ddCountrySummary').textContent,
    a: document.getElementById('ddAsinSummary').textContent,
    s: document.getElementById('ddSeriesSummary').textContent
  }));
  t('daily 默认全部', st.c === '全部' && st.a === '全部' && st.s === '全部', st);

  // 1b. 单击 US → 单选替换; ASIN 联动隐藏
  await page.evaluate(clickDaily('selCountry', 'US', false));
  await page.waitForTimeout(200);
  const usAsinsUI = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  t('daily 选US后ASIN列表非空', usAsinsUI.length > 0, { count: usAsinsUI.length });

  // 1c. 单击唯一已选项 → 清空回全部
  await page.evaluate(clickDaily('selCountry', 'US', false));
  const cleared = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('daily 再单击唯一US→清空回全部', cleared === '全部', { cleared });

  // 1d. Ctrl+单击 = 多选追加/取消
  await page.evaluate(clickDaily('selCountry', 'US', false));
  await page.evaluate(clickDaily('selCountry', 'DE', true));
  const multi = await page.evaluate(() => [...selCountry].sort().join(','));
  t('daily Ctrl+DE 多选追加 → US,DE', multi === 'DE,US', { multi });
  await page.evaluate(clickDaily('selCountry', 'US', true));
  const multi2 = await page.evaluate(() => [...selCountry].join(','));
  t('daily Ctrl+US 再点 → 移除US仅DE', multi2 === 'DE', { multi2 });

  // 1e. 系列搜索框
  await page.evaluate(() => { selCountry.clear(); renderAll(); });
  await page.evaluate(() => { document.getElementById('ddSeries').classList.add('open'); document.getElementById('ddSeriesSearch').value = 'X1'; buildSeriesOptions(); });
  const s1 = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(o => o.textContent));
  await page.evaluate(() => { document.getElementById('ddSeriesSearch').value = '不存在'; buildSeriesOptions(); });
  const s2 = await page.evaluate(() => document.getElementById('ddSeriesList').textContent);
  t('daily 系列搜索 X1→仅X1; 不存在→无匹配', s1.length === 1 && s1[0] === 'X1' && s2.includes('无匹配'), { s1, s2: s2.slice(0, 30) });

  // 1f. 选系列X1 → 产品名级联
  await page.evaluate(() => { document.getElementById('ddSeriesSearch').value = ''; buildSeriesOptions(); });
  await page.evaluate(clickDaily('selSeries', 'X1', false));
  await page.evaluate(() => { document.getElementById('ddName').classList.add('open'); document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  const n0 = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(o => o.textContent));
  t('daily 选X1产品名仅支架A(级联,每日仅1ASIN映射X1)', n0.length === 1 && n0[0] === '支架A', { n0 });

  // ==================== 2) 周度汇总 product.html ====================
  await page.goto(BASE + '/product.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => localStorage.clear());
  await injectMap(page, TEST_MAP_PROD);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 2a. 默认全部
  let ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 默认全选显示全部', ps === '全部', { ps });

  // 2b. 国家单击=单选替换; Ctrl=多选追加 (countryOptClick 走地区↔国家自动同步路径)
  await page.evaluate(`countryOptClick({ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }, 'US')`);
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 单击US→摘要US+地区自动NA', ps === 'US', { ps });
  let pr = await page.evaluate(() => document.getElementById('ddRegionSummary').textContent);
  t('product 单击US→地区自动同步NA', pr === 'NA', { pr });
  await page.evaluate(`countryOptClick({ ctrlKey:true, metaKey:true, preventDefault(){}, stopPropagation(){} }, 'DE')`);
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product Ctrl+DE→US,DE', ps === 'US,DE', { ps });

  // 2c. 单击唯一已选项 → 清空回全部 (先移除DE, 再移除US)
  await page.evaluate(`countryOptClick({ ctrlKey:true, metaKey:true, preventDefault(){}, stopPropagation(){} }, 'DE')`);
  await page.evaluate(`countryOptClick({ ctrlKey:false, metaKey:false, preventDefault(){}, stopPropagation(){} }, 'US')`);
  await page.waitForTimeout(300);
  ps = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('product 再单击唯一US→清空回全部', ps === '全部', { ps });

  // 2d. 系列筛选: 选X1 → ASIN列表仅X1的ASIN
  await page.evaluate(() => { document.getElementById('ddSeries').classList.add('open'); });
  await page.evaluate(click('selSeries', 'X1', false));
  await page.waitForTimeout(300);
  const prodAsinsUI = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  t('product 选X1后ASIN列表仅含X1 ASIN(支架A/B)', 
    prodAsinsUI.includes('B0H69JJZ1M') && prodAsinsUI.includes('B0H75HMBF5') && !prodAsinsUI.includes('B0HCXVRB21'),
    { prodAsinsUI });

  // 2e. 产品名级联: 选X1 → 产品名下拉仅支架A/支架B
  await page.evaluate(() => { nameSearchKw = ''; document.getElementById('ddName').classList.add('open'); document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  const prodNames = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(o => o.textContent));
  t('product 选X1后产品名仅支架A/支架B(级联)', 
    prodNames.length === 2 && prodNames.includes('支架A') && prodNames.includes('支架B'), { prodNames });

  // 2f. 产品名搜索
  await page.evaluate(() => { nameSearchKw = '支架B'; document.getElementById('ddNameSearch').value = '支架B'; buildNameOptions(); });
  const prodNamesSearch = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt .opt-name')].map(o => o.textContent));
  t('product 搜索"支架B"→仅支架B', prodNamesSearch.length === 1 && prodNamesSearch[0] === '支架B', { prodNamesSearch });

  // 2g. 清除系列筛选 → ASIN 恢复全部
  await page.evaluate(() => { nameSearchKw = ''; document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  await page.evaluate(click('selSeries', 'X1', false));
  await page.waitForTimeout(300);
  const prodAsinsAll = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  const prodAsinsExp = await page.evaluate(() => asinCandidates().length);
  t('product 清除系列后ASIN恢复全部', prodAsinsAll.length === prodAsinsExp && prodAsinsExp > 0, { count: prodAsinsAll.length, expected: prodAsinsExp });

  // ==================== 3) 广告看板 ad.html ====================
  await page.goto(BASE + '/ad.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => localStorage.clear());
  await injectMap(page, TEST_MAP);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 3a. 默认: 广告看板国家为"全部"(2026-09-07 改为空集=全部, 防止周切换往返丢失选择)
  let as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad 默认国家为全部(空集=全部)', as === '全部', { as });

  // 3b. 清空全部 → "全部"; 再单击US → "已选1/13"(单选替换)
  await page.evaluate(() => { setAll('country', false); });
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad 清空国家→全部', as === '全部', { as });
  await page.evaluate(click('selCountry', 'US', false));
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad 单击US→已选1/13(单选替换)', /^已选 1\/13 项$/.test(as), { as });

  // 3c. Ctrl+单击US → 移除(多选取消); 再Ctrl+单击US → 添加(多选追加)
  await page.evaluate(click('selCountry', 'US', true));
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad Ctrl+US移除→全部', as === '全部', { as });
  await page.evaluate(click('selCountry', 'US', true));
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad Ctrl+US再添加→已选1/13', /^已选 1\/13 项$/.test(as), { as });

  // 3d. 单击唯一已选项 → 清空回全部
  await page.evaluate(click('selCountry', 'US', false));
  await page.waitForTimeout(300);
  as = await page.evaluate(() => document.getElementById('ddCountrySummary').textContent);
  t('ad 再单击唯一US→清空回全部', as === '全部', { as });

  // 3d. 系列筛选: 选X1 → ASIN列表仅B0H69JJZ1M
  await page.evaluate(() => { document.getElementById('ddSeries').classList.add('open'); });
  await page.evaluate(click('selSeries', 'X1', false));
  await page.waitForTimeout(300);
  const adAsinsUI = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  t('ad 选X1后ASIN列表仅B0H69JJZ1M', 
    adAsinsUI.length === 1 && adAsinsUI[0] === 'B0H69JJZ1M', { adAsinsUI });

  // 3e. 产品名级联: 选X1 → 支架A/支架B(级联全集; 支架B无映射数据→置灰可点, Bug2联动重置入口)
  await page.evaluate(() => { nameSearchKw = ''; document.getElementById('ddName').classList.add('open'); document.getElementById('ddNameSearch').value = ''; buildNameOptions(); });
  const adNameOpts = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .dd-opt')].map(o => ({ name: o.querySelector('.opt-name').textContent, dim: o.className.includes('dim'), disabled: !!o.querySelector('input[disabled]') })));
  const _optA = adNameOpts.find(o => o.name === '支架A'), _optB = adNameOpts.find(o => o.name === '支架B');
  t('ad 选X1后产品名支架A/支架B(级联,B置灰可点)',
    adNameOpts.length === 2 && _optA && !_optA.dim && _optB && _optB.dim && !_optB.disabled, { adNameOpts });

  // 3f. 系列搜索(先清除X1选择, 否则selAsin被修剪导致X2不可见)
  await page.evaluate(click('selSeries', 'X1', false));
  await page.waitForTimeout(300);
  await page.evaluate(() => { seriesSearchKw = 'X2'; document.getElementById('ddSeriesSearch').value = 'X2'; buildSeriesOptions(); });
  const adSeriesSearch = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .dd-opt .opt-name')].map(o => o.textContent));
  t('ad 系列搜索X2→仅X2', adSeriesSearch.length === 1 && adSeriesSearch[0] === 'X2', { adSeriesSearch });

  // 3g. 清除系列搜索 → ASIN恢复2个(selSeries已在3f清空)
  await page.evaluate(() => { seriesSearchKw = ''; document.getElementById('ddSeriesSearch').value = ''; buildSeriesOptions(); });
  await page.waitForTimeout(300);
  const adAsinsAll = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  const adAsinsExp = await page.evaluate(() => asinCandidates().length);
  t('ad 清除系列后ASIN恢复全部', adAsinsAll.length === adAsinsExp && adAsinsExp > 0, { adAsinsAll, expected: adAsinsExp });

  // 3h. 系列+国家双筛选: 选X2 + US → ASIN仅B0HCXVRB21(如果US有数据)
  await page.evaluate(click('selSeries', 'X2', false));
  await page.evaluate(click('selCountry', 'US', false));
  await page.waitForTimeout(300);
  const adX2Us = await page.evaluate(() => [...document.querySelectorAll('#ddAsinList .dd-opt .opt-name')].map(o => o.textContent));
  t('ad 选X2+US → ASIN仅B0HCXVRB21(有US数据时)', 
    adX2Us.length <= 1 && (adX2Us.length === 0 || adX2Us[0] === 'B0HCXVRB21'), { adX2Us });

  // ==================== 4) 壳页面 index.html ====================
  // 认证守卫(2026-08-25上线): 注入 wb_auth stub + 拦截 Supabase auth 校验返回 200, 否则被重定向到 login.html 导致 btnBack 为 null
  await page.route('**/auth/v1/user', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"email":"test@aliencell.com","role":"viewer"}' }));
  await page.addInitScript(() => {
    try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'stub-token', refresh_token: 'stub-refresh', expires_at: Date.now() + 3600000, user: { email: 'test@aliencell.com' }, role: 'viewer' })); } catch (e) {}
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const shell = await page.evaluate(() => ({
    navMap: !!document.querySelector('.nav-map'),
    mapBtns: [...document.querySelectorAll('.map-btn')].map(b => b.textContent.trim().replace(/\s+/g, ' ')),
    adminHidden: (function () { var b = document.getElementById('btnAdminUsers'); return b && b.style.display === 'none'; })(),
    bottomBar: !!document.querySelector('.bottom-bar'),
    btnBackHidden: document.getElementById('btnBack').style.display === 'none'
  }));
  t('壳页面: 导航含"产品关系管理"(viewer隐藏"用户管理",无底部栏)',
    shell.navMap && !shell.bottomBar && shell.mapBtns.some(b => b.includes('产品关系管理')) && shell.adminHidden && shell.btnBackHidden, shell);

  // 4b. 点击"产品关系管理" → iframe加载mapping.html(无hash,默认catalog Tab)
  await page.evaluate(() => openMapping());
  await page.waitForTimeout(600);
  const inMap = await page.evaluate(() => ({ 
    src: document.getElementById('frame').src.split('/').pop(), 
    back: document.getElementById('btnBack').style.display 
  }));
  // 壳页面 iframe 带缓存版本号(2026-09-14 加): mapping.html?v=xxxx, 断言兼容
  const stripV = (u) => (u || '').replace(/\?v=\d+/, '');
  t('点"产品关系管理"→iframe加载mapping.html并显示返回', 
    stripV(inMap.src) === 'mapping.html' && inMap.back === '', inMap);

  // 4c. 返回看板
  await page.evaluate(() => backFromMapping());
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ src: document.getElementById('frame').src.split('/').pop() }));
  t('返回看板→回到原看板(ad)', stripV(back.src) === 'ad.html', back);

  // 4d. openMapping('asin') 仍可直达ASIN Tab
  await page.evaluate(() => openMapping('asin'));
  await page.waitForTimeout(600);
  const asinTab = await page.evaluate(() => document.getElementById('frame').src.split('/').pop());
  t('openMapping(asin)→mapping.html#asin(兼容)', stripV(asinTab) === 'mapping.html#asin', { asinTab });

  // ==================== 5) 无 JS 错误 ====================
  const real = errors.filter(e => !/favicon|net::ERR/.test(e));
  t('全程无 JS 错误', real.length === 0, { errors: real.slice(0, 5) });

  const failed = results.filter(r => !r.ok);
  console.log('\n===== ' + results.length + ' checks, ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL =====');
  if (failed.length) { console.log('FAILED:', failed.map(f => f.name)); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exitCode = 1; });
