// Bug2 修复验证: 周多选后筛选产品(无数据)→周筛选应自动重置; 部分重叠→修剪; 范围外选项置灰可点
// 用法: NODE_PATH=<node workspace> node test_week_reset_verify.js
const { chromium } = require('./playwright-auth');
const path = require('path');
const PRODUCT = 'file:///' + path.resolve(__dirname, '..', '2026-08-17-14-21-33', 'filterable_dashboard.html').replace(/\\/g, '/');
const AD = 'file:///' + path.resolve(__dirname, 'ad_dashboard.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

(async () => {
  const browser = await chromium.launch();

  // ================= 产品看板 =================
  console.log('\n========== 产品看板 (filterable_dashboard.html) ==========');
  {
    const page = await browser.newPage();
    // 拦截云端映射拉取: 避免云映射与本地不一致触发 location.reload() 销毁执行上下文(竞态)
    await page.route('https://oovvqvgrjqwogjwswaxx.supabase.co/**', r => r.abort());
    await page.goto(PRODUCT);
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const aw = {};
      DATA.asin_list.forEach(a => { aw[a] = Object.keys(DATA.asins[a].weeks || {}); });
      return { weeks: DATA.weeks.map(w => w.label), aw };
    });
    const [wa, wb] = [info.weeks[0], info.weeks[1]];
    const onlyA = Object.keys(info.aw).find(a => info.aw[a].includes(wa) && !info.aw[a].includes(wb));
    const neither = Object.keys(info.aw).find(a => !info.aw[a].includes(wa) && !info.aw[a].includes(wb) && info.aw[a].length > 0);
    console.log(`测试周: ${wa}+${wb}; 仅${wa}有数据: ${onlyA}; 两周均无数据: ${neither}`);

    // --- 用例1: 多选两周后, 无数据产品应可见(置灰) ---
    await page.evaluate(({ wa, wb }) => { selWeek.clear(); selWeek.add(wa); selWeek.add(wb); syncAndRender(); }, { wa, wb });
    const vis = await page.evaluate((Q) => {
      const el = [...document.querySelectorAll('#ddAsinList .dd-opt')].find(o => o.dataset.asin === Q);
      return el ? { dim: el.classList.contains('dim') } : null;
    }, neither);
    ok(vis && vis.dim, `用例1: 无数据产品 ${neither} 置灰可见`);

    // --- 用例2: 点击该产品 → 周筛选应重置为全部, 产品保留 ---
    await page.evaluate((Q) => { lastFilterDim = 'asin'; selAsin.clear(); selAsin.add(Q); syncAndRender(); }, neither);
    const r2 = await page.evaluate(() => ({
      selWeek: [...selWeek], selAsin: [...selAsin],
      weekSum: document.getElementById('ddWeekSummary').textContent.trim(),
      asinSum: document.getElementById('ddAsinSummary').textContent.trim()
    }));
    ok(r2.selWeek.length === 0, `用例2a: 周筛选已重置 (selWeek=${JSON.stringify(r2.selWeek)}=全部)`);
    ok(r2.selAsin.length === 1 && r2.selAsin[0] === neither, `用例2b: 产品保留 (selAsin=${r2.selAsin[0]})`);
    ok(r2.weekSum === '全部', `用例2c: 周摘要="全部" (实际: ${r2.weekSum})`);
    const rows = await page.evaluate(() => document.querySelectorAll('#sumBody tr').length);
    ok(rows > 0, `用例2d: 表格有数据行 (${rows} 行)`);

    // --- 用例3: 真实 UI 路径 — 多选两周后点击置灰产品 ---
    await page.evaluate(() => { init(); });  // 重置到初始状态
    await page.waitForTimeout(300);
    await page.click('#ddWeek > .dd-btn');
    await page.waitForTimeout(200);
    await page.click(`#ddWeekList .dd-opt[data-week="${wa}"]`);
    await page.waitForTimeout(150);
    await page.keyboard.down('Control');
    await page.click(`#ddWeekList .dd-opt[data-week="${wb}"]`);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.click('#ddAsin > .dd-btn');
    await page.waitForTimeout(200);
    const qOpt = await page.$(`#ddAsinList .dd-opt[data-asin="${neither}"]`);
    ok(!!qOpt, '用例3a: 置灰产品在下拉中可找到');
    if (qOpt) {
      await qOpt.click();
      await page.waitForTimeout(300);
      const r3 = await page.evaluate(() => ({
        selWeek: [...selWeek], selAsin: [...selAsin],
        weekSum: document.getElementById('ddWeekSummary').textContent.trim()
      }));
      ok(r3.selWeek.length === 0 && r3.selAsin.length === 1, `用例3b: 真实点击后 周重置+产品保留 (week=${JSON.stringify(r3.selWeek)}, asin=${r3.selAsin.length}个)`);
      ok(r3.weekSum === '全部', `用例3c: 周摘要="全部" (实际: ${r3.weekSum})`);
    }

    // --- 用例4: 部分重叠 — 选"仅 wa 有数据"的产品 → wb 应被修剪 ---
    await page.evaluate(({ onlyA, wa, wb }) => {
      selWeek.clear(); selWeek.add(wa); selWeek.add(wb);
      selAsin.clear(); selAsin.add(onlyA);
      lastFilterDim = 'asin';
      syncAndRender();
    }, { onlyA, wa, wb });
    const r4 = await page.evaluate(() => ({ selWeek: [...selWeek], selAsin: [...selAsin] }));
    ok(r4.selWeek.length === 1 && r4.selWeek[0] === wa && r4.selAsin[0] === onlyA, `用例4: 部分重叠修剪正确 (week=${r4.selWeek.join(',')}, asin保留=${r4.selAsin[0] === onlyA})`);

    // --- 用例5: 周筛选点击(反向) — 选中产品后点无数据周 → 产品重置为全部(原行为不变) ---
    await page.evaluate(({ neither, wa }) => {
      selWeek.clear(); selAsin.clear(); selAsin.add(neither);
      lastFilterDim = 'week';
      selWeek.add(wa);   // neither 在 wa 无数据
      syncAndRender();
    }, { neither, wa });
    const r5 = await page.evaluate(() => ({ selWeek: [...selWeek], selAsin: [...selAsin] }));
    ok(r5.selWeek.length === 1 && r5.selAsin.length === 0, `用例5: 点周后产品重置为全部 (week=${r5.selWeek.join(',')}, asin=全部)`);

    // --- 用例6: 周下拉显示置灰周(所选产品无数据) ---
    await page.evaluate((Q) => { selAsin.clear(); selAsin.add(Q); selWeek.clear(); syncAndRender(); }, neither);
    const r6 = await page.evaluate(() => [...document.querySelectorAll('#ddWeekList .dd-opt.dim')].length);
    ok(r6 > 0, `用例6: 周下拉显示置灰的无数据周 (${r6} 个)`);

    await page.close();
  }

  // ================= 广告看板 =================
  console.log('\n========== 广告看板 (ad_dashboard.html) ==========');
  {
    const page = await browser.newPage();
    await page.route('https://oovvqvgrjqwogjwswaxx.supabase.co/**', r => r.abort());
    await page.goto(AD);
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const aw = {};
      DATA.records.forEach(r => { (aw[r.asin] = aw[r.asin] || []).push(r.week); });
      Object.keys(aw).forEach(a => { aw[a] = [...new Set(aw[a])]; });
      return { weeks: DATA.weeks.map(w => w.label), aw };
    });
    const [wa, wb] = [info.weeks[0], info.weeks[1]];
    const neither = Object.keys(info.aw).find(a => !info.aw[a].includes(wa) && !info.aw[a].includes(wb) && info.aw[a].length > 0);
    console.log(`测试周: ${wa}+${wb}; 两周均无数据的产品: ${neither}`);
    if (!neither) { console.log('  (跳过: 找不到符合条件的 ASIN)'); }
    else {
      // 多选两周 → 点置灰产品 → 周重置
      await page.evaluate(({ wa, wb }) => { selWeek.clear(); selWeek.add(wa); selWeek.add(wb); syncAndRender(); }, { wa, wb });
      const vis = await page.evaluate((Q) => {
        const el = [...document.querySelectorAll('#ddAsinList .dd-opt')].find(o => o.textContent.includes(Q));
        return el ? { dim: el.classList.contains('dim') } : null;
      }, neither);
      ok(vis && vis.dim, `用例A1: 无数据产品 ${neither} 置灰可见`);

      await page.evaluate((Q) => { lastFilterDim = 'asin'; selAsin.clear(); selAsin.add(Q); syncAndRender(); }, neither);
      const rA = await page.evaluate(() => ({
        selWeek: [...selWeek], selAsin: [...selAsin],
        weekSum: document.getElementById('ddWeekSummary').textContent.trim()
      }));
      ok(rA.selWeek.length === 0, `用例A2a: 周筛选已重置 (${JSON.stringify(rA.selWeek)}=全部)`);
      ok(rA.selAsin.length === 1, `用例A2b: 产品保留`);
      ok(rA.weekSum === '全部', `用例A2c: 周摘要="全部" (实际: ${rA.weekSum})`);

      // 真实 UI: Ctrl 多选两周 → 下拉点击置灰产品
      await page.evaluate(() => { init(); });
      await page.waitForTimeout(300);
      await page.click('#ddWeek > .dd-btn');
      await page.waitForTimeout(200);
      const weekOpts = page.locator('#ddWeekList .dd-opt');
      await weekOpts.nth(0).click();          // wa (第一周)
      await page.waitForTimeout(150);
      await page.keyboard.down('Control');
      await weekOpts.nth(1).click();          // wb (第二周)
      await page.keyboard.up('Control');
      await page.waitForTimeout(200);
      await page.click('#ddAsin > .dd-btn');
      await page.waitForTimeout(200);
      const qOpt = await page.$(`#ddAsinList .dd-opt:has-text("${neither}")`);
      ok(!!qOpt, '用例A3a: 置灰产品在下拉中可找到');
      if (qOpt) {
        await qOpt.click();
        await page.waitForTimeout(300);
        const r3 = await page.evaluate(() => ({ selWeek: [...selWeek], selAsin: [...selAsin] }));
        ok(r3.selWeek.length === 0 && r3.selAsin.length === 1, `用例A3b: 真实点击后 周重置+产品保留 (week=${JSON.stringify(r3.selWeek)}, asin=${r3.selAsin.length}个)`);
      }
    }
    await page.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
