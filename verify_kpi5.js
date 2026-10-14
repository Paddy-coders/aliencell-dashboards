// 验证周度汇总看板 KPI 5卡可替换功能
// 运行前提: _deploy 目录已起 http.server 8899
const { chromium } = require('./playwright-auth');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const results = [];
  const ok = (name, cond, extra = '') => {
    results.push([cond ? 'PASS' : 'FAIL', name, extra]);
  };

  await page.goto('http://127.0.0.1:8899/product.html');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.removeItem('pc_kpi5'));
  await page.reload();
  await page.waitForTimeout(1200);

  // 1. KPI 卡片数量 = 5
  const nCards = await page.evaluate(() => document.querySelectorAll('#kpiRow .kpi').length);
  ok('KPI 卡片数量为 5', nCards === 5, `count=${nCards}`);

  // 2. 默认 5 卡 label 顺序: 订单量/销售额/广告花费/ROAS/转化率 CVR
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⇄/g, '').trim())
  );
  const expect = ['📦 订单量', '💰 销售额', '📢 广告花费', '🚀 ROAS', '🎯 转化率 CVR'];
  ok('默认 KPI 顺序', JSON.stringify(labels) === JSON.stringify(expect), JSON.stringify(labels));

  // 3. 值格式: 订单量整数 / 销售额$ / 广告花费$ / ROAS x / CVR %
  const vals = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .value')].map(e => e.textContent.trim())
  );
  ok('订单量为整数', /^[\d,]+$/.test(vals[0]), vals[0]);
  ok('销售额 $ 格式', vals[1].startsWith('$'), vals[1]);
  ok('广告花费 $ 格式', vals[2].startsWith('$'), vals[2]);
  ok('ROAS x 格式', vals[3].endsWith('x'), vals[3]);
  ok('CVR % 格式', vals[4].endsWith('%'), vals[4]);

  // 4. 卡片 hover 有更换提示(title)
  const hasSwap = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi')].every(e => e.getAttribute('title') && e.classList.contains('kpi-edit'))
  );
  ok('卡片可点击(title/kpi-edit)', hasSwap);

  // 5. 点击第1张卡 → 弹选择器
  await page.click('#kpiRow .kpi >> nth=0');
  await page.waitForTimeout(400);
  const pickerVisible = await page.evaluate(() =>
    document.getElementById('kpiPicker').style.display === 'flex'
  );
  const optCount = await page.evaluate(() => document.querySelectorAll('#kpiPicker .kpi-opt').length);
  ok('点击卡片弹出选择器', pickerVisible && optCount === 19, `opts=${optCount}`);

  // 6. 已用指标(非当前)禁用
  const disabledCount = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiPicker .kpi-opt')].filter(b => b.disabled).length
  );
  ok('已用指标禁用(4个)', disabledCount === 4, `disabled=${disabledCount}`);
  const curLabel = await page.evaluate(() => document.querySelector('#kpiPicker .kpi-opt.cur')?.textContent.trim() || '');
  ok('当前卡片高亮', curLabel.includes('订单量'), curLabel);

  // 7. 替换第1张为「买家访问次数」
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#kpiPicker .kpi-opt')].find(b => b.textContent.includes('买家访问次数'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  const labels2 = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⇄/g, '').trim())
  );
  ok('替换为买家访问次数', labels2[0].includes('买家访问次数'), JSON.stringify(labels2));
  const saved = await page.evaluate(() => localStorage.getItem('pc_kpi5'));
  ok('localStorage 已保存', saved && JSON.parse(saved)[0] === 'sessions', saved);

  // 8. 刷新后保持 (持久化)
  await page.reload();
  await page.waitForTimeout(1200);
  const labels3 = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⇄/g, '').trim())
  );
  ok('刷新后保持自定义', labels3[0].includes('买家访问次数'), JSON.stringify(labels3));

  // 9. 选择器取消按钮关闭
  await page.click('#kpiRow .kpi >> nth=2');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('#kpiPicker .kpi-picker-close .btn')][0];
    if (c) c.click();
  });
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => document.getElementById('kpiPicker').style.display === 'none');
  ok('取消关闭选择器', hidden);

  // 10. 无 JS 错误
  ok('无 JS 错误', errs.length === 0, JSON.stringify(errs));

  // 清理测试状态
  await page.evaluate(() => localStorage.removeItem('pc_kpi5'));

  await browser.close();
  let pass = 0, fail = 0;
  results.forEach(([s, n, e]) => { if (s === 'PASS') pass++; else fail++; console.log(`${s} | ${n} | ${e}`); });
  console.log(`\n${pass}/${results.length} PASS (${fail} FAIL)`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
