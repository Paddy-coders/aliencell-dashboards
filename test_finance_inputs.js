// test_finance_inputs.js — 财务录入页(finance_inputs.html)回归
// 覆盖: ①页面结构与两张表 ②增删改 → localStorage/云端 ③云端 PATCH 只动 finance 键(不抹 catalog/asinMap/woot/wootCfg)
//      ④CSV/JSON 批量导入(表头识别 + 同 月份+ASIN 数量合并 + 非法行丢弃) ⑤CSV 导出文本
//      ⑥与 mapping.html / woot.html 的"共用单行"互不踩: 那两页写回时必须保留 finance
// 用法: node test_finance_inputs.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896, 可用环境变量覆盖)
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**/rest/v1/mapping*';
// 云端既有数据(模拟别人已存的映射/Woot/成本设置) —— 财务页写回时必须原样保留
const CLOUD_DATA = {
  catalog: [{ name: '滚轴', series: 'X1系列配件' }],
  asinMap: [{ asin: 'B0H69JJZ1M', series: 'X1系列', name: '滚轴', country: 'US' }],
  woot: [{ start: '2026-09-10', end: '2026-09-10', asin: 'B0H69JJZ1M', orders: 1 }],
  wootCfg: { price: 1380, cost: {} },
  finance: { otherOrders: [], reviewFees: [], updatedAt: '2026-10-11T00:00:00.000Z' }
};

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 1e-6 : tol);

function stubCloud(page, sink) {
  page.on('request', req => {
    if (req.method() === 'PATCH' && /\/rest\/v1\/mapping/.test(req.url())) {
      try { sink.push(JSON.parse(req.postData() || '{}')); } catch (e) { sink.push({ _parseError: String(e) }); }
    }
  });
  return page.route(SUPA, route => {
    const req = route.request();
    if (req.method() === 'PATCH') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ data: JSON.parse(JSON.stringify(CLOUD_DATA)), updated_at: '2026-10-12T02:00:00+00:00' }])
    });
  });
}

(async () => {
  const browser = await chromium.launch();

  // ================= ① 财务录入页 =================
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
  });
  const patches = [];
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await stubCloud(page, patches);
  await page.goto(BASE + '/finance_inputs.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(1500);

  t('页面加载无 JS 错误', errs.length === 0, errs.slice(0, 2));
  t('标题与入口存在', await page.evaluate(() =>
    /财务录入/.test(document.title) && !!document.querySelector('.tabs .tab')), null);
  // ⚠️ 导航项数不写死: 只断言"含财务录入入口"(页脚/导航会随迭代增删)
  t('页面含「其他渠道订单」「测评费用」两个页签', await page.evaluate(() => {
    const txt = [...document.querySelectorAll('.tab')].map(e => e.textContent).join('|');
    return /其他渠道订单/.test(txt) && /测评费用/.test(txt);
  }), null);

  // ---------- ② 添加记录 → 本机 + 云端 ----------
  await page.evaluate(() => {
    document.getElementById('ooYm').value = '2026-09';
    document.getElementById('ooAsin').value = 'b0h6qDgyy5';   // 小写输入应被规范化
    document.getElementById('ooQty').value = '1';
    document.getElementById('ooNote').value = '独立站';
    addOO();
  });
  await page.evaluate(() => {
    document.getElementById('rfYm').value = '2026-09';
    document.getElementById('rfSite').value = 'UK';
    document.getElementById('rfAsin').value = 'B0G25G961Y';
    document.getElementById('rfAmt').value = '120';
    document.getElementById('rfNote').value = '测评2单';
    addRF();
  });
  await page.waitForTimeout(1200);

  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_finance') || 'null'));
  t('本机已存 pc_finance · 其他渠道订单 1 条(ASIN 已大写)', !!local && local.otherOrders.length === 1
    && local.otherOrders[0].asin === 'B0H6QDGYY5' && near(local.otherOrders[0].qty, 1), local && local.otherOrders);
  t('本机已存 pc_finance · 测评费 1 条(币种按站点兜底 GBP)', !!local && local.reviewFees.length === 1
    && local.reviewFees[0].site === 'UK' && local.reviewFees[0].cur === 'GBP' && near(local.reviewFees[0].amount, 120),
    local && local.reviewFees);

  const last = patches[patches.length - 1];
  t('已推送云端 PATCH', !!last && !!last.data, patches.length);
  t('云端 data.finance 已写入且条数正确', !!last && last.data.finance
    && last.data.finance.otherOrders.length === 1 && last.data.finance.reviewFees.length === 1,
    last && last.data && last.data.finance);
  // ★ 关键护栏: 单行共用 → 写入必须保留别人的键
  t('★ 写云端保留 catalog/asinMap/woot/wootCfg(未抹掉)', !!last
    && Array.isArray(last.data.catalog) && last.data.catalog.length === 1
    && Array.isArray(last.data.asinMap) && last.data.asinMap.length === 1
    && Array.isArray(last.data.woot) && last.data.woot.length === 1
    && !!last.data.wootCfg,
    last && Object.keys(last.data || {}));

  // ---------- ③ 同 月份+ASIN 合并数量 ----------
  await page.evaluate(() => {
    document.getElementById('ooYm').value = '2026-09';
    document.getElementById('ooAsin').value = 'B0H6QDGYY5';
    document.getElementById('ooQty').value = '2';
    addOO();
  });
  await page.waitForTimeout(300);
  t('同 月份+ASIN 再次添加 → 数量合并(1+2=3)', await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('pc_finance')).otherOrders || []).length === 1
    && JSON.parse(localStorage.getItem('pc_finance')).otherOrders[0].qty === 3), null);

  // ---------- ④ 非法输入被拒 ----------
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_finance')));
  await page.evaluate(() => {
    document.getElementById('ooYm').value = '2026-09';
    document.getElementById('ooAsin').value = 'SHORT';   // 非 10 位
    document.getElementById('ooQty').value = '3';
    addOO();
    document.getElementById('rfYm').value = '2026-09';
    document.getElementById('rfSite').value = '';         // 未选站点
    document.getElementById('rfAmt').value = '50';
    addRF();
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_finance')));
  t('非法 ASIN / 未选站点 被拒(条数不变)', before.otherOrders.length === after.otherOrders.length
    && before.reviewFees.length === after.reviewFees.length, { oo: after.otherOrders.length, rf: after.reviewFees.length });

  // ---------- ⑤ CSV 导入(表头识别 + 合并 + 丢弃) ----------
  const csvOO = '月份,ASIN,数量,备注\n2026-09,B0H6QDGYY5,4,追加\n2026-08,B0HZ8Y9LV4,2,8月独立站\n2026-08,BAD,1,x\n';
  await page.evaluate((txt) => {
    document.getElementById('ooText').value = txt;
    importOOFromText();
  }, csvOO);
  await page.waitForTimeout(600);
  const oo2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_finance')).otherOrders);
  t('CSV 导入其他渠道订单: 合并同键 + 新增 1 条 + 丢弃 1 行', oo2.length === 2
    && oo2.find(x => x.ym === '2026-09' && x.asin === 'B0H6QDGYY5').qty === 7
    && !!oo2.find(x => x.ym === '2026-08' && x.asin === 'B0HZ8Y9LV4'), oo2);

  const csvRF = '月份,站点,ASIN,金额,币种,备注\n2026-09,DE,,80,,9月测评\n2026-09,CN,B0G25G961Y,10,CNY,非法站点\n';
  await page.evaluate((txt) => {
    document.getElementById('rfText').value = txt;
    importRFFromText();
  }, csvRF);
  await page.waitForTimeout(600);
  const rf2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_finance')).reviewFees);
  t('CSV 导入测评费: 空 ASIN=全站 + 币种按站点兜底 EUR + 非法站点丢弃', rf2.length === 2
    && !!rf2.find(x => x.site === 'DE' && !x.asin && near(x.amount, 80) && x.cur === 'EUR'), rf2);

  // ---------- ⑥ JSON 导入(对象形态 {otherOrders:[]}) ----------
  await page.evaluate(() => {
    document.getElementById('ooText').value = JSON.stringify({ otherOrders: [{ ym: '2026/10', asin: 'B0HCZ6CPT1', qty: 2, note: '10月' }] });
    importOOFromText();
  });
  await page.waitForTimeout(500);
  t('JSON 导入 + 月份格式归一(2026/10 → 2026-10)', await page.evaluate(() =>
    !!JSON.parse(localStorage.getItem('pc_finance')).otherOrders.find(x => x.ym === '2026-10' && x.asin === 'B0HCZ6CPT1')), null);

  // ---------- ⑦ 导出 CSV 文本 ----------
  const csvOut = await page.evaluate(() => toCsvText([['月份', 'ASIN', '数量', '备注'], ['2026-09', 'B0H6QDGYY5', 7, 'a,b"c']]));
  t('CSV 导出: 逗号/引号被正确转义', csvOut.indexOf('"a,b""c"') >= 0, csvOut);

  // ---------- ⑧ 从云端拉取 ----------
  // 把「页面内存里」的状态清空(而不是只改 localStorage —— 页面用的是内存 fin, 那样测不到真行为)
  await page.evaluate(() => { fin.otherOrders = []; fin.reviewFees = []; });
  // 云端换成"别人录的 1 条" —— stub 每次请求都按当时的 CLOUD_DATA 生成响应, 故此处赋值即生效
  CLOUD_DATA.finance = { otherOrders: [{ ym: '2026-08', asin: 'B0HZ8Y9LV4', qty: 5, note: '云端录入' }], reviewFees: [] };
  await page.evaluate(() => pullCloud(true));
  await page.waitForTimeout(900);
  t('从云端拉取可覆盖本机(内存清空后拉回 1 条)', await page.evaluate(() =>
    fin.otherOrders.length === 1 && JSON.parse(localStorage.getItem('pc_finance')).otherOrders.length === 1), null);

  t('全程无 JS 错误', errs.length === 0, errs.slice(0, 3));
  await ctx.close();

  // ================= ⑨ 与 mapping.html / woot.html 互不踩 =================
  for (const [file, label] of [['mapping.html', '产品映射页'], ['woot.html', 'Woot 数据页']]) {
    const c2 = await browser.newContext();
    await c2.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    });
    const p2 = await c2.newPage();
    const pat2 = [];
    const err2 = [];
    p2.on('pageerror', e => err2.push(String(e).slice(0, 200)));
    await stubCloud(p2, pat2);
    await p2.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 90000 });
    await p2.waitForTimeout(2500);
    // 触发一次保存(改一下本机数据再存) —— 用页面自己的云保存函数
    if (file === 'mapping.html') {
      await p2.evaluate(() => { catalog.push({ name: '自测产品', series: '自测' }); saveAll(false); });
    } else {
      await p2.evaluate(() => { try { entries.push({ start: '2026-10-01', end: '2026-10-01', asin: 'B0H69JJZ1M', orders: 1, sales: 1 }); } catch (e) {} saveCfg(false); });
    }
    await p2.waitForTimeout(2000);
    const pl = pat2[pat2.length - 1];
    t(`${label} 保存时保留 finance 键(未被抹掉)`, !!pl && !!pl.data && !!pl.data.finance, pl && pl.data && Object.keys(pl.data));
    if (err2.length) console.log('    (页面错误)', err2.slice(0, 2));
    await c2.close();
  }

  // ================= ⑩ 入口: index.html → 财务录入窗口 =================
  // 用户口径③④是把费用「录进去」, 所以线上必须有能点到这个窗口的入口, 否则功能等于不存在。
  {
    const c3 = await browser.newContext();
    await c3.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
      try { localStorage.setItem('pc_woot', '[]'); } catch (e) {}
    });
    const p3 = await c3.newPage();
    const err3 = [];
    p3.on('pageerror', e => err3.push(String(e).slice(0, 200)));
    // index.html 是首页: 除 mapping 外还要过登录态校验(/auth/v1/user), 否则会被重定向到 login.html
    await p3.route('**/auth/v1/user', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"email":"test@aliencell.com","role":"viewer"}' }));
    await p3.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ data: { catalog: [], asinMap: [], woot: [], wootCfg: null }, updated_at: '2026-10-12T02:00:00+00:00' }]) }));
    await p3.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 90000 });
    await p3.waitForTimeout(2000);
    const hasBtn = await p3.evaluate(() => !!document.querySelector('[onclick*="openFinance"]'));
    t('index 首页含「财务录入」入口按钮', hasBtn, null);
    if (hasBtn) {
      await p3.evaluate(() => openFinance());
      await p3.waitForTimeout(1200);
      const src = await p3.evaluate(() => {
        const f = document.querySelector('iframe[src*="finance_inputs.html"]');
        return f ? f.getAttribute('src') : null;
      });
      t('点击入口后弹出 iframe 载入 finance_inputs.html', !!src && src.indexOf('finance_inputs.html') >= 0, src);
      t('入口页无 JS 错误', err3.length === 0, err3.slice(0, 2));
    }
    await c3.close();
  }

  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
