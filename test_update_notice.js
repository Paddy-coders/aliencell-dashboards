// test_update_notice.js — 云端更新提示条回归
//
// 背景：看板以前只在「页面加载时」拉云端数据，别人上传 Woot / 改映射后，已经开着页面的
//       人不会知道。2026-09-23 给五套看板加了「静默轮询 + 顶部提示条」：
//         1. 首检 5s、之后每 60s 检查；切回前台也检查
//         2. 与本页渲染快照(BASE_SIG)、此刻本机缓存(localSig)、云端(cloudSig)三路比对
//         3. 只提示不自动刷新（看板筛选是内存态，自动 reload 会清空用户正在看的筛选）
//         4. 点「立即刷新」：若本机缓存已被别的标签页更新过，就只重载、不用云端值回写
//
// 本文件用 route 拦截 Supabase 请求喂假数据，不触碰生产数据。
// 需要本地服务器：python -m http.server 8899 -d _deploy

const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const SB = /rest\/v1\/mapping/;

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

const PAGES = ['daily.html', 'ad.html', 'monthly.html', 'target.html', 'product.html'];

// Woot 记录真实结构：{ asin, start, end, name, metrics:{ orders, sales, adCost, adClicks, adOrders, adImpr, adSales } }
const mk = (orders, sales) => ([{
  asin: 'B0TEST0001', start: '2026-09-12', end: '2026-09-12', name: '测试产品A',
  metrics: { orders, sales, adCost: 6.5, adClicks: 12, adOrders: 2, adImpr: 1500, adSales: 39.98 },
}]);
const W_A = mk(3, 59.97), W_B = mk(7, 139.93), W_C = mk(11, 219.89);

const MOCK = { mode: 'old', cfg: null };
// ⚠️ 生产云端 wootCfg 的实际键序是 {cost, price}（cost 在前），而看板 load 同步会把它规范化成
//    {price, cost} 再写本机 —— 两者 JSON.stringify 结果不相等。老代码的 cloudSig 直接用云端原对象
//    ⇒ 判定「云端有新数据」永远成立 ⇒ 提示条常驻（2026-10-14 用户报「为什么总是提示云端数据已更新」）。
//    所以 mock 必须复刻生产的**键顺序**，否则这个坑测不出来。
const cfgProd = () => ({ cost: {}, price: 1380 });
function mockBody() {
  const data = { catalog: [], asinMap: [] };
  if (MOCK.mode !== 'old') data.woot = MOCK.mode === 'a' ? W_A : MOCK.mode === 'b' ? W_B : MOCK.mode === 'c' ? W_C : [];
  if (MOCK.cfg) data.wootCfg = MOCK.cfg;
  return JSON.stringify([{ data, updated_at: new Date().toISOString() }]);
}

// 清理本机缓存（仅每个 session 首次）；用 sessionStorage 标记，避免 reload 后又清掉刚写入的数据
const CLEAR = function () {
  try {
    if (!sessionStorage.getItem('__uw_cleared')) {
      sessionStorage.setItem('__uw_cleared', '1');
      ['pc_woot', 'pc_catalog', 'pc_asinmap', 'pc_woot_cfg'].forEach(k => localStorage.removeItem(k));
    }
  } catch (e) {}
};

let _seq = 0;
const U = f => `${BASE}/${f}?cb=${Date.now()}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const poke = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const barVis = page => page.evaluate(() => {
  const b = document.getElementById('wbUpdateBar');
  return !!(b && getComputedStyle(b).display !== 'none');
});
const barTxt = page => page.evaluate(() => {
  const b = document.getElementById('wbUpdateBar');
  return b ? b.textContent : '';
});
const readWoot = page => page.evaluate(() => localStorage.getItem('pc_woot'));

async function clickRefresh(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }).catch(() => {}),
    page.evaluate(() => { document.getElementById('wbUpdateBar').querySelectorAll('button')[0].click(); }),
  ]);
  await page.waitForTimeout(1200);
}
async function clickDismiss(page) {
  await page.evaluate(() => { document.getElementById('wbUpdateBar').querySelectorAll('button')[1].click(); });
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const file of PAGES) {
    console.log(`-- ${file} --`);
    const HAS_CFG = ['daily.html', 'monthly.html', 'product.html'].includes(file);  // 消费 wootCfg 的看板
    MOCK.mode = 'old';
    MOCK.cfg = cfgProd();   // 云端始终带 wootCfg（与生产同构），键序 {cost, price}
    let reqCount = 0, errs = [];
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    await ctx.route(SB, route => { reqCount++; route.fulfill({ status: 200, contentType: 'application/json', body: mockBody() }); });
    await ctx.addInitScript(CLEAR);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));

    try {
      await page.goto(U(file), { waitUntil: 'load', timeout: 60000 });

      // ---- 1. 自动首检：云端为旧结构(无 woot 键) → 请求发出但不误报 ----
      const n0 = reqCount;
      await page.waitForTimeout(6000);
      t(`${file} 自动首检已发出云端请求`, reqCount > n0, { before: n0, after: reqCount });
      t(`${file} 云端无 woot 键(旧数据)不误报`, !(await barVis(page)));

      // ---- 2. 云端与本机一致(都为空) → 不提示 ----
      MOCK.mode = 'empty';
      await poke(page); await page.waitForTimeout(500);
      t(`${file} 云端与本机一致时不提示`, !(await barVis(page)));

      // ---- 2b. ★ 云端 wootCfg 键序({cost,price}) ≠ 看板规范化后的本机({price,cost}) ----
      //      同一份数据不得判为「有更新」。2026-10-14 回归点：老实现直接 stringify 云端原对象，
      //      与规范化后的本机永不相等 ⇒ 提示条常驻、点「立即刷新」也不消失。
      if (HAS_CFG) {
        const lc = await page.evaluate(() => localStorage.getItem('pc_woot_cfg'));
        t(`${file} 本机 wootCfg 已按 {price,cost} 规范化写入(前提)`, /"price":1380/.test(lc || ''), { lc });
      }
      t(`${file} wootCfg 键序差异不算更新(提示条常驻回归)`, !(await barVis(page)));
      if (HAS_CFG) {
        // 反向:值真的变了必须提示（不能为了消误报把真报也消掉）
        MOCK.cfg = { cost: {}, price: 1580 };
        await poke(page); await page.waitForTimeout(700);
        t(`${file} wootCfg 值真的变化仍会提示`, await barVis(page));
        await clickDismiss(page);
        MOCK.cfg = cfgProd();
        await poke(page); await page.waitForTimeout(700);
        await clickDismiss(page);
        t(`${file} 恢复原配置后不提示`, !(await barVis(page)));
      }

      // ---- 3. 云端出现新数据 → 提示条 ----
      MOCK.mode = 'a';
      await poke(page); await page.waitForTimeout(500);
      const vis1 = await barVis(page), txt1 = await barTxt(page);
      t(`${file} 云端更新后弹出提示条`, vis1);
      t(`${file} 提示文案正确`, /云端数据已更新/.test(txt1) && /立即刷新/.test(txt1), { txt: txt1 });

      // ---- 4. 点 × 关闭 → 同一状态不再重复提示 ----
      await clickDismiss(page);
      t(`${file} 点 × 后提示条隐藏`, !(await barVis(page)));
      await poke(page); await page.waitForTimeout(500);
      t(`${file} 已忽略的更新不再重复提示`, !(await barVis(page)));

      // ---- 5. 又一轮更新 → 提示 → 立即刷新 → 本机缓存写入新数据 ----
      MOCK.mode = 'b';
      await poke(page); await page.waitForTimeout(500);
      t(`${file} 新一轮更新再次提示`, await barVis(page));
      await clickRefresh(page);
      let ok = false;
      try { ok = JSON.stringify(JSON.parse(await readWoot(page))) === JSON.stringify(W_B); } catch (e) {}
      t(`${file} 立即刷新后本机缓存=云端新数据`, ok);
      t(`${file} 刷新后不再提示`, !(await barVis(page)));

      // ---- 6. 同浏览器上传场景：本机被别的标签页写新(云端也已同步) → 仍要提示 ----
      MOCK.mode = 'c';
      const other = await ctx.newPage();
      await other.goto(`${BASE}/login.html?cb=ox${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await other.evaluate(v => localStorage.setItem('pc_woot', JSON.stringify(v)), W_C);
      await other.close();
      await poke(page); await page.waitForTimeout(500);
      t(`${file} 同浏览器上传后也会提示`, await barVis(page));
      await clickRefresh(page);
      let kept = false;
      try { kept = JSON.stringify(JSON.parse(await readWoot(page))) === JSON.stringify(W_C); } catch (e) {}
      t(`${file} 本机已最新时不被云端值覆盖`, kept);

      t(`${file} 全程无 JS 报错`, errs.length === 0, errs.slice(0, 2));
    } catch (e) {
      t(`${file} 流程执行`, false, { error: String(e).slice(0, 200) });
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
