// 产品映射功能验证: mapping.html 管理页 + daily.html 看板级联筛选 + index.html 底部栏联动
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
  page.on('dialog', d => d.accept().catch(() => {})); // 自动确认 confirm 弹窗

  // ============ 1) mapping.html: 目录管理与级联 ============
  await page.goto(BASE + '/mapping.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // 1a. 添加产品目录
  await page.evaluate(() => { document.getElementById('cSeries').value = 'X1'; document.getElementById('cName').value = '手机支架A'; addCatalogItem(); });
  await page.evaluate(() => { document.getElementById('cSeries').value = 'X1'; document.getElementById('cName').value = '手机支架B'; addCatalogItem(); });
  await page.evaluate(() => { document.getElementById('cSeries').value = 'X2'; document.getElementById('cName').value = '充电器C'; addCatalogItem(); });
  const catLen = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]').length);
  t('目录添加 3 个产品', catLen === 3, { catLen });

  // 1b. 切换到 ASIN 页, 检查系列下拉级联
  await page.evaluate(() => switchTabView('asin'));
  await page.waitForTimeout(300);
  const seriesOpts = await page.evaluate(() => [...document.getElementById('aSeries').options].map(o => o.textContent));
  t('ASIN表单系列下拉含 X1/X2', seriesOpts.includes('X1') && seriesOpts.includes('X2'), { seriesOpts });

  await page.evaluate(() => { const s = document.getElementById('aSeries'); s.value = 'X1'; renderFormNames(); });
  const nameOpts1 = await page.evaluate(() => [...document.getElementById('aName').options].map(o => o.textContent));
  t('选 X1 后产品名仅含 A/B(不含充电器C)', nameOpts1.includes('手机支架A') && nameOpts1.includes('手机支架B') && !nameOpts1.includes('充电器C'), { nameOpts1 });

  await page.evaluate(() => { const s = document.getElementById('aSeries'); s.value = 'X2'; renderFormNames(); });
  const nameOpts2 = await page.evaluate(() => [...document.getElementById('aName').options].map(o => o.textContent));
  t('选 X2 后产品名仅含 充电器C', nameOpts2.includes('充电器C') && !nameOpts2.includes('手机支架A'), { nameOpts2 });

  // 1c. 添加 ASIN 匹配
  await page.evaluate(() => {
    document.getElementById('aAsin').value = 'B0H69JJZ1M';
    const s = document.getElementById('aSeries'); s.value = 'X1'; renderFormNames();
    const n = document.getElementById('aName'); n.value = '手机支架A';
    addAsinItem();
  });
  const asinMapLen = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]').length);
  t('添加 ASIN 匹配 1 条', asinMapLen === 1, { asinMapLen });

  // 1d. 匹配表格内级联: 改系列为 X2 → 产品名选项变为充电器C
  await page.evaluate(() => {
    const sel = document.querySelector('#asinTable select[onchange="rowSeriesChange(this)"]');
    sel.value = 'X2'; rowSeriesChange(sel);
  });
  const rowNameOpts = await page.evaluate(() => [...document.querySelectorAll('#asinTable select[onchange="rowNameChange(this)"] option')].map(o => o.textContent));
  t('匹配表格改系列X2后产品名含充电器C', rowNameOpts.includes('充电器C'), { rowNameOpts });

  // 1e. 删除匹配
  await page.evaluate(() => { const b = document.querySelector('#asinTable .mini.danger'); delAsin(b); });
  const asinMapLen2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]').length);
  t('删除匹配后为 0 条', asinMapLen2 === 0, { asinMapLen2 });

  // 1f. 从每日数据导入 ASIN
  await page.evaluate(() => importAsinsFromData());
  await page.waitForTimeout(4000);
  const asinMapLen3 = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]').length);
  t('从每日数据导入 12 个 ASIN', asinMapLen3 === 12, { asinMapLen3 });

  // ============ 2) daily.html: 看板级联筛选 ============
  // 预置映射: 2个ASIN映射到 X1, 其余未匹配
  await page.evaluate(() => {
    localStorage.setItem('pc_catalog', JSON.stringify([{ series: 'X1', name: '手机支架A' }, { series: 'X1', name: '手机支架B' }]));
    localStorage.setItem('pc_asinmap', JSON.stringify([
      { asin: 'B0H69JJZ1M', series: 'X1', name: '手机支架A' },
      { asin: 'B0H68YLB2S', series: 'X1', name: '手机支架B' }
    ]));
  });
  await page.goto(BASE + '/daily.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const seriesOptsD = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .opt-name')].map(o => o.textContent));
  t('看板系列下拉含 X1 与 无', seriesOptsD.includes('X1') && seriesOptsD.includes('无'), { seriesOptsD });

  const mapStat = await page.evaluate(() => document.getElementById('mapStat').textContent);
  t('footer 映射状态 2/12', mapStat === '2/12', { mapStat });

  const asinOptSub = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#ddAsinList .dd-opt')].find(o => o.textContent.includes('B0H69JJZ1M'));
    return el ? el.querySelector('.opt-sub').textContent : null;
  });
  t('ASIN 下拉显示映射 X1 / 手机支架A', asinOptSub && asinOptSub.includes('X1') && asinOptSub.includes('手机支架A'), { asinOptSub });

  const readTotal = () => page.evaluate(() => {
    const tr = document.querySelector('#tableWrap tr.total-row');
    const tds = [...tr.querySelectorAll('td')];
    const txt = tds[1].innerText.replace(/,/g, '').trim();
    return Number(txt); // 合计行流量列(第2个td)为纯文本
  });
  const allTotal = await readTotal();
  t('全量合计流量 > 0', allTotal > 0, { allTotal });

  // 选系列 X1
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#ddSeriesList .dd-opt')].find(o => o.textContent.trim().startsWith('X1'));
    el.click();
  });
  await page.waitForTimeout(400);
  const nameOptsD = await page.evaluate(() => [...document.querySelectorAll('#ddNameList .opt-name')].map(o => o.textContent));
  t('选系列X1后产品名下拉仅 A/B(级联)', nameOptsD.includes('手机支架A') && nameOptsD.includes('手机支架B') && !nameOptsD.includes('无'), { nameOptsD });
  const x1Total = await readTotal();
  t('选系列X1后合计流量 < 全量', x1Total < allTotal, { allTotal, x1Total });

  // 再选产品名 手机支架A
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#ddNameList .dd-opt')].find(o => o.textContent.includes('手机支架A'));
    el.click();
  });
  await page.waitForTimeout(400);
  const aTotal = await readTotal();
  t('选 X1/手机支架A 后合计流量 < X1系列', aTotal < x1Total, { x1Total, aTotal });

  // 选系列 无 (未匹配)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#ddSeriesList .dd-opt')].find(o => o.textContent.includes('无'));
    el.click();
  });
  await page.waitForTimeout(400);
  const noneTotal = await readTotal();
  t('选「无」后合计流量为剩余ASIN(>0 且 <全量)', noneTotal > 0 && noneTotal < allTotal, { noneTotal, allTotal });

  // 重置筛选
  await page.evaluate(() => { selSeries.clear(); selName.clear(); renderAll(); });

  // 未匹配 ASIN 默认归「无」
  const metaCheck = await page.evaluate(() => { const m = asinMetaOf('B0HCV1WBGT'); return m.series + '/' + m.name; });
  t('未匹配 ASIN 默认归属 无/无', metaCheck === '无/无', { metaCheck });

  // 无 localStorage(同事视角) → 内嵌映射兜底: 全部归无, 系列下拉只有 无
  await page.evaluate(() => localStorage.removeItem('pc_asinmap'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const seriesOptsE = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .opt-name')].map(o => o.textContent));
  t('无本地映射时系列下拉只有 无(内嵌兜底为空映射)', seriesOptsE.length === 1 && seriesOptsE[0] === '无', { seriesOptsE });

  // ============ 3) index.html: 底部栏联动 ============
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const barOk = await page.evaluate(() => {
    const s = document.getElementById('mapStatus');
    return { txt: s ? s.textContent : null, hasBtns: !!document.querySelector('.bb-btn[onclick*="openMapping"]'), hasBack: !!document.getElementById('btnBack') };
  });
  t('底部栏存在(状态角标+两个管理按钮+返回按钮)', barOk.hasBtns && barOk.hasBack && /映射/.test(barOk.txt || ''), barOk);

  // 点击「产品名/系列管理」→ iframe 加载 mapping.html#catalog
  await page.evaluate(() => openMapping('catalog'));
  await page.waitForTimeout(2000);
  let mapFrame = page.frames().find(f => f.url().includes('mapping.html'));
  t('点击管理按钮后 iframe 加载 mapping.html', !!mapFrame, { url: mapFrame && mapFrame.url() });

  // 在 iframe 中点击「返回看板」→ 壳页面切回原看板
  await mapFrame.evaluate(() => goBack());
  await page.waitForTimeout(1500);
  const backFrame = page.frames().find(f => f.url().includes('mapping.html'));
  const curSrc = await page.evaluate(() => document.getElementById('frame').src);
  t('返回看板后 iframe 回到 ad.html', !backFrame && /ad\.html/.test(curSrc), { curSrc });

  console.log('\n=== JS 错误 ===', errors.length ? errors.join('\n') : '无');
  const failed = results.filter(r => !r.ok).length;
  console.log('\n=== 汇总: ' + (results.length - failed) + '/' + results.length + ' PASS ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
