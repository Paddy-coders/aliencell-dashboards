// 易仓利润报表(ASIN维度) 抓取脚本 → profit_data.json
// 用法:
//   node fetch_profit_data.js                 # 增量: 补缺天数 + 复核最近 REFRESH_DAYS 天 + 各月
//   node fetch_profit_data.js --force         # 全量重抓
//   node fetch_profit_data.js --from 2026-06-01 [--to 2026-09-30]
// 前置: auto_login_eccang.js 已运行(Edge 9223 已登录易仓)
// 口径: 行 = 日期 × ASIN × 店铺 × 站点; 费用均为负值(与 ERP 一致); 原币种
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BASE_DIR = __dirname;
const OUT_FILE = path.join(BASE_DIR, 'profit_data.json');
const BACKUP_DIR = path.join(BASE_DIR, 'backups');

// 数据起点(与日看板数据范围对齐, 2026-06 起留余量)
const DEFAULT_FROM = '2026-06-01';
// 最近 N 天每次都重抓(结算数据会回填修订)
const REFRESH_DAYS = 6;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const argOf = (k, dflt) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const FROM = argOf('--from', DEFAULT_FROM);
const TO = argOf('--to', '');   // 空 = 今天

setTimeout(() => { console.log('WATCHDOG 超时退出'); process.exit(3); }, 25 * 60 * 1000);

// 日期工具: 必须用本地时间格式化。⚠️ 不能用 toISOString()——GMT+8 下会回退 8 小时,
// 导致 addDays(x,1) 返回同一天, daterange 死循环把内存吃爆(2026-10-10 实测 OOM 4GB)
function fmtLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() { return fmtLocal(new Date()); }
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtLocal(d); }
function monthOf(s) { return s.slice(0, 7); }
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}`, days: last };
}
function daterange(a, b) { const out = []; let x = a; while (x <= b) { out.push(x); x = addDays(x, 1); } return out; }

// ERP 行 → 精简行(只留需要的字段, 控制体积)
function trimRow(r) {
  return {
    as: r.asin || '', pa: r.parentAsin || '', site: r.site || '', ua: r.userAccount || '',
    cur: r.currencyCode || '', qty: Number(r.quantityTotal) || 0,
    sales: Number(r.productSalesTotal) || 0,          // 销售额
    promo: Number(r.promotionalRebatesTotal) || 0,    // 促销折扣汇总(负)
    comm: Number(r.sellingFeesTotal) || 0,            // 销售佣金汇总(负)
    fba: Number(r.fbaFeesTotal) || 0,                 // 配送费汇总(负)
    adErp: Number(r.otherTransactionFeeTotal) || 0,   // ERP广告费用汇总(负, 仅对账用)
    cost: Number(r.productCostTotal) || 0,            // 商品成本(负)
    mst: Number(r.fbaMonthStorageFee) || 0,           // FBA月仓储费(负, 月度行有效)
    lst: Number(r.fbaLongtermStorageFee) || 0,        // 长期仓储费(负)
    psvc: Number(r.couponAndLightningDealFeeTotal) || 0, // 推广服务费汇总(负)
    svc: Number(r.serviceFeeTotal) || 0,              // 服务费汇总(负)
    gross: Number(r.grossProfitTotal) || 0,           // ERP毛利(对账用)
    // ---- 2026-10-12 第一轮: FBA库存与入境服务费 / 多渠道 ----
    inb: Number(r.fbaInboundTransportationFee) || 0,  // FBA物流国际货运费(月度/站点级行, 无 ASIN)
    invTotal: Number(r.fbaInventoryFeeTotal) || 0,    // 汇总(对账用)
    mqty: Number(r.multiChannelQuantity) || 0,        // 多渠道销量(台)
    mcost: (Number(r.multiPurchaseCostFee) || 0) + (Number(r.multiPurchaseShippingFee) || 0)
         + (Number(r.multiPurchaseTariffFee) || 0),   // 多渠道订单-采购成本/运费/税费(已含在 cost 内)
    mhead: (Number(r.multiFirstShippingFee) || 0) + (Number(r.multiFirstShippingTariffFee) || 0), // 多渠道头程(已含在 cost 内)
    mship: Number(r.multiFbaFees) || 0,               // 多渠道配送费(已含在 fba 内)
    // ---- 2026-10-12 第二轮: 「FBA库存与入境服务费」拆 9 细项 (ERP 官方公式 customSummaryCalFormula) ----
    //   fbaInventoryFeeTotal = FBA退货处理费 + 其他FBA库存和入境服务费 + FBA物流国际货运费 + 超量费
    //                         + 合仓费 + 合作承运费 + 移除费用 + FBA月仓租费 + FBA长期仓租费
    //   ⚠️ 「合作承运费」ERP 无独立返回字段(实测缺) → 用**倒挤**: 汇总 − 已知 8 项, 保证 9 项之和恒等于汇总
    fbRet: sumOf(r, 'fbaReturnDisposalFeeTotal', 'fbaReturnDisposalFeeOtherFee',
                    'fbaReturnDisposalFeeFbaFee', 'fbaReturnDisposalFeeTbybCustomerFbaFee'),
    fbOth: sumOf(r, 'otherFbaInventoryFeeOtherFee', 'otherFbaInventoryFeeFbaFee', 'otherFbaInventoryFbaAndFba'),
    fbInb: Number(r.fbaInboundTransportationFee) || 0,
    fbOvr: sumOf(r, 'fbaWeightBasedFee', 'fbWeightBasedFee'),
    fbCon: sumOf(r, 'fbaInboundConvenienceFee', 'fbaInboundConvenienceServiceFee'),
    fbRem: Number(r.fbaRemovalFee) || 0,
    fbMst: Number(r.fbaMonthStorageFee) || 0,
    fbLst: Number(r.fbaLongtermStorageFee) || 0,
    fbTot: Number(r.fbaInventoryFeeTotal) || 0,
    // 站点级行的仓储(交易报告) —— 与 ASIN 行的 fbaMonthStorageFee 互补, 两者相加才是全站仓储
    stSite: Number(r.storageFee) || 0,
    // ---- 退款 (2026-10-12 第二轮): 毛利要减退款、加回促销折扣退款与销售佣金退款 ----
    refSales: sumOf(r, 'refundFbaProductSalesTotal', 'fbmRefundFbmProductSales'),  // 退款商品金额(负)
    refPromo: Number(r.refundPromotionalRebates) || 0,   // 促销折扣退款(正)
    refComm: Number(r.refundSellingFees) || 0,           // 销售佣金退款(负=支出)
    refFba: Number(r.refundFbaFees) || 0,                // 配送费退款
    refQty: Number(r.refundQuantityTotal) || 0,          // 退款数量(退款率分子)
    refRate: Number(r.refundRate) || 0,                  // ERP 退款率(数量口径)
    refShip: Number(r.refundShippingCredits) || 0        // 买家运费退款
  };
}
// 取多个候选字段名之和(ERP 字段名偶有别名/拼写差异, 取第一个命中的集合)
function sumOf(r, ...names) {
  let v = 0;
  for (const n of names) v += Number(r[n]) || 0;
  return v;
}

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  let page = pages.find(p => p.url().includes('eccang.com'));
  if (!page) {
    const ctx0 = b.contexts()[0] || await b.newContext();
    page = await ctx0.newPage();
    await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(6000);
  }
  if (String(page.url()).includes('/login')) { console.log('ERROR: 易仓未登录, 先运行 node auto_login_eccang.js'); await b.close(); process.exit(1); }

  // 打开利润报表页(拿同源 localStorage token)
  if (!page.url().includes('profit_system')) {
    await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/profit_system#/ps/profit-statement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(9000);
  }
  const TOKEN = await Promise.race([
    page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value || ''; } catch (e) { return ''; } }),
    sleep(8000).then(() => '')
  ]);
  if (!TOKEN) { console.log('ERROR: 读取 token 失败'); await b.close(); process.exit(1); }

  const req = page.context().request;
  const mkBody = (start, end) => ({
    selectOptionsConditionList: [
      { selectType: 'site', selectValue: [] }, { selectType: 'userAccount', selectValue: [] },
      { selectType: 'transactionStatus', selectValue: [] }, { selectType: 'category', selectValue: [] },
      { selectType: 'sellerStatus', selectValue: [] }, { selectType: 'sellerUser', selectValue: [] },
      { selectType: 'isLowPrice', selectValue: [] }, { selectType: 'tags', selectValue: [] }
    ],
    inputOptionsConditionList: [{ inputType: 'asin', inputValue: [] }, { inputType: 'brand', inputValue: [] }],
    timeCondition: { timeType: 'dateTime', startTime: start + ' 00:00:00', endTime: end + ' 23:59:59' },
    dateType: 'd', currencyCode: 'ORIGINAL', pageNo: 1, pageSize: 500,
    timeArea: 'SITE', profitFormulaType: 1, costType: '1', chargeType: 'ord', dimension: 'ctm', parentAsin: 0
  });
  const LOGF = path.join(BASE_DIR, '_fetch_profit_sync.log');
  const slog = (...a) => { try { fs.appendFileSync(LOGF, a.join(' ') + '\n'); } catch (e) {} console.log(...a); };
  async function query(start, end) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await req.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
          headers: { 'Content-Type': 'application/json', 'authorization': TOKEN, 'x-access-token': TOKEN, 'company': 'ntvb7tr' },
          data: mkBody(start, end), timeout: 60000
        });
        const buf = await r.body();
        if (buf.length > 30 * 1024 * 1024) {
          slog('  ⚠ 巨型响应跳过', start, (buf.length / 1048576).toFixed(1) + 'MB');
          return null;
        }
        const j = JSON.parse(buf.toString('utf8'));
        if (j && j.data && Array.isArray(j.data.records)) return { rows: j.data.records, bytes: buf.length };
        slog('  响应异常(第' + attempt + '次):', buf.toString('utf8', 0, 160));
      } catch (e) { slog('  请求失败(第' + attempt + '次):', start, e.message.slice(0, 100)); }
      await sleep(2500 * attempt);
    }
    return null;
  }

  // ---- 计划抓取的天与月 ----
  const today = todayStr();
  const endDate = TO || today;
  const allDays = daterange(FROM, endDate);
  const allMonths = [...new Set(allDays.map(monthOf))].sort();

  let prev = { days: {}, months: {}, siteFees: {}, generatedAt: '', note: '' };
  if (fs.existsSync(OUT_FILE)) {
    try { prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch (e) { console.log('警告: 旧 profit_data.json 解析失败, 全量重抓'); prev = { days: {}, months: {} }; }
  }
  prev.days = prev.days || {}; prev.months = prev.months || {}; prev.siteFees = prev.siteFees || {};

  const needDays = [];
  for (const d of allDays) {
    if (FORCE || !prev.days[d] || (prev.days[d].length === 0)) needDays.push(d);
    else if (d > addDays(today, -REFRESH_DAYS)) needDays.push(d);   // 最近 N 天复核
  }
  // 只抓已有日数据的范围, 避免白抓(利润数据从 6 月起)
  slog(`计划: 天数 ${needDays.length}/${allDays.length} (范围 ${FROM} ~ ${endDate}${FORCE ? ' · 全量' : ''})`);

  const newDays = {};
  let failDays = 0, emptyDays = 0;
  const mem = () => { const m = process.memoryUsage(); return 'heap=' + (m.heapUsed / 1048576).toFixed(0) + 'MB'; };
  for (let i = 0; i < needDays.length; i++) {
    const d = needDays[i];
    const res = await query(d, d);
    if (res === null) { failDays++; continue; }        // 失败保留旧数据
    const trimmed = res.rows.map(trimRow).filter(r => r.as);
    if (trimmed.length === 0) emptyDays++;
    newDays[d] = trimmed;
    if ((i + 1) % 10 === 0 || i === needDays.length - 1) {
      const s = trimmed.reduce((a, r) => a + r.sales, 0);
      console.log(`  [${i + 1}/${needDays.length}] ${d}: ${trimmed.length}行 ${res.bytes}B 销售 ${s.toFixed(2)} ${mem()}`);
      // 阶梯落盘(崩溃不丢进度)
      fs.writeFileSync(OUT_FILE + '.part', JSON.stringify({ days: Object.assign({}, prev.days, newDays), months: prev.months, siteFees: prev.siteFees }));
    }
    await sleep(120);
  }

  // ---- 月度抓取(取月仓储费 + 站点级入境费 + 对账) ----
  const newMonths = {};
  const newSiteFees = {};
  const monthStats = [];
  for (const ym of allMonths) {
    const { start, end } = monthRange(ym);
    if (start < FROM) continue;
    const res = await query(start, end);
    if (res === null) { console.log(`  月 ${ym}: 抓取失败, 保留旧数据`); continue; }
    // ⚠️ 站点级(无 ASIN)行承载「FBA物流国际货运费」等无法归到 SKU 的费用。
    //    下面 trimmed 的 .filter(r=>r.as) 会把它丢掉 → 必须单独按 ym×site 存, 供构建期按 SKU 分摊。
    // 2026-10-12 第二轮: 由「只存 inb/invx」扩为**全套 9 细项**(与 trimRow 同名), 供拆列与并入其他费用。
    const siteAgg = {};
    for (const r of res.rows) {
      if (r.asin) continue;
      const s = String(r.site || '').toUpperCase();
      if (!s) continue;
      const a = siteAgg[s] || (siteAgg[s] = {
        inb: 0, invTotal: 0, storageFee: 0,
        fbRet: 0, fbOth: 0, fbInb: 0, fbOvr: 0, fbCon: 0, fbRem: 0, fbMst: 0, fbLst: 0, fbTot: 0,
      });
      const t = trimRow(r);
      a.inb += t.fbInb;
      a.invTotal += t.fbTot;
      a.storageFee += Number(r.storageFee) || 0;
      a.fbRet += t.fbRet; a.fbOth += t.fbOth; a.fbInb += t.fbInb; a.fbOvr += t.fbOvr;
      a.fbCon += t.fbCon; a.fbRem += t.fbRem; a.fbMst += t.fbMst; a.fbLst += t.fbLst; a.fbTot += t.fbTot;
    }
    // 合作承运费倒挤(站点级): 汇总 − 已知 8 项
    for (const a of Object.values(siteAgg)) {
      const known = a.fbRet + a.fbOth + a.fbInb + a.fbOvr + a.fbCon + a.fbRem + a.fbMst + a.fbLst;
      a.fbCar = a.fbTot ? +(a.fbTot - known).toFixed(4) : 0;
    }
    // 只留有金额的站点, 控制体积
    const siteKeep = {};
    for (const [s, a] of Object.entries(siteAgg)) {
      if (a.inb || a.invTotal || a.storageFee || a.fbRet || a.fbOth || a.fbOvr || a.fbCon
          || a.fbCar || a.fbRem || a.fbMst || a.fbLst) siteKeep[s] = a;
    }
    newSiteFees[ym] = siteKeep;
    const trimmed = res.rows.map(trimRow).filter(r => r.as);
    newMonths[ym] = trimmed;
    const s = k => +trimmed.reduce((a, r) => a + (r[k] || 0), 0).toFixed(2);
    const fbOk = +Object.values(siteKeep).reduce((a, x) => a + (x.fbTot || 0), 0).toFixed(2);
    const fbKnown = +Object.values(siteKeep).reduce((a, x) =>
      a + (x.fbRet || 0) + (x.fbOth || 0) + (x.fbInb || 0) + (x.fbOvr || 0) + (x.fbCon || 0) + (x.fbCar || 0) + (x.fbRem || 0) + (x.fbMst || 0) + (x.fbLst || 0), 0).toFixed(2);
    monthStats.push({ ym, rows: trimmed.length, sales: s('sales'), cost: s('cost'), mst: s('mst') + s('lst'), gross: s('gross'),
                      ref: s('refSales'), refQty: s('refQty'), fbSiteTot: fbOk, fbSiteKnown: fbKnown });
    console.log(`  月 ${ym}: ${trimmed.length}行 ${res.bytes}B ${mem()} · 退款 ${s('refSales')}(${s('refQty')}件) · 站点级入库费 ${fbOk}(9项和 ${fbKnown})`);
    await sleep(150);
  }

  await b.close().catch(() => {});

  // ---- 合并 ----
  const days = Object.assign({}, prev.days, newDays);
  const months = Object.assign({}, prev.months, newMonths);
  const siteFees = Object.assign({}, prev.siteFees, newSiteFees);
  // 丢弃范围外
  for (const d of Object.keys(days)) if (d < FROM || d > endDate) delete days[d];
  for (const m of Object.keys(months)) if (m < monthOf(FROM) || m > monthOf(endDate)) delete months[m];
  for (const m of Object.keys(siteFees)) if (m < monthOf(FROM) || m > monthOf(endDate)) delete siteFees[m];

  const out = {
    generatedAt: new Date().toLocaleString('sv-SE').replace('T', ' '),
    source: 'eccang 财务-营收利润-利润报表(ASIN) productAsin/queryPage',
    formula: '毛利 = 销售额 + 促销折扣 + 销售佣金 + 配送费 + 商品成本 + 仓储费 - 广告费(看板) - 其他费用均摊; 费用为负值',
    from: FROM, through: endDate,
    days, months, siteFees,
    note: '行=日期×ASIN×店铺×站点; 原币种; 结算数据滞后1~2天自动回填; siteFees=站点级(无ASIN)月度费用(FBA物流国际货运费等)'
  };

  // 备份
  if (fs.existsSync(OUT_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    fs.copyFileSync(OUT_FILE, path.join(BACKUP_DIR, `profit_data_${ts}.json`));
    const olds = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('profit_data_')).sort();
    while (olds.length > 4) fs.unlinkSync(path.join(BACKUP_DIR, olds.shift()));
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out), 'utf8');

  // ---- 汇报 ----
  const dayCount = Object.keys(days).filter(d => (days[d] || []).length > 0).length;
  const totalRows = Object.values(days).reduce((s, v) => s + (v || []).length, 0);
  console.log(`\n=== 完成 ===`);
  console.log(`天数(非空): ${dayCount}, 日行总数: ${totalRows}, 本次失败天: ${failDays}, 空天: ${emptyDays}`);
  console.log('站点级(无ASIN)月度费用 [siteFees]:');
  for (const ym of Object.keys(siteFees).sort()) {
    const m = siteFees[ym] || {};
    const parts = Object.entries(m).map(([s, a]) => `${s}: 入境货运费 ${(a.inb || 0).toFixed(2)} / 9项和 ${((a.fbRet || 0) + (a.fbOth || 0) + (a.fbInb || 0) + (a.fbOvr || 0) + (a.fbCon || 0) + (a.fbCar || 0) + (a.fbRem || 0) + (a.fbMst || 0) + (a.fbLst || 0)).toFixed(2)} / 汇总 ${(a.fbTot || 0).toFixed(2)} / 仓储 ${(a.storageFee || 0).toFixed(2)}`);
    if (parts.length) console.log(`  ${ym}: ${parts.join(' | ')}`);
  }
  console.log('月份对账 (月度查询):');
  monthStats.forEach(m => console.log(`  ${m.ym}: ${m.rows} 行 · 销售额 ${m.sales} · 成本 ${m.cost} · 仓储 ${m.mst} · ERP毛利 ${m.gross} · 退款 ${m.ref} (${m.refQty} 件) · 站点级入库费 ${m.fbSiteTot}`));
  // 日汇总 vs 月度对账
  console.log('日汇总 vs 月度 (销售额):');
  for (const m of monthStats) {
    let ds = 0, dg = 0, dn = 0;
    for (const [d, rows] of Object.entries(days)) {
      if (monthOf(d) !== m.ym) continue;
      dn++; ds += (rows || []).reduce((a, r) => a + r.sales, 0); dg += (rows || []).reduce((a, r) => a + r.gross, 0);
    }
    const dsR = +ds.toFixed(2), dgR = +dg.toFixed(2);
    const flag = Math.abs(dsR - m.sales) > Math.max(1, Math.abs(m.sales) * 0.005) ? ' ⚠ 不一致' : ' ✓';
    console.log(`  ${m.ym}: 日汇总 ${dsR} (${dn}天) vs 月度 ${m.sales}${flag} | 毛利 日 ${dgR} vs 月 ${m.gross}${Math.abs(dgR - m.gross) > 1 ? ' ⚠' : ' ✓'}`);
  }
  process.exit(failDays > needDays.length * 0.2 ? 2 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
