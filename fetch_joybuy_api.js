/**
 * JoyBuy 数据采集脚本（基于 joybuy_api.js 的签名 SDK）
 *
 * 两种模式：
 *   node fetch_joybuy_api.js probe              逐接口试调一次，原始响应落 joybuy_raw/<接口>.json（用于校准字段）
 *   node fetch_joybuy_api.js collect [--days 90] 分页采集 → joybuy_raw/ + joybuy_api_data.json
 *   node fetch_joybuy_api.js fields             打印已采集原始数据的顶层字段清单（辅助写字段映射）
 *
 * 说明：开放平台 SP-API 只有 Aftersales / Vender / Product / Order 五组（已实测 listApiGroup 确认），
 *      没有流量 / 加购 / 收藏接口 —— 那三项走商家后台报表（见 joybuy_import_traffic.js）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const jb = require('./joybuy_api');

const RAW_DIR = path.join(__dirname, 'joybuy_raw');
const OUT_FILE = path.join(__dirname, 'joybuy_api_data.json');
const FIELD_MAP_FILE = path.join(__dirname, 'joybuy_fieldmap.json');

/* ------------------------------------------------------------------ *
 * 接口清单（路径已由开放平台 API References 实测导出，共 44 个）
 *
 * baseQuery 说明（2026-09-26 实测补齐，来自文档详情页展开后的 Request Parameters）：
 *   文档页可用 URL 直连：https://open-portal.joybuy.com/#/doc/api?apiName=<名>&gwType=1&businessModel=1
 *   - listOrders 参数平铺在 query，全部必填：shopId / multiOrderStatus / startTime / endTime
 *     / sortOrder / sortBy / page / pageSize / scopeSet（毫秒时间戳，跨度 ≤ 3 个月）
 *   - listProducts / listSkus / listAfsOrders 只需 shopId（+ 分页）
 *   - listSkuStocks 还需 fulfillmentType
 *   - shopId 实测就是 venderId（新 ID 体系，形如 1500002329）
 * ------------------------------------------------------------------ */
const CFG = (() => { try { return require('./joybuy_api').loadConfig(); } catch (e) { return {}; } })();
const SHOP_ID = Number(CFG.venderId || 1500002329);
const ORDER_STATUSES = 'UN_PAID,UN_SHIPPED,SHIPPED,COMPLETED,CANCELLED,LOCKED,SUSPEND';

const ENDPOINTS = {
  listVenderShops: { method: 'GET', path: '/sp-seller/v0/venders/self/shops', page: false, baseQuery: { isEnableSiteCode: true } },
  listProducts: { method: 'GET', path: '/sp-product/v0/products', page: true, pageSize: 20, baseQuery: { shopId: SHOP_ID } },
  listSkus: { method: 'GET', path: '/sp-product/v0/skus', page: true, pageSize: 20, baseQuery: { shopId: SHOP_ID } },
  // ⚠️ 注意参数名是 bussinessModel（京东文档把 business 拼错了，双 s），
  //    用 fulfillmentType/fulfillmentMode 一律报 "the fulfillment mode cannot be empty"。
  //    且不是分页接口：必填 skuIdList（逗号分隔，单次 ≤ 20 个）。
  listSkuStocks: { method: 'GET', path: '/sp-product/v0/sku-stocks', page: false, baseQuery: { bussinessModel: 'FBM', shopId: SHOP_ID } },
  listAfsOrders: { method: 'GET', path: '/sp-aftercare/v0/afs-orders', page: true, baseQuery: { shopId: SHOP_ID } },
  listOrders: {
    method: 'GET', path: '/sp-order/v0/orders', page: true,
    baseQuery: {
      shopId: SHOP_ID,
      multiOrderStatus: ORDER_STATUSES,
      sortOrder: 'DESC',
      sortBy: 'modifiedTime',
      scopeSet: 'skuItemInfo'
    }
  }
};

/* ------------------------------------------------------------------ *
 * 字段别名表：不同接口/版本字段名可能不同，用多个候选名兜底
 * ------------------------------------------------------------------ */
const ALIAS = {
  orderId: ['orderId', 'order_id', 'jdOrderId', 'orderNo', 'orderCode'],
  orderStatus: ['orderStatus', 'order_status', 'status'],
  orderTime: ['orderTime', 'order_time', 'createTime', 'createdTime', 'orderCreateTime', 'submitTime', 'orderDate'],
  payTime: ['payTime', 'paymentTime', 'paidTime'],
  sku: ['sku', 'skuId', 'sku_id', 'outerSkuId', 'sellerSku', 'skuCode'],
  productId: ['productId', 'product_id'],
  productName: ['productName', 'product_name', 'title', 'name'],
  qty: ['quantity', 'qty', 'num', 'itemNum', 'skuNum', 'count'],
  amount: ['amount', 'totalAmount', 'orderAmount', 'payAmount', 'actualAmount', 'price', 'totalPrice', 'itemAmount', 'goodsAmount'],
  currency: ['currency', 'currencyCode', 'currency_code'],
  stock: ['stock', 'stockNum', 'availableStock', 'quantity', 'inventory', 'skuStock', 'availableQty'],
  state: ['state', 'status', 'skuState', 'productState'],
  afsId: ['afsOrderId', 'afsId', 'serviceOrderId', 'id'],
  afsType: ['reverseType', 'afsType', 'type', 'serviceType'],
  afsStatus: ['afsStatus', 'status', 'orderStatus'],
  afsAmount: ['refundAmount', 'amount', 'refundFee', 'totalAmount'],
  afsTime: ['applyTime', 'createTime', 'afsCreateTime', 'orderTime'],
  shopId: ['shopId', 'venderId', 'vender_id', 'shop_id'],
  shopName: ['shopName', 'venderName', 'name', 'shop_name']
};

function pick(obj, alts, dflt) {
  if (!obj || typeof obj !== 'object') return dflt;
  for (const k of alts) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return dflt;
}
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[,\s¥$€£]/g, ''));
  return isNaN(n) ? 0 : n;
}
function toDateStr(v) {
  if (!v) return '';
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    const ms = String(n).length === 10 ? n * 1000 : n;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}

/* ------------------------------------------------------------------ *
 * 周口径：周六~周五为一周（与亚马逊看板一致），周号取周五所在 ISO 周
 * ------------------------------------------------------------------ */
function weekRangeOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  const dow = d.getDay();                 // 0=周日 … 6=周六
  const offsetToSat = (dow - 6 + 7) % 7;  // 距本周六的天数
  const start = new Date(d); start.setDate(d.getDate() - offsetToSat);
  const end = new Date(start); end.setDate(start.getDate() + 6); // 周五
  return { start: fmt(start), end: fmt(end), monday: new Date(start) };
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function isoWeekOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yStart) / 86400000 + 1) / 7);
}
function weekKey(dateStr) {
  const r = weekRangeOf(dateStr);
  if (!r) return '';
  return 'W' + isoWeekOf(r.end);
}
function weekLabel(dateStr) {
  const r = weekRangeOf(dateStr);
  if (!r) return '';
  return `${weekKey(dateStr)} (${r.start.slice(5)}~${r.end.slice(5)})`;
}

/* ------------------------------------------------------------------ *
 * probe / collect
 * ------------------------------------------------------------------ */
function ensureDirs() { if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true }); }

async function probe() {
  ensureDirs();
  const cfg = jb.loadConfig();
  const report = [];
  for (const [name, ep] of Object.entries(ENDPOINTS)) {
    const query = Object.assign({}, ep.baseQuery || {}, ep.page ? { page: 1, pageSize: 10 } : {});
    // listOrders 必填时间窗（毫秒，跨度 ≤ 3 个月）
    if (name === 'listOrders') {
      query.endTime = Date.now();
      query.startTime = Date.now() - 30 * 86400000;
    }
    // listSkuStocks 必填 skuIdList（逗号分隔，≤20 个）—— 先借一个真实 SKU 来探测
    if (name === 'listSkuStocks') {
      try {
        const pr = await jb.call('GET', ENDPOINTS.listProducts.path, { query: { shopId: SHOP_ID, page: 1, pageSize: 1 } });
        const sku = (((pr.data || [])[0] || {}).skus || [])[0];
        query.skuIdList = sku ? String(sku.skuId) : '';
      } catch (e) { /* 忽略，下面会报参数错 */ }
    }
    let res;
    try {
      res = await jb.call(ep.method, ep.path, { query });
    } catch (e) {
      report.push({ name, ok: false, error: e.message });
      console.log(`✗ ${name}  ${ep.method} ${ep.path} → ${e.message}`);
      continue;
    }
    fs.writeFileSync(path.join(RAW_DIR, `${name}.json`), JSON.stringify(res.raw, null, 2), 'utf-8');
    const errs = res.errors ? res.errors.map(e => `${e.code}:${String(e.message).slice(0, 90)}`).join(' / ') : '';
    report.push({ name, ok: res.ok, status: res.status, errors: errs });
    console.log(`${res.ok ? '✓' : '✗'} ${name}  ${ep.method} ${ep.path}  HTTP ${res.status}${errs ? '  ' + errs : ''}`);
    if (res.ok) console.log(`    data keys: ${Object.keys(res.data || {}).join(', ') || '(空)'}`);
  }
  console.log('\n原始响应已落盘: joybuy_raw/');
  return report;
}

/** 通用分页拉取：尝试多种分页参数命名，直到返回空页或达到上限 */
async function fetchAllPages(name, ep, extraQuery = {}, maxPages = 200) {
  const rows = [];
  const ps = ep.pageSize || 100;
  for (let page = 1; page <= maxPages; page++) {
    const query = Object.assign({}, ep.baseQuery || {}, { page, pageSize: ps }, extraQuery);
    let res;
    try { res = await jb.call(ep.method, ep.path, { query }); } catch (e) { break; }
    if (!res.ok) { if (page === 1) throw new Error(`${name} 调用失败: ${JSON.stringify(res.errors || res.raw).slice(0, 300)}`); break; }
    const list = extractList(res.data);
    if (!list.length) break;
    rows.push(...list);
    if (list.length < ps) break;
  }
  return rows;
}

/** 从响应 data 里找出列表数组（兼容 list/rows/records/items/data 等命名） */
function extractList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ['list', 'rows', 'records', 'items', 'data', 'resultList', 'orderList', 'content', 'datas']) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && typeof data[k] === 'object') {
      for (const k2 of ['list', 'rows', 'records', 'items']) if (Array.isArray(data[k][k2])) return data[k][k2];
    }
  }
  return [];
}

async function collect({ days = 90 } = {}) {
  ensureDirs();
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'joybuy-openapi',
    window: { days },
    shops: [], products: [], skus: [], stocks: [], orders: [], aftersales: [],
    warnings: []
  };

  // 1) 店铺
  try {
    const r = await jb.call('GET', ENDPOINTS.listVenderShops.path, { query: Object.assign({}, ENDPOINTS.listVenderShops.baseQuery || {}) });
    if (r.ok) out.shops = extractList(r.data).map(s => ({
      shopId: String(pick(s, ALIAS.shopId, '')),
      shopName: String(pick(s, ALIAS.shopName, ''))
    }));
    else out.warnings.push('listVenderShops: ' + JSON.stringify(r.errors || r.raw).slice(0, 200));
  } catch (e) { out.warnings.push('listVenderShops: ' + e.message); }

  // 2) 商品 / SKU
  for (const [name, key] of [['listProducts', 'products'], ['listSkus', 'skus']]) {
    try {
      const rows = await fetchAllPages(name, ENDPOINTS[name]);
      out[key] = rows;
      console.log(`✓ ${name}: ${rows.length} 条`);
    } catch (e) {
      out.warnings.push(`${name}: ${e.message}`);
      console.log(`✗ ${name}: ${e.message}`);
    }
  }

  // 2b) 库存：不是分页接口，必须用 skuIdList（逗号分隔，单次 ≤ 20）逐个批次查
  try {
    const skuIds = [...new Set((out.products || [])
      .flatMap(p => ((p && p.skus) || []).map(s => s && s.skuId))
      .filter(Boolean))];
    if (!skuIds.length) {
      console.log('– listSkuStocks: 无 SKU 可查，跳过');
    } else {
      const stocks = [];
      for (let i = 0; i < skuIds.length; i += 20) {
        const batch = skuIds.slice(i, i + 20);
        const r = await jb.call('GET', ENDPOINTS.listSkuStocks.path, {
          query: Object.assign({}, ENDPOINTS.listSkuStocks.baseQuery, { skuIdList: batch.join(',') })
        });
        if (r.ok) stocks.push(...extractList(r.data));
        else out.warnings.push('listSkuStocks 批次失败: ' + JSON.stringify(r.errors || r.raw).slice(0, 200));
      }
      out.stocks = stocks;
      console.log(`✓ listSkuStocks: ${stocks.length} 条（覆盖 ${skuIds.length} 个 SKU）`);
    }
  } catch (e) {
    out.warnings.push('listSkuStocks: ' + e.message);
    console.log(`✗ listSkuStocks: ${e.message}`);
  }

  // 3) 订单（近 N 天）
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 86400000);
    // listOrders 要毫秒时间戳；跨度不得 > 3 个月，超过则分段拉取
    const rows = [];
    const CHUNK = 80 * 86400000; // 80 天一块，安全落在 3 个月内
    for (let t = start.getTime(); t < end.getTime(); t += CHUNK) {
      const seg = await fetchAllPages('listOrders', ENDPOINTS.listOrders, {
        startTime: t, endTime: Math.min(t + CHUNK, end.getTime())
      });
      rows.push(...seg);
      if (seg.length) console.log(`   …订单分段 ${new Date(t).toISOString().slice(0, 10)} 起 ${seg.length} 条`);
    }
    out.orders = rows;
    console.log(`✓ listOrders: ${rows.length} 条（${fmt(start)} ~ ${fmt(end)}）`);
  } catch (e) {
    out.warnings.push('listOrders: ' + e.message);
    console.log(`✗ listOrders: ${e.message}`);
  }

  // 4) 售后
  try {
    const rows = await fetchAllPages('listAfsOrders', ENDPOINTS.listAfsOrders);
    out.aftersales = rows;
    console.log(`✓ listAfsOrders: ${rows.length} 条`);
  } catch (e) {
    out.warnings.push('listAfsOrders: ' + e.message);
    console.log(`✗ listAfsOrders: ${e.message}`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\n已写出 ${OUT_FILE}`);
  if (out.warnings.length) console.log('警告:\n - ' + out.warnings.join('\n - '));
  return out;
}

/** 打印已落盘原始数据的结构，辅助校准字段映射 */
function fields() {
  if (!fs.existsSync(RAW_DIR)) { console.log('还没有 joybuy_raw/，先跑 probe'); return; }
  for (const f of fs.readdirSync(RAW_DIR).filter(x => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    const list = extractList(j && j.data !== undefined ? j.data : j);
    const sample = list[0];
    console.log(`\n=== ${f}  (列表 ${list.length} 条) ===`);
    if (!sample) { console.log('  (无数据) path keys:', j && j.data ? Object.keys(j.data).join(',') : Object.keys(j || {}).join(',')); continue; }
    console.log('  字段:', Object.keys(sample).join(', '));
    console.log('  样例:', JSON.stringify(sample).slice(0, 600));
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
(async () => {
  const cmd = process.argv[2] || 'help';
  const opt = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (cmd === 'probe') return void await probe();
  if (cmd === 'collect') return void await collect({ days: Number(opt('days') || 90) });
  if (cmd === 'fields') return void fields();
  console.log(`JoyBuy 数据采集
  node fetch_joybuy_api.js probe                 逐接口试调，原始响应落 joybuy_raw/
  node fetch_joybuy_api.js fields                打印原始数据的字段结构（校准映射用）
  node fetch_joybuy_api.js collect [--days 90]   分页采集 → joybuy_api_data.json`);
})().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; });

module.exports = { ENDPOINTS, ALIAS, extractList, weekKey, weekLabel, weekRangeOf, toDateStr, num, pick, collect, probe };
