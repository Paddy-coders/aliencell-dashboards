// 周维度切换确定性回归: 来回切换周, KPI 数值与其他维度选择集必须完全不变
// 背景: 2026-09-07 用户反馈 W36→W35→W36 销售额变化; 根因=初始"全选"+pruneSelections 永久删除
const { chromium } = require('./playwright-auth');
let pass = 0, fail = 0;
function t(name, ok, info) { console.log((ok ? 'PASS | ' : 'FAIL | ') + name + (ok ? '' : ' | ' + JSON.stringify(info))); ok ? pass++ : fail++; }
(async () => {
  const browser = await chromium.launch();
  // ⚠️ 必须桩掉鉴权: 未登录时页面顶层的登录闸门会挡在指标区之前, #ddWeekList 永远不可见
  //    ⇒ 点击超时(2026-10-12 发现本脚本在此前就已「静默失效」: 一直抛 TimeoutError, 没人跑到它)。
  const ctx = await browser.newContext({ viewport: { width: 2200, height: 1100 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  });
  await ctx.route('**/rest/v1/mapping*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { catalog: [], asinMap: [], woot: [], wootCfg: null } }])
  }));
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR:', e.message); fail++; });
  await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard.html');
  await page.waitForTimeout(1200);

  async function totals() {
    return await page.evaluate(() => {
      const a = aggregate();
      return { sales: a.totals.sales, cost: a.totals.cost, orders: a.totals.orders, clicks: a.totals.clicks,
        state: { week: [...selWeek], country: [...selCountry], asin: [...selAsin], type: [...selType], st: [...selState], camp: [...selCampaigns], series: [...selSeries], name: [...selName] } };
    });
  }
  async function clickWeek(label) {
    await page.evaluate(() => { document.getElementById('ddWeek').classList.add('open'); buildWeekOptions(); });
    await page.waitForTimeout(120);
    const idx = await page.evaluate(lb => [...document.querySelectorAll('#ddWeekList .dd-opt .opt-name')].findIndex(o => o.textContent.trim() === lb), label);
    await page.locator('#ddWeekList .dd-opt').nth(idx).click();
    await page.waitForTimeout(250);
  }

  // --- 场景1: 用户原始路径 W36→W35→W36 ---
  await clickWeek('W36'); const w36a = await totals();
  await clickWeek('W35'); const w35 = await totals();
  await clickWeek('W36'); const w36b = await totals();
  t('场景1: W36 销售额往返一致', w36a.sales === w36b.sales, { first: w36a.sales, second: w36b.sales });
  t('场景1: W35 销售额与 W36 不同(周确实生效)', w35.sales !== w36b.sales, w35);
  t('场景1: 切换不改变其他维度选择', JSON.stringify(w36a.state) === JSON.stringify(w36b.state), { a: w36a.state, b: w36b.state });

  // --- 场景2: 经过窄周(覆盖差异大的周) 再回 W36 ---
  await clickWeek('W33'); const w33 = await totals();
  await clickWeek('W36'); const w36c = await totals();
  t('场景2: W33→W36 后 W36 销售额仍一致', w36a.sales === w36c.sales, { first: w36a.sales, afterW33: w36c.sales });
  t('场景2: 切换不改变其他维度选择', JSON.stringify(w36a.state) === JSON.stringify(w36c.state), { a: w36a.state, c: w36c.state });
  t('场景2: W33 数值确定', w33.sales > 0, w33);

  // --- 场景3: 全部↔W36 往返(单击唯一已选项=取消回全部) ---
  // 进入本场景时 W36 为唯一选中态: 点1次→全部, 点2次→W36, 点3次→全部
  await clickWeek('W36'); const allA = await totals();
  await clickWeek('W36'); const w36d = await totals();
  await clickWeek('W36'); const allB = await totals();
  t('场景3: W36 选中值与场景1一致', w36d.sales === w36a.sales, { w36d: w36d.sales, w36a: w36a.sales });
  t('场景3: 全部↔W36 往返数值一致', allA.sales === allB.sales, { allA: allA.sales, allB: allB.sales });
  t('场景3: 切换不改变其他维度选择', JSON.stringify(allA.state) === JSON.stringify(allB.state), { a: allA.state, b: allB.state });

  // --- 场景4: 空集=全部, KPI 应等于全数据聚合 ---
  const allTotals = await page.evaluate(() => { const s = { sales: 0, cost: 0 }; DATA.records.forEach(r => { s.sales += (+r.sales || 0); s.cost += (+r.cost || 0); }); return s; });
  t('场景4: 空集=全部 聚合等于全量求和', Math.abs(allA.sales - allTotals.sales) < 0.01 && Math.abs(allA.cost - allTotals.cost) < 0.01, { agg: allA, raw: allTotals });

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
