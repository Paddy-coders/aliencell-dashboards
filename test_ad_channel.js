// test_ad_channel.js — ad.html(广告周度看板)「销售店铺」渠道筛选回归
//
// 背景：ad.html 里 Woot 广告此前只能靠「广告类型 = Woot 广告」间接筛，
//       没有真正的店铺维度。本测试守住新增的「销售店铺」维度。
//
// 覆盖：
//   ① 控件结构：位于筛选栏首位、选项=Aliencell官方店铺/Woot店铺、默认「全部（合并）」
//   ② Woot 广告记录注入：channel='woot' + type='wootAds'，只进 US
//   ③ 三态加性：花费/点击/订单/曝光/销售额/记录数 全部满足 合并 = 官方 + Woot
//   ④ 广告类型联动：单看官方 → Woot 广告置灰(0 条)；单看 Woot → SP/SB/SD 置灰(0 条)
//   ⑤ 广告组层：Woot 广告组只在 Woot 渠道出现；选中 Woot 活动后广告组表可渲染
//   ⑥ UI：单击=单选、Ctrl=多选、「合并看（全部）」恢复
//   ⑦ KPI/表格无 NaN、无 JS 报错、无 location.reload() 循环
//
// 用法: node test_ad_channel.js
// ⚠️ 映射预取云端 → 写 localStorage；取不到时回退 _map_cache.json(离线可跑)
// ⚠️ 云端只读接口拦成空映射假响应(页面自身 guard 处 return)，绝不写生产数据
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/ad_dashboard.html';
const CACHE = path.join(BASE, '_map_cache.json');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

// 两条 Woot 记录：一条整周(B0H69JJZ1M)、一条单日(B0FN3NPF7Y → 落到所属周)
const WOOT = [
  { start: '2026-09-08', end: '2026-09-14', type: 'week', asin: 'B0H69JJZ1M',
    metrics: { orders: 2, sales: 3799.98, adCost: 1037.6, adClicks: 332, adOrders: 1, adImpr: 96070, adSales: 900 } },
  { start: '2026-09-15', end: '2026-09-15', type: 'day', asin: 'B0FN3NPF7Y',
    metrics: { orders: 1, sales: 999.99, adCost: 200, adClicks: 50, adOrders: 1, adImpr: 10000, adSales: 400 } },
];

let pass = 0, fail = 0;
const fails = [];
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol);

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 12000 }, res => {
      const bufs = []; res.on('data', c => bufs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  let mapData = null;
  try {
    const rows = await fetchJson(SB_URL, { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY });
    const j = rows && rows[0] && rows[0].data;
    if (j && Array.isArray(j.catalog) && Array.isArray(j.asinMap) && j.asinMap.length) {
      mapData = { catalog: j.catalog, asinMap: j.asinMap };
      fs.writeFileSync(CACHE, JSON.stringify(mapData));
    }
  } catch (e) { /* 走缓存 */ }
  if (!mapData && fs.existsSync(CACHE)) mapData = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (!mapData) { console.log('FAIL | 无法获得产品映射，测试中止'); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.md.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot));
  }, { md: mapData, woot: WOOT });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  let navs = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) }));

  await page.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('== 测试目标: ' + FILE + ' ==');

  const setCh = (ids) => page.evaluate((a) => { selChannel.clear(); (a || []).forEach(c => selChannel.add(c)); syncAndRender(); }, ids);
  const aggOf = () => page.evaluate(() => {
    const a = aggregate();
    return { cost: +a.totals.cost.toFixed(2), clicks: a.totals.clicks, orders: a.totals.orders,
      impressions: a.totals.impressions, sales: +a.totals.sales.toFixed(2),
      nRec: DATA.records.filter(r => recInScope(r)).length,
      nGroups: aggregateByAdGroup().length,
      typeCnt: (() => { const c = {}; DATA.records.forEach(r => { if (recInScope(r)) c[r.type] = (c[r.type] || 0) + 1; }); return c; })(),
      groups: aggregateByAdGroup().map(g => g.adGroup),
      nan: /NaN/.test(document.getElementById('kpiRow').innerHTML) || /NaN/.test(document.getElementById('sumBody').innerHTML) };
  });

  // ---------- ① 控件结构 ----------
  {
    console.log('-- ① 控件结构 --');
    const s = await page.evaluate(() => {
      const bar = document.querySelector('.filter-bar');
      return {
        ddExists: !!document.getElementById('ddChannel'),
        firstChild: bar.firstElementChild ? bar.firstElementChild.id : '',
        label: document.querySelector('#ddChannel .dd-label').textContent.replace(/\s+/g, ' ').trim(),
        opts: [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => ({
          name: o.querySelector('.opt-name').textContent.replace(/\s+/g, ' ').trim().replace(/^[^ ]+ /, ''),
          dim: o.classList.contains('dim')
        })),
        summary: document.getElementById('ddChannelSummary').textContent,
        hasMergeBtn: !!document.querySelector('#ddChannel .dd-tools .btn'),
      };
    });
    t('「销售店铺」下拉存在', s.ddExists, s);
    t('位于筛选栏首位(国家之前)', s.firstChild === 'ddChannel', s.firstChild);
    t('标题含「销售店铺」', s.label.includes('销售店铺'), s.label);
    t('选项 = Aliencell官方店铺 + Woot店铺', s.opts.map(o => o.name).join('|') === 'Aliencell官方店铺|Woot店铺', s.opts);
    t('两渠道均有数据(不置灰)', s.opts.length === 2 && s.opts.every(o => !o.dim), s.opts);
    t('默认汇总 = 全部（合并）', s.summary === '全部（合并）', s.summary);
    t('有「合并看（全部）」按钮', s.hasMergeBtn === true, s);
  }

  // ---------- ② Woot 广告记录注入 ----------
  {
    console.log('-- ② Woot 广告记录注入 --');
    const s = await page.evaluate(() => {
      const w = DATA.records.filter(r => r.channel === 'woot');
      return { n: w.length, types: [...new Set(w.map(r => r.type))], ccs: [...new Set(w.map(r => r.country))],
        costs: +w.reduce((s, r) => s + r.cost, 0).toFixed(2), clicks: w.reduce((s, r) => s + r.clicks, 0),
        asins: [...new Set(w.map(r => r.asin))], nAmz: DATA.records.filter(r => r.channel !== 'woot').length,
        wootAdsType: DATA.types.some(x => x.code === 'wootAds') };
    });
    t('存在 channel=\'woot\' 的广告记录', s.n > 0, s);
    t('Woot 记录类型均为 wootAds', s.types.join() === 'wootAds', s.types);
    t('Woot 广告只进 US', s.ccs.join() === 'US', s.ccs);
    t('Woot 花费 = 1037.6 + 200', near(s.costs, 1237.6, 0.05), s.costs);
    t('Woot 点击 = 332 + 50', s.clicks === 382, s.clicks);
    t('Woot ASIN 含注入的两个', s.asins.indexOf('B0H69JJZ1M') >= 0 && s.asins.indexOf('B0FN3NPF7Y') >= 0, s.asins);
    t('官方店铺记录未被污染(>0 且远多于 Woot)', s.nAmz > 0, { nAmz: s.nAmz, nWoot: s.n });
    t('wootAds 仍在广告类型列表中', s.wootAdsType === true, s);
  }

  // ---------- ③ 三态加性 ----------
  let A = {};
  {
    console.log('-- ③ 三态加性 --');
    await setCh([]); A.merged = await aggOf();
    await setCh(['amazon']); A.amz = await aggOf();
    await setCh(['woot']); A.woot = await aggOf();
    await setCh([]);
    console.log('   合并 花费' + A.merged.cost + ' / 官方 ' + A.amz.cost + ' / Woot ' + A.woot.cost);
    const keys = ['cost', 'clicks', 'orders', 'impressions', 'sales', 'nRec'];
    const bad = keys.filter(k => !near(A.merged[k], A.amz[k] + A.woot[k], k === 'cost' || k === 'sales' ? 0.05 : 0.5));
    t('六个口径全部满足 合并 = 官方 + Woot', bad.length === 0, bad.map(k => k + ': ' + A.merged[k] + ' vs ' + (A.amz[k] + A.woot[k])));
    t('官方店铺花费 > 0', A.amz.cost > 0, A.amz.cost);
    t('Woot 花费 = 1237.6', near(A.woot.cost, 1237.6, 0.05), A.woot.cost);
    t('Woot 记录数 = 3', A.woot.nRec === 3, A.woot.nRec);
    // 记录数随数据周变化 → 动态读源 JSON, 不硬编码
    const nOfficial = JSON.parse(fs.readFileSync(path.join(BASE, 'ad_dashboard_data.json'), 'utf8')).records.length;
    t('官方记录数 = 源JSON记录数(' + nOfficial + ')', A.amz.nRec === nOfficial, A.amz.nRec);
    t('合并记录数 = 官方 + Woot(3)', A.merged.nRec === nOfficial + 3, A.merged.nRec);
    t('Woot 广告组数 = 2(按 ASIN)', A.woot.nGroups === 2, A.woot.nGroups);
    t('合并广告组数 = 官方 + Woot', A.merged.nGroups === A.amz.nGroups + A.woot.nGroups, A);
  }

  // ---------- ④ 广告类型联动 ----------
  {
    console.log('-- ④ 广告类型联动 --');
    const tc = await page.evaluate(() => {
      const pick = (ids) => { selChannel.clear(); ids.forEach(c => selChannel.add(c)); syncAndRender();
        const cnt = {}; DATA.records.forEach(r => { if (recInScope(r)) cnt[r.type] = (cnt[r.type] || 0) + 1; });
        return { cnt, opts: [...document.querySelectorAll('#ddTypeList .dd-opt')].map(o => ({ n: o.querySelector('.opt-name').textContent.trim(), dim: o.classList.contains('dim') })) }; };
      const amz = pick(['amazon']), woot = pick(['woot']), merged = pick([]);
      selChannel.clear(); syncAndRender();
      return { amz, woot, merged };
    });
    const dimOf = (o, kw) => { const hit = o.find(x => x.n.includes(kw)); return hit ? hit.dim : null; };
    t('单看官方 → Woot 广告 0 条', (tc.amz.cnt.wootAds || 0) === 0, tc.amz.cnt);
    t('单看官方 → 「Woot 广告」选项置灰', dimOf(tc.amz.opts, 'Woot') === true, tc.amz.opts);
    t('单看 Woot → SP/SB/SD 均 0 条/置灰',
      (tc.woot.cnt.sponsoredProducts || 0) === 0 && (tc.woot.cnt.sponsoredBrands || 0) === 0 && (tc.woot.cnt.sponsoredDisplay || 0) === 0
      && dimOf(tc.woot.opts, '商品推广') === true && dimOf(tc.woot.opts, '品牌推广') === true,
      { cnt: tc.woot.cnt, opts: tc.woot.opts.map(o => o.n + (o.dim ? '(灰)' : '')) });
    t('单看 Woot → Woot 广告 3 条', (tc.woot.cnt.wootAds || 0) === 3, tc.woot.cnt);
    t('单看 Woot → 「Woot 广告」选项不置灰', dimOf(tc.woot.opts, 'Woot') === false, tc.woot.opts);
    t('合并 → 四种广告类型都有数据',
      (tc.merged.cnt.wootAds || 0) === 3 && (tc.merged.cnt.sponsoredProducts || 0) > 0
      && (tc.merged.cnt.sponsoredBrands || 0) > 0 && (tc.merged.cnt.sponsoredDisplay || 0) > 0, tc.merged.cnt);
  }

  // ---------- ⑤ 广告组层 ----------
  {
    console.log('-- ⑤ 广告组层 --');
    const g = await page.evaluate(() => {
      const probe = (ids) => { selChannel.clear(); ids.forEach(c => selChannel.add(c)); syncAndRender();
        return aggregateByAdGroup().map(x => x.adGroup); };
      const woot = probe(['woot']), amz = probe(['amazon']), merged = probe([]);
      // 选中一个 Woot 活动 → 广告组表应显示
      const wid = (DATA.campaigns.find(c => c.channel === 'woot') || {}).id;
      selChannel.clear(); syncAndRender();
      selCampaigns.clear(); if (wid) selCampaigns.add(wid); syncAndRender();
      const shown = { wid, display: document.getElementById('adgroupCard').style.display,
        nBody: document.querySelectorAll('#adgroupBody tr').length,
        headTxt: document.getElementById('adgroupHead').textContent.replace(/\s+/g, ' ').trim().slice(0, 120) };
      selCampaigns.clear(); selChannel.clear(); syncAndRender();
      return { woot, amz, merged, shown };
    });
    t('单看 Woot 的广告组只有「Woot 广告」', g.woot.length > 0 && g.woot.every(n => n === 'Woot 广告'), g.woot);
    t('单看官方不含「Woot 广告」组', g.amz.indexOf('Woot 广告') < 0, g.amz.slice(0, 3));
    t('合并后「Woot 广告」组出现', g.merged.indexOf('Woot 广告') >= 0, g.merged.length);
    t('选中 Woot 活动 → 广告组表可见', g.shown.wid && g.shown.display !== 'none', g.shown);
    t('选中 Woot 活动 → 广告组表有行', g.shown.nBody > 0, g.shown);
  }

  // ---------- ⑥ UI 交互 ----------
  {
    console.log('-- ⑥ UI 交互 --');
    const openDd = async () => {
      const vis = await page.evaluate(() => {
        const o = document.querySelector('#ddChannelList .dd-opt');
        if (!o) return false;
        return o.getBoundingClientRect().height > 0;
      });
      if (!vis) { await page.click('#ddChannel .dd-btn'); await page.waitForTimeout(200); }
    };
    const clickOpt = async (i) => {
      await openDd();
      await page.evaluate((k) => { document.querySelectorAll('#ddChannelList .dd-opt')[k].click(); }, i);
      await page.waitForTimeout(250);
    };
    const st = () => page.evaluate(() => ({ size: selChannel.size, list: [...selChannel],
      summary: document.getElementById('ddChannelSummary').textContent }));

    await setCh([]);
    await clickOpt(1);
    const w1 = await st();
    t('单击 Woot店铺 => 单选', w1.size === 1 && w1.list[0] === 'woot', w1);
    t('汇总显示「Woot店铺 单独看」', w1.summary.indexOf('Woot') >= 0, w1.summary);

    await clickOpt(0);
    const w2 = await st();
    t('单击 Aliencell官方店铺 => 单选', w2.size === 1 && w2.list[0] === 'amazon', w2);
    t('汇总显示「Aliencell官方店铺 单独看」', w2.summary.indexOf('Aliencell') >= 0, w2.summary);

    await openDd();
    await page.evaluate(() => {
      document.querySelectorAll('#ddChannelList .dd-opt')[1]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    await page.waitForTimeout(250);
    const w3 = await st();
    t('Ctrl+单击 => 两渠道都选', w3.size === 2, w3);
    t('两渠道都选 = 合并(汇总回「全部（合并）」)', w3.summary === '全部（合并）', w3.summary);
    const afterBoth = await aggOf();
    t('两渠道都选 KPI ≡ 合并', near(afterBoth.cost, A.merged.cost, 0.05) && afterBoth.nRec === A.merged.nRec, { both: afterBoth, merged: A.merged });

    await openDd();
    await page.click('#ddChannel .dd-tools .btn');
    await page.waitForTimeout(250);
    const w4 = await st();
    t('「合并看（全部）」清空选择', w4.size === 0, w4);
    const back = await aggOf();
    t('恢复后 KPI 与初始一致', near(back.cost, A.merged.cost, 0.05) && back.nRec === A.merged.nRec, { back, init: A.merged });
  }

  // ---------- ⑦ 报错与 NaN ----------
  {
    console.log('-- ⑦ 报错与 NaN --');
    t('三态均无 NaN 残留', !A.merged.nan && !A.amz.nan && !A.woot.nan, { m: A.merged.nan, a: A.amz.nan, w: A.woot.nan });
    const real = errs.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
    t('无 JS 报错', real.length === 0, real.slice(0, 5));
    t('无 location.reload() 循环', navs === 1, { navs });
  }

  console.log('\n===== ad 渠道筛选: ' + pass + ' pass / ' + fail + ' fail =====');
  if (fail) console.log('失败项: ' + fails.join(' | '));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
