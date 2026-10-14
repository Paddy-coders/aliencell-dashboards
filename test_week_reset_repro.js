// Bug2 复现: 周多选后筛选产品, 产品在所选周无数据时周筛选不重置
// 用法: NODE_PATH=<node workspace> node test_week_reset_repro.js
const { chromium } = require('./playwright-auth');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, '..', '2026-08-17-14-21-33', 'filterable_dashboard.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(FILE);
  await page.waitForTimeout(800);

  // 1. 数据画像: 每周有哪些 ASIN
  const info = await page.evaluate(() => {
    const weeks = DATA.weeks.map(w => w.label);
    const asinWeeks = {};
    DATA.asin_list.forEach(a => { asinWeeks[a] = Object.keys(DATA.asins[a].weeks || {}); });
    return { weeks, asinWeeks, nAsins: DATA.asin_list.length };
  });
  console.log('周列表:', info.weeks.join(', '));
  console.log('ASIN 总数:', info.nAsins);

  // 找: W_a(早周) 与 W_b(早周) 中很多 ASIN 无数据; 找 Q = 在 W_a/W_b 均无数据的 ASIN
  const wa = info.weeks[0], wb = info.weeks[1];
  const inA = Object.keys(info.asinWeeks).filter(a => info.asinWeeks[a].includes(wa));
  const inB = Object.keys(info.asinWeeks).filter(a => info.asinWeeks[a].includes(wb));
  const neither = Object.keys(info.asinWeeks).filter(a => !info.asinWeeks[a].includes(wa) && !info.asinWeeks[a].includes(wb));
  console.log(`${wa} 有数据的 ASIN: ${inA.length}; ${wb}: ${inB.length}; 两周均无数据: ${neither.length}`);
  const Q = neither[0], P = inA[0];
  console.log('P(有数据示例):', P, ' Q(两周均无数据):', Q);

  // 2. 场景B: 多选两周后, Q 是否出现在子ASIN下拉里
  const state = await page.evaluate(({ wa, wb }) => {
    selWeek.clear(); selWeek.add(wa); selWeek.add(wb);
    syncAndRender();
    const opts = [...document.querySelectorAll('#ddAsinList .dd-opt')].map(o => o.dataset.asin);
    return { selWeekAfter: [...selWeek], asinOpts: opts, selAsinSize: selAsin.size };
  }, { wa, wb });
  console.log('\n[场景B] 多选', wa, '+', wb, '后:');
  console.log('  ASIN 下拉可见数量:', state.asinOpts.length, ' Q 在下拉中?', state.asinOpts.includes(Q));
  console.log('  selAsin(修剪后)大小:', state.selAsinSize, '/', info.nAsins);

  // 3. 场景C: 模拟用户强行选中 Q(若可见则点击, 否则直接改状态) → 观察修剪行为
  const res = await page.evaluate((Q) => {
    selAsin.clear(); selAsin.add(Q);   // 用户点击 Q 的效果
    syncAndRender();
    return {
      selAsinAfter: [...selAsin],
      selWeekAfter: [...selWeek],
      weekSummary: document.getElementById('ddWeekSummary').textContent.trim(),
      asinSummary: document.getElementById('ddAsinSummary').textContent.trim()
    };
  }, Q);
  console.log('\n[场景C] 选中 Q(在所选周无数据)后:');
  console.log('  selAsin =', JSON.stringify(res.selAsinAfter), '(空=全部, 即 Q 被丢弃)');
  console.log('  selWeek =', JSON.stringify(res.selWeekAfter), '(未重置!)');
  console.log('  周摘要:', res.weekSummary, ' ASIN摘要:', res.asinSummary);

  // 4. 场景A: 部分重叠 — 选 P(仅在 wa 有数据) → wb 应被修剪
  const resA = await page.evaluate(({ P, wa, wb }) => {
    selWeek.clear(); selWeek.add(wa); selWeek.add(wb);
    selAsin.clear(); selAsin.add(P);
    syncAndRender();
    return { selWeek: [...selWeek], selAsin: [...selAsin] };
  }, { P, wa, wb });
  console.log('\n[场景A] 选 P(仅', wa, '有数据) + 多选两周 → selWeek =', JSON.stringify(resA.selWeek), '(应只剩', wa + ')', resA.selWeek.length === 1 && resA.selWeek[0] === wa ? '✓ 正常' : '✗ 异常');

  await browser.close();
})();
