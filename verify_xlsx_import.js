// 验证: mapping.html 批量导入支持 XLS / XLSX（SheetJS 解析第一个工作表 → 复用 CSV 导入逻辑）
// 覆盖: xlsx 带表头 / xls 别名表头 / xlsx ASIN 带表头 / xls 无表头 / 多工作表取第一个 / JSON-CSV 回归
const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8899/mapping.html';
const T = 'C:/Users/paddy/AppData/Local/Temp/xlsipt/';
const results = [];
function t(name, ok, extra) { results.push({ name, ok, extra }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(BASE);
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(600);

  // 0. XLSX 库已加载
  const hasXLSX = await page.evaluate(() => typeof XLSX !== 'undefined');
  t('XLSX 库已加载', hasXLSX === true);

  // 1. 目录导入 xlsx（表头 产品系列,产品名）
  await page.setInputFiles('#cFile', T + 'test_catalog.xlsx');
  await page.waitForTimeout(500);
  let state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  t('目录导入 xlsx（表头 产品系列/产品名）', state.length === 3 && state.some(x => x.series === 'X1' && x.name === '手机支架A') && state.some(x => x.series === 'X3' && x.name === '数据线C'), state);

  // 2. 目录导入 xls（别名表头 系列/名称）
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.setInputFiles('#cFile', T + 'test_catalog.xls');
  await page.waitForTimeout(500);
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  t('目录导入 xls（别名表头 系列/名称）', state.length === 3 && state.some(x => x.series === 'X2' && x.name === '充电器B'), state);

  // 3. ASIN 导入 xlsx（表头 ASIN,产品系列,产品名）
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.setInputFiles('#aFile', T + 'test_asin.xlsx');
  await page.waitForTimeout(500);
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]'));
  t('ASIN 导入 xlsx（表头）', state.length === 3 && state.some(x => x.asin === 'B0H69JJZ1M' && x.series === 'X1' && x.name === '手机支架A') && state.some(x => x.asin === 'B0H75HMBF5' && x.series === 'X3' && x.name === '数据线C'), state);
  // 导入时带新系列自动补录目录
  const catAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  t('ASIN 导入自动补录目录', catAfter.length === 3, catAfter);

  // 4. ASIN 导入 xls 无表头（按 ASIN,系列,产品名 顺序）
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.setInputFiles('#aFile', T + 'test_asin_noheader.xls');
  await page.waitForTimeout(500);
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]'));
  t('ASIN 导入 xls 无表头', state.length === 2 && state.some(x => x.asin === 'B0H68YLB2S' && x.series === 'X1' && x.name === '手机支架A'), state);

  // 5. 多工作表 xlsx → 只取第一个 sheet
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.setInputFiles('#aFile', T + 'test_asin_multi.xlsx');
  await page.waitForTimeout(500);
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]'));
  t('多工作表取第一个', state.length === 1 && state[0].asin === 'B0H68YLB2S' && state[0].series === 'X9', state);

  // 6. 回归: CSV 粘贴导入仍可用（目录）
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.getElementById('cText').value = '产品系列,产品名\nX1,手机支架A\nX2,充电器B';
    importCatalogFromText();
  });
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  t('回归: CSV 粘贴导入目录', state.length === 2 && state[0].series === 'X1', state);

  // 7. 回归: JSON 粘贴导入仍可用（ASIN）
  await page.evaluate(() => {
    document.getElementById('aText').value = '[{"asin":"B0H69JJZ1M","series":"X1","name":"手机支架A"}]';
    importAsinFromText();
  });
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]'));
  t('回归: JSON 粘贴导入 ASIN', state.length === 1 && state[0].asin === 'B0H69JJZ1M', state);

  // 8. 无 JS 错误
  t('无 JS 错误', errs.length === 0, errs);

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log('\n===== 结果: ' + results.length + ' 项, ' + (results.length - fails.length) + ' PASS, ' + fails.length + ' FAIL =====');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
