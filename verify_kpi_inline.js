// 验证周度汇总看板 KPI 内联下拉交互 (参照广告周度分析看板)
// 运行前提: _deploy 目录已起 http.server 8899; NODE_PATH=managed workspace node_modules
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
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⚙/g, '').trim())
  );
  const expect = ['📦 订单量', '💰 销售额', '📢 广告花费', '🚀 ROAS', '🎯 转化率 CVR'];
  ok('默认 KPI 顺序', JSON.stringify(labels) === JSON.stringify(expect), JSON.stringify(labels));

  // 3. 卡片含 ⚙ 角标 + 浅蓝底 (参照广告看板)
  const cardStyle = await page.evaluate(() => {
    const el = document.querySelector('#kpiRow .kpi');
    return {
      hasSwap: !!el.querySelector('.kpi-swap'),
      bg: getComputedStyle(el).backgroundColor,
    };
  });
  ok('卡片有 ⚙ 角标', cardStyle.hasSwap);
  ok('卡片浅蓝底', cardStyle.bg === 'rgb(240, 247, 255)', cardStyle.bg);

  // 4. 值格式: 订单量整数 / 销售额$ / 广告花费$ / ROAS x / CVR %
  const vals = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .value')].map(e => e.textContent.trim())
  );
  ok('订单量为整数', /^[\d,]+$/.test(vals[0]), vals[0]);
  ok('销售额 $ 格式', vals[1].startsWith('$'), vals[1]);
  ok('广告花费 $ 格式', vals[2].startsWith('$'), vals[2]);
  ok('ROAS x 格式', vals[3].endsWith('x'), vals[3]);
  ok('CVR % 格式', vals[4].endsWith('%'), vals[4]);

  // 5. 点击第1张卡 → 内联下拉展开 (非弹窗)
  await page.click('#kpiRow .kpi >> nth=0');
  await page.waitForTimeout(400);
  const ddState = await page.evaluate(() => {
    const dd = document.getElementById('kpi-dd-0');
    return {
      open: dd && dd.classList.contains('open'),
      count: dd ? dd.querySelectorAll('.kpi-dropdown-item').length : 0,
      hasOverlay: !!document.getElementById('kpiPicker'),
    };
  });
  ok('点击卡片展开内联下拉', ddState.open, `open=${ddState.open}`);
  ok('下拉含 19 项指标', ddState.count === 19, `count=${ddState.count}`);
  ok('无全屏弹窗残留', !ddState.hasOverlay);

  // 6. 当前项(订单量)有 ✓ 标记
  const curItem = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#kpi-dd-0 .kpi-dropdown-item')];
    const cur = items.find(i => i.querySelector('.check').textContent === '✓');
    return cur ? cur.textContent.trim() : '';
  });
  ok('当前项 ✓ 标记', curItem.includes('订单量'), curItem);

  // 7. 已用项(其余4张卡指标)淡色 ·已用, 但不禁用
  const usedInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#kpi-dd-0 .kpi-dropdown-item')];
    const used = items.filter(i => i.classList.contains('used'));
    return { n: used.length, texts: used.map(i => i.textContent.trim()) };
  });
  ok('已用项 4 个淡色标记', usedInfo.n === 4, `used=${usedInfo.n}`);
  ok('已用项带 ·已用 文本', usedInfo.texts.every(t => t.includes('·已用')), JSON.stringify(usedInfo.texts));

  // 8. 点击下拉项替换第1张为「买家访问次数」→ 下拉关闭 + label 更新
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('#kpi-dd-0 .kpi-dropdown-item')].find(i => i.textContent.includes('买家访问次数'));
    if (item) item.click();
  });
  await page.waitForTimeout(500);
  const labels2 = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⚙/g, '').trim())
  );
  ok('替换为买家访问次数', labels2[0].includes('买家访问次数'), JSON.stringify(labels2));
  const ddClosed = await page.evaluate(() => !document.getElementById('kpi-dd-0').classList.contains('open'));
  ok('替换后下拉关闭', ddClosed);
  const saved = await page.evaluate(() => localStorage.getItem('pc_kpi5'));
  ok('localStorage 已保存', saved && JSON.parse(saved)[0] === 'sessions', saved);

  // 9. 刷新后保持 (持久化)
  await page.reload();
  await page.waitForTimeout(1200);
  const labels3 = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⚙/g, '').trim())
  );
  ok('刷新后保持自定义', labels3[0].includes('买家访问次数'), JSON.stringify(labels3));

  // 10. 点击卡片外部关闭下拉
  await page.click('#kpiRow .kpi >> nth=1');
  await page.waitForTimeout(300);
  const openBefore = await page.evaluate(() => document.getElementById('kpi-dd-1').classList.contains('open'));
  await page.click('.card-title');
  await page.waitForTimeout(300);
  const openAfter = await page.evaluate(() => document.getElementById('kpi-dd-1').classList.contains('open'));
  ok('点击卡片展开下拉', openBefore);
  ok('点击外部关闭下拉', !openAfter);

  // 11. 多卡互斥: 打开卡1后点卡2, 卡1关闭
  await page.click('#kpiRow .kpi >> nth=0');
  await page.waitForTimeout(250);
  await page.click('#kpiRow .kpi >> nth=2');
  await page.waitForTimeout(250);
  const mutual = await page.evaluate(() => ({
    d0: document.getElementById('kpi-dd-0').classList.contains('open'),
    d2: document.getElementById('kpi-dd-2').classList.contains('open'),
  }));
  ok('下拉互斥(卡1关卡2开)', !mutual.d0 && mutual.d2, JSON.stringify(mutual));

  // 12. 无 JS 错误
  ok('无 JS 错误', errs.length === 0, JSON.stringify(errs));

  // 清理测试状态
  await page.evaluate(() => localStorage.removeItem('pc_kpi5'));

  await browser.close();
  let pass = 0, fail = 0;
  results.forEach(([s, n, e]) => { if (s === 'PASS') pass++; else fail++; console.log(`${s} | ${n} | ${e}`); });
  console.log(`\n${pass}/${results.length} PASS (${fail} FAIL)`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
