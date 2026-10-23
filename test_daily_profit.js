// test_daily_profit.js — 日看板毛利列回归
// 校验: ①毛利/毛利率列存在 ②指定日期毛利值 = Σ(利润报表各项) − VAT − 头程 + 其他渠道剔除 − 测评费 − 看板广告花费(均折USD)
//      ③7月前无毛利(—) ④毛利率=毛利÷利润报表销售额 ⑤合计行含毛利 ⑥列开关生效
// 用法: node test_daily_profit.js
//
// ⚠️ 毛利口径（2026-10-12 用户口径定稿，与 build_profit_metrics.py / 页面 profitOf 三方对齐）：
//    毛利 = 销售额 + 促销折扣 + 销售佣金 + 配送费 + 商品成本 + 仓储分摊 + 其他费用分摊
//           − VAT(EU/UK) − 头程(成本表预估) + 其他渠道剔除加回 − 测评费 − 本看板广告花费
//    · VAT 与「剔除/测评费」都由 build_profit_metrics.py 摊到**每一行**（profit_metrics.json 的
//      vat/mcAdj/review 字段），所以这里直接按行累加即可，与看板同源但互相独立（文件 vs 页面）。
//    · 头程**不在** profit_metrics.json 里（页面按「ASIN→产品名→成本表头程RMB」实时算出），
//      因此期望值必须自己用 product_cost_table.json + ASIN 映射复算（与 test_ratio_cols.js 同一套算法）。
const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const FILE = 'file:///' + BASE.replace(/\\/g, '/') + '/daily.html';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * tolPct);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, timeout: 15000 }, res => {
      const bufs = []; res.on('data', c => bufs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(bufs).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  // ---- 期望值计算(Node 侧, 与看板同一套数据源) ----
  const fx = JSON.parse(fs.readFileSync(path.join(BASE, 'fx_rates.json'), 'utf8'));
  const pm = JSON.parse(fs.readFileSync(path.join(BASE, 'profit_metrics.json'), 'utf8'));
  const dd = JSON.parse(fs.readFileSync(path.join(BASE, 'daily_data.json'), 'utf8'));
  const tbl = JSON.parse(fs.readFileSync(path.join(BASE, 'product_cost_table.json'), 'utf8'));
  // 头程需要「ASIN→产品名」映射(与页面 asinMetaOf 同源: 云端 asinMap). 拉不到就退化为空映射(头程=0),
  //   此时页面同样查不到 → 两边一致, 不会假失败。
  let asinMap = [];
  try { asinMap = (await fetchJson(SB_URL))[0].data.asinMap || []; } catch (e) { console.log('  (云端映射拉取失败, 头程按 0 计: ' + String(e && e.message || e) + ')'); }
  const nameOf = {}; asinMap.forEach(x => { if (x && x.asin) nameOf[x.asin] = x.name; });
  const EU_SITES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PL', 'SE'];
  const regOf = s => s === 'UK' ? 'UK' : (s === 'US' ? 'US' : (EU_SITES.includes(s) ? 'EU' : null));
  // 头程(USD) = 成本表头程RMB × 销量 ÷ (CNY per USD); 与页面 convHead() 同口径(默认显示币种=USD)
  function headUsd(r, ym) {
    const p = tbl.products && tbl.products[nameOf[r.as]];
    const rg = regOf(r.site);
    const cny = (fx.rates[ym] || {}).USD;
    if (!p || !rg || !cny) return 0;
    const rmb = Number((p.headRMB || {})[rg]) || 0;
    return rmb * (Number(r.qty) || 0) / cny;
  }
  // ⚠️ fx_rates.json 是 CNY 基准 (rates[ym][cur] = 1 单位 cur 折多少 CNY)。
  //    换算到 USD 必须先把基准币 USD 也算进去 —— 早先写成 `cur === 'USD' ? 1 : rates[cur]`
  //    会让美元金额被压成 1/6.72, US 单国毛利对账恒差 615.69 (2026-10-10 踩过)。
  //    逻辑与看板 fxToUsd() 完全对齐: 1 CUR = ? USD, 缺月回退最近可用月份。
  const CUR_OF = { US: 'USD', CA: 'CAD', MX: 'MXN', UK: 'GBP', JP: 'JPY', AU: 'AUD', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', IE: 'EUR', PL: 'PLN', SE: 'SEK' };
  function fxToUsd(month, cur) {
    if (cur === 'USD') return 1;
    const months = fx.rates || {};
    const rate = (m, c) => {
      const a = (months[m] || {})[c], b = (months[m] || {})['USD'];
      return (a != null && b != null) ? a / b : null;
    };
    if (rate(month, cur) != null) return rate(month, cur);
    const ks = Object.keys(months).sort();
    let best = null;
    for (const k of ks) { if (k <= month && rate(k, cur) != null) best = k; }
    if (!best) for (const k of ks) { if (rate(k, cur) != null) { best = k; break; } }
    return best ? rate(best, cur) : null;
  }
  const usdPer = (site, ym) => { const r = fxToUsd(ym, CUR_OF[site] || 'USD'); return r == null ? 1 : r; };
  // ⚠️ 广告条目必须从**页面**取, 不能直接用 daily_data.json:
  //    看板启动时会从本机缓存 pc_woot 注入 Woot 店铺的广告行(带 woot:true, 有自己的 asin),
  //    若期望值只算源文件, 会被注入的 Woot 广告费污染而恒差一截(2026-10-10 踩过: 差 53.85)。
  //    从页面取数既避免污染, 又保证期望值与看板看到的是同一份条目。
  const _adCache = new Map();
  async function adItems(date) {
    if (_adCache.has(date)) return _adCache.get(date);
    const arr = await page.evaluate((d) => {
      const out = [];
      for (const [cc, items] of Object.entries(((DATA.days[d] || {}).ads) || {})) {
        for (const it of items) out.push({ cc: cc, asin: it.Asin || '', camp: it.CampaignName || it.Name || '',
          port: it.PortfolioName || '', cost: (it.Report || {}).Cost || 0 });
      }
      return out;
    }, date);
    _adCache.set(date, arr);
    return arr;
  }
  // 某日毛利期望(USD) = Σ(利润报表各项 − VAT − 头程 + 剔除加回 − 测评费) − Σ广告花费(看板口径)
  //   逐行折算到 USD 再相加(与页面 convAmt → usdToDisp 的顺序一致)
  async function expectProfit(date, onlySite) {
    const ym = date.slice(0, 7);
    let sum = 0, pSales = 0, any = false;
    for (const r of (pm.rows || [])) {
      if (r.d !== date) continue;
      if (onlySite && r.site !== onlySite) continue;
      any = true;
      const k = usdPer(r.site, ym);
      sum += (r.sales + r.promo + r.comm + r.fba + r.cost + r.storage + r.other) * k;
      sum += (r.fbRet || 0) * k;            // FBA退货处理费(2026-10-12 第二轮, 独立计入毛利)
      sum += ((r.refSales || 0) + (r.refShip || 0) + (r.refPromo || 0) + (r.refComm || 0) + (r.refFba || 0)) * k;  // 退款各项
      sum -= (r.vat || 0) * k;              // EU/UK 增值税(正数, 从毛利扣)
      sum -= headUsd(r, ym);                // 头程 — 已是 USD, 不能再乘 k
      sum += (r.mcAdj || 0) * k;            // 其他渠道订单剔除加回(正数)
      sum -= (r.review || 0) * k;           // 测评费
      pSales += r.sales * k;
    }
    let adCost = 0;
    for (const it of await adItems(date)) { if (onlySite && it.cc !== onlySite) continue; adCost += it.cost * usdPer(it.cc, ym); }
    return { any, profit: sum - adCost, pSales, adCost };
  }

  const browser = await chromium.launch();
  // 与 test_ratio_cols.js 同款隔离: 预注入映射(让头程可复算) + 拦云端(防空 woot 写缓存触发 reload)
  const ctx = await browser.newContext();
  await ctx.addInitScript((arg) => {
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap || []));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  }, { asinMap });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ data: { asinMap: asinMap, catalog: [], woot: [], wootCfg: null } }]) }));
  await page.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3500);
  console.log('  映射: ' + asinMap.length + ' 个 ASIN(云端) · 头程表 ' + Object.keys((tbl.products) || {}).length + ' 产品');

  // ① 列存在
  const heads = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim()));
  t('表头含 毛利/毛利率', heads.includes('毛利') && heads.includes('毛利率'), heads);
  t('列选择器含毛利', await page.evaluate(() => {
    buildColOptions();
    return document.getElementById('ddColList').textContent.includes('毛利');
  }), null);

  // ② 单日数值对账 (2026-09-15, 当日有完整结算+广告)
  const DAY = '2026-09-15';
  const exp = await expectProfit(DAY);
  t('预期数据存在(09-15 有利润行)', exp.any && Math.abs(exp.profit) > 0, exp);
  const got = await page.evaluate((d) => {
    const v = metricVals(aggRows(d, new Set(), new Set()));
    return { profit: v.profit, margin: v.margin, pRows: v.profit === null ? 0 : 1 };
  }, DAY);
  t('09-15 毛利值对账(USD)', got.profit !== null && near(got.profit, exp.profit, 0.005), { got: got.profit, exp: +exp.profit.toFixed(2) });
  t('09-15 毛利率=毛利÷报表销售额', got.margin !== null && near(got.margin, exp.profit / exp.pSales * 100, 0.01), { got: got.margin, exp: +(exp.profit / exp.pSales * 100).toFixed(2) });

  // ②b 退款日对账 (动态找一天有退款的; 覆盖「减退款+加回促销折扣/佣金退款」路径)
  const REF_DAY = (() => {
    const byDay = {};
    pm.rows.forEach(r => { if (r.refSales) byDay[r.d] = (byDay[r.d] || 0) + r.refSales; });
    const ks = Object.keys(byDay).sort();
    return ks.length ? ks[ks.length - 1] : null;
  })();
  t('存在退款日(可对账退款路径)', !!REF_DAY, REF_DAY);
  if (REF_DAY) {
    const expR = await expectProfit(REF_DAY);
    const gotR = await page.evaluate((d) => {
      const v = metricVals(aggRows(d, new Set(), new Set()));
      return { profit: v.profit, refAbs: v.refAbs, refPromo: v.refPromo, refComm: v.refComm, refQty: v.refQty };
    }, REF_DAY);
    t(`${REF_DAY} 退款日 毛利值对账(含退款与退货处理费)`, gotR.profit !== null && near(gotR.profit, expR.profit, 0.005),
      { got: gotR.profit, exp: +expR.profit.toFixed(2) });
    t(`${REF_DAY} 退款金额已接进看板(非零)`, Math.abs(gotR.refAbs) > 0,
      { refAbs: gotR.refAbs, refPromo: gotR.refPromo, refComm: gotR.refComm, refQty: gotR.refQty });
  }
  // ②c 促销折扣退款：单日经常为 0（源数据 2026-10-17 就是 0，全期只有 09-08 / 09-29 有）
  //   ⇒ 动态挑「最近一个 refPromo 非零的日」；整期都没发生则跳过，不把源数据的空当成看板回归
  const PROMO_DAY = (() => {
    const byDay = {};
    pm.rows.forEach(r => { if (r.refPromo) byDay[r.d] = (byDay[r.d] || 0) + r.refPromo; });
    const ks = Object.keys(byDay).sort();
    return ks.length ? ks[ks.length - 1] : null;
  })();
  if (PROMO_DAY) {
    const gp = await page.evaluate((d) => {
      const v = metricVals(aggRows(d, new Set(), new Set()));
      return { refPromo: v.refPromo, refAbs: v.refAbs };
    }, PROMO_DAY);
    t(`${PROMO_DAY} 促销折扣退款已接进看板`, gp.refPromo !== 0, gp);
  } else {
    console.log('  SKIP 全期无促销折扣退款(源数据未发生，非回归)');
  }

  // ③ 利润报表无数据的日期(6月) → 毛利为 —
  const jun = await page.evaluate(() => metricVals(aggRows('2026-06-25', new Set(), new Set())).profit);
  t('06-25 毛利为 null(数据从2026-07起)', jun === null, jun);

  // ④ 合计行: 毛利 / 毛利(RMB) / 退款率 / 8 细项 (2026-10-12 第二轮新增列)
  const totInfo = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const trs = [...document.querySelectorAll('#tableWrap tbody tr')];
    const tot = trs.find(tr => tr.textContent.trim().startsWith('合计'));
    if (!tot) return null;
    const cells = [...tot.querySelectorAll('td')].map(td => td.textContent.trim());
    const off = cells.length - heads.length;                       // 容错: 首列可能是/不是独立 td
    const get = lbl => { const i = heads.indexOf(lbl); return i < 0 ? null : cells[i + off]; };
    const n = s => (s == null ? NaN : Number(String(s).replace(/[^0-9.\-]/g, '')));
    return {
      heads, off,
      ciR: heads.indexOf('毛利(RMB)'), ci: heads.indexOf('毛利'),
      profit: get('毛利'), rmb: get('毛利(RMB)'), rate: get('退款率'),
      fbMst: get('FBA月仓租费'), refAbs: get('退款金额'), refPromo: get('促销折扣退款'),
      refNet: get('退款净额'),
      nProfit: n(get('毛利')), nRmb: n(get('毛利(RMB)')),
    };
  });
  t('表头 毛利(RMB) 紧邻在 毛利 之前', totInfo.ciR >= 0 && totInfo.ci === totInfo.ciR + 1, { ciR: totInfo.ciR, ci: totInfo.ci });
  t('合计行毛利非 —', !!totInfo.profit && totInfo.profit !== '—', totInfo.profit);
  t('合计行 毛利(RMB) 非 — 且 ¥ 前缀', !!totInfo.rmb && totInfo.rmb.startsWith('¥'), totInfo.rmb);
  t('合计行 毛利(RMB) ≈ 毛利 × CNY/USD', (() => {
    if (!isFinite(totInfo.nProfit) || !isFinite(totInfo.nRmb) || totInfo.nProfit === 0) return false;
    const r = totInfo.nRmb / totInfo.nProfit; return r > 6.4 && r < 7.4;
  })(), { rmb: totInfo.rmb, profit: totInfo.profit });
  t('表头含 8 细项 (FBA退货处理费…FBA长期仓租费)', await page.evaluate(() =>
    ['FBA退货处理费', '其他FBA库存和入境服务费', '超量费', '合仓费', '合作承运费', '移除费用', 'FBA月仓租费', 'FBA长期仓租费']
      .every(l => METRICS.some(m => m.label === l))), null);
  t('表头含 退款系列列', await page.evaluate(() =>
    ['退款金额', '促销折扣退款', '销售佣金退款', '退款净额', '退款率'].every(l => METRICS.some(m => m.label === l))), null);
  // 费用/退款列一律「取正数显示」(与既有的 FBA / 仓储 / 头程 / 其他费用 一致)
  const n2 = s => Number(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
  t('合计行 FBA月仓租费 非 — 且为正数(费用列取正数显示)', n2(totInfo.fbMst) > 0, totInfo.fbMst);
  const expRef = pm.rows.reduce((o, r) => ({
    abs: o.abs - (r.refSales || 0),
    promo: o.promo + (r.refPromo || 0),
    comm: o.comm - (r.refComm || 0),
    net: o.net - ((r.refSales || 0) + (r.refShip || 0) + (r.refPromo || 0) + (r.refComm || 0) + (r.refFba || 0)),
  }), { abs: 0, promo: 0, comm: 0, net: 0 });
  t('合计行 退款金额/促销折扣退款/退款净额 为正且与 profit_metrics.json 对账',
    n2(totInfo.refAbs) > 0 && n2(totInfo.refPromo) > 0 && n2(totInfo.refNet) > 0
    && near(n2(totInfo.refAbs), expRef.abs, 0.005)
    && near(n2(totInfo.refPromo), expRef.promo, 0.005)
    && near(n2(totInfo.refNet), expRef.net, 0.005),
    { page: { abs: n2(totInfo.refAbs), promo: n2(totInfo.refPromo), net: n2(totInfo.refNet) },
      exp: { abs: +expRef.abs.toFixed(2), promo: +expRef.promo.toFixed(2), net: +expRef.net.toFixed(2) } });
  t('退款净额 = 退款金额 + 促销折扣退款符号相加(取正数后为 金额+运费+佣金−促销折扣)', await page.evaluate(() => {
    // 直接核对页面内部一致性: refNetAbs = -(refSales+refShip+refPromo+refComm+refFba)
    const all = DAYS.reduce((acc, d) => {
      const a = aggRows(d, new Set(), new Set());
      ['pRefSales', 'pRefShip', 'pRefPromo', 'pRefComm', 'pRefFba'].forEach(k => { acc[k] = (acc[k] || 0) + (a[k] || 0); });
      return acc;
    }, {});
    const exp = -(all.pRefSales + all.pRefShip + all.pRefPromo + all.pRefComm + all.pRefFba);
    const mv = metricVals({ ...all, pRows: 1 });
    return Math.abs(mv.refNetAbs - exp) < 0.02;
  }), null);
  // ⚠️ 期望值必须动态算: 退款率随数据增长而变(早期硬编码 2.08 会在数据补齐后假失败)。
  //    独立口径: 页面当前显示的 DAYS 内, profit_metrics.json 的 ΣrefQty ÷ Σqty。
  const DAYS_LIST = await page.evaluate(() => DAYS);
  const rateDays = new Set(DAYS_LIST);
  let expRefQ = 0, expSalQ = 0;
  for (const r of pm.rows) { if (rateDays.has(r.d)) { expRefQ += (r.refQty || 0); expSalQ += (r.qty || 0); } }
  const expRate = expSalQ > 0 ? expRefQ / expSalQ * 100 : null;
  t('退款率 = 退款件数÷利润报表销量(独立算自 profit_metrics.json)', await page.evaluate((e) => {
    const mv = metricVals(DAYS.reduce((acc, d) => {
      const a = aggRows(d, new Set(), new Set());
      Object.keys(a).forEach(k => { if (typeof a[k] === 'number' && acc[k] !== undefined) acc[k] += a[k]; else if (typeof a[k] === 'number') acc[k] = a[k]; });
      return acc;
    }, { pSalesQty: 0, pRefQty: 0 }));
    return e !== null && mv.refRate !== null && Math.abs(mv.refRate - e) < 0.02 && mv.refRate > 0;
  }, expRate), { exp: expRate === null ? null : +expRate.toFixed(3), refQty: expRefQ, salesQty: expSalQ });

  // ⑤ 列开关: 关掉毛利 → 表头消失
  await page.evaluate(() => { toggleCol('profit'); renderTable(); });
  const heads2 = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim()));
  t('关闭毛利列后表头无 毛利', !heads2.includes('毛利') && heads2.includes('毛利率'), heads2);
  await page.evaluate(() => { toggleCol('profit'); renderTable(); });
  const heads3 = await page.evaluate(() => [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim()));
  t('重新开启毛利列', heads3.includes('毛利'), null);

  // ⑥ 单国筛选下毛利仍对账 (US)
  const expUS = (async () => {
    const e = await expectProfit(DAY, 'US');
    return e.profit;
  })();
  const gotUS = await page.evaluate((d) => metricVals(aggRows(d, new Set(['US']), new Set())).profit, DAY);
  const expUSv = await expUS;
  t('09-15 US 单国毛利对账', gotUS !== null && near(gotUS, expUSv, 0.005), { got: gotUS, exp: +expUSv.toFixed(2) });

  // ⑦ 筛单个 ASIN 时，品牌推广(SB)广告费必须计入
  //   ⚠️ 背景: SB 报表的 Asin 字段为空, 只能靠「活动名里的 ASIN / 系列兜底」归属。
  //     日看板早期只有「自带 Asin + SPECIAL_ASIN」两级, 导致筛单个 ASIN 时 SB 被 filterRows 整块丢弃
  //     → 该 ASIN 广告花费偏低、毛利偏高。此处锁定四级规则与 ad_asin_rules.py 一致。
  //   注意: 若将来运营把 SB 广告名都加上了 ASIN 码, 本用例仍应通过(只是走第 2 层而非第 4 层)。
  const SPECIAL_ASIN = { 'X1-SBV-片段2': 'B0H69JJZ1M', 'X1-SB-定投旗舰店-LC-B2B': 'B0H69JJZ1M', 'X1-SB-定投旗舰店首页-B2B': 'B0H69JJZ1M' };
  const ASIN_RE = /B0[A-Z0-9]{8}/;
  const X1_FB = { US: 'B0H69JJZ1M', CA: 'B0H69JJZ1M', MX: 'B0H69JJZ1M' };
  // 与 ad_asin_rules.py 同规则(独立实现, 用于交叉验证看板)
  // 字段兼容两种形状: 源文件条目(Asin/CampaignName/PortfolioName) 与 adItems() 归一化后的(asin/camp/port)
  const fAsin = (it) => String(it.Asin != null ? it.Asin : (it.asin || '')).trim();
  const fCamp = (it) => String(it.CampaignName != null ? (it.CampaignName || it.Name || '') : (it.camp || '')).trim();
  const fPort = (it) => String(it.PortfolioName != null ? it.PortfolioName : (it.port || ''));
  const fCost = (it) => Number(it.cost != null ? it.cost : ((it.Report || {}).Cost || 0));
  function attrAsin(it, cc) {
    const a = fAsin(it); if (a) return a;
    const c = fCamp(it); if (!c) return null;
    const m = ASIN_RE.exec(c); if (m) return m[0];
    if (SPECIAL_ASIN[c]) return SPECIAL_ASIN[c];
    if (/X1\d/i.test(c)) return null;
    const key = c + ' ' + fPort(it);
    if (/lite/i.test(key)) return 'B0H9YBM4H1';
    if (/X1(?!\d)/i.test(key)) return X1_FB[String(cc || '').toUpperCase()] || 'B0HH8J6SSL';
    return null;
  }
  // 从「页面实际广告条目」算某 ASIN 当日广告花费(USD)；sb = 其中来自「无 Asin 字段」条目的部分(即 SB)
  function expectAdCostByAsin(items, date, asin) {
    const ym = date.slice(0, 7);
    let all = 0, sb = 0, nSb = 0, nonUSsb = 0;
    for (const it of items) {
      if (attrAsin(it, it.cc) !== asin) continue;
      const v = fCost(it) * usdPer(it.cc, ym);
      all += v;
      if (!fAsin(it)) {
        sb += v; nSb++;
        if (it.cc !== 'US') nonUSsb += v;
      }
    }
    return { all, sb, nSb, nonUSsb };
  }

  const ASB_DAY = '2026-09-07', ASB = 'B0H69JJZ1M';
  const itemsASB = await adItems(ASB_DAY);
  const eS = expectAdCostByAsin(itemsASB, ASB_DAY, ASB);
  t('⑦a 前置: ' + ASB_DAY + ' 存在归到 ' + ASB + ' 的 SB 条目', eS.nSb > 0 && eS.sb > 0, eS);
  const gS = await page.evaluate(([d, a]) => {
    const v = metricVals(aggRows(d, new Set(), new Set([a])));
    return { adCost: v.adCost, profit: v.profit };
  }, [ASB_DAY, ASB]);
  t('⑦b 筛 ' + ASB + ' 后广告花费含 SB 归属', gS.adCost !== null && near(gS.adCost, eS.all, 0.005),
    { got: gS.adCost, exp: +eS.all.toFixed(2), 其中SB: +eS.sb.toFixed(2) });
  // 反证: 若 SB 被丢弃, 值应恰为 all − sb; 两者相等说明本用例没测到东西
  t('⑦c SB 部分确实被计入(非旧口径)', Math.abs(eS.sb) > 0.01 && !near(gS.adCost, eS.all - eS.sb, 0.005), { sb: +eS.sb.toFixed(2) });
  // ⑦d 该 ASIN 当日毛利 = (该 ASIN 报表各项 − VAT − 头程 + 剔除 − 测评费) − 该 ASIN 广告花费(含 SB)
  //    ⚠️ 广告费这里必须用 eS.all(页面条目口径, 含 SB 归属), 不能用 adItems 全量 —— 本用例专测 ASIN 维度
  const expProfitA = (() => {
    const ym = ASB_DAY.slice(0, 7); let sum = 0, any = false;
    for (const r of (pm.rows || [])) {
      if (r.d !== ASB_DAY || r.as !== ASB) continue;
      any = true;
      const k = usdPer(r.site, ym);
      sum += (r.sales + r.promo + r.comm + r.fba + r.cost + r.storage + r.other) * k;
      sum -= (r.vat || 0) * k;
      sum -= headUsd(r, ym);
      sum += (r.mcAdj || 0) * k;
      sum -= (r.review || 0) * k;
    }
    return { any, v: sum - eS.all };
  })();
  if (expProfitA.any) {
    t('⑦d 筛 ' + ASB + ' 后毛利 = 该 ASIN 报表利润 − 含 SB 广告花费',
      gS.profit !== null && near(gS.profit, expProfitA.v, 0.005), { got: gS.profit, exp: +expProfitA.v.toFixed(2) });
  } else {
    t('⑦d 跳过(该 ASIN 当日无利润行 → 毛利显示 — 属正常)', gS.profit === null, gS.profit);
  }
  // ⑧ 站点感知: 欧洲款 X1 SB 归 B0HH8J6SSL, 不能错归到美国款 B0H69JJZ1M
  //    日期候选先从源文件里找(源文件确定), 期望值仍用页面条目算(含注入行), 两边都不写死日期
  const EU = 'B0HH8J6SSL';
  const euCand = Object.keys(dd.days).filter((d) => {
    for (const [cc, items] of Object.entries((dd.days[d].ads) || {})) {
      if (cc === 'US') continue;
      for (const it of items) {
        if (!fAsin(it) && attrAsin(it, cc) === EU && fCost(it) > 0) return true;
      }
    }
    return false;
  }).sort();
  const euDay = euCand[euCand.length - 1];
  const eEU = euDay ? expectAdCostByAsin(await adItems(euDay), euDay, EU) : { all: 0, sb: 0, nSb: 0, nonUSsb: 0 };
  const gEU = await page.evaluate(([d, a]) => metricVals(aggRows(d, new Set(), new Set([a]))).adCost, [euDay, EU]);
  t('⑧ 欧洲款 SB 按站点归 ' + EU + ' (非错归美国款)',
    !!euDay && eEU.nonUSsb > 0 && gEU !== null && near(gEU, eEU.all, 0.005),
    { day: euDay, got: gEU, exp: +eEU.all.toFixed(2), 非美站点SB: +eEU.nonUSsb.toFixed(2) });

  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
