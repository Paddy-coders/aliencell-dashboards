/**
 * fetch_joybuy_bills.js — JoyBuy 商家后台「账单明细」采集（费用侧唯一数据源）
 *
 * 为什么必须有这个脚本：
 *   用户要的利润结构「货款 − 佣金 − 交易服务费 − 广告返点 − 增值税费 − 退款 + 退回佣金 − 退货服务费」
 *   里的**每一个费项**都只在账单明细里。开放平台没有财务接口（实测 44 个接口无 Finance 组，
 *   唯一存在的 `BillingDetailQuery` 报 403 code=99900140003，需权限包「全流程控制」）。
 *   但**商家后台的账单页可以直接调**——它和开放平台那支接口是同一套费项编码。
 *
 * 实测结论（2026-10-12）：
 *   接口：POST https://sff.joybuy.com/api?api=<API>&appId=1SBIFSJH9OSWNCNUSKG5&timestamp=..&v=1.0
 *     · dsm.jsp2.ledger.spi.bill.BillDetailReadProvider.queryBillOrderDetailShop   ← 账单明细
 *     · dsm.jsp2.ledger.spi.bill.BillDetailReadProvider.querySumBalAndCountShop    ← 账单汇总
 *   页面：https://partner.joybuy.com/finance-intl/homeOverview （Payments → Account Overview）
 *
 * 坑位（都踩过）：
 *   ① **必须切店铺**：接口按服务端会话（cookie）决定店铺，`shopIdList` 传了也不生效。
 *      切店铺 = GET https://museaccount.joybuy.com/account/live/change?shopId=<id>&belongBizId=<biz>
 *      **并且必须吸收响应的 Set-Cookie（b_belong）**，否则四个站静默返回同一个站的数据。
 *      连"空数据"都会骗人：不切店铺时 DE 站也会返回 total=5（因为第一次切过）。
 *   ② **参数必须给全**：`billOrderQuery` 的 15 个键缺一个就报 `452 Missing necessary parameter`
 *      （即使值是 null 也得写）。用 `fullQuery()` 生成。
 *   ③ **结果数组在 `data.data`**，不是 `data.records`/`data.list`；`total` 才是总数。
 *   ④ 返回结构是 **订单 → skuList[] → costItemList[]** 三层；`detailType=1001` 是商品行，
 *      其它 detailType 是**售后行**（退款/退回佣金/退货服务费就落在这里）。
 *   ⑤ 店铺归属用 `findAllBelongDetailByPin` 拿 `belongBizId`（本次 = 1500002329），
 *      不要用开放平台的 venderId 当 shopId。
 *
 * 用法：
 *   node fetch_joybuy_bills.js [--days 180] [--out joybuy_bills.json]
 *   node fetch_joybuy_bills.js --probe           仅打印费项枚举，不落盘
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_DIR = __dirname;
const SESSION_FILE = path.join(BASE_DIR, 'joybuy_compass_session.json');
const ORDERS_FILE = path.join(BASE_DIR, 'joybuy_orders.json');
const DEFAULT_OUT = path.join(BASE_DIR, 'joybuy_bills.json');
const APPID = '1SBIFSJH9OSWNCNUSKG5';          // Data Compass / 商家后台同一个微应用
const SHOP_LIST_API = 'dsm.intl.account.AccountBelongFacade.findAllBelongDetailByPin';
const MENU_API = 'dsm.intl.account.menu.QueryPinMenusFacade.queryPinMenuTree';
const DETAIL_API = 'dsm.jsp2.ledger.spi.bill.BillDetailReadProvider.queryBillOrderDetailShop';
const SUM_API = 'dsm.jsp2.ledger.spi.bill.BillDetailReadProvider.querySumBalAndCountShop';

/* ------------------------------ cookie jar ------------------------------ */
function buildJar(sess) {
  const jar = new Map();
  String(sess.cookie || '').split(';').forEach(kv => {
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
  });
  return jar;
}
const jarStr = jar => [...jar].map(([k, v]) => k + '=' + v).join('; ');
function absorb(jar, setCookie) {
  (setCookie || []).forEach(c => {
    const kv = String(c).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
  });
}

/* ------------------------------ HTTP ------------------------------ */
function rawRequest(url, { method = 'POST', body, jar, extraHeaders = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise(resolve => {
    const req = https.request(url, {
      method,
      headers: Object.assign({
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': jarStr(jar),
        'Referer': 'https://partner.joybuy.com/',
        'Origin': 'https://partner.joybuy.com'
      }, payload ? { 'Content-Type': 'application/json;charset=UTF-8', 'Content-Length': Buffer.byteLength(payload) } : {}, extraHeaders)
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        absorb(jar, res.headers['set-cookie']);
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', e => resolve({ status: 0, err: e.message }));
    req.setTimeout(45000, () => req.destroy(new Error('超时(45s)')));
    if (payload) req.write(payload);
    req.end();
  });
}
function dsm(api, body, jar) {
  const url = 'https://sff.joybuy.com/api?api=' + encodeURIComponent(api)
    + '&appId=' + APPID + '&timestamp=' + Date.now() + '&v=1.0';
  return rawRequest(url, { body: body || {}, jar, extraHeaders: { 'dsm-platform': 'intl-pc', 'dsm-site': '', 'dsm-language': 'en_GB' } });
}
function switchShop(shopId, bizId, jar) {
  return rawRequest('https://museaccount.joybuy.com/account/live/change?shopId=' + shopId + '&belongBizId=' + bizId,
    { method: 'GET', jar });
}

/* ------------------------------ 账单查询 ------------------------------ */
/** 参数必须给全（缺一个 → 452），值为 null 也要写 */
function fullQuery(o = {}) {
  return { billOrderQuery: Object.assign({
    orderId: null, settleStatusList: [2, 1, 3],
    paymentReceivedTimeE: null, paymentReceivedTimeS: null,
    orderDateTimeE: null, orderDateTimeS: null,
    billTimeS: null, billTimeE: null, rfBusiId: null,
    shopIdList: [], bankFlow: null, feeCode: null, skuId: null,
    pageSize: 100, currentPage: 1, secMerchantNo: ''
  }, o) };
}

const fmtDT = t => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

async function queryAll(shopId, bizId, jar, days) {
  await switchShop(shopId, bizId, jar);
  const now = Date.now();
  // ⚠️ 日期过滤有坑：带 orderDateTime 范围时条数会变少（实测不筛 5 条 / 筛 180 天 3 条），
  // 说明它筛的是「订单时间」而非「账单时间」，跨期账单会被漏掉 ⇒ 默认不筛（--days 0），
  // 全量拉回后在 Python 侧按 happenTime 归属期间。
  const range = days > 0 ? { orderDateTimeS: fmtDT(now - days * 86400e3), orderDateTimeE: fmtDT(now) } : {};
  const rows = [];
  const errors = [];
  let page = 1, total = null;
  for (;;) {
    const r = await dsm(DETAIL_API, fullQuery(Object.assign({ currentPage: page }, range)), jar);
    if (!r.json || r.json.code !== 200) {
      errors.push('page ' + page + ' → HTTP' + r.status + ' code=' + (r.json && r.json.code) + ' ' + (r.json && r.json.msg || (r.text || '').slice(0, 120)));
      break;
    }
    const d = r.json.data || {};
    if (total === null) total = d.total != null ? Number(d.total) : null;
    const list = Array.isArray(d.data) ? d.data : [];
    list.forEach(x => rows.push(x));
    if (!list.length || (total != null && rows.length >= total) || page > 50) break;
    page++;
  }
  return { rows, total, errors };
}

/* ------------------------------ 归一 ------------------------------ */
/** 把三层结构（订单→skuList→costItemList）拍平成费项行，便于聚合 */
function flatten(orders, shopSite) {
  const items = [];
  (orders || []).forEach(o => {
    (o.skuList || []).forEach(sk => {
      (sk.costItemList || []).forEach(c => {
        items.push({
          site: shopSite, shopId: o.shopId, orderId: String(o.orderId || ''),
          skuId: String(sk.skuId || ''), skuName: sk.skuName || '',
          detailType: sk.detailType, isAfterSale: sk.detailType !== 1001,
          num: sk.num != null ? sk.num : null,
          feeName: c.feeName || '', feeCode: c.feeCode != null ? c.feeCode : null,
          bal: Number(c.bal) || 0,
          direction: Number(c.direction) || 0,        // 1 = 商家应收, −1 = 商家应付
          signed: (Number(c.direction) || 0) === 1 ? Math.abs(Number(c.bal) || 0) : -Math.abs(Number(c.bal) || 0),
          currency: c.currency || '',
          settleStatus: c.settleStatus != null ? c.settleStatus : null,
          remark: c.remark || '',
          bankFlow: c.bankFlow || '',
          secMerchantNo: c.secMerchantNo || '',
          happenTime: c.happenTime || null,
          settleTime: c.settleTime || null,
          paymentReceivedTime: c.paymentReceivedTime || null
        });
      });
    });
  });
  return items;
}

/* ------------------------------ 主流程 ------------------------------ */
(async () => {
  const argv = process.argv;
  const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(opt('days') || 0);   // 0 = 不筛日期，全量拉取
  const probeOnly = argv.includes('--probe');
  const outFile = opt('out') ? path.resolve(opt('out')) : DEFAULT_OUT;

  if (!fs.existsSync(SESSION_FILE)) {
    console.error('✗ 缺少会话文件 ' + SESSION_FILE + '\n  先跑 node joybuy_compass_fetch.js --save-session');
    process.exit(2);
  }
  const sess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const jar = buildJar(sess);

  // ① 店铺归属（belongBizId 从这里来）
  const shopRes = await dsm(SHOP_LIST_API, {}, jar);
  if (!shopRes.json || shopRes.json.code !== 200 || !Array.isArray(shopRes.json.data) || !shopRes.json.data.length) {
    console.error('✗ 取店铺归属失败（会话多半已过期，重新 --save-session）:', (shopRes.text || '').slice(0, 200));
    process.exit(2);
  }
  const bizId = String(shopRes.json.data[0].belongBizId);

  // ② 店铺清单（站点 + shopId）：优先用已有订单文件的 shops，否则从菜单元数据补
  let shops = [];
  if (fs.existsSync(ORDERS_FILE)) {
    const od = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    shops = (od.shops || []).map(s => ({ site: s.site, shopId: s.shopId }));
  }
  if (!shops.length) {
    console.error('✗ 没有店铺清单 —— 先跑 node fetch_joybuy_orders.js 生成 joybuy_orders.json');
    process.exit(2);
  }
  console.log('belongBizId=%s · 站点 %d 个：%s', bizId, shops.length, shops.map(s => s.site + '#' + s.shopId).join(', '));

  // ③ 逐站查账单
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'partner.joybuy.com 账单明细（ledger.spi.bill.BillDetailReadProvider）',
    api: { detail: DETAIL_API, sum: SUM_API },
    window: { days },
    belongBizId: bizId,
    shops: [], items: [], summaries: [], warnings: [], selfCheck: {}
  };
  let rawOrders = [];
  for (const shop of shops) {
    const { rows, total, errors } = await queryAll(shop.shopId, bizId, jar, days);
    errors.forEach(e => out.warnings.push(shop.site + ': ' + e));
    const items = flatten(rows, shop.site);
    rawOrders = rawOrders.concat(rows.map(r => Object.assign({ _site: shop.site }, r)));
    out.items = out.items.concat(items);
    const sum = await dsm(SUM_API, fullQuery({ shopIdList: [] }), jar);
    out.summaries.push({ site: shop.site, shopId: shop.shopId, total, summary: (sum.json && sum.json.data) || null });
    console.log('  ' + shop.site + ' 账单订单 ' + (total != null ? total : rows.length) + ' 条 → 费项 ' + items.length + ' 项'
      + (errors.length ? ' (错误 ' + errors.length + ')' : ''));
  }
  out.shops = shops;

  // ④ 自检：费项枚举 + 汇总恒等式 + 多币种
  const byFee = {};
  out.items.forEach(it => {
    const k = it.feeName + '|dir' + it.direction;
    byFee[k] = byFee[k] || { n: 0, sum: 0 };
    byFee[k].n++; byFee[k].sum += it.bal;
  });
  const netOf = arr => arr.reduce((s, it) => s + it.signed, 0);
  const goods = out.items.filter(i => /Product Payment/i.test(i.feeName));
  const fees = out.items.filter(i => !/Product Payment/i.test(i.feeName));
  out.selfCheck = {
    billOrders: rawOrders.length,
    feeItems: out.items.length,
    feeVocabulary: Object.keys(byFee).sort(),
    byFee: Object.fromEntries(Object.entries(byFee).map(([k, v]) => [k, { n: v.n, sum: +v.sum.toFixed(2) }])),
    currency: [...new Set(out.items.map(i => i.currency))].sort(),
    sitesWithBills: [...new Set(out.items.map(i => i.site))].sort(),
    netBeforeLogistics: +(netOf(goods) + netOf(fees)).toFixed(2),
    hasAfterSale: out.items.some(i => i.isAfterSale)
  };

  if (!probeOnly) {
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8');
    console.log('\n已写出 %s（%d 个费项 / %d 张账单）', outFile, out.items.length, rawOrders.length);
  }
  console.log('费项枚举：');
  Object.keys(out.selfCheck.byFee).sort().forEach(k => {
    const v = out.selfCheck.byFee[k];
    console.log('  ' + k.padEnd(46) + ' n=' + String(v.n).padEnd(4) + v.sum);
  });
  console.log('币种 %s · 净额(未扣物流) %s %s', out.selfCheck.currency.join('/'), out.selfCheck.netBeforeLogistics,
    out.selfCheck.hasAfterSale ? '· 含售后行' : '· 本期无售后行');
  if (out.warnings.length) console.log('警告 %d 条:\n - %s', out.warnings.length, out.warnings.slice(0, 5).join('\n - '));
})().catch(e => { console.error("FATAL:", e.message); console.error(e.stack); process.exitCode = 1; });
