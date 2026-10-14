// 云端冒烟: 验证 product.html KPI 内联下拉
const { chromium } = require('./playwright-auth');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const results = [];
  const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

  await page.goto('https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link/product.html');
  await page.waitForTimeout(2500);
  await page.evaluate(() => localStorage.removeItem('pc_kpi5'));
  await page.reload();
  await page.waitForTimeout(2500);

  const nCards = await page.evaluate(() => document.querySelectorAll('#kpiRow .kpi').length);
  ok('云端 KPI 卡片=5', nCards === 5, `count=${nCards}`);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('#kpiRow .kpi .label')].map(e => e.textContent.replace(/⚙/g, '').trim())
  );
  const expect = ['📦 订单量', '💰 销售额', '📢 广告花费', '🚀 ROAS', '🎯 转化率 CVR'];
  ok('云端默认 KPI 顺序', JSON.stringify(labels) === JSON.stringify(expect), JSON.stringify(labels));

  await page.click('#kpiRow .kpi >> nth=0');
  await page.waitForTimeout(500);
  const dd = await page.evaluate(() => {
    const el = document.getElementById('kpi-dd-0');
    return { open: el && el.classList.contains('open'), n: el ? el.querySelectorAll('.kpi-dropdown-item').length : 0 };
  });
  ok('云端点击展开内联下拉', dd.open && dd.n === 19, JSON.stringify(dd));

  await page.evaluate(() => {
    const item = [...document.querySelectorAll('#kpi-dd-0 .kpi-dropdown-item')].find(i => i.textContent.includes('买家访问次数'));
    if (item) item.click();
  });
  await page.waitForTimeout(600);
  const l2 = await page.evaluate(() => document.querySelector('#kpiRow .kpi .label').textContent.replace(/⚙/g, '').trim());
  ok('云端替换成功', l2.includes('买家访问次数'), l2);
  ok('云端无 JS 错误', errs.length === 0, JSON.stringify(errs));

  await page.evaluate(() => localStorage.removeItem('pc_kpi5'));
  await browser.close();
  let pass = 0, fail = 0;
  results.forEach(([s, n, e]) => { if (s === 'PASS') pass++; else fail++; console.log(`${s} | ${n} | ${e}`); });
  console.log(`\n${pass}/${results.length} PASS (${fail} FAIL)`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
