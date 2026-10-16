/* 回归：daily.html 头程优先取推演数据(mapping.freight)，未覆盖回退成本表预估
 * 姿势：page.route 拦截 rest/v1/mapping*（假后端，零生产写入）；期望值全部由页面内函数动态计算
 * 覆盖：① freight 云端同步段(reload 生效) ② freightHeadOf 命中/回退 ③ aggRows().pHead 集成口径
 */
const pw = require('./playwright-auth');   // 注入 wb_auth 登录态（看板有认证守卫）
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'daily.html').replace(/\\/g, '/');

// 固定 fixture：freight 只覆盖「X1系列蜂窝板」2026-10-10 那一周（allocPrice=100 CNY/台）
const FREIGHT = {
  schema: 'freight-alloc-v2',
  pushedAt: '2026-10-16T07:00:00.000Z',
  payload: {
    schema: 'freight-alloc-v2', generatedAt: '2026-10-16T07:00:00.000Z', currency: 'CNY',
    methods: {
      WA: { label: '移动加权平均', groups: [{
        series: 'X1系列配件', name: 'X1系列蜂窝板',
        weeks: [{ batch: '2026-10-13', date: '2026-10-13', weekStart: '2026-10-10',
                  weekLabel: '10-10~10-16', sold: 3, carryPrice: 100, allocPrice: 100, alloc: 300 }],
        totals: { sold: 3, alloc: 300, remainQty: 0, remainCost: 0 } }], totals: {} },
      CUM: { label: '累计到货均价', groups: [], totals: {} },
      FIFO: { label: 'FIFO', groups: [], totals: {} }
    }
  }
};
const MAPPING_ROW = [{
  id: 1, updated_at: '2026-10-16T07:00:00.000Z',
  data: {
    catalog: [{ name: 'X1系列蜂窝板', series: 'X1系列配件' }, { name: '滚轴', series: 'X1系列配件' }],
    asinMap: [{ asin: 'B0H6QGKLJK', name: 'X1系列蜂窝板', series: 'X1系列配件', country: 'US' }],
    woot: [], wootCfg: { price: 1380, cost: {} },
    freight: FREIGHT
  }
}];

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  actual=' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/mapping*', route => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MAPPING_ROW) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto(FILE, { waitUntil: 'networkidle', timeout: 60000 });
  // 等 freight 云端同步段写本机 + 自动 reload 生效（页面自己会 reload，不手动干预避免竞态）
  await page.waitForFunction(() => { try { return !!localStorage.getItem('pc_freight'); } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);

  console.log('[1] freight 云端同步段');
  const synced = await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('pc_freight') || 'null');
    return f && f.schema === 'freight-alloc-v2' && f.pushedAt === '2026-10-16T07:00:00.000Z';
  });
  assert('mapping.freight 已拉取写本机(含自动 reload)', synced);

  console.log('[2] freightHeadOf 命中与回退');
  const unit = await page.evaluate(() => ({
    hit: freightHeadOf('B0H6QGKLJK', '2026-10-14'),        // 该产品该周有推演 → 100
    wkKey: freightWeekStart('2026-10-14'),                  // 周六~周五：10-14 → 10-10
    missWeek: freightHeadOf('B0H6QGKLJK', '2026-10-02'),    // 该产品但不在推演周 → null(回退)
    missProd: freightHeadOf('B0H6QDJQR5', '2026-10-14'),    // 产品不在推演数据 → null(回退)
    badDate: freightHeadOf('B0H6QGKLJK', '')                // 坏日期 → null
  }));
  assert('周 key(周六起算) 10-14 → 10-10', unit.wkKey === '2026-10-10', unit.wkKey);
  assert('命中: 覆盖产品×周 → 100 CNY/台', unit.hit === 100, unit.hit);
  assert('回退: 该周无推演 → null', unit.missWeek === null, unit.missWeek);
  assert('回退: 产品不在推演 → null', unit.missProd === null, unit.missProd);
  assert('容错: 坏日期 → null', unit.badDate === null, unit.badDate);

  console.log('[3] pHead 集成口径 (动态期望值)');
  const integ = await page.evaluate(() => {
    const day = '2026-10-14';
    const prows = (PROFIT_BY_DAY[day] || []);
    const expFreight = prows.reduce((s, pr) => {
      const fr = freightHeadOf(pr.as, day);
      return s + convHead(fr != null ? fr : headRmbOf(pr.as, pr.site), pr.qty, '2026-10');
    }, 0);
    const coveredQty = prows.filter(pr => freightHeadOf(pr.as, day) != null).reduce((s, pr) => s + pr.qty, 0);
    return { got: aggRows(day, null, null).pHead, exp: expFreight, coveredQty, rows: prows.length };
  });
  assert('该日存在推演覆盖的销量行(断言自检, coveredQty>0)', integ.coveredQty > 0, integ.coveredQty);
  assert('pHead(推演优先) = 动态期望值', Math.abs(integ.got - integ.exp) < 1e-6, integ);

  console.log('[4] 回退口径：无推演数据时 pHead 与原成本表预估一致');
  const fallback = await page.evaluate((freightFixture) => {
    const day = '2026-10-14';
    try { localStorage.removeItem('pc_freight'); } catch (e) {}   // 临时摘除推演数据 → 应回退预估
    const prows = (PROFIT_BY_DAY[day] || []);
    const expBase = prows.reduce((s, pr) => s + convHead(headRmbOf(pr.as, pr.site), pr.qty, '2026-10'), 0);
    const got = aggRows(day, null, null).pHead;
    const missAfterRemove = freightHeadOf('B0H6QGKLJK', day);      // 摘除后必须回退 null
    try { localStorage.setItem('pc_freight', JSON.stringify(freightFixture)); } catch (e) {}  // 还原
    const restored = freightHeadOf('B0H6QGKLJK', day) === 100;
    return { got, exp: expBase, missAfterRemove, restored };
  }, FREIGHT);
  assert('摘除推演后 freightHeadOf → null', fallback.missAfterRemove === null, fallback.missAfterRemove);
  assert('还原推演后 freightHeadOf → 100', fallback.restored);
  assert('pHead(无推演) = Σ convHead(成本表预估)', Math.abs(fallback.got - fallback.exp) < 1e-6, fallback);

  console.log('[5] 口径文案');
  const note = await page.evaluate(() => document.querySelector('.note') ? document.querySelector('.note').textContent : '');
  assert('口径说明含推演实际口径', note.includes('实际推演值') && note.includes('自动回退'));

  assert('零 pageerror', errors.length === 0, errors.join(' | '));
  console.log('\n===== 结果: ' + pass + ' pass / ' + fail + ' fail =====');
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
