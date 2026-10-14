const { chromium } = require('./playwright-auth');
const results = [];
function ok(t, m) { results.push({pass:true, test:t, msg:m}); }
function fail(t, m) { results.push({pass:false, test:t, msg:m}); }

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const url = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link/product.html';
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    let jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

    // 1. 5张KPI卡片
    const kpis = await page.locator('.kpi').count();
    if (kpis === 5) ok('云端5卡存在', '5张'); else fail('云端5卡存在', `${kpis}张`);

    // 2. 点击展开dropdown
    await page.locator('.kpi').first().click();
    await page.waitForTimeout(500);
    const dd = await page.locator('.kpi-dropdown.open').count();
    if (dd === 1) ok('云端点击展开下拉', '展开'); else fail('云端点击展开下拉', `未展开(${dd})`);

    // 3. 19项
    const items = await page.locator('.kpi-dropdown.open .kpi-dropdown-item').count();
    if (items === 19) ok('云端下拉19项', '19项'); else fail('云端下拉19项', `${items}项`);

    // 4. z-index 足够
    const ddZ = await page.evaluate(() => {
      const el = document.querySelector('.kpi-dropdown.open');
      return el ? window.getComputedStyle(el).zIndex : 'N/A';
    });
    if (ddZ === '999') ok('云端dropdown z-index', '999'); else fail('云端dropdown z-index', ddZ);

    const kpiZ = await page.evaluate(() => {
      const el = document.querySelector('.kpi-edit');
      return el ? window.getComputedStyle(el).zIndex : 'N/A';
    });
    if (kpiZ === '10') ok('云端kpi-edit z-index', '10'); else fail('云端kpi-edit z-index', kpiZ);

    // 5. 切换KPI不崩溃
    const beforeUrl = page.url();
    const items2 = await page.locator('.kpi-dropdown-item').all();
    let usedIdx = -1;
    for (let i = 0; i < items2.length; i++) {
      const cls = await items2[i].getAttribute('class');
      if (cls && cls.includes('used')) { usedIdx = i; break; }
    }
    if (usedIdx >= 0) {
      await items2[usedIdx].click();
      await page.waitForTimeout(1000);
      if (page.url() === beforeUrl) ok('云端切换未刷新', 'URL不变');
      else fail('云端切换未刷新', `URL变化`);
      if (jsErrors.length === 0) ok('云端切换无JS错误', '0 errors');
      else fail('云端切换无JS错误', jsErrors.join('; '));
    } else {
      ok('云端切换未刷新', '无used项，跳过');
    }

    // 6. 切换后5卡正常
    const kpis2 = await page.locator('.kpi').count();
    if (kpis2 === 5) ok('云端切换后5卡', '5张'); else fail('云端切换后5卡', `${kpis2}张`);

  } catch (e) {
    fail('云端全局异常', e.message);
  }
  await browser.close();

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== 云端冒烟: ${passed}/${total} ===`);
  results.forEach(r => console.log(r.pass ? '✓' : '✗', r.test, r.msg ? `— ${r.msg}` : ''));
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
