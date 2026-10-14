/**
 * JoyBuy 看板 —— 六维筛选逻辑回归（本地 file:// 直开 joybuy.html）
 *
 *   前置：node joybuy_browser.js --keep; sleep 5400   （CDP 9333，放后台任务）
 *   运行：node test_joybuy_filter.js
 *
 * 覆盖项：
 *   1  默认全量（订单/销售额/SKU 数/产品名数）
 *   1b 6 个下拉**真实点开**（.dd-btn.click()，这样才测得出内联 onclick 的 IIFE 作用域问题）
 *      + 面板内关键字搜索
 *   2  国家筛选  3 产品系列筛选  4 候选联动是否"干净"  5 产品名筛选
 *   6  周数筛选  7 空集归零
 *   8  重置  8b 套装维度（X1L 已并入 X1 Lite）  8c 表头不能被 esc 成字面量
 *   8d KPI 固定 5 张 · 可下拉替换 · 指标全中文 · 恢复默认
 *   8e 无数据的候选**直接隐藏**（不是置灰）+ 隐藏计数提示
 *   8f 窗口从「首个有数据的周」开始（早期连续全 0 的周已删除；单站再按该站起点收窄）
 *   8g 周筛选真的驱动图表 X 轴 / 周度表 / 日明细（选了哪几周就只画哪几周）+「窗口」标签跟随
 *   9  Ctrl 多选
 * 末尾自动刷新 _jb_f_reset.png / _jb_f_product.png / _jb_f_series.png
 *
 * ⚠️ 断言是「数据感知」的：期望值一律从构建产物 joybuy.html **内嵌的 PAYLOAD 自算**，
 *    不写死任何业务数字（订单量 / 销售额 / SKU 数 / 产品名数 / 周数 / 窗口日期 全是算出来的）。
 *    好处：每周重采数据后本脚本无需改动，就能区分「筛选逻辑回归」和「业务数据正常变化」——
 *    写死绝对值只会把后者误报成前者（本脚本 2026-09-28 之前有 13 条就是这么红的）。
 *    代价：这里的聚合口径是**刻意复刻前端**的（ROWS / aggRows / activeWeeks / renderWinBadge），
 *          改前端聚合逻辑时必须同步改这里的对应函数，否则测试会「跟着一起错」。
 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/joybuy.html';

/* ═══════════════════════════════════════════════════════════════════════════
 *  期望值自算：解出 joybuy.html 里内嵌的 `var PAYLOAD = {...}`
 *
 *  PAYLOAD 不挂 window（`var PAYLOAD = __PAYLOAD__;` 在 IIFE 内），所以只能在
 *  Node 侧从源文件文本里切出来。切法用**花括号配平**（跳过字符串字面量里的 {}），
 *  比正则可靠：payload 里到处是 JSON 的引号和中文说明文案。
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const P = (function () {
  const src = fs.readFileSync(FILE.replace('file:///', ''), 'utf8');
  const tag = 'var PAYLOAD = ';
  const i = src.indexOf(tag);
  if (i < 0) throw new Error('joybuy.html 里找不到 `var PAYLOAD = `');
  const j = i + tag.length;
  if (src[j] !== '{') throw new Error('PAYLOAD 不是对象字面量，起手字符 = ' + src[j]);
  let depth = 0, inStr = false, q = '', esc = false;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(src.slice(j, k + 1)); }
  }
  throw new Error('PAYLOAD 花括号未配平');
})();

const WKEYS = P.weeks.map(function (w) { return w.key; });
const SITE_CODES = P.sites.map(function (s) { return s.code; });
const CUR = {}; P.sites.forEach(function (s) { CUR[s.code] = s.currency; });
const SYM = { GBP: '£', EUR: '€', USD: '$' };
// 站点级周指标（与前端 activeWeeks 里那份列表保持一致）
const SUMK = ['uv', 'pv', 'pdpUv', 'pdpPv', 'atcUv', 'addToCart', 'buyers', 'orders',
  'units', 'favorites', 'atcProducts', 'visited'];
const fmt0 = function (v) { return Number(v).toLocaleString('en-US'); };
const fmt2 = function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
/** 复刻前端 salesText()：多币种用 ' + ' 连接，单币种直接给符号+金额 */
const salesTextOf = function (m) {
  const ks = Object.keys(m || {}).filter(function (k) { return m[k]; });
  if (!ks.length) return '—';
  if (ks.length === 1) return SYM[ks[0]] + fmt2(m[ks[0]]);
  return ks.map(function (k) { return SYM[k] + fmt2(m[k]); }).join(' + ');
};

/** 复刻前端 ROWS + filterRows：把各站 skuWeeks 拉平后按维度筛（空数组 = 不约束该维度） */
function rowsOf(o) {
  o = o || {};
  const out = [];
  SITE_CODES.forEach(function (c) {
    if (o.site && o.site.length && o.site.indexOf(c) < 0) return;
    (P.data[c].skuWeeks || []).forEach(function (r) {
      if (o.series && o.series.length && o.series.indexOf(r.series) < 0) return;
      if (o.name && o.name.length && o.name.indexOf(r.name) < 0) return;
      if (o.bundle && o.bundle.length && o.bundle.indexOf(r.bundle || '标配') < 0) return;
      if (o.week && o.week.length && o.week.indexOf(r.week) < 0) return;
      out.push(Object.assign({ site: c }, r));
    });
  });
  return out;
}
/** 复刻前端 aggRows()：订单量 / 销售额(按币种) / SKU 数 / 产品名数 */
function aggOf(o) {
  const rows = rowsOf(o), byCur = {}, sku = {}, name = {};
  let orders = 0;
  rows.forEach(function (r) {
    orders += r.orders || 0;
    const c = CUR[r.site] || '';
    byCur[c] = (byCur[c] || 0) + (r.sales || 0);
    sku[r.skuId] = 1; name[r.name] = 1;
  });
  return { orders: orders, byCur: byCur, salesText: salesTextOf(byCur),
    sku: Object.keys(sku).length, name: Object.keys(name).length, rows: rows.length };
}
/** 某站「有数据」的周集合 —— 复刻前端 activeWeeks() 的 hit 口径
 *  （站点级任一指标非 0，或该周在 SKU 明细里出现过） */
function siteHitWeeks(code) {
  const hit = {}, d = P.data[code] || {};
  (d.weeks || []).forEach(function (w) {
    if (SUMK.some(function (k) { return (w[k] || 0) > 0; }) || (w.sales || 0) > 0) hit[w.key] = 1;
  });
  (d.skuWeeks || []).forEach(function (x) { if (x.week) hit[x.week] = 1; });
  return hit;
}
/** 复刻前端 activeWeeks()：从「首个有数据的周」一路切到窗口末尾（**连续后缀**，不是离散集合） */
function activeWeeksOf(codes) {
  const hit = {};
  (codes && codes.length ? codes : SITE_CODES).forEach(function (c) {
    const h = siteHitWeeks(c);
    Object.keys(h).forEach(function (k) { hit[k] = 1; });
  });
  const i = WKEYS.findIndex(function (k) { return hit[k]; });
  return i < 0 ? [] : WKEYS.slice(i);
}
/** 周数下拉里**实际可见**的候选 = activeWeeks() ∩「该筛选下出现过 SKU 行的周」
 *  （前端 renderDD 里 uvMap[v] === undefined 的项会被隐藏） */
function visibleWeekOpts(o) {
  o = o || {};
  const inRows = {};
  rowsOf(o).forEach(function (r) { inRows[r.week] = 1; });
  return activeWeeksOf(o.site).filter(function (k) { return inRows[k]; });
}
/** 站点级 KPI（店铺访客数）＝ Σ 选中站 weeks[].uv，且只算 visibleWeeks（复刻 siteWeeksMerged） */
function storeUvOf(codes) {
  const set = {};
  activeWeeksOf(codes).forEach(function (k) { set[k] = 1; });
  let s = 0;
  (codes && codes.length ? codes : SITE_CODES).forEach(function (c) {
    (P.data[c].weeks || []).forEach(function (w) { if (set[w.key]) s += w.uv || 0; });
  });
  return s;
}
/** 窗口标签 = 首尾周的 start/end，再夹到 PAYLOAD.range（复刻 renderWinBadge 的 2026-09-28 修复） */
function winLabelOf(keys) {
  const pick = P.weeks.filter(function (w) { return keys.indexOf(w.key) >= 0; });
  if (!pick.length) return P.windowLabel;
  const rg = P.range || {};
  let s = pick[0].start, e = pick[pick.length - 1].end;
  if (rg.startDate && s < rg.startDate) s = rg.startDate;
  if (rg.endDate && e > rg.endDate) e = rg.endDate;
  return '窗口 ' + s + ' ~ ' + e;
}
/** 后端裁掉、且**不在**当前窗口里的周（这些在任何候选里都不该出现） */
const TRIMMED_OUT = (function () {
  const all = [];
  Object.keys(P.trimmedWeeks || {}).forEach(function (c) {
    (P.trimmedWeeks[c].keys || []).forEach(function (k) { if (all.indexOf(k) < 0) all.push(k); });
  });
  return all.filter(function (k) { return WKEYS.indexOf(k) < 0; });
})();
/** 接口真没返回更早日期的站（rawCoverStart 晚于窗口起点）—— 「起点晚」提示只该列这些 */
const LATE_COVER_SITES = SITE_CODES.filter(function (c) {
  const d = P.data[c] || {};
  return d.rawCoverStart && P.range.startDate && d.rawCoverStart > P.range.startDate;
});

const BASE = aggOf({});                        // 全量基线
const DE_ALL = aggOf({ site: ['DE'] });        // DE 全量（供「系列收窄」比较用）
const BUNDLES_PRESENT = (function () {
  const seen = [], out = [];
  rowsOf({ site: ['DE'], series: ['X1 Lite'] }).forEach(function (r) {
    const b = r.bundle || '标配';
    if (seen.indexOf(b) < 0) { seen.push(b); out.push(b); }
  });
  return out;
})();
// 套装候选顺序跟前端一致：按 payload.bundleOrder 过滤出「本筛选下真实存在的」
const EXPECT_BUNDLES = (P.bundleOrder && P.bundleOrder.length ? P.bundleOrder : BUNDLES_PRESENT)
  .filter(function (b) { return BUNDLES_PRESENT.indexOf(b) >= 0; });
const BD_HONEY = EXPECT_BUNDLES.filter(function (b) { return b.indexOf('蜂窝板') >= 0; })[0] || 'Air Assist+蜂窝板+旋转轴';
const BD_AIR = EXPECT_BUNDLES.filter(function (b) { return b.indexOf('Air Assist') >= 0 && b !== BD_HONEY; })[0] || 'Air Assist';

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '   ' + detail : '')); }
}

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = await b.contexts()[0].newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180)); });
  await page.addInitScript(() => { try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'probe' })); } catch (e) {} });
  await page.setViewportSize({ width: 1680, height: 1200 });
  await page.goto(FILE, { waitUntil: 'load', timeout: 40000 });
  await sleep(4200);

  // KPI 现在固定只显示 5 张（可下拉替换）。测试要读的指标不一定在默认 5 张上，
  // 所以在一次 evaluate 里把它们依次装到第 5 张卡片读回来 ——
  // pickKpi → renderKpis 是同步的，不用等 sleep；顺带也覆盖了「卡片可替换」这个功能。
  const kpi = () => page.evaluate(() => {
    const CAT = ['订单量', '销售额', '销售件数', '商品访客数', '商品浏览量', '加购访客数',
      '加购件数', '加购率', '转化率', 'SKU 数', '产品名数', '收藏商品数', '店铺访客数'];
    const o = {};
    const snap = () => [].forEach.call(document.querySelectorAll('.kpi'), (k) => {
      const nm = (k.querySelector('.k') || {}).innerText;
      if (!nm || o[nm] !== undefined) return;
      o[nm] = (k.querySelector('.v') || {}).innerText;
    });
    snap();
    const SLOT = 4;
    CAT.forEach((name) => {
      if (o[name] !== undefined) return;
      const card = document.querySelector('.kpi[data-slot="' + SLOT + '"]');
      if (!card) return;
      const head = card.querySelector('.kpi-head');
      if (head) head.click();                       // 展开面板（只切 class，不重渲染）
      const host = document.querySelector('.kpi[data-slot="' + SLOT + '"]');
      const opt = [...host.querySelectorAll('.dd-opt')]
        .find((x) => ((x.querySelector('.opt-name') || {}).innerText) === name && !x.classList.contains('dim'));
      if (opt) opt.click();                         // 触发 pickKpi → renderKpis（同步）
      snap();
    });
    // ⚠️ 用完必须恢复默认 5 项，否则测试为读指标而换上去的项会留到下一页断言里
    //    （8d 段曾因此读到「收藏商品数」而不是「商品浏览量」）
    if (window.resetKpi) window.resetKpi();
    return o;
  });
  const note = () => page.evaluate(() => (document.getElementById('filterNote') || {}).innerText || '');

  // 打开某维度下拉并点某个选项（再点一下按钮收起）
  async function openDD(ddId) {
    const opened = await page.evaluate((id) => {
      const b = document.querySelector('#' + id + ' .dd-btn');
      if (!b) return false;
      b.click();                                  // 走真实 onclick，能暴露作用域问题
      return document.getElementById(id).classList.contains('open');
    }, ddId);
    await sleep(250);
    return opened;
  }
  async function pickOpt(ddId, listId, matcher) {
    const opened = await openDD(ddId);
    if (!opened) return false;
    const ok = await page.evaluate(({ listId, matcher }) => {
      const opts = [...document.querySelectorAll('#' + listId + ' .dd-opt')];
      const t = opts.find((o) => o.innerText.indexOf(matcher) >= 0);
      if (!t) return false;
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, { listId, matcher });
    await sleep(700);
    await page.evaluate((id) => document.getElementById(id).classList.remove('open'), ddId);
    return ok;
  }
  async function optsOf(listId) {
    await page.evaluate(() => {});
    return page.evaluate((id) => [...document.querySelectorAll('#' + id + ' .dd-opt')]
      .map((o) => ({ txt: o.innerText.replace(/\s+/g, ' ').trim(), dim: o.classList.contains('dim'), sel: o.classList.contains('sel') })), listId);
  }
  async function summaryOf(sumId) { return page.evaluate((id) => document.getElementById(id).innerText, sumId); }
  async function reset() {
    await page.evaluate(() => document.getElementById('btnReset').click());
    await sleep(800);
  }

  console.log('=== 0. 期望值自算的底座（payload 是否与页面同源） ===');
  ck('从 joybuy.html 解出 PAYLOAD 且非空',
    WKEYS.length > 0 && BASE.rows > 0 && SITE_CODES.length > 0,
    '窗口 ' + P.range.startDate + ' ~ ' + P.range.endDate + ' · ' + WKEYS.length + ' 周 · ' +
    SITE_CODES.length + ' 站 · SKU 明细 ' + BASE.rows + ' 行');
  const builtTxt = await page.evaluate(() => (document.getElementById('builtBadge') || {}).textContent || '');
  ck('页面 builtBadge == payload.builtAt（确认页面就是这份产物，不是旧缓存）',
    builtTxt.indexOf(P.builtAt) >= 0, builtTxt + ' / payload ' + P.builtAt);

  console.log('\n=== 1. 默认全部 ===');
  let k = await kpi();
  ck('订单量 == payload 全量聚合订单数（' + BASE.orders + '）', k['订单量'] === fmt0(BASE.orders), k['订单量']);
  ck('销售额 == payload 全量聚合销售额（' + BASE.salesText + '）', k['销售额'] === BASE.salesText, k['销售额']);
  ck('SKU 数 == payload 全量 SKU 数（' + BASE.sku + '）', k['SKU 数'] === fmt0(BASE.sku), k['SKU 数']);
  ck('产品名数 == payload 全量产品名数（' + BASE.name + '）', k['产品名数'] === fmt0(BASE.name), k['产品名数']);

  // 「商品上架日」是解释早期周次商品指标为 0 的关键证据（UK 07-01↔W27 / DE 08-05↔W32 /
  // NL 08-10↔W33 / FR 08-07↔W32，四站全部吻合到周内），不能被误删成「无数据」。
  const warnTxt = await page.evaluate(() => (document.getElementById('warnHost') || {}).innerText || '');
  ck('警示条含「商品上架时间」', warnTxt.indexOf('商品上架时间') >= 0, warnTxt.split('\n').filter((x) => x.indexOf('上架') >= 0)[0] || '（缺失）');
  ck('措辞说明早期 0 是真实的 0（不是"无数据"）',
    warnTxt.indexOf('不是数据缺失') >= 0 && warnTxt.indexOf('无数据') < 0,
    warnTxt.indexOf('无数据') >= 0 ? '仍出现「无数据」字样' : '措辞正确');

  console.log('\n=== 1b. 下拉必须能点开（内联 onclick 作用域） ===');
  for (const [id, nm] of [['ddSite', '国家'], ['ddSeries', '产品系列'], ['ddName', '产品名'], ['ddBundle', '套装'], ['ddSku', 'SKU'], ['ddWeek', '周数']]) {
    const open = await openDD(id);
    ck(nm + ' 下拉可打开', open === true);
    await page.evaluate((i) => document.getElementById(i).classList.remove('open'), id);
    await sleep(150);
  }
  // 面板内搜索
  const ALL_NAMES = [...new Set(rowsOf({}).map((r) => r.name))];
  const AIR_NAMES = ALL_NAMES.filter((n) => /Air/i.test(n));
  const beforeN = (await optsOf('ddNameList')).length;
  ck('全量产品名候选 == payload 里的产品名集合（' + ALL_NAMES.length + '）',
    beforeN === ALL_NAMES.length, beforeN + ' 项');
  await page.evaluate(() => {
    const el = document.getElementById('ddNameSearch');
    el.value = 'Air';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  const after = await optsOf('ddNameList');
  ck('产品名搜索生效（Air → 只剩 ' + AIR_NAMES.length + ' 个含 Air 的产品名）',
    after.length > 0 && after.length < beforeN &&
    after.length === AIR_NAMES.length && after.every((x) => /Air/i.test(x.txt)),
    beforeN + ' → ' + after.length + '：' + after.map((x) => x.txt).join('/'));
  await page.evaluate(() => {
    const el = document.getElementById('ddNameSearch');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);

  console.log('\n=== 2. 国家筛选 ===');
  let ok = await pickOpt('ddSite', 'ddSiteList', 'DE');
  ck('能选中 DE', ok, '国家=' + await summaryOf('ddSiteSum'));
  k = await kpi();
  ck('DE 订单量 == DE 站点聚合订单数（' + DE_ALL.orders + '）', k['订单量'] === fmt0(DE_ALL.orders), k['订单量']);
  ck('DE 销售额 == DE 站点聚合销售额（' + DE_ALL.salesText + '）', k['销售额'] === DE_ALL.salesText, k['销售额']);
  ck('DE SKU 数 == DE 站点聚合 SKU 数（' + DE_ALL.sku + '）', k['SKU 数'] === fmt0(DE_ALL.sku), k['SKU 数']);
  ck('DE 店铺访客数 == DE 站点级 uv 之和（' + storeUvOf(['DE']) + '，站点级指标）',
    k['店铺访客数'] === fmt0(storeUvOf(['DE'])), k['店铺访客数']);

  console.log('\n=== 3. 产品系列筛选（DE 站内） ===');
  const DE_X1 = aggOf({ site: ['DE'], series: ['X1'] });
  ok = await pickOpt('ddSeries', 'ddSeriesList', 'X1');
  ck('能选中系列 X1', ok, '系列=' + await summaryOf('ddSeriesSum'));
  k = await kpi();
  console.log('   KPI:', JSON.stringify(k));
  ck('SKU 数 收窄到 < DE 全量', parseInt(k['SKU 数'].replace(/,/g, ''), 10) < DE_ALL.sku,
    k['SKU 数'] + ' < ' + DE_ALL.sku);
  ck('订单量 == DE+X1 聚合订单数（' + DE_X1.orders + '，原意：X1 系列里只有 60W 出过单）',
    k['订单量'] === fmt0(DE_X1.orders), k['订单量']);

  console.log('\n=== 4. 联动：产品名候选应只剩 X1 系列 ===');
  const names = await optsOf('ddNameList');
  const bad = names.filter((n) => /Air Purifier|Vacuum|Starter|Honeycomb|Laser Module|E1/.test(n.txt));
  ck('产品名候选不含其他系列', bad.length === 0, bad.map((x) => x.txt).join(' / ') || '干净');
  console.log('   候选产品名: ' + names.map((x) => x.txt).join(' ｜ '));

  console.log('\n=== 5. 产品名筛选 ===');
  // 'X1 60W' 只是**选项选择器**（点哪个下拉项），不是期望值；期望值仍从 payload 算。
  const SEL_NAME = 'X1 60W';
  const A_NAME = aggOf({ site: ['DE'], series: ['X1'], name: [SEL_NAME] });
  ok = await pickOpt('ddName', 'ddNameList', SEL_NAME);
  ck('能选中产品名 ' + SEL_NAME, ok, '产品名=' + await summaryOf('ddNameSum'));
  k = await kpi();
  ck(SEL_NAME + ' 订单量 == 聚合值（' + A_NAME.orders + '）', k['订单量'] === fmt0(A_NAME.orders), k['订单量']);
  ck(SEL_NAME + ' 销售额 == 聚合值（' + A_NAME.salesText + '）', k['销售额'] === A_NAME.salesText, k['销售额']);
  ck(SEL_NAME + ' SKU 数 == 聚合值（' + A_NAME.sku + '）', k['SKU 数'] === fmt0(A_NAME.sku), k['SKU 数']);

  console.log('\n=== 6. 周数筛选（挑该产品名**真的出过单**的那一周） ===');
  // 不写死 W38 —— 从 payload 里找这个产品名 orders>0 的周；一周都没出单就退回首个可见周（期望值随之为 0）。
  const NAME_ROWS = rowsOf({ site: ['DE'], series: ['X1'], name: [SEL_NAME] });
  const ORDER_WEEKS = [...new Set(NAME_ROWS.filter((r) => r.orders > 0).map((r) => r.week))];
  const W_ORDER = ORDER_WEEKS[0] || visibleWeekOpts({ site: ['DE'], series: ['X1'], name: [SEL_NAME] })[0];
  const A_WK = aggOf({ site: ['DE'], series: ['X1'], name: [SEL_NAME], week: [W_ORDER] });
  const wkOpts = await optsOf('ddWeekList');
  console.log('   周候选: ' + wkOpts.map((x) => x.txt).join(' ') + '（无数据项已隐藏，故无置灰项）');
  console.log('   ' + SEL_NAME + ' 出单周 = ' + (ORDER_WEEKS.join(',') || '（无，退回 ' + W_ORDER + '）'));
  ok = await pickOpt('ddWeek', 'ddWeekList', W_ORDER);
  ck('能选中 ' + W_ORDER, ok, '周=' + await summaryOf('ddWeekSum'));
  k = await kpi();
  ck(W_ORDER + ' + ' + SEL_NAME + ' 订单量 == 聚合值（' + A_WK.orders + '）',
    k['订单量'] === fmt0(A_WK.orders), k['订单量']);
  ck(W_ORDER + ' + ' + SEL_NAME + ' 销售额 == 聚合值（' + A_WK.salesText + '）',
    k['销售额'] === A_WK.salesText, k['销售额']);

  console.log('\n=== 7. 无数据的候选已被隐藏（因此 UI 上构造不出空集） ===');
  // ⚠️ 这一段原来靠「硬选一个无订单的周 W23」来验证空集兜底。
  // 需求③ 把无数据的候选直接隐藏后，W23 在当前筛选下根本不在候选里、点不到 ——
  // 「点不到」本身就是需求③要的结果，所以改成验证「已隐藏」，空集兜底改用搜索框来测。
  const wkNow = await page.evaluate(() => [...document.querySelectorAll('#ddWeekList .dd-opt')]
    .map((x) => x.innerText.split(' ')[0]));
  const outStill = TRIMMED_OUT.filter((x) => wkNow.indexOf(x) >= 0);
  ck('窗口外被后端裁掉的周（' + (TRIMMED_OUT.join(',') || '无') + '）已从候选消失（点不到 → 不会产生空集）',
    outStill.length === 0, outStill.length ? '仍可见 ' + outStill.join(',') : '已隐藏');
  const EXP_W_NOW = visibleWeekOpts({ site: ['DE'], series: ['X1'], name: [SEL_NAME] });
  ck('当前筛选下周候选 == 该组合真实有数据的周（' + EXP_W_NOW.length + ' 周）',
    wkNow.length === EXP_W_NOW.length && wkNow.join() === EXP_W_NOW.join(),
    wkNow.length + ' 周：' + wkNow.join(' '));
  ck('可见周次非空', wkNow.length > 0, wkNow.length + ' 周：' + wkNow.join(' '));
  // 兜底：面板内搜一个不存在的词 → 应显示「无匹配项」，且页面不报错
  const noMatch = await page.evaluate(() => {
    if (window.setKw) window.setKw('week', 'zzz-nothing');
    const t = (document.getElementById('ddWeekList') || {}).innerText || '';
    if (window.setKw) window.setKw('week', '');
    return t;
  });
  ck('搜不到 → 面板显示「无匹配项」', noMatch.indexOf('无匹配项') >= 0, '"' + noMatch.replace(/\n/g, ' ').trim().slice(0, 30) + '"');
  ck('空匹配下 KPI 仍渲染 5 张（不报错）',
    (await page.evaluate(() => document.querySelectorAll('.kpi').length)) === 5, '5 张');

  console.log('\n=== 8. 重置 ===');
  await reset();
  k = await kpi();
  ck('重置后回到全量', k['订单量'] === fmt0(BASE.orders) && k['SKU 数'] === fmt0(BASE.sku),
    '订单=' + k['订单量'] + ' SKU=' + k['SKU 数'] + '（期望 ' + fmt0(BASE.orders) + ' / ' + fmt0(BASE.sku) + '）');
  ck('重置后各维度显示「全部」',
    (await summaryOf('ddSiteSum')) === '全部' && (await summaryOf('ddSeriesSum')) === '全部' &&
    (await summaryOf('ddNameSum')) === '全部' && (await summaryOf('ddWeekSum')) === '全部');

  console.log('\n=== 8b. 套装维度（X1L 已按业务确认并入 X1 Lite） ===');
  const A_LITE = aggOf({ site: ['DE'], series: ['X1 Lite'] });
  const A_HONEY = aggOf({ site: ['DE'], series: ['X1 Lite'], bundle: [BD_HONEY] });
  const A_AIR = aggOf({ site: ['DE'], series: ['X1 Lite'], bundle: [BD_AIR] });
  await reset();
  await pickOpt('ddSite', 'ddSiteList', 'DE');
  await pickOpt('ddSeries', 'ddSeriesList', 'X1 Lite');
  k = await kpi();
  ck('X1 Lite 已含原 X1L（DE 站 SKU 数 == 聚合值 ' + A_LITE.sku + '）',
    k['SKU 数'] === fmt0(A_LITE.sku), k['SKU 数']);
  ck('X1 Lite 产品名数 == 聚合值（' + A_LITE.name + '，即 20W/40W/60W）',
    k['产品名数'] === fmt0(A_LITE.name), k['产品名数']);
  const bdOpts = await optsOf('ddBundleList');
  ck('套装候选 == 该筛选下真实存在的套装集合（' + EXPECT_BUNDLES.join(' / ') + '）',
    bdOpts.length === EXPECT_BUNDLES.length &&
    EXPECT_BUNDLES.every((b) => bdOpts.some((x) => x.txt.indexOf(b) >= 0)),
    bdOpts.map((x) => x.txt).join(' / '));
  ok = await pickOpt('ddBundle', 'ddBundleList', '蜂窝板');
  ck('能选中套装「' + BD_HONEY + '」', ok, '套装=' + await summaryOf('ddBundleSum'));
  k = await kpi();
  ck('套装筛选后 SKU 数 == 聚合值（' + A_HONEY.sku + '）', k['SKU 数'] === fmt0(A_HONEY.sku), k['SKU 数']);
  ck('套装筛选后产品名数 == 聚合值（' + A_HONEY.name + '）', k['产品名数'] === fmt0(A_HONEY.name), k['产品名数']);
  ok = await pickOpt('ddBundle', 'ddBundleList', 'Air Assist');
  k = await kpi();
  ck('切到「' + BD_AIR + '」后 SKU 数 == 聚合值（' + A_AIR.sku + '）', k['SKU 数'] === fmt0(A_AIR.sku), k['SKU 数']);

  console.log('\n=== 8c. 表头内嵌标签必须渲染成元素（不能被 esc 成字面量） ===');
  // 曾经的 bug：tableHtml 对列名统一 esc()，于是 `<span class="scope-tag">站点</span>`
  // 原样打在表头里。这类问题肉眼要靠截图才发现，加一条断言兜住。
  const headTxt = await page.evaluate(() => [...document.querySelectorAll('.tbl-wrap thead th')].map((e) => e.innerHTML).join('||'));
  // 注意：只查「被转义」的字面量 &lt;span；渲染正确的表头本来就含真实 <span>。
  ck('表头无被转义的字面量 &lt;span', headTxt.indexOf('&lt;span') < 0,
    headTxt.indexOf('&lt;span') < 0 ? '干净' : headTxt.slice(headTxt.indexOf('&lt;span') - 20, headTxt.indexOf('&lt;span') + 40));
  const tagN = await page.evaluate(() => document.querySelectorAll('.tbl-wrap thead th .scope-tag').length);
  ck('「站点级」标签已渲染为元素', tagN >= 2, tagN + ' 个');

  console.log('\n=== 8d. KPI 固定 5 张 · 可下拉替换 · 指标全中文 ===');
  await reset();
  const kpiInfo = await page.evaluate(() => ({
    n: document.querySelectorAll('.kpi').length,
    heads: [...document.querySelectorAll('.kpi .kpi-head .k')].map((x) => x.innerText.trim()),
    heads2: document.querySelectorAll('.kpi .kpi-head').length,
    panels: document.querySelectorAll('.kpi .dd-panel').length
  }));
  ck('KPI 恰好 5 张（不再平铺全部指标）', kpiInfo.n === 5, '实际 ' + kpiInfo.n);
  ck('5 张卡片都有指标下拉', kpiInfo.heads2 === 5 && kpiInfo.panels === 5,
    kpiInfo.heads2 + ' 按钮 / ' + kpiInfo.panels + ' 面板');
  ck('默认 5 项 = 订单量/销售额/销售件数/商品访客数/商品浏览量',
    kpiInfo.heads.join(',') === '订单量,销售额,销售件数,商品访客数,商品浏览量', kpiInfo.heads.join(','));
  ck('卡片标题不含 UV/PV/PDP 缩写',
    kpiInfo.heads.every((h) => !/UV|PV|PDP/.test(h)), kpiInfo.heads.join(','));

  const swap = await page.evaluate(() => {
    const card = document.querySelector('.kpi[data-slot="0"]');
    card.querySelector('.kpi-head').click();
    const opened = card.classList.contains('open');
    const busy = [...card.querySelectorAll('.dd-opt')].filter((x) => x.classList.contains('dim')).length;
    const opt = [...card.querySelectorAll('.dd-opt')]
      .find((x) => (x.querySelector('.opt-name') || {}).innerText === '转化率');
    if (opt) opt.click();
    return { opened: opened, busy: busy, now: (document.querySelector('.kpi[data-slot="0"] .k') || {}).innerText };
  });
  ck('点卡片标题能展开指标面板', swap.opened === true, swap.opened ? '已展开' : '打不开');
  ck('被其他卡片占用的指标置灰（4 项）', swap.busy === 4, 'N=' + swap.busy);
  ck('选「转化率」后第 1 张卡片标题已替换', swap.now === '转化率', swap.now || '(读不到)');

  const reset5 = await page.evaluate(() => {
    const card = document.querySelector('.kpi[data-slot="0"]');
    card.querySelector('.kpi-head').click();
    const f = [...document.querySelectorAll('.kpi[data-slot="0"] .dd-foot')]
      .find((x) => x.innerText.indexOf('恢复默认') >= 0);
    if (!f) return null;
    f.click();
    return [...document.querySelectorAll('.kpi .k')].map((x) => x.innerText.trim()).join(',');
  });
  ck('「恢复默认 5 项」生效', reset5 === '订单量,销售额,销售件数,商品访客数,商品浏览量', reset5 || '（找不到按钮）');

  const enLeft = await page.evaluate(() => {
    const txt = document.body.innerText;
    return ['PDP UV', 'PDP PV', '店铺 UV', '店铺 PV', '加购 UV', 'PDP UV/PV'].filter((x) => txt.indexOf(x) >= 0);
  });
  ck('整页正文无英文指标缩写', enLeft.length === 0, enLeft.length ? enLeft.join(' / ') : '全中文');

  console.log('\n=== 8e. 无数据的候选直接隐藏（不是置灰） ===');
  await reset();
  const siteAll = await page.evaluate(() => [...document.querySelectorAll('#ddSiteList .dd-opt')]
    .map((x) => x.innerText.split('\n')[0]));
  const SITES_WITH_ROWS = SITE_CODES.filter((c) => rowsOf({}).some((r) => r.site === c));
  ck('全量时站点候选 == 有 SKU 明细的站点（' + SITES_WITH_ROWS.length + ' 个：' + SITES_WITH_ROWS.join('/') + '）',
    siteAll.length === SITES_WITH_ROWS.length, siteAll.join(' '));
  // 「激光模块」只在部分站点卖 → 选它后没卖的站点应从站点下拉消失
  const LASER_SITES = SITE_CODES.filter((c) => rowsOf({ series: ['Laser Module'] }).some((r) => r.site === c));
  const NON_LASER = SITE_CODES.filter((c) => LASER_SITES.indexOf(c) < 0);
  await pickOpt('ddSeries', 'ddSeriesList', 'Laser Module');
  const siteNarrow = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#ddSiteList .dd-opt')].map((x) => x.innerText.split('\n')[0]),
    dim: document.querySelectorAll('#ddSiteList .dd-opt.dim').length,
    foot: (document.querySelector('#ddSiteList .dd-foot.info') || {}).innerText || ''
  }));
  ck('选「激光模块」后不卖它的站点（' + (NON_LASER.join('/') || '无') + '）直接消失',
    siteNarrow.opts.length > 0 && siteNarrow.opts.every((t) => NON_LASER.every((c) => t.indexOf(c) < 0)),
    siteNarrow.opts.join(' '));
  ck('用的是「隐藏」而非「置灰」', siteNarrow.dim === 0, '置灰项 ' + siteNarrow.dim);
  ck('面板底部提示已隐藏项数', siteNarrow.foot.indexOf('已按当前筛选隐藏') >= 0, siteNarrow.foot || '（缺失）');
  const EXP_W_LASER = visibleWeekOpts({ series: ['Laser Module'] });
  const wkAll = await page.evaluate(() => [...document.querySelectorAll('#ddWeekList .dd-opt')]
    .map((x) => x.innerText.split(' ')[0]));
  ck('周数候选同样被收窄到「激光模块真实有数据的周」（' + EXP_W_LASER.length + ' 周）',
    wkAll.length > 0 && wkAll.length === EXP_W_LASER.length && wkAll.join() === EXP_W_LASER.join(),
    '剩 ' + wkAll.length + ' 周：' + wkAll.join(' '));
  // 站点下拉右上角的范围提示也得跟着收窄，否则「UK / DE / NL / FR」会让人以为 UK 有数据
  const siteHint = await page.evaluate(() => (document.getElementById('ddSiteHint') || {}).textContent || '');
  ck('站点范围提示同步收窄（=' + LASER_SITES.join(' / ') + '）',
    siteHint.length > 0 && LASER_SITES.every((c) => siteHint.indexOf(c) >= 0) &&
    NON_LASER.every((c) => siteHint.indexOf(c) < 0), siteHint);

  // 需求③ 的附带收益：候选已按其余维度收窄，**UI 上选不出「两个维度无交集」的组合**了。
  // 选了 UK 之后，只在 DE/FR/NL 卖的「激光模块」直接从系列候选里消失，点都点不到，
  // 自然也就不会出现「刚选的项被系统悄悄取消」。pruneOther + 「自动取消」提示保留作兜底
  // （数据重采后商品下架、或带失效值的旧链接仍有概率触发）。
  await reset();
  await pickOpt('ddSite', 'ddSiteList', 'UK');
  const laserUnder = await page.evaluate(() => [...document.querySelectorAll('#ddSeriesList .dd-opt')]
    .some((x) => x.innerText.indexOf('Laser Module') >= 0));
  ck('选了 UK 后「激光模块」系列已被隐藏（选不出无效组合）', laserUnder === false,
    laserUnder ? '仍可选 → 可能选出空集' : '已隐藏');
  await reset();

  console.log('\n=== 8f. 窗口从「首个有数据的周」开始（早期连续全 0 的周已删除） ===');
  // 采集窗口是滚动 120 天（更早），但商品 7 月才上架 → 前面若干周四个站点全是 0。
  // 这类「开头连续为 0」的周只拉长 X 轴、还容易被读成「流量一直为零」，已整体移除。
  // ⚠️ 期望值不写死周号 / 周数：用 payload 复算 activeWeeks() 的「连续后缀」。
  const EXP_W_BASE = visibleWeekOpts({});
  await reset();
  const w0 = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#ddWeekList .dd-opt')].map((x) => x.innerText.split(' ')[0]),
    win: (document.getElementById('winBadge') || {}).textContent || '',
    warn: (document.getElementById('warnHost') || {}).innerText || ''
  }));
  ck('全量周候选 == payload 复算的可见周（' + EXP_W_BASE.length + ' 周：' +
    EXP_W_BASE[0] + '~' + EXP_W_BASE[EXP_W_BASE.length - 1] + '）',
    w0.opts.length === EXP_W_BASE.length && w0.opts.join() === EXP_W_BASE.join(),
    w0.opts.length + ' 周：' + w0.opts[0] + '…' + w0.opts[w0.opts.length - 1]);
  ck('全量周候选起点 == payload.weeks 首周（' + WKEYS[0] + '，窗口起点已收紧）',
    w0.opts[0] === WKEYS[0], w0.opts[0] + ' / payload 首周 ' + WKEYS[0]);
  const gone = TRIMMED_OUT.filter((x) => w0.opts.indexOf(x) >= 0);
  ck('被后端裁掉、且不在窗口内的周（' + (TRIMMED_OUT.join(',') || '无') + '）已从候选删除',
    gone.length === 0, gone.length ? '仍可见 ' + gone.join(',') : '已删除');
  ck('窗口标签 == range 的 ' + P.range.startDate + ' ~ ' + P.range.endDate + '（不再说长到进行中的半周）',
    w0.win === winLabelOf(EXP_W_BASE), w0.win + '（期望 ' + winLabelOf(EXP_W_BASE) + '）');
  ck('警示条说明窗口起点已收紧',
    w0.warn.indexOf('窗口起点已收紧') >= 0 &&
    (P.warnings || []).some((w) => w.indexOf('窗口起点已收紧') >= 0 && w.indexOf(P.range.startDate) >= 0),
    (w0.warn.split('\n').filter((x) => x.indexOf('收紧') >= 0)[0] || '（缺失）'));
  const wrongLate = SITE_CODES.filter((c) => LATE_COVER_SITES.indexOf(c) < 0)
    .filter((c) => w0.warn.indexOf(c + ' 自 ') >= 0);
  ck('「起点晚」提示只保留接口真没返回的站（' + (LATE_COVER_SITES.join('/') || '无') + '），不误报其余站',
    LATE_COVER_SITES.every((c) => w0.warn.indexOf(c + ' 自 ') >= 0) && wrongLate.length === 0,
    (w0.warn.split('\n').filter((x) => x.indexOf('店铺流量') >= 0)[0] || '（无此条）'));

  // 选单站时以「该站自己的首个有数据周」为准（activeWeeks 前端动态收窄）
  const EXP_W_DE = visibleWeekOpts({ site: ['DE'] });
  await pickOpt('ddSite', 'ddSiteList', 'DE');
  const deW = await page.evaluate(() => [...document.querySelectorAll('#ddWeekList .dd-opt')].map((x) => x.innerText.split(' ')[0]));
  ck('选 DE 后周候选 == DE 站实际可见的周（' + EXP_W_DE.length + ' 周，从 ' + EXP_W_DE[0] + ' 起）',
    deW.length === EXP_W_DE.length && deW.join() === EXP_W_DE.join(),
    deW.length + ' 周：' + deW.join(' '));
  const deCut = WKEYS.slice(0, WKEYS.indexOf(EXP_W_DE[0]));
  ck('DE 起点之前的全量周已从候选去掉', deCut.every((x) => deW.indexOf(x) < 0),
    (deCut.join(',') || '无') + ' 已去掉');
  await reset();
  const EXP_W_UK = visibleWeekOpts({ site: ['UK'] });
  await pickOpt('ddSite', 'ddSiteList', 'UK');
  const ukW = await page.evaluate(() => [...document.querySelectorAll('#ddWeekList .dd-opt')].map((x) => x.innerText.split(' ')[0]));
  ck('选 UK 后周候选 == UK 站实际可见的周（' + EXP_W_UK.length + ' 周，从 ' + EXP_W_UK[0] + ' 起）',
    ukW.length === EXP_W_UK.length && ukW.join() === EXP_W_UK.join(),
    ukW.length + ' 周：' + ukW[0] + '…' + ukW[ukW.length - 1]);
  await reset();

  console.log('\n=== 8g. 周筛选要真的驱动图表 X 轴（选了哪几周就只画哪几周） ===');
  // 回归背景：activeWeeks() 是「排除周筛选」算的（周数下拉候选必须不受自身影响，否则
  // 选完一周面板里就只剩那一周、没法继续多选）。副作用是：在周数下拉里选了几周之后，
  // X 轴仍铺满全部有效周、未选中的画成 0 —— 用户视觉上就是「筛了等于没筛」。
  // 现在图表 / 周度表 / 日明细改走 visibleWeeks() = activeWeeks() ∩ 周筛选。
  const base = await page.evaluate(() => {
    const c = window.Chart && Chart.getChart('c1');
    return {
      labels: c ? c.data.labels.map(String) : [],
      rows: document.querySelectorAll('#tblWeeks table tbody tr').length,
      win: (document.getElementById('winBadge') || {}).textContent || ''
    };
  });
  ck('未选周时 X 轴 = 全部有效周（' + EXP_W_BASE.length + '）', base.labels.length === EXP_W_BASE.length,
    base.labels.length + ' 周：' + base.labels[0] + '…' + base.labels[base.labels.length - 1]);
  ck('未选周时周度汇总表行数 == 同样周数', base.rows === EXP_W_BASE.length, base.rows + ' 行');
  ck('未筛选时「窗口」标签 == 裁剪后窗口（行为不变）',
    base.win === winLabelOf(EXP_W_BASE), base.win);

  // 选哪两周由 payload 决定（取可见周的最后两个），不写死 W38/W39
  const W_PICK = EXP_W_BASE.slice(-2);
  await openDD('ddWeek');
  await page.evaluate((wk) => {
    const o = [...document.querySelectorAll('#ddWeekList .dd-opt')]
      .find((x) => x.innerText.split(' ')[0] === wk);
    o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, W_PICK[0]);
  await sleep(700);
  await page.evaluate((wk) => {
    const o = [...document.querySelectorAll('#ddWeekList .dd-opt')]
      .find((x) => x.innerText.split(' ')[0] === wk);
    o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  }, W_PICK[1]);
  await sleep(900);
  await page.evaluate(() => document.getElementById('ddWeek').classList.remove('open'));

  const picked = await page.evaluate(() => {
    const c1 = window.Chart && Chart.getChart('c1');
    const c2 = window.Chart && Chart.getChart('c2');
    return {
      c1: c1 ? c1.data.labels.map(String) : [],
      c2: c2 ? c2.data.labels.map(String) : [],
      rows: document.querySelectorAll('#tblWeeks table tbody tr').length,
      daily: document.querySelectorAll('#tblDaily table tbody tr').length,
      opts: document.querySelectorAll('#ddWeekList .dd-opt').length,
      win: (document.getElementById('winBadge') || {}).textContent || ''
    };
  });
  ck('选 ' + W_PICK.join('+') + ' 后订单量图 X 轴只剩这 2 周',
    picked.c1.length === 2 && picked.c1.join() === W_PICK.join(), picked.c1.join(' ') || '（空）');
  ck('商品流量图同步收窄到同样 2 周',
    picked.c2.length === 2 && picked.c2.join() === W_PICK.join(), picked.c2.join(' ') || '（空）');
  ck('周度汇总表行数同步 = 2', picked.rows === 2, picked.rows + ' 行');
  const dayCap = W_PICK.reduce((n, k) => n + (P.weeks.filter((w) => w.key === k)[0] || {}).nDays, 0) || 14;
  ck('每日明细只剩这两周内的日期（≤ ' + dayCap + ' 行）', picked.daily > 0 && picked.daily <= dayCap, picked.daily + ' 行');
  ck('周数下拉候选不受自身筛选影响（仍 ' + EXP_W_BASE.length + ' 项，可继续多选）',
    picked.opts === EXP_W_BASE.length, picked.opts + ' 项');
  ck('「窗口」标签同步跟到筛选后的日期范围（' + winLabelOf(W_PICK) + '）',
    picked.win === winLabelOf(W_PICK), picked.win);
  await reset();

  console.log('\n=== 9. 多选 ===');
  await page.evaluate((id) => document.getElementById(id).classList.add('open'), 'ddSite');
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('#ddSiteList .dd-opt')].find((x) => x.innerText.indexOf('UK') >= 0);
    o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(700);
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('#ddSiteList .dd-opt')].find((x) => x.innerText.indexOf('DE') >= 0);
    o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  });
  await sleep(800);
  ck('Ctrl 多选生效', (await summaryOf('ddSiteSum')).indexOf('已选') >= 0 || (await summaryOf('ddSiteSum')).indexOf('UK') >= 0, await summaryOf('ddSiteSum'));
  const A_UKDE = aggOf({ site: ['UK', 'DE'] });
  k = await kpi();
  console.log('   UK+DE KPI:', JSON.stringify(k));
  ck('UK+DE 订单量 == 聚合值（' + A_UKDE.orders + '）', k['订单量'] === fmt0(A_UKDE.orders), k['订单量']);
  ck('UK+DE 销售额 == 多站点按币种分开计（' + A_UKDE.salesText + '）',
    k['销售额'] === A_UKDE.salesText, k['销售额']);
  const ukde = await page.evaluate(() => {
    const t = document.querySelector('#tblSku');
    return t ? [...t.querySelectorAll('tbody tr')].length : 0;
  });
  ck('UK+DE 有 SKU 明细行', ukde > 0, ukde + ' 行');

  // 截图：产品页签要渲染整张 SKU 表 + 关键词表，偶发超时（页面重绘把 CDP 截图卡住）。
  // 截图只是给人看的副产物，**不能让它把回归判成失败**，所以单独兜住。
  try {
    const SHOT = { timeout: 45000 };
    await reset();
    await sleep(900);
    await page.screenshot(Object.assign({ path: '_jb_f_reset.png' }, SHOT));
    await page.evaluate(() => document.querySelector('.tab[data-p="product"]').click());
    await sleep(1800);
    await page.screenshot(Object.assign({ path: '_jb_f_product.png' }, SHOT));
    await page.evaluate(() => document.querySelector('.tab[data-p="trend"]').click());
    await sleep(1400);
    await pickOpt('ddSeries', 'ddSeriesList', 'X1');
    await sleep(600);
    await page.screenshot(Object.assign({ path: '_jb_f_series.png' }, SHOT));
    console.log('  截图已更新: _jb_f_reset.png / _jb_f_product.png / _jb_f_series.png');
  } catch (e) {
    console.log('  ! 截图跳过（不影响结论）: ' + String(e.message).split('\n')[0]);
  }

  console.log('\nERRORS(' + errs.length + '):', JSON.stringify(errs.slice(0, 8)));
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(2); });
