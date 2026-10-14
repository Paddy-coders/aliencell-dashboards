// test_woot.js — Woot 数据上传/并入 回归（官方「产品每日总表现」报表 + 按子 ASIN 并入）
// 用法: node test_woot.js  (BASE 默认 http://127.0.0.1:8899, 可设 BASE 测线上)
const { chromium } = require('./playwright-auth');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const FIXTURE_XLSX = path.join(__dirname, 'woot_official_sample.xlsx');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// 逐日记录（官方报表形态：带子 ASIN）
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };
// 旧的周汇总记录（无 ASIN，应仍兼容 → WOOT-STORE 伪 ASIN，按重叠天数分摊）
const WOOT_LEGACY = { start: '2026-09-05', end: '2026-09-11', type: 'week', label: 'W37',
  metrics: { orders: 0, sales: 7000, adCost: 700, adClicks: 140, adOrders: 7, adImpr: 70000, adSales: 3500 } };

async function newPage(browser, woot) {
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((w) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
  }, woot);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(SUPA, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  return { page, errs, ctx };
}

(async () => {
  const browser = await chromium.launch();
  console.log(`== 测试目标: ${BASE} ==`);

  // ---------- 1. woot.html: 官方报表解析 / 合并 / 云端保存 ----------
  {
    console.log('-- woot.html 管理页 --');
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 960 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    let savedBody = null;
    await page.route(SUPA, async route => {
      const req = route.request();
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify([{ id: 1, data: { catalog: [], asinMap: [], woot: [] }, updated_at: 'x' }]) });
      }
      if (req.method() === 'PATCH') { savedBody = req.postData(); return route.fulfill({ status: 204 }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto(BASE + '/woot.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(800);

    // 1.1 官方 xlsx 直传（标题行 + 英文表头 + 中文表头）
    await page.setInputFiles('#wFile', FIXTURE_XLSX);
    await page.waitForTimeout(1500);
    t('woot: 官方 xlsx 弹出预览', await page.locator('#previewBox.show').count() === 1);
    const off = await page.evaluate(() => {
      const rows = pendingPreview.map(e => ({ d: e.start, a: e.asin, o: e.metrics.orders, s: e.metrics.sales, c: e.metrics.adCost, k: e.metrics.adClicks, i: e.metrics.adImpr }));
      const sum = k => pendingPreview.reduce((s, e) => s + (e.metrics[k] || 0), 0);
      return { n: pendingPreview.length, asins: [...new Set(pendingPreview.map(e => e.asin))],
        sumSales: sum('sales'), sumCost: sum('adCost'), sumOrders: sum('orders'), rows,
        d914: rows.find(r => r.d === '2026-09-14') };
    });
    t('woot: 官方表解析出 9 个有数据日(14天中5天全0已跳过)', off.n === 9, off.n);
    t('woot: 预览提示 5 行全 0 已跳过(不算未识别)', (await page.textContent('#previewBox')).includes('5 行全 0 已跳过') && !(await page.textContent('#previewBox')).includes('行未识别'),
      (await page.textContent('#previewBox')).slice(0, 120));
    t('woot: 子 ASIN 全部识别为 B0H69JJZ1M', off.asins.length === 1 && off.asins[0] === 'B0H69JJZ1M', off.asins);
    t('woot: 09-14 精确值(订单1/销售1899.99/花费518.8/点击166/曝光48035)',
      off.d914 && off.d914.o === 1 && Math.abs(off.d914.s - 1899.99) < 0.01 && Math.abs(off.d914.c - 518.8) < 0.01 && off.d914.k === 166 && off.d914.i === 48035, off.d914);
    t('woot: 合计 销售额1899.99 / 广告花费3138.5 / 订单1',
      Math.abs(off.sumSales - 1899.99) < 0.01 && Math.abs(off.sumCost - 3138.5) < 0.01 && off.sumOrders === 1,
      { s: off.sumSales, c: off.sumCost, o: off.sumOrders });

    // 1.2 粘贴官方格式（含标题行/双行表头/同日期同 ASIN 两行 → 应聚合为 1 条）
    await page.fill('#wText', [
      '产品每日总表现',
      'Date,WeekDay,SubOrderId,ProductDetail,childAsin,Woot Orders,Ads Orders,Ads CR,Acos,Ads Spend,Ads CPC,Impressions,Clicks,Ads CTR,Ads Sales,Cost Per Ads Order,Cost Per Order,Ads Orders Share,BSR1,BSR2,ViewableImpressions,vcpm,M8',
      '报告日期,星期,订单编号,产品名称,子Asin,Woot订单数量,广告订单数量,广告的转化率,广告投入产出比,广告花费,广告单次点击花费,展示数量,点击数量,广告点击率,广告销售额,单个广告订单的费用,单个订单的费用,广告占比,BSR1,BSR2,Viewable展示数量,千次展示花费,总销售额',
      '2026-09-11,Friday,BC001,激光雕刻机,B0H69JJZ1M,2,1,0.5,0.1,100.5,1.2,9000,80,0.008,500,100,50,0.5,409326,1162,0,0,2000',
      '2026-09-11,Friday,BC002,激光雕刻机,B0H69JJZ1M,1,0,0,0,50.5,1.1,4000,40,0.01,0,0,0,0,409326,1162,0,0,1000',
    ].join('\n'));
    await page.click('text=解析预览');
    await page.waitForTimeout(300);
    const paste = await page.evaluate(() => {
      const e = pendingPreview[0];
      return { n: pendingPreview.length, d: e.start, asin: e.asin, orders: e.metrics.orders,
        sales: e.metrics.sales, cost: e.metrics.adCost, clicks: e.metrics.adClicks, adsales: e.metrics.adSales };
    });
    t('woot: 同日期同 ASIN 两行聚合为 1 条(09-11)', paste.n === 1 && paste.d === '2026-09-11' && paste.asin === 'B0H69JJZ1M', paste);
    t('woot: 聚合后数值相加(订单3/销售3000/花费151/点击120/广告销售额500)',
      paste.orders === 3 && Math.abs(paste.sales - 3000) < 0.01 && Math.abs(paste.cost - 151) < 0.01 && paste.clicks === 120 && Math.abs(paste.adsales - 500) < 0.01,
      paste);
    t('woot: 中文表头「展示数量」未被 Viewable展示数量/千次展示花费 误匹配', paste.clicks === 120 && paste.adsales === 500, paste);

    // 1.2b Session 是 ASIN 维度/全平台口径 → Woot 表即便带 Session 列也不采集、不被误匹配（2026-09-23 用户澄清）
    await page.fill('#wText', [
      '产品每日总表现',
      'Date,WeekDay,ProductDetail,childAsin,Sessions,Woot Orders,Ads Spend,Clicks,Ads Sales,M8',
      '报告日期,星期,产品名称,子Asin,买家访问次数,Woot订单数量,广告花费,点击数量,广告销售额,总销售额',
      '2026-09-11,Friday,激光雕刻机,B0H69JJZ1M,7777,2,100.5,80,500,2000',
    ].join('\n'));
    await page.click('text=解析预览');
    await page.waitForTimeout(300);
    const sess = await page.evaluate(() => {
      const e = pendingPreview[0];
      return { n: pendingPreview.length, keys: Object.keys(e.metrics).sort().join(','), orders: e.metrics.orders,
        sales: e.metrics.sales, cost: e.metrics.adCost, clicks: e.metrics.adClicks,
        hasSessField: FIELDS.some(f => /session/i.test(f.key) || (f.aliases || []).some(a => /session/i.test(a))) };
    });
    t('woot: 表头映射无 session 字段(Session 为 ASIN 维度全平台口径,不补)', sess.hasSessField === false, sess.hasSessField);
    t('woot: 官方表带 Session 列仍能正常解析且不被误采(订单=2 而非 7777)',
      sess.n === 1 && sess.orders === 2 && Math.abs(sess.sales - 2000) < 0.01 && Math.abs(sess.cost - 100.5) < 0.01 && sess.clicks === 80, sess);
    t('woot: 条目只含 7 个既定指标键(无 sessions)',
      sess.keys === 'adClicks,adCost,adImpr,adOrders,adSales,orders,sales', sess.keys);

    // 1.3 旧周汇总格式仍兼容
    await page.fill('#wText', '周开始日期,周结束日期,销售额,广告花费,广告点击,广告订单,广告曝光\n2026-09-05,2026-09-11,"12,345.67",2100.5,455,12,180000');
    await page.click('text=解析预览');
    await page.waitForTimeout(200);
    const pv = await page.evaluate(() => { const e = pendingPreview[0]; return { n: pendingPreview.length, s: e.start, en: e.end, label: e.label, sales: e.metrics.sales, cost: e.metrics.adCost, asin: e.asin }; });
    t('woot: 旧周汇总格式仍可解析(W37/12345.67)', pv.n === 1 && pv.s === '2026-09-05' && pv.en === '2026-09-11' && pv.label === 'W37' && Math.abs(pv.sales - 12345.67) < 0.01 && !pv.asin, pv);

    // 1.4 确认导入 → 云端保存
    await page.click('text=确认导入');
    await page.waitForTimeout(500);
    t('woot: 确认导入后云端 PATCH 含 woot 键与日期', !!savedBody && savedBody.includes('"woot"') && savedBody.includes('2026-09-05'), savedBody ? savedBody.slice(0, 160) : null);
    t('woot: 列表显示 1 条记录', (await page.textContent('#stCount')).trim() === '1');

    // 1.5 重复上传 = 覆盖（不报错）：同周期重传 → 记录数不变、值替换为最新
    await page.fill('#wText', '周开始日期,周结束日期,销售额,广告花费,广告点击,广告订单,广告曝光\n2026-09-05,2026-09-11,"22,000",3000,500,20,200000');
    await page.click('text=解析预览');
    await page.waitForTimeout(250);
    const ptxt = await page.textContent('#previewBox');
    t('woot: 重复上传同周期 → 预览显示「覆盖同键 1 条」而不是报错',
      ptxt.includes('覆盖同键 1 条') && ptxt.includes('新增 0 条'), ptxt.replace(/\s+/g, ' ').slice(0, 170));
    await page.click('text=确认导入');
    await page.waitForTimeout(400);
    const rep = await page.evaluate(() => ({ n: entries.length, sales: entries[0].metrics.sales, cost: entries[0].metrics.adCost }));
    t('woot: 重传后记录数不变、数值以最新一次为准(22000/3000)',
      rep.n === 1 && Math.abs(rep.sales - 22000) < 0.01 && Math.abs(rep.cost - 3000) < 0.01, rep);

    // 1.6 覆盖同步：逐日数据取代同范围旧记录（含旧整店汇总），避免延迟重传/换粒度造成重复计算
    await page.evaluate(() => {
      entries = [
        { start: '2026-09-05', end: '2026-09-11', type: 'range', label: 'W37', asin: '', name: '',
          metrics: { orders: 0, sales: 7000, adCost: 700, adClicks: 140, adOrders: 7, adImpr: 70000, adSales: 3500 } },
        { start: '2026-09-10', end: '2026-09-10', type: 'day', label: '2026-09-10', asin: 'B0H69JJZ1M', name: '',
          metrics: { orders: 1, sales: 1000, adCost: 100, adClicks: 10, adOrders: 1, adImpr: 10000, adSales: 500 } },
      ];
      renderList();
    });
    await page.fill('#wText', [
      'Date,childAsin,Woot Orders,Ads Spend,Clicks,Ads Sales,M8',
      '2026-09-10,B0H69JJZ1M,1,518.8,166,0,1899.99',
      '2026-09-11,B0H69JJZ1M,3,100.5,80,500,2000',
    ].join('\n'));
    await page.click('text=解析预览');
    await page.waitForTimeout(250);
    const plan = await page.evaluate(() => {
      const p = planImport(pendingPreview, 'sync');
      return { add: p.add, upd: p.upd, dels: p.dels.map(e => (e.asin || '(整店)') + ' ' + e.start + '~' + e.end) };
    });
    t('woot: 覆盖同步：9/10 同键覆盖 + 9/11 新增 + 旧整店汇总被清理',
      plan.add === 1 && plan.upd === 1 && plan.dels.length === 1 && plan.dels[0].includes('(整店)'), plan);
    await page.click('text=确认导入');
    await page.waitForTimeout(400);
    const after6 = await page.evaluate(() => ({ n: entries.length, asins: [...new Set(entries.map(e => e.asin || ''))].sort(),
      d10: (entries.find(e => e.start === '2026-09-10') || {}).metrics }));
    t('woot: 导入后只剩逐日记录、旧整店汇总已清除(不重复计算)',
      after6.n === 2 && after6.asins.length === 1 && after6.asins[0] === 'B0H69JJZ1M', after6);
    t('woot: 9/10 旧值(1000)被最新上传值覆盖(1899.99)',
      Math.abs(after6.d10.sales - 1899.99) < 0.01 && Math.abs(after6.d10.adCost - 518.8) < 0.01, after6.d10);

    // 1.6b 数据延迟修正：某天从有值变为全 0（重传时该行被跳过）→ 旧记录应被清理，不能留下虚高值
    await page.evaluate(() => {
      entries = [{ start: '2026-09-12', end: '2026-09-12', type: 'day', label: '2026-09-12', asin: 'B0H69JJZ1M', name: '',
        metrics: { orders: 0, sales: 500, adCost: 50, adClicks: 5, adOrders: 0, adImpr: 5000, adSales: 0 } }];
      renderList();
    });
    await page.fill('#wText', [
      'Date,childAsin,Woot Orders,Ads Spend,Clicks,Ads Sales,M8',
      '2026-09-11,B0H69JJZ1M,3,100.5,80,500,2000',
      '2026-09-12,B0H69JJZ1M,0,0,0,0,0',
      '2026-09-13,B0H69JJZ1M,1,10,5,0,300',
    ].join('\n'));
    await page.click('text=解析预览');
    await page.waitForTimeout(250);
    const zeroPlan = await page.evaluate(() => {
      const p = planImport(pendingPreview, 'sync');
      return { n: pendingPreview.length, dels: p.dels.map(e => e.start) };
    });
    t('woot: 某天重传后变全 0 → 该天旧记录被清理(不留虚高)',
      zeroPlan.n === 2 && zeroPlan.dels.length === 1 && zeroPlan.dels[0] === '2026-09-12', zeroPlan);

    // 1.7 「仅追加」模式：不清理旧记录
    await page.evaluate(() => {
      entries = [{ start: '2026-09-10', end: '2026-09-10', type: 'day', label: '2026-09-10', asin: '', name: '',
        metrics: { orders: 0, sales: 7000, adCost: 700, adClicks: 140, adOrders: 7, adImpr: 70000, adSales: 3500 } }];
      renderList();
    });
    await page.selectOption('#impMode', 'append');
    await page.fill('#wText', 'Date,childAsin,Woot Orders,Ads Spend,Clicks,Ads Sales,M8\n2026-09-10,B0H69JJZ1M,1,518.8,166,0,1899.99');
    await page.click('text=解析预览');
    await page.waitForTimeout(250);
    const app = await page.evaluate(() => { const p = planImport(pendingPreview, 'append'); return { dels: p.dels.length, add: p.add }; });
    t('woot: 「仅追加」模式不清理旧记录', app.dels === 0 && app.add === 1, app);
    await page.selectOption('#impMode', 'sync');

    t('woot: 无页面错误', errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 2. daily.html: 逐日精确并入 + 按 ASIN 归属 ----------
  {
    console.log('-- daily.html 并入 --');
    const { page, errs } = await newPage(browser, [WOOT_DAY]);
    await page.goto(BASE + '/daily.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    t('daily: 无页面错误', errs.length === 0, errs);

    const d10 = await page.evaluate(() => {
      const a = aggRows('2026-09-10', new Set(['US']), new Set());
      return { sales: a.sales, adCost: a.adCost, adClicks: a.adClicks, orders: a.orders, sessions: a.sessions };
    });
    const { page: p2 } = await newPage(browser, []);
    await p2.goto(BASE + '/daily.html', { waitUntil: 'load', timeout: 60000 });
    await p2.waitForTimeout(2500);
    const d10base = await p2.evaluate(() => { const a = aggRows('2026-09-10', new Set(['US']), new Set()); return { sales: a.sales, adCost: a.adCost, adClicks: a.adClicks, orders: a.orders, sessions: a.sessions }; });
    t('daily: 09-10 为真实当日值(销售+1899.99/花费+518.8/点击+166/订单+1)',
      Math.abs((d10.sales - d10base.sales) - 1899.99) < 0.01 &&
      Math.abs((d10.adCost - d10base.adCost) - 518.8) < 0.01 &&
      Math.abs((d10.adClicks - d10base.adClicks) - 166) < 0.01 &&
      (d10.orders - d10base.orders) === 1,
      { with: d10, without: d10base });
    t('daily: Woot 不产生 Sessions(流量不变)', Math.abs(d10.sessions - d10base.sessions) < 0.01, { with: d10.sessions, without: d10base.sessions });

    // 相邻日期不应被分摊
    const d11 = await page.evaluate(() => { const a = aggRows('2026-09-11', new Set(['US']), new Set()); return a.sales; });
    const d11base = await p2.evaluate(() => { const a = aggRows('2026-09-11', new Set(['US']), new Set()); return a.sales; });
    t('daily: 未记录的相邻日(09-11)不变(证明不再均摊)', Math.abs(d11 - d11base) < 0.01, { with: d11, without: d11base });

    // 选中该 ASIN 时应包含 Woot 金额（新行为）
    const asinSel = await page.evaluate(() => {
      const a = aggRows('2026-09-10', new Set(), new Set(['B0H69JJZ1M']));
      return { sales: a.sales, adCost: a.adCost };
    });
    const asinSelBase = await p2.evaluate(() => { const a = aggRows('2026-09-10', new Set(), new Set(['B0H69JJZ1M'])); return { sales: a.sales, adCost: a.adCost }; });
    t('daily: 筛选具体 ASIN B0H69JJZ1M 已包含 Woot 金额',
      Math.abs((asinSel.sales - asinSelBase.sales) - 1899.99) < 0.01 && Math.abs((asinSel.adCost - asinSelBase.adCost) - 518.8) < 0.01,
      { with: asinSel, without: asinSelBase });
    t('daily: footer 显示 Woot 已并入', (await page.textContent('body')).includes('Woot 数据已并入'));
    await p2.context().close();
    await page.context().close();
  }

  // ---------- 3. daily.html: 旧周汇总记录仍按比例分摊到 WOOT-STORE ----------
  {
    console.log('-- daily.html 旧记录兼容 --');
    const { page, errs } = await newPage(browser, [WOOT_LEGACY]);
    await page.goto(BASE + '/daily.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    t('daily(旧): 无页面错误', errs.length === 0, errs);
    const r = await page.evaluate(() => {
      let s = 0; for (const d of DAYS) s += aggRows(d, new Set(), new Set(['WOOT-STORE'])).sales;
      return { total: s, hasStore: allAsins.has('WOOT-STORE') };
    });
    t('daily(旧): WOOT-STORE 合计 = 7000', r.hasStore && Math.abs(r.total - 7000) < 0.05, r);
    await page.context().close();
  }

  // ---------- 4. monthly.html: 按 ASIN 月度汇总 ----------
  {
    console.log('-- monthly.html 并入 --');
    const { page, errs } = await newPage(browser, [WOOT_DAY, WOOT_LEGACY]);
    await page.goto(BASE + '/monthly.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    t('monthly: 无页面错误', errs.length === 0, errs);
    const m = await page.evaluate(() => {
      const asinRows = ROWS.filter(r => r.woot && r.asin === 'B0H69JJZ1M');
      const storeRows = ROWS.filter(r => r.woot && r.asin === 'WOOT-STORE');
      return { asinN: asinRows.length, asinSales: asinRows.reduce((s, r) => s + r.sales, 0),
        asinYm: asinRows.map(r => r.ym), asinCc: asinRows.map(r => r.cc),
        storeN: storeRows.length, storeSales: storeRows.reduce((s, r) => s + r.sales, 0) };
    });
    t('monthly: 生成 B0H69JJZ1M 月度行(2026-09/US/销售1899.99)',
      m.asinN === 1 && m.asinYm[0] === '2026-09' && m.asinCc[0] === 'US' && Math.abs(m.asinSales - 1899.99) < 0.01, m);
    t('monthly: 旧记录仍生成 WOOT-STORE 行(7000)', m.storeN === 1 && Math.abs(m.storeSales - 7000) < 0.05, m);
    await page.context().close();
  }

  // ---------- 5. product.html (周度汇总): 按 ASIN 累加 ----------
  {
    console.log('-- product.html 并入 --');
    const { page, errs } = await newPage(browser, [WOOT_DAY, WOOT_LEGACY]);
    await page.goto(BASE + '/product.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    const { page: p2 } = await newPage(browser, []);
    await p2.goto(BASE + '/product.html', { waitUntil: 'load', timeout: 60000 });
    await p2.waitForTimeout(2500);
    t('product: 无页面错误', errs.length === 0, errs);
    const withW = await page.evaluate(() => {
      const a = asinWeekData('B0H69JJZ1M', 'W37');
      const b = asinWeekData('WOOT-STORE', 'W37');
      return { a: a && { sales: a.sales, adSpend: a.adSpend }, b: b && { sales: b.sales, adSpend: b.adSpend } };
    });
    const base = await p2.evaluate(() => { const a = asinWeekData('B0H69JJZ1M', 'W37'); return a ? { sales: a.sales, adSpend: a.adSpend } : null; });
    t('product: W37 该 ASIN 销售额增加 1899.99 / 广告花费增加 518.8',
      Math.abs((withW.a.sales - (base ? base.sales : 0)) - 1899.99) < 0.05 && Math.abs((withW.a.adSpend - (base ? base.adSpend : 0)) - 518.8) < 0.05,
      { with: withW.a, without: base });
    t('product: 旧记录仍生成 WOOT-STORE 周行(销售7000/花费700)',
      withW.b && Math.abs(withW.b.sales - 7000) < 0.05 && Math.abs(withW.b.adSpend - 700) < 0.05, withW.b);
    await p2.context().close();
    await page.context().close();
  }

  // ---------- 6. target.html (月度目标追踪) ----------
  {
    console.log('-- target.html 并入 --');
    const { page, errs } = await newPage(browser, [WOOT_DAY, WOOT_LEGACY]);
    await page.goto(BASE + '/target.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    t('target: 无页面错误', errs.length === 0, errs);
    const r = await page.evaluate(() => {
      const a = ROWS.filter(x => x.woot && x.asin === 'B0H69JJZ1M');
      const b = ROWS.filter(x => x.woot && x.asin === 'WOOT-STORE');
      return { an: a.length, asales: a.reduce((s, x) => s + x.sales, 0), aym: a.map(x => x.ym),
        bn: b.length, bsales: b.reduce((s, x) => s + x.sales, 0) };
    });
    t('target: B0H69JJZ1M 实际值含 Woot(2026-09 / 1899.99)',
      r.an === 1 && r.aym[0] === '2026-09' && Math.abs(r.asales - 1899.99) < 0.01, r);
    t('target: 旧记录仍生成 WOOT-STORE 行(7000)', r.bn === 1 && Math.abs(r.bsales - 7000) < 0.05, r);
    await page.context().close();
  }

  // ---------- 7. ad.html (广告周度): Woot 广告花费并入 ----------
  {
    console.log('-- ad.html 并入 --');
    const { page, errs } = await newPage(browser, [WOOT_DAY]);
    await page.goto(BASE + '/ad.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    t('ad: 无页面错误', errs.length === 0, errs);
    const a = await page.evaluate(() => {
      const recs = DATA.records.filter(r => r.type === 'wootAds');
      const camps = DATA.campaigns.filter(c => c.id.indexOf('woot-') === 0);
      return { n: recs.length, cost: recs.reduce((s, r) => s + r.cost, 0), clicks: recs.reduce((s, r) => s + r.clicks, 0),
        week: recs.map(r => r.week), cc: recs.map(r => r.country), asin: recs.map(r => r.asin),
        hasType: DATA.types.some(x => x.code === 'wootAds'), campN: camps.length };
    });
    t('ad: 注入 Woot 广告记录(1条/花费518.8/点击166/US)', a.n === 1 && Math.abs(a.cost - 518.8) < 0.01 && a.clicks === 166 && a.cc[0] === 'US', a);
    t('ad: 所属周为 W37', a.week[0] === 'W37', a.week);
    t('ad: 归到子 ASIN B0H69JJZ1M', a.asin[0] === 'B0H69JJZ1M', a.asin);
    t('ad: 类型下拉新增 wootAds 与对应活动', a.hasType && a.campN === 1, a);
    t('ad: 页面出现「Woot 广告」', (await page.textContent('body')).includes('Woot 广告'));
    await page.context().close();
  }

  // ---------- 7b. ad.html 跨浏览器可见性：模拟"其他同事"(本机无 Woot 缓存) ----------
  // 护栏: ad.html 若缺少 cloudWootSync, 只读 localStorage → 换一台电脑/换个人打开就看不到
  // Woot 广告(无报错、静默少数据)。此用例断言"空缓存 + 云端有数据"也能显示。
  {
    console.log('-- ad.html 跨浏览器可见性(别人能不能看到) --');
    const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'other@aliencell.com' } }));
      // 不写 pc_woot：全新浏览器 = 其他同事首次打开
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.route(SUPA, route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, data: { catalog: [], asinMap: [], woot: [WOOT_DAY] }, updated_at: 'x' }]) }));
    await page.goto(BASE + '/ad.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);   // 等 cloudWootSync 拉云端 + 写入本机 + reload
    const b = await page.evaluate(() => {
      const recs = DATA.records.filter(r => r.type === 'wootAds');
      let ls = [];
      try { ls = JSON.parse(localStorage.getItem('pc_woot') || '[]') || []; } catch (e) {}
      return { n: recs.length, cost: recs.reduce((s, r) => s + r.cost, 0), ls: ls.length };
    });
    t('ad: 本机无缓存也能从云端拉到 Woot 广告(别人打开看得到)', b.n === 1 && Math.abs(b.cost - 518.8) < 0.01, b);
    t('ad: 云端数据已回写本机缓存', b.ls === 1, b);
    t('ad: 跨浏览器路径无页面错误', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
