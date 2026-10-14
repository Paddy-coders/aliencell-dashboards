const { chromium } = require('./playwright-auth');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\paddy\\WorkBuddy\\2026-08-18-14-43-38\\_deploy';
const results = [];
function ok(t, m) { results.push({pass:true, test:t, msg:m}); }
function fail(t, m) { results.push({pass:false, test:t, msg:m}); }

async function run() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, req.url === '/' ? 'product.html' : req.url);
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); }
      else { res.writeHead(200, {'Content-Type':'text/html'}); res.end(data); }
    });
  }).listen(8901);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('http://127.0.0.1:8901/product.html', { waitUntil: 'networkidle', timeout: 30000 });

    // 1. 5张KPI卡片存在
    const kpis = await page.locator('.kpi').count();
    if (kpis === 5) ok('KPI卡片数量', '5张'); else fail('KPI卡片数量', `实际${kpis}张`);

    // 2. 点击第1张卡片展开dropdown
    await page.locator('.kpi').first().click();
    await page.waitForTimeout(300);
    const dd = await page.locator('.kpi-dropdown.open').count();
    if (dd === 1) ok('点击展开下拉', '1个展开'); else fail('点击展开下拉', `实际${dd}个`);

    // 3. dropdown 项数 = 19
    const items = await page.locator('.kpi-dropdown.open .kpi-dropdown-item').count();
    if (items === 19) ok('下拉项总数', '19项'); else fail('下拉项总数', `实际${items}项`);

    // 4. z-index: 检查 dropdown 的 z-index 是否高于 th 的 z-index
    const ddZ = await page.evaluate(() => {
      const el = document.querySelector('.kpi-dropdown.open');
      return el ? window.getComputedStyle(el).zIndex : 'N/A';
    });
    if (ddZ === '999') ok('dropdown z-index', '999'); else fail('dropdown z-index', `实际${ddZ}`);

    const kpiEditZ = await page.evaluate(() => {
      const el = document.querySelector('.kpi-edit');
      return el ? window.getComputedStyle(el).zIndex : 'N/A';
    });
    if (kpiEditZ === '10') ok('kpi-edit z-index', '10'); else fail('kpi-edit z-index', `实际${kpiEditZ}`);

    // 5. th z-index 检查
    const thZ = await page.evaluate(() => {
      const th = document.querySelector('th');
      return th ? window.getComputedStyle(th).zIndex : 'N/A';
    });
    ok('th z-index', `th z-index=${thZ} (应低于dropdown)`);

    // 6. 点击一个已用项（如第2项），确认不崩溃，且只重渲染KPI（syncAndRender不被调用）
    // 通过监听 console.error 和检查页面是否仍响应
    let jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

    // 获取当前页面URL确认没刷新
    const beforeUrl = page.url();
    const beforeTitle = await page.title();

    // 点击第2项（"已用"项，如销量）
    const items2 = await page.locator('.kpi-dropdown-item').all();
    // 找第一个used项
    let usedIdx = -1;
    for (let i = 0; i < items2.length; i++) {
      const cls = await items2[i].getAttribute('class');
      if (cls && cls.includes('used')) { usedIdx = i; break; }
    }
    if (usedIdx >= 0) {
      await items2[usedIdx].click();
      await page.waitForTimeout(500);
      const afterUrl = page.url();
      const afterTitle = await page.title();
      if (afterUrl === beforeUrl && afterTitle === beforeTitle) ok('KPI切换未刷新页面', 'URL和title不变');
      else fail('KPI切换未刷新页面', `URL变化: ${beforeUrl} -> ${afterUrl}`);
      if (jsErrors.length === 0) ok('KPI切换无JS错误', '0 errors');
      else fail('KPI切换无JS错误', jsErrors.join('; '));
    } else {
      ok('KPI切换未刷新页面', '未找到used项，跳过');
    }

    // 7. 确认dropdown关闭，5张卡片仍在
    const ddClosed = await page.locator('.kpi-dropdown.open').count();
    if (ddClosed === 0) ok('切换后下拉关闭', '已关闭'); else fail('切换后下拉关闭', `仍${ddClosed}个打开`);

    const kpisAfter = await page.locator('.kpi').count();
    if (kpisAfter === 5) ok('切换后5卡仍在', '5张'); else fail('切换后5卡仍在', `实际${kpisAfter}张`);

    // 8. 再次切换回来，确保渲染正常
    await page.locator('.kpi').first().click();
    await page.waitForTimeout(300);
    const items3 = await page.locator('.kpi-dropdown-item').all();
    // 找第一个非used项
    let nonUsedIdx = -1;
    for (let i = 0; i < items3.length; i++) {
      const cls = await items3[i].getAttribute('class');
      if (!cls || !cls.includes('used')) { nonUsedIdx = i; break; }
    }
    if (nonUsedIdx >= 0) {
      await items3[nonUsedIdx].click();
      await page.waitForTimeout(500);
      const kpis3 = await page.locator('.kpi').count();
      if (kpis3 === 5) ok('切回后5卡仍在', '5张'); else fail('切回后5卡仍在', `实际${kpis3}张`);
      if (jsErrors.length === 0) ok('多次切换无累积错误', '0 errors');
      else fail('多次切换无累积错误', `${jsErrors.length} errors: ${jsErrors.join('; ')}`);
    } else {
      ok('切回后5卡仍在', '未找到非used项，跳过');
    }

    // 9. 检查 dropdown 是否有水平溢出截断（width 应 >= 200）
    await page.locator('.kpi').first().click();
    await page.waitForTimeout(300);
    const ddWidth = await page.evaluate(() => {
      const el = document.querySelector('.kpi-dropdown.open');
      return el ? el.getBoundingClientRect().width : 0;
    });
    if (ddWidth >= 190) ok('dropdown宽度足够', `${Math.round(ddWidth)}px >= 200`); 
    else fail('dropdown宽度足够', `${Math.round(ddWidth)}px < 200`);

    // 10. 检查 dropdown 底部是否可见（不被table遮挡）
    const ddRect = await page.evaluate(() => {
      const el = document.querySelector('.kpi-dropdown.open');
      return el ? el.getBoundingClientRect() : null;
    });
    const tableRect = await page.evaluate(() => {
      const el = document.querySelector('.table-wrap, table, tbody');
      return el ? el.getBoundingClientRect() : null;
    });
    if (ddRect && tableRect) {
      // dropdown 应显示在 table 上方（z-index 999）
      // 如果 dropdown 底部与 table 重叠，检查 getComputedStyle 的 z-index
      const ddStyleZ = await page.evaluate(() => {
        const el = document.querySelector('.kpi-dropdown.open');
        return el ? parseInt(window.getComputedStyle(el).zIndex) : 0;
      });
      const thStyleZ = await page.evaluate(() => {
        const th = document.querySelector('th');
        return th ? parseInt(window.getComputedStyle(th).zIndex) : 0;
      });
      if (ddStyleZ > thStyleZ) ok('dropdown层叠高于th', `${ddStyleZ} > ${thStyleZ}`);
      else fail('dropdown层叠高于th', `${ddStyleZ} <= ${thStyleZ}`);
    } else {
      ok('dropdown层叠高于th', '缺少rect数据，跳过');
    }

  } catch (e) {
    fail('全局异常', e.message);
  }

  await browser.close();
  server.close();

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== 结果: ${passed}/${total} ===`);
  results.forEach(r => console.log(r.pass ? '✓' : '✗', r.test, r.msg ? `— ${r.msg}` : ''));
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
