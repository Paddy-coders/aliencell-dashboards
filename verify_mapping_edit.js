// 验证 mapping.html 新版：产品目录展开式 + 系列/产品名编辑 + ASIN 国家字段 + 匹配列表展开式
const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8899/';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond){ pass++; console.log('PASS | ' + name); }
  else { fail++; console.log('FAIL | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); }
};
const CAT = [ {series:'X1',name:'手机支架A'}, {series:'X1',name:'手机支架B'}, {series:'X2',name:'充电器A'}, {series:'X3',name:'数据线C'} ];
const ASIN = [
  {asin:'B0H69JJZ1M',series:'X1',name:'手机支架A',country:'EU'},
  {asin:'B0H69JJZ2M',series:'X1',name:'手机支架B',country:'EU'},
  {asin:'B0HCXVRB21',series:'X2',name:'充电器A',country:'EU'},
  {asin:'B0H75HMBF5',series:'无',name:'无',country:'EU'},
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());

  async function seed(cat, asin){
    await page.evaluate(([c, a]) => {
      localStorage.setItem('pc_catalog', JSON.stringify(c));
      localStorage.setItem('pc_asinmap', JSON.stringify(a));
      localStorage.removeItem('pc_open_cat');
      localStorage.removeItem('pc_open_asin');
      localStorage.removeItem('pc_asin_group');
    }, [cat, asin]);
    await page.reload();
    await page.waitForTimeout(600);
  }

  // ---------- 1. 加载无错误 ----------
  await page.goto(BASE + 'mapping.html');
  await page.waitForTimeout(800);
  ok('页面加载无 JS 错误', errs.length === 0, errs);

  // ---------- 2. 默认折叠 + 点击展开 ----------
  await seed(CAT, ASIN);
  const catInit = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#catalogTable .grp-head')];
    return { heads: heads.length, rows: document.querySelectorAll('#catalogTable .grp-row').length,
             btnText: document.getElementById('btnExpandCat').textContent };
  });
  ok('产品目录按系列分组（3个组头）', catInit.heads === 3, catInit);
  ok('默认全部折叠（无产品行）', catInit.rows === 0, catInit);
  ok('按钮显示"全部展开"', catInit.btnText.includes('全部展开'), catInit.btnText);
  await page.click('#catalogTable .grp-head >> nth=0');
  await page.waitForTimeout(300);
  const afterClick = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogTable .grp-row').length,
    name0: document.querySelector('#catalogTable .grp-row .row-main')?.textContent.trim()
  }));
  ok('点击系列头展开显示产品行（X1有2个产品）', afterClick.rows === 2 && afterClick.name0.includes('手机支架A'), afterClick);

  // ---------- 3. 全部展开 / 全部折叠 ----------
  await page.click('#btnExpandCat');
  await page.waitForTimeout(300);
  const allOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogTable .grp-row').length,
    btn: document.getElementById('btnExpandCat').textContent
  }));
  ok('全部展开显示全部产品（4个）', allOpen.rows === 4, allOpen);
  ok('全部展开后按钮变"全部折叠"', allOpen.btn.includes('全部折叠'), allOpen.btn);
  await page.click('#btnExpandCat');
  await page.waitForTimeout(300);
  const allClosed = await page.evaluate(() => document.querySelectorAll('#catalogTable .grp-row').length);
  ok('全部折叠后无产品行', allClosed === 0, allClosed);

  // ---------- 4. 展开状态持久化 ----------
  await page.click('#catalogTable .grp-head >> nth=1'); // 展开 X2
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(600);
  const persist = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogTable .grp-row').length,
    secondOpen: document.querySelectorAll('#catalogTable .grp-head')[1]?.classList.contains('collapsed') === false
  }));
  ok('展开状态刷新后保持（X2展开）', persist.rows === 1 && persist.secondOpen, persist);

  // ---------- 5. 系列编辑重命名（级联同步） ----------
  await seed(CAT, ASIN);
  await page.click('#btnExpandCat'); // 全部展开
  await page.waitForTimeout(200);
  await page.click('#catalogTable .icon-btn[title="重命名系列"][data-s="X1"]');
  await page.waitForTimeout(300);
  await page.fill('#edtVal', 'X1-新');
  await page.click('#catalogTable >> text=✓ 保存');
  await page.waitForTimeout(300);
  const renameState = await page.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem('pc_catalog')),
    asin: JSON.parse(localStorage.getItem('pc_asinmap')),
    head: document.querySelector('#catalogTable .grp-head .grp-name')?.textContent.trim()
  }));
  ok('系列重命名后 catalog 级联更新', renameState.cat.every(p => p.series !== 'X1') && renameState.cat.filter(p => p.series === 'X1-新').length === 2, renameState.cat);
  ok('系列重命名后 asinMap 级联更新', renameState.asin.filter(m => m.series === 'X1-新').length === 2 && !renameState.asin.some(m => m.series === 'X1'), renameState.asin);
  ok('系列头显示新名称', renameState.head.includes('X1-新'), renameState.head);

  // ---------- 6. 系列下添加产品 ----------
  await page.click('#catalogTable .icon-btn[title="在此系列下添加产品"][data-s="X1-新"]');
  await page.waitForTimeout(300);
  await page.fill('#edtVal', '手机支架C');
  await page.click('#catalogTable >> text=添加');
  await page.waitForTimeout(300);
  const addName = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog')));
  ok('系列下添加产品成功', addName.some(p => p.series === 'X1-新' && p.name === '手机支架C'), addName);

  // ---------- 7. 产品名编辑（级联同步 asinMap） ----------
  await page.evaluate(([c, a]) => {
    localStorage.setItem('pc_catalog', JSON.stringify(c));
    localStorage.setItem('pc_asinmap', JSON.stringify(a));
    localStorage.removeItem('pc_open_cat'); localStorage.removeItem('pc_open_asin');
  }, [CAT, ASIN]);
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('#btnExpandCat');
  await page.waitForTimeout(200);
  await page.click('#catalogTable .icon-btn[title="修改产品名"][data-s="X1"][data-n="手机支架B"]');
  await page.waitForTimeout(300);
  await page.fill('#edtVal', '手机支架B2');
  await page.click('#catalogTable >> text=✓ 保存');
  await page.waitForTimeout(300);
  const nameEdit = await page.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem('pc_catalog')),
    asin: JSON.parse(localStorage.getItem('pc_asinmap'))
  }));
  ok('产品名修改后 catalog 更新', nameEdit.cat.some(p => p.name === '手机支架B2') && !nameEdit.cat.some(p => p.name === '手机支架B'), nameEdit.cat);
  ok('产品名修改后 asinMap 级联更新', nameEdit.asin.some(m => m.name === '手机支架B2') && !nameEdit.asin.some(m => m.name === '手机支架B'), nameEdit.asin);

  // ---------- 8. 删除系列（级联置无） ----------
  await page.evaluate(([c, a]) => {
    localStorage.setItem('pc_catalog', JSON.stringify(c));
    localStorage.setItem('pc_asinmap', JSON.stringify(a));
  }, [CAT, ASIN]);
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('#catalogTable .icon-btn[title="删除系列"][data-s="X3"]');
  await page.waitForTimeout(300);
  const delSer = await page.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem('pc_catalog')),
    asin: JSON.parse(localStorage.getItem('pc_asinmap'))
  }));
  ok('删除系列后 catalog 移除该系列', !delSer.cat.some(p => p.series === 'X3'), delSer.cat);
  ok('删除系列后 asinMap 该系列置无', delSer.asin.filter(m => m.series === 'X3').length === 0, delSer.asin);

  // ---------- 9. ASIN 表单国家下拉 ----------
  await page.click('#tabBtnAsin');
  await page.waitForTimeout(300);
  const ctr = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#aCountry option')].map(o => o.value),
    val: document.getElementById('aCountry').value
  }));
  ok('国家下拉选项为 EU/UK/US/CA/JP/AU', JSON.stringify(ctr.opts) === JSON.stringify(['EU','UK','US','CA','JP','AU']), ctr);
  ok('国家默认选中 EU', ctr.val === 'EU', ctr.val);

  // ---------- 10. 添加 ASIN 带国家 + 同 ASIN 不同国家并存 ----------
  await page.fill('#aAsin', 'B0H99TEST1');
  await page.selectOption('#aCountry', 'US');
  await page.selectOption('#aSeries', 'X1');
  await page.waitForTimeout(200);
  await page.selectOption('#aName', '手机支架A');
  await page.click('#viewAsin .form-row .btn.primary');
  await page.waitForTimeout(300);
  const afterFirst = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('pc_asinmap')).filter(m => m.asin === 'B0H99TEST1'),
    selSeries: document.getElementById('aSeries').value,
    selName: document.getElementById('aName').value
  }));
  ok('添加 ASIN（US）成功', afterFirst.saved.length === 1 && afterFirst.saved[0].country === 'US' && afterFirst.saved[0].series === 'X1', afterFirst);
  await page.fill('#aAsin', 'B0H99TEST1');
  await page.selectOption('#aCountry', 'EU');
  await page.click('#viewAsin .form-row .btn.primary');
  await page.waitForTimeout(300);
  const multi = await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('pc_asinmap')).filter(m => m.asin === 'B0H99TEST1');
    return a.map(m => m.country).sort();
  });
  ok('同一 ASIN 可分别维护 EU + US 两条', JSON.stringify(multi) === JSON.stringify(['EU','US']), multi);

  // ---------- 11. 匹配列表展开式（按系列） ----------
  const asinTab = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#asinTable .grp-head')];
    const rows = document.querySelectorAll('#asinTable .grp-row').length;
    return { heads: heads.map(h => h.textContent.trim().replace(/\d+ 条/g,'').trim()), rows };
  });
  ok('匹配列表默认折叠（按系列分组，无行）', asinTab.rows === 0 && asinTab.heads.length >= 3, asinTab);
  await page.click('#asinTable .grp-head >> nth=0');
  await page.waitForTimeout(300);
  const asinOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#asinTable .grp-row').length,
    firstRow: document.querySelector('#asinTable .grp-row')?.textContent.trim()
  }));
  ok('点击组头展开显示 ASIN 行（含国家/系列/产品名下拉）', asinOpen.rows >= 1 && asinOpen.firstRow.includes('B0'), asinOpen);
  ok('ASIN 行含国家下拉（mini-sel 3个）', await page.evaluate(() => document.querySelectorAll('#asinTable .grp-row .mini-sel').length >= 3));

  // ---------- 12. 行内国家编辑 ----------
  await page.click('#asinTable .grp-head >> nth=1'); // 展开第二组
  await page.waitForTimeout(300);
  const row2Sel = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('#asinTable .grp-row .mini-sel')];
    return sels.map(s => ({ v: s.value, a: s.dataset.a }));
  });
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('#asinTable .grp-row .mini-sel')][0];
    sel.value = 'UK';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const countryEdit = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap')).map(m => m.country));
  ok('行内国家编辑生效（存在 UK）', countryEdit.includes('UK'), countryEdit);

  // ---------- 13. 分组切换（按国家） ----------
  await page.click('#grpBtnCountry');
  await page.waitForTimeout(300);
  const byCountry = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('#asinTable .grp-head .grp-name')].map(h => h.textContent.trim()),
    segActive: document.getElementById('grpBtnCountry').classList.contains('active')
  }));
  ok('按国家分组渲染（组头含地区名）', byCountry.segActive && byCountry.heads.some(h => h.includes('EU')), byCountry);

  // ---------- 14. 旧数据迁移（无 country → 补 EU） ----------
  await page.evaluate(() => {
    localStorage.setItem('pc_asinmap', JSON.stringify([{asin:'B0HLEGACY1',series:'无',name:'无'}]));
    localStorage.removeItem('pc_open_cat'); localStorage.removeItem('pc_open_asin');
  });
  await page.reload();
  await page.waitForTimeout(600);
  const mig = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap')));
  ok('旧数据无 country 自动补 EU', mig[0].country === 'EU', mig);

  // ---------- 15. 导入带国家 CSV（独立场景，重置数据） ----------
  await seed(CAT, [{asin:'B0H69JJZ1M',series:'X1',name:'手机支架A',country:'EU'}]);
  await page.click('#tabBtnAsin');
  await page.waitForTimeout(200);
  await page.fill('#aText', 'ASIN,产品系列,产品名,国家\nB0HIMPORT1,X1,手机支架A,JP\nB0HIMPORT2,X2,充电器A,AU');
  await page.click('#viewAsin .import-box .btn.primary');
  await page.waitForTimeout(300);
  const imp = await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('pc_asinmap'));
    return a.filter(m => m.asin.startsWith('B0HIMPORT')).map(m => m.country).sort();
  });
  ok('导入支持国家列（JP/AU）', JSON.stringify(imp) === JSON.stringify(['AU','JP']), imp);

  // ---------- 16. 全部展开/折叠（ASIN） ----------
  await page.click('#btnExpandAsin');
  await page.waitForTimeout(300);
  const allAsin = await page.evaluate(() => ({
    rows: document.querySelectorAll('#asinTable .grp-row').length,
    btn: document.getElementById('btnExpandAsin').textContent
  }));
  ok('ASIN 全部展开显示所有行（3条）', allAsin.rows === 3, allAsin);
  ok('ASIN 全部展开后按钮变折叠', allAsin.btn.includes('全部折叠'), allAsin.btn);

  ok('全程无 JS 错误', errs.length === 0, errs);

  await browser.close();
  console.log(`\n===== ${pass} PASS / ${fail} FAIL =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
