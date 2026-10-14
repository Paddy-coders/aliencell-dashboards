// _probe_woot_channel.js — 周看板(product.html)「销售店铺」筛选探针
// 用法: node _probe_woot_channel.js   (BASE 默认 http://127.0.0.1:8896, 必须从 _deploy/ 起的服务)
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// 逐日记录(带子 ASIN) → 2026-09-10 属 W37(周六09-05~周五09-11)
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((w) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
  }, [WOOT_DAY]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.goto(BASE + '/product.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    const out = {};
    // ---- DOM ----
    const bar = document.querySelector('.filter-bar');
    out.barExists = !!bar;
    out.firstChildId = bar && bar.firstChild ? (bar.firstChild.id || bar.firstChild.className) : null;
    out.ddExists = !!document.getElementById('ddChannel');
    out.opts = [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => ({
      name: o.querySelector('.opt-name').textContent,
      dim: o.classList.contains('dim'),
      checked: !!o.querySelector('input').checked
    }));
    out.summary0 = document.getElementById('ddChannelSummary') ? document.getElementById('ddChannelSummary').textContent : null;
    // ---- 数据 ----
    out.hasWootParts = Object.keys(DATA.wootParts || {}).length;
    out.hasWootAdParts = Object.keys(DATA.wootAdParts || {}).length;
    // 动态发现候选: 任意有 US 数据的 (asin, week)
    let cand = null;
    const wp = DATA.wootParts || {};
    for (const asin in wp) {
      for (const wk in (wp[asin].weeks || {})) {
        const c = wp[asin].weeks[wk].US;
        if (c && (Number(c.sales) > 0 || Number(c.orders) > 0)) { cand = { asin, wk }; break; }
      }
      if (cand) break;
    }
    out.cand = cand;
    if (!cand) return out;
    const setCh = arr => { window.selChannel.clear(); arr.forEach(x => window.selChannel.add(x)); };
    const snap = (asin, wk) => {
      const v = window.asinWeekData(asin, wk);
      if (!v) return null;
      const g = k => Number(v[k]) || 0;
      return { sales: g('sales'), orders: g('orders'), units: g('units'),
               adSpend: g('adSpend'), adClicks: g('adClicks'),
               profit: g('profit'), pN: g('pN'), sessions: g('sessions'), pv: g('pv') };
    };
    setCh([]);          out.merged = snap(cand.asin, cand.wk);
    setCh(['woot']);    out.woot = snap(cand.asin, cand.wk);
    setCh(['amazon']);  out.amz = snap(cand.asin, cand.wk);
    setCh([]);          out.summaryRestored = document.getElementById('ddChannelSummary').textContent;
    // 原始 Woot 输入(用于对账)
    out.rawPart = JSON.parse(JSON.stringify((DATA.wootParts[cand.asin].weeks[cand.wk] || {}).US || null));
    out.rawAd = JSON.parse(JSON.stringify(((DATA.wootAdParts[cand.asin] || {}).weeks[cand.wk] || {}).US || null));
    // 合并值必须含 Woot 的量: 合并 sales - 官方店铺 sales 应 = Woot sales(原始)
    return out;
  });

  console.log('=== 数据/结构 ===');
  console.log(JSON.stringify(r, null, 1));

  // ---- UI 交互(真实点击) ----
  await page.click('#ddChannel .dd-btn');
  await page.waitForTimeout(150);
  const ui = await page.evaluate(() => ({ open: !!document.querySelector('#ddChannel.open, #ddChannel .dd-panel.show') }));
  // 点 Woot店铺(第 2 项) —— 单击=单选
  const optCount = await page.locator('#ddChannelList .dd-opt').count();
  await page.locator('#ddChannelList .dd-opt').nth(optCount - 1).click();
  await page.waitForTimeout(250);
  const afterWoot = await page.evaluate(() => ({
    summary: document.getElementById('ddChannelSummary').textContent,
    n: Object.keys(DATA.wootParts || {}).length
  }));
  // 点「合并看（全部）」
  await page.click('#ddChannelPanelAll, #ddChannel .dd-tools .btn').catch(() => {});
  await page.waitForTimeout(250);
  const afterAll = await page.evaluate(() => document.getElementById('ddChannelSummary').textContent);

  console.log('=== UI ===');
  console.log('open=' + JSON.stringify(ui) + ' optCount=' + optCount);
  console.log('afterWoot=' + JSON.stringify(afterWoot));
  console.log('afterAll=' + afterAll);
  console.log('=== page errors ===');
  console.log(errs.length ? errs : '(none)');

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
