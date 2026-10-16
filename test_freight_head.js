/* 回归：周度汇总看板(product.html)头程优先取推演数据(mapping.freight)，未覆盖回退成本表预估
 * 2026-10-16 口径调整：推演实际口径从 daily 移到周度看板（周维度看推演更有意义）
 * 姿势：page.route 拦截 rest/v1/mapping*（假后端，零生产写入）；期望值全部由页面内函数动态计算
 * 覆盖：① cloudWootSync ③ freight 段(reload 生效) ② freightHeadOfWeek 命中/回退 ③ asinWeekData().pHead 集成口径
 * fixture：推演只覆盖「X1主机+40W蓝光头+气泵」(B0H69JJZ1M) W31(2026-07-25~07-31) 那一周，allocPrice=100 CNY/台
 *          （PROFIT 里该 ASIN W31 US qty=6，有真实销量行可断言）
 */
const pw = require('./playwright-auth');   // 注入 wb_auth 登录态（看板有认证守卫）
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'product.html').replace(/\\/g, '/');

const FREIGHT = {
  schema: 'freight-alloc-v2',
  pushedAt: '2026-10-16T07:00:00.000Z',
  payload: {
    schema: 'freight-alloc-v2', generatedAt: '2026-10-16T07:00:00.000Z', currency: 'CNY',
    methods: {
      WA: { label: '移动加权平均', groups: [{
        series: 'X1系列', name: 'X1主机+40W蓝光头+气泵',
        weeks: [{ batch: '2026-07-27', date: '2026-07-27', weekStart: '2026-07-25',
                  weekLabel: '07-25~07-31', sold: 6, carryPrice: 100, allocPrice: 100, alloc: 600 }],
        totals: { sold: 6, alloc: 600, remainQty: 0, remainCost: 0 } }], totals: {} },
      CUM: { label: '累计到货均价', groups: [], totals: {} },
      FIFO: { label: 'FIFO', groups: [], totals: {} }
    }
  }
};
const MAPPING_ROW = [{
  id: 1, updated_at: '2026-10-16T07:00:00.000Z',
  data: {
    catalog: [{ name: 'X1主机+40W蓝光头+气泵', series: 'X1系列' }, { name: 'X1系列蜂窝板', series: 'X1系列配件' }],
    asinMap: [{ asin: 'B0H69JJZ1M', name: 'X1主机+40W蓝光头+气泵', series: 'X1系列', country: 'US' }],
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
  // 等 cloudWootSync 的 freight 段写本机 + 自动 reload 生效（页面自己会 reload，不手动干预避免竞态）
  await page.waitForFunction(() => { try { return !!localStorage.getItem('pc_freight'); } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);

  console.log('[1] freight 云端同步段 (cloudWootSync ③)');
  const synced = await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('pc_freight') || 'null');
    return f && f.schema === 'freight-alloc-v2' && f.pushedAt === '2026-10-16T07:00:00.000Z';
  });
  assert('mapping.freight 已拉取写本机(含自动 reload)', synced);

  console.log('[2] freightHeadOfWeek 命中与回退');
  const unit = await page.evaluate(() => ({
    wkStart: (DATA.weeks.find(w => w.label === 'W31') || {}).start,   // 周 label → 周六 start
    hit: freightHeadOfWeek('B0H69JJZ1M', 'W31'),                      // 该产品该周有推演 → 100
    missWeek: freightHeadOfWeek('B0H69JJZ1M', 'W32'),                 // 该产品但不在推演周 → null(回退)
    missProd: freightHeadOfWeek('B0H6QGKLJK', 'W31'),                 // 产品不在推演数据 → null(回退)
    badWeek: freightHeadOfWeek('B0H69JJZ1M', 'W99')                   // 不存在的周 → null
  }));
  assert('周映射: W31 → 2026-07-25(周六)', unit.wkStart === '2026-07-25', unit.wkStart);
  assert('命中: 覆盖产品×周 → 100 CNY/台', unit.hit === 100, unit.hit);
  assert('回退: 该周无推演 → null', unit.missWeek === null, unit.missWeek);
  assert('回退: 产品不在推演 → null', unit.missProd === null, unit.missProd);
  assert('容错: 不存在的周 → null', unit.badWeek === null, unit.badWeek);

  console.log('[3] asinWeekData().pHead 集成口径 (动态期望值)');
  const integ = await page.evaluate(() => {
    const d = asinWeekData('B0H69JJZ1M', 'W31');
    const exp = d && d.pQty > 0 ? fxHeadCny(freightHeadOfWeek('B0H69JJZ1M', 'W31') * d.pQty) : null;
    return { got: d ? d.pHead : null, exp, qty: d ? d.pQty : 0 };
  });
  assert('该周存在推演覆盖的销量行(断言自检, pQty>0)', integ.qty > 0, integ.qty);
  assert('pHead(推演优先) = fxHeadCny(100 × pQty)', integ.exp !== null && Math.abs(integ.got - integ.exp) < 1e-6, integ);

  console.log('[4] 回退口径：摘除推演后 pHead 与成本表预估一致');
  const fallback = await page.evaluate((freightFixture) => {
    try { localStorage.removeItem('pc_freight'); } catch (e) {}   // 临时摘除推演数据 → 应回退预估
    const missAfterRemove = freightHeadOfWeek('B0H69JJZ1M', 'W31');
    const d = asinWeekData('B0H69JJZ1M', 'W31');
    const expBase = fxHeadCny(headRmbOf('B0H69JJZ1M', 'US') * d.pQty);
    const got = d.pHead;
    try { localStorage.setItem('pc_freight', JSON.stringify(freightFixture)); } catch (e) {}  // 还原
    const restored = freightHeadOfWeek('B0H69JJZ1M', 'W31') === 100;
    return { got, expBase, missAfterRemove, restored, headRmb: headRmbOf('B0H69JJZ1M', 'US') };
  }, FREIGHT);
  assert('摘除推演后 freightHeadOfWeek → null', fallback.missAfterRemove === null, fallback.missAfterRemove);
  assert('还原推演后 freightHeadOfWeek → 100', fallback.restored);
  assert('pHead(无推演) = fxHeadCny(成本表 ' + fallback.headRmb + ' × pQty)', Math.abs(fallback.got - fallback.expBase) < 1e-6, fallback);

  console.log('[5] 口径文案');
  const note = await page.evaluate(() => document.querySelector('.note') ? document.querySelector('.note').textContent : '');
  assert('口径说明含推演实际口径', note.includes('实际推演值') && note.includes('自动回退'), note.slice(0, 0));

  assert('零 pageerror', errors.length === 0, errors.join(' | '));
  console.log('\n===== 结果: ' + pass + ' pass / ' + fail + ' fail =====');
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
