/**
 * fetch_joybuy_orders.js — JoyBuy 订单 + 承运商 + 售后 采集
 *
 * 为什么单独一个脚本（不复用 fetch_joybuy_api.js）：
 *   ① 原采集脚本的 shopId 取了 `venderId`，而**订单接口要的是各站自己的 shopId**
 *      —— 用 venderId 查订单永远返回 0 条（会让人误判「JoyBuy 没有订单」）。
 *      四站 shopId 必须用 listVenderShops(isEnableSiteCode:false) 取。
 *   ② 19 位 orderId 超出 double 精度（2^53≈9e15），JSON.parse 会把它变成
 *      `1063102470000082650 → 1063102470000082700` —— 拿被改过的号去查运单会报
 *      「Order is not exist」。本脚本先把 ≥15 位的整数**加引号**再 parse。
 *   ③ 承运商只在 `sp-order/v0/waybill-traces` 里（需 shopId + language + orderId），
 *      不在订单列表/详情里 —— 而承运商决定了物流费按 MCF 还是海外仓尾程结算。
 *
 * 用法：
 *   node fetch_joybuy_orders.js [--days 120] [--out joybuy_orders.json]
 *
 * 输出：joybuy_orders.json（orders[].waybills[].carrierName + logisticsBasis）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const jb = require('./joybuy_api');

const BASE_DIR = __dirname;
const DEFAULT_OUT = path.join(BASE_DIR, 'joybuy_orders.json');

const SITE_LANG = { 'DE-Site': 'de_DE', 'UK-Site': 'en_GB', 'NL-Site': 'nl_NL', 'FR-Site': 'fr_FR' };
const SITE_COUNTRY = { 'DE-Site': 'DE', 'UK-Site': 'GB', 'NL-Site': 'NL', 'FR-Site': 'FR' };

// 物流口径：承运商名命中这些 → 走 Amazon MCF 结算；否则按海外仓尾程配送
const MCF_CARRIER_RE = /amazon\s*(logistics|shipping|freight|transportation)?/i;

const ALL_STATUS = 'UN_PAID,UN_SHIPPED,SHIPPED,COMPLETED,CANCELLED,LOCKED,SUSPEND';
const SEG_DAYS = 85;          // 订单接口限制：startTime~endTime 跨度 ≤ 3 个月

/* ------------------------------ HTTP 原语 ------------------------------ */
async function rawGet(apiPath, { pathParams = {}, query = {} } = {}) {
  const cfg = await jb.ensureToken(jb.loadConfig());
  const timestamp = Date.now();
  const { signature, method } = jb.sign({
    pathParams, query, appKey: cfg.appKey, appSecret: cfg.appSecret,
    accessToken: cfg.accessToken, timestamp,
    method: cfg.signMethod, quoteQueryValues: cfg.signQueryValues
  });
  const headers = {
    'X-JOS-App-Key': cfg.appKey, 'X-JOS-Access-Token': cfg.accessToken,
    'X-JOS-Timestamp': String(timestamp), 'X-JOS-Sign': signature,
    'Content-Type': 'application/json',
    'X-JOS-Request-Identity': cfg.requestIdentity, 'X-JOS-Request-BizId': cfg.venderId,
    'X-JOS-site': cfg.site, 'X-JOS-timeZone': cfg.timeZone,
    'X-JOS-currency': cfg.currency, 'X-JOS-language': cfg.language
  };
  if (method !== 'md5') headers['X-JOS-Sign-Method'] = method;
  const qs = Object.keys(query).length
    ? '?' + Object.keys(query).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&') : '';
  const res = await jb.request(cfg.baseUrl + apiPath + qs, { method: 'GET', headers });
  return res;   // { status, text, json }
}

/** 把 ≥15 位的整数加引号，规避 double 精度破坏 19 位 orderId */
function safeParse(text) {
  if (!text) return null;
  const fixed = text.replace(/:(\d{15,})(?=[,\]}])/g, ':"$1"');
  try { return JSON.parse(fixed); } catch (e) { return null; }
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

function classifyCarrier(names) {
  if (!names || !names.length) return 'UNKNOWN';
  return names.some(n => MCF_CARRIER_RE.test(String(n))) ? 'MCF' : 'LASTMILE';
}

/* ------------------------------ 采集主体 ------------------------------ */
async function collectOrders(shop, days) {
  const now = Date.now();
  const segs = [];
  for (let i = Math.ceil(days / SEG_DAYS); i >= 1; i--) {
    segs.push([now - i * SEG_DAYS * 86400e3, now - (i - 1) * SEG_DAYS * 86400e3]);
  }
  const byId = new Map();
  const errors = [];
  for (const [a, b] of segs) {
    const r = await rawGet('/sp-order/v0/orders', {
      query: {
        shopId: shop.shopId, multiOrderStatus: ALL_STATUS,
        startTime: Math.round(a), endTime: Math.round(b),
        sortOrder: 'DESC', sortBy: 'modifiedTime', page: 1, pageSize: 50,
        scopeSet: 'skuItemInfo'
      }
    });
    const j = safeParse(r.text);
    if (!j || !j.success) {
      errors.push('%s %s~%s → %s' % (shop.site, new Date(a).toISOString().slice(0, 10),
        new Date(b).toISOString().slice(0, 10), (r.text || '').slice(0, 160)));
      continue;
    }
    const list = Array.isArray(j.data) ? j.data : (j.data && (j.data.list || j.data.orders)) || [];
    for (const o of list) {
      if (o && o.orderId != null) byId.set(String(o.orderId), o);
    }
  }
  return { orders: [...byId.values()], errors };
}

async function collectWaybill(shop, orderId) {
  const lang = SITE_LANG[shop.site] || 'en_GB';
  for (const lg of [lang, 'en_GB']) {
    const r = await rawGet('/sp-order/v0/waybill-traces', { query: { shopId: shop.shopId, language: lg, orderId } });
    const j = safeParse(r.text);
    if (j && j.success && Array.isArray(j.data)) {
      return {
        waybills: j.data.map(x => ({
          carrierName: x.carrierName || '', carrierCode: x.carrierCode || '', waybillCode: x.waybillCode || '',
          events: (x.traceDataList || []).length
        })),
        error: null
      };
    }
    const msg = j && j.errorList && j.errorList[0] ? j.errorList[0].message : (r.text || '').slice(0, 120);
    if (/language/i.test(msg)) continue;          // 语言不对 → 换 en_GB 再试
    return { waybills: [], error: msg };
  }
  return { waybills: [], error: '无法确定 language 参数' };
}

async function collectAfs(shop) {
  const r = await rawGet('/sp-aftercare/v0/afs-orders', { query: { shopId: shop.shopId, page: 1, pageSize: 50 } });
  const j = safeParse(r.text);
  if (!j || !j.success) return { rows: [], error: (r.text || '').slice(0, 160) };
  const list = Array.isArray(j.data) ? j.data : (j.data && (j.data.list || j.data.orders)) || [];
  return { rows: list, error: null };
}

(async () => {
  const argv = process.argv;
  const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(opt('days') || 120);
  const outFile = opt('out') ? path.resolve(opt('out')) : DEFAULT_OUT;

  // ① 站点清单：isEnableSiteCode=false 才返回全部站点（true 只给一个站）
  const shopRes = await rawGet('/sp-seller/v0/venders/self/shops', { query: { isEnableSiteCode: false } });
  const shopJson = safeParse(shopRes.text);
  const shops = (shopJson && Array.isArray(shopJson.data) ? shopJson.data : [])
    .map(s => ({ site: s.siteCode, shopId: s.shopId, siteId: s.siteId, shopName: s.shopName, currency: { 'UK-Site': 'GBP' }[s.siteCode] || 'EUR' }));
  if (!shops.length) { console.error('✗ 取不到店铺清单:', (shopRes.text || '').slice(0, 200)); process.exit(2); }
  console.log('店铺 %d 个: %s', shops.length, shops.map(s => s.site + '#' + s.shopId).join(', '));

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'joybuy-openapi · sp-order/v0 + sp-aftercare/v0',
    window: { days },
    shops, orders: [], aftersales: [], warnings: [], selfCheck: {}
  };

  // ② 逐站采集订单 + 运单 + 售后
  for (const shop of shops) {
    const { orders, errors } = await collectOrders(shop, days);
    errors.forEach(e => out.warnings.push(e));
    console.log('  %s: 订单 %d 条%s', shop.site, orders.length, errors.length ? ' (含错误 ' + errors.length + ')' : '');
    for (const o of orders) {
      const { waybills, error } = await collectWaybill(shop, String(o.orderId));
      const names = waybills.map(w => w.carrierName).filter(Boolean);
      let ext = {};
      try { ext = JSON.parse(o.orderExt || '{}'); } catch (e) { ext = {}; }
      const items = (o.skuItemList || []).map(it => ({
        skuId: it.skuId != null ? String(it.skuId) : '',
        outerSkuId: it.outerSkuId || '',
        skuName: it.skuName || '',
        num: Number(it.num) || 0,
        salesPrice: Number(it.salesPrice) || 0
      }));
      const gross = items.reduce((s, it) => s + it.salesPrice * it.num, 0);
      out.orders.push({
        orderId: String(o.orderId),
        site: shop.site, shopId: shop.shopId, siteId: o.siteId,
        country: ext.country || SITE_COUNTRY[shop.site] || '',
        currency: ext.currency || shop.currency,
        status: o.orderStatus || '',
        fulfillmentType: o.fulfillmentType || '',
        createdAt: (o.orderTimeInfo && o.orderTimeInfo.createdTime) || null,
        outboundAt: (o.orderTimeInfo && o.orderTimeInfo.outboundTime) || null,
        finishedAt: (o.orderTimeInfo && o.orderTimeInfo.finishedTime) || null,
        items,
        grossAmount: Number(gross.toFixed(2)),
        units: items.reduce((s, it) => s + it.num, 0),
        waybills,
        carrierNames: names,
        logisticsBasis: classifyCarrier(names),
        waybillError: error
      });
    }
    const afs = await collectAfs(shop);
    if (afs.error) out.warnings.push(shop.site + ' afs: ' + afs.error);
    afs.rows.forEach(r => out.aftersales.push(Object.assign({ site: shop.site, shopId: shop.shopId }, r)));
    console.log('     承运商：%s', [...new Set(out.orders.filter(o => o.site === shop.site).map(o => o.carrierNames.join('/') || '(无)'))].join(' | '));
  }

  // ③ 自检：防串站 + 精度自证 + 承运商分布
  const bySite = {};
  out.shops.forEach(s => { bySite[s.site] = out.orders.filter(o => o.site === s.site).length; });
  const orderIds = out.orders.map(o => o.orderId);
  const shortIds = orderIds.filter(x => x.length < 15);
  const duplicated = orderIds.length !== new Set(orderIds).size;
  const basisCount = { MCF: 0, LASTMILE: 0, UNKNOWN: 0 };
  out.orders.forEach(o => { basisCount[o.logisticsBasis] = (basisCount[o.logisticsBasis] || 0) + 1; });
  out.selfCheck = {
    ordersBySite: bySite,
    orderIdCount: orderIds.length,
    orderIdMinLen: orderIds.length ? Math.min(...orderIds.map(x => x.length)) : 0,
    orderIdPrecisionOK: shortIds.length === 0 && !duplicated,
    logisticsBasis: basisCount,
    carriersSeen: [...new Set(out.orders.flatMap(o => o.carrierNames))].sort(),
    aftersales: out.aftersales.length
  };

  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf-8');
  console.log('\n已写出 %s (%d 订单 / %d 售后)', outFile, out.orders.length, out.aftersales.length);
  console.log('自检: 订单ID精度 %s · 物流口径 %s', out.selfCheck.orderIdPrecisionOK ? 'OK' : '⚠️ 异常',
    JSON.stringify(out.selfCheck.logisticsBasis));
  if (out.warnings.length) console.log('警告 %d 条:\n - %s', out.warnings.length, out.warnings.slice(0, 5).join('\n - '));
  if (!out.selfCheck.orderIdPrecisionOK) process.exitCode = 3;
})().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; });
