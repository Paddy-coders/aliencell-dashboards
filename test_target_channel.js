// test_target_channel.js — target.html(目标看板)「销售店铺」渠道筛选回归
//
// 覆盖：
//   ① 控件结构：位于筛选栏首位、选项=Aliencell官方店铺/Woot店铺、默认「全部（合并）」
//   ② Woot 行注入：pc_woot 被注入为 channel='woot' 的 US 行（且只进 US）
//   ③ 三态加性（KPI）：合并 = 官方店铺 + Woot（销量 & 人民币销售额）
//   ④ 目标级精确对账：actualFor 在三种渠道下的差额 === 该目标范围内的 Woot 行之和
//   ⑤ 表格层：行内「实际销量」求和 === KPI 实际销量；无 NaN / undefined 残留
//   ⑥ UI：单击=单选、Ctrl=多选、「合并看（全部）」恢复
//   ⑦ 无 JS 报错、无 location.reload() 循环
//
// 用法: node test_target_channel.js
// ⚠️ target.html 的 EMBED_MAP 为空(映射在云端)，本测试预取云端映射写入 localStorage；
//    取不到时回退到本地缓存 _map_cache.json —— 保证离线也能跑出确定结论。
// ⚠️ 云端只读接口一律拦成本地假响应(空映射 => 页面自身 return，不覆盖、不 reload)，绝不写生产数据。
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/target.html';
const CACHE = path.join(BASE, '_map_cache.json');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

// 单条 Woot 日记录（2026-09-10，属 US）—— 与 test_woot_channel.js 同一条，便于横向比对
const WA = 'B0H69JJZ1M';
const YM = '2026-09';
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: WA,
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

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
  // ---------- 0. 映射：云端 → 本地缓存 ----------
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
  if (!mapData) { console.log('FAIL | 无法获得产品映射(云端与缓存均不可用)，测试中止'); process.exit(1); }
  console.log('映射: catalog ' + mapData.catalog.length + ' 条 · asinMap ' + mapData.asinMap.length + ' 条');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.md.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.md.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot));
  }, { md: mapData, woot: [WOOT_DAY] });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  let navs = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  // 空映射假响应 => 页面 cloudMapSync/cloudWootSync 均在 guard 处 return（不覆盖本机、不 reload）
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) }));

  await page.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  // ⚠️ 2026-10-12：目标看板默认平台已改为「🌐 全部平台」（需求：进去默认展示所有站点平台之和）。
  // 本测试的断言全部基于 **Amazon 视图**（Woot 并入 AMZ_ROWS、目标解析、三态加性）⇒ 显式钉到 Amazon。
  await page.evaluate(() => { setPlatform('amazon'); });
  await page.waitForTimeout(600);
  console.log('== 测试目标: ' + FILE + ' ==（已钉住平台 = Amazon）');

  const kpiOf = (label) => page.evaluate((l) => {
    for (const k of document.querySelectorAll('#kpiRow .kpi')) {
      if (k.querySelector('.kpi-label').textContent.includes(l)) return k.querySelector('.kpi-value').textContent.trim();
    }
    return null;
  }, label);
  const num = (s) => { if (s === null || s === '—') return null; const n = Number(String(s).replace(/[¥,\s]/g, '')); return isNaN(n) ? null : n; };
  const setCh = (ids) => page.evaluate((a) => { selChannel.clear(); (a || []).forEach(c => selChannel.add(c)); renderAll(); }, ids);

  // ---------- ① 控件结构 ----------
  {
    console.log('-- ① 控件结构 --');
    const s = await page.evaluate(() => {
      const bar = document.querySelector('.filter-bar');
      return {
        ddExists: !!document.getElementById('ddChannel'),
        firstChildId: (bar && bar.firstElementChild) ? bar.firstElementChild.id : '',
        opts: [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => ({
          name: o.querySelector('.opt-name').textContent.replace(/\s+/g, ' ').trim(),
          dim: o.classList.contains('dim')
        })),
        summary: document.getElementById('ddChannelSummary').textContent,
        label: document.querySelector('#ddChannel .dd-label').textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    t('「销售店铺」下拉存在', s.ddExists, s);
    t('位于筛选栏首位(平台之前)', s.firstChildId === 'ddChannel', s.firstChildId);
    t('标题含「销售店铺」', s.label.includes('销售店铺'), s.label);
    t('选项 = Aliencell官方店铺 + Woot店铺', s.opts.map(o => o.name.replace(/^[^ ]+ /, '')).join('|') === 'Aliencell官方店铺|Woot店铺', s.opts);
    t('两渠道均有数据(不置灰)', s.opts.length === 2 && s.opts.every(o => !o.dim), s.opts);
    t('默认汇总 = 全部（合并）', s.summary === '全部（合并）', s.summary);
    t('未发生 location.reload() 循环', navs === 1, { navs });
  }

  // ---------- ② Woot 行注入 ----------
  {
    console.log('-- ② Woot 行注入 --');
    const s = await page.evaluate((a) => {
      const w = ROWS.filter(r => r.channel === 'woot');
      return {
        n: w.length,
        allWoot: w.every(r => r.woot === true),
        ccs: [...new Set(w.map(r => r.cc))],
        asins: [...new Set(w.map(r => r.asin))],
        months: [...new Set(w.map(r => r.ym))],
        units: w.reduce((s, r) => s + r.units, 0),
        sales: +w.reduce((s, r) => s + r.sales, 0).toFixed(2),
        nRowsAll: ROWS.length,
        nAmz: ROWS.filter(r => r.channel !== 'woot').length,
      };
    }, WOOT_DAY);
    t('存在 channel=\'woot\' 的行', s.n > 0, s);
    t('Woot 行均带 woot=true 标记', s.allWoot, s);
    t('Woot 只进 US', s.ccs.join() === 'US', s.ccs);
    t('Woot 行月份为 ' + YM, s.months.join() === YM, s.months);
    t('Woot 行 ASIN 含注入的 ' + WA, s.asins.indexOf(WA) >= 0, s.asins);
    t('Woot 销量 = 注入的 1 单', near(s.units, WOOT_DAY.metrics.orders, 0.5), s.units);
    t('Woot 销售额 ≈ 注入的 1899.99', near(s.sales, WOOT_DAY.metrics.sales, 0.05), s.sales);
  }

  // ---------- ③ 三态加性(KPI) ----------
  let kpi = {};
  {
    console.log('-- ③ 三态加性(KPI) --');
    await setCh([]);
    kpi.merged = { u: num(await kpiOf('实际销量')), s: num(await kpiOf('实际销售额')) };
    await setCh(['amazon']);
    kpi.amz = { u: num(await kpiOf('实际销量')), s: num(await kpiOf('实际销售额')) };
    await setCh(['woot']);
    kpi.woot = { u: num(await kpiOf('实际销量')), s: num(await kpiOf('实际销售额')) };
    await setCh([]);
    kpi.both = { u: num(await kpiOf('实际销量')), s: num(await kpiOf('实际销售额')) };
    console.log('   合并', JSON.stringify(kpi.merged), '官方', JSON.stringify(kpi.amz), 'Woot', JSON.stringify(kpi.woot));

    t('官方店铺实际销量 > 0', kpi.amz.u > 0, kpi.amz);
    t('Woot 实际销量 > 0', kpi.woot.u > 0, kpi.woot);
    t('Woot 实际销量 = 1 单', near(kpi.woot.u, 1, 0.5), kpi.woot.u);
    t('三态销量加性: 合并 = 官方 + Woot', near(kpi.merged.u, kpi.amz.u + kpi.woot.u, 1), kpi);
    t('三态金额加性: 合并 = 官方 + Woot', near(kpi.merged.s, kpi.amz.s + kpi.woot.s, 2), kpi);
    t('合并销售额 ≥ 官方销售额', kpi.merged.s >= kpi.amz.s, kpi);
    t('同时选中两渠道 ≡ 合并', near(kpi.both.u, kpi.merged.u, 1) && near(kpi.both.s, kpi.merged.s, 2), { both: kpi.both, merged: kpi.merged });
    t('Woot 金额最小(只有 1 单)', kpi.woot.s < kpi.amz.s, kpi);
  }

  // ---------- ④ 目标级精确对账 ----------
  {
    console.log('-- ④ 目标级精确对账(actualFor) --');
    const exp = await page.evaluate((a) => {
      // 动态找出包含 Woot ASIN 且月份匹配的 amazon 目标（不写死目标行）
      let hit = null;
      for (const tt of (TARGETS.targets || [])) {
        if (tgtPlat(tt) !== 'amazon') continue;
        if ((tt.month || '').slice(0, 7) !== a.ym) continue;
        let res; try { res = resolveTarget(tt); } catch (e) { continue; }
        if (res.matched && res.asins.has(a.asin)) { hit = { tt, res }; break; }
      }
      if (!hit) return { found: false, nResolved: (TARGETS.targets || []).filter(x => { try { return tgtPlat(x) === 'amazon' && resolveTarget(x).matched; } catch (e) { return false; } }).length };
      const own = ROWS.filter(r => channelOf(r) === 'woot' && r.asin === a.asin && r.ym === a.ym &&
        (!hit.res.ccs || hit.res.ccs.has(regionOf(r.cc))));
      // 三种渠道下同一个目标的实际值
      const pick = (ids) => { selChannel.clear(); ids.forEach(c => selChannel.add(c)); return actualFor(hit.res, a.ym); };
      const merged = pick([]), amz = pick(['amazon']), woot = pick(['woot']);
      selChannel.clear(); renderAll();
      return { found: true, product: hit.tt.product, country: hit.tt.country, nAsins: hit.res.asins.size,
        nOwnRows: own.length, ownUnits: own.reduce((s, r) => s + r.units, 0), ownSales: +own.reduce((s, r) => s + r.sales, 0).toFixed(2),
        merged, amz, woot };
    }, { asin: WA, ym: YM });
    t('找到含 Woot ASIN 的目标行(' + YM + ')', exp.found === true, exp);
    if (exp.found) {
      t('该目标范围内有 Woot 行', exp.nOwnRows > 0, exp);
      t('Woot 单看: actualFor == 该目标范围内的 Woot 行之和',
        near(exp.woot.units, exp.ownUnits, 0.5) && near(exp.woot.sales, exp.ownSales, 0.05),
        { woot: exp.woot, ownUnits: exp.ownUnits, ownSales: exp.ownSales });
      t('合并 − 官方 = 该目标范围内的 Woot 行之和',
        near(exp.merged.units - exp.amz.units, exp.ownUnits, 0.5) && near(exp.merged.sales - exp.amz.sales, exp.ownSales, 0.05),
        { dU: exp.merged.units - exp.amz.units, dS: +(exp.merged.sales - exp.amz.sales).toFixed(2), ownUnits: exp.ownUnits, ownSales: exp.ownSales });
      t('单看 Woot 不影响官方店铺值(官方 = 合并 − Woot)',
        near(exp.amz.units + exp.woot.units, exp.merged.units, 0.5), exp);
    }
  }

  // ---------- ⑤ 表格层 ----------
  {
    console.log('-- ⑤ 表格层 --');
    const tb = await page.evaluate(() => {
      // 注意：表格末尾有一行 .total-row(合计)，其「实际销量」格本身又是总数 —— 必须排除，否则重复累加
      const sumCol = (idx) => {
        let s = 0, n = 0;
        for (const tr of document.querySelectorAll('#tableWrap tbody tr')) {
          if (tr.classList.contains('total-row')) continue;
          const tds = tr.querySelectorAll('td');
          if (tds.length <= idx) continue;
          const v = Number(tds[idx].textContent.replace(/[,¥\s]/g, ''));
          if (!isNaN(v)) { s += v; n++; }
        }
        return { s, n };
      };
      const totalRowVal = (idx) => {
        const tr = document.querySelector('#tableWrap tbody tr.total-row');
        if (!tr) return null;
        const tds = tr.querySelectorAll('td');
        if (!tds[idx]) return null;
        const v = Number(tds[idx].textContent.replace(/[,¥\s]/g, ''));
        return isNaN(v) ? null : v;
      };
      const res = {};
      for (const mode of ['merged', 'amz', 'woot']) {
        selChannel.clear();
        if (mode === 'amz') selChannel.add('amazon');
        if (mode === 'woot') selChannel.add('woot');
        renderAll();
        res[mode] = {
          nTr: document.querySelectorAll('#tableWrap tbody tr').length,
          nData: document.querySelectorAll('#tableWrap tbody tr:not(.total-row)').length,
          col5: sumCol(5),
          total5: totalRowVal(5),
          html: document.getElementById('tableWrap').innerHTML
        };
      }
      selChannel.clear(); renderAll();
      res.merged2 = { nTr: document.querySelectorAll('#tableWrap tbody tr').length };
      return res;
    });
    t('合并视图表格有行', tb.merged.nTr > 0, tb.merged.nTr);
    t('单看 Woot 表格仍有行(有 Woot 目标)', tb.woot.nTr > 0, tb.woot.nTr);
    t('单看 Woot 行数 ≤ 合并行数', tb.woot.nTr <= tb.merged.nTr, { woot: tb.woot.nTr, merged: tb.merged.nTr });
    t('表格「实际销量」列求和 == KPI 实际销量(合并)', near(tb.merged.col5.s, kpi.merged.u, 2), { table: tb.merged.col5.s, kpi: kpi.merged.u });
    t('表格「实际销量」列求和 == KPI 实际销量(官方)', near(tb.amz.col5.s, kpi.amz.u, 2), { table: tb.amz.col5.s, kpi: kpi.amz.u });
    t('表格「实际销量」列求和 == KPI 实际销量(Woot)', near(tb.woot.col5.s, kpi.woot.u, 0.5), { table: tb.woot.col5.s, kpi: kpi.woot.u });
    t('合计行「实际销量」== KPI 实际销量(合并)', tb.merged.total5 === kpi.merged.u, { total: tb.merged.total5, kpi: kpi.merged.u });
    t('合计行「实际销量」随渠道变化(Woot 单看=1)', tb.woot.total5 === 1, tb.woot.total5);
    t('表格无 NaN 残留', !/NaN/.test(tb.merged.html) && !/NaN/.test(tb.amz.html) && !/NaN/.test(tb.woot.html));
    t('表格无 undefined 残留', !/undefined/.test(tb.merged.html) && !/undefined/.test(tb.amz.html) && !/undefined/.test(tb.woot.html));
    t('恢复合并后行数与初始一致', tb.merged2.nTr === tb.merged.nTr, { before: tb.merged.nTr, after: tb.merged2.nTr });
  }

  // ---------- ⑥ UI 交互 ----------
  {
    console.log('-- ⑥ UI 交互 --');
    const openDd = async () => {
      const vis = await page.evaluate(() => {
        const o = document.querySelector('#ddChannelList .dd-opt');
        if (!o) return false;
        const r = o.getBoundingClientRect();
        return r.height > 0 && getComputedStyle(o).visibility !== 'hidden';
      });
      if (!vis) { await page.click('#ddChannel .dd-btn'); await page.waitForTimeout(200); }
      return vis;
    };
    const clickOpt = async (idx) => {
      await openDd();
      await page.evaluate((i) => { document.querySelectorAll('#ddChannelList .dd-opt')[i].click(); }, idx);
      await page.waitForTimeout(250);
    };
    const st = () => page.evaluate(() => ({ size: selChannel.size, list: [...selChannel], summary: document.getElementById('ddChannelSummary').textContent }));

    await page.click('#ddChannelList .dd-opt', { force: true }).catch(() => {});
    // 单击「Woot店铺」= 单选
    await setCh([]);
    await clickOpt(1);
    const w1 = await st();
    t('单击 Woot店铺 => 单选(仅 woot)', w1.size === 1 && w1.list[0] === 'woot', w1);
    t('汇总文案显示「Woot店铺 单独看」', w1.summary.indexOf('Woot') >= 0, w1.summary);

    // 单击「Aliencell官方店铺」= 切换单选
    await clickOpt(0);
    const w2 = await st();
    t('单击 Aliencell官方店铺 => 单选(仅 amazon)', w2.size === 1 && w2.list[0] === 'amazon', w2);
    t('汇总文案显示「Aliencell官方店铺 单独看」', w2.summary.indexOf('Aliencell') >= 0, w2.summary);

    // Ctrl+单击 另一个 => 多选(两渠道都选 == 合并)
    await openDd();
    await page.evaluate(() => {
      const o = document.querySelectorAll('#ddChannelList .dd-opt')[1];
      o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    await page.waitForTimeout(250);
    const w3 = await st();
    t('Ctrl+单击 => 两渠道都选', w3.size === 2, w3);
    t('两渠道都选时汇总回到「全部（合并）」', w3.summary === '全部（合并）', w3.summary);

    // 「合并看（全部）」按钮
    await openDd();
    await page.click('#ddChannel .dd-tools .btn');
    await page.waitForTimeout(250);
    const w4 = await st();
    t('「合并看（全部）」清空选择', w4.size === 0, w4);
    t('恢复后汇总 = 全部（合并）', w4.summary === '全部（合并）', w4.summary);
    const kpiBack = { u: num(await kpiOf('实际销量')), s: num(await kpiOf('实际销售额')) };
    t('恢复后 KPI 与初始一致', near(kpiBack.u, kpi.merged.u, 1) && near(kpiBack.s, kpi.merged.s, 2), { back: kpiBack, init: kpi.merged });
  }

  // ---------- ⑦ 报错 ----------
  {
    console.log('-- ⑦ 页面报错 --');
    const real = errs.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
    t('无 JS 报错', real.length === 0, real.slice(0, 5));
    t('无二次导航(reload 循环)', navs === 1, { navs });
  }

  console.log('\n===== target 渠道筛选: ' + pass + ' pass / ' + fail + ' fail =====');
  if (fail) console.log('失败项: ' + fails.join(' | '));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
