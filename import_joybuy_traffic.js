/**
 * JoyBuy 商家后台「流量报表」导入器
 *
 * 背景：开放平台 SP-API 只有 Aftersales/Vender/Product/Order 五组，**没有**流量/加购/收藏接口
 *      （已用 dsm.jdo.open.cms.api4home.listApiGroup 实测确认）。这三类指标只能从
 *      JoyBuy 商家后台(seller.joybuy.com)的业务报表导出，再导入本系统。
 *
 * 用法：
 *   node import_joybuy_traffic.js <报表文件.xlsx|.csv> [--granularity day|week|month] [--merge]
 *   node import_joybuy_traffic.js --template            生成导入模板 CSV
 *
 * 输出：joybuy_traffic_data.json
 *   { generatedAt, granularity, rows:[{date|start|end, sku, name, uv, pv, addToCart, favorites, orders, sales}] }
 *
 * 表头识别：容错多行表头（标题行 + 中文/英文表头行），精确匹配优先、再包含匹配，并带黑名单防误匹配。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('./xlsx.full.min.js');

const OUT = path.join(__dirname, 'joybuy_traffic_data.json');

/* 字段定义：aliases 精确/包含匹配，not 为黑名单（命中即排除） */
const FIELDS = [
  { key: 'date', aliases: ['日期', '统计日期', '报告日期', 'date', 'day', '时间'], not: ['周', '月', 'week', 'month'], type: 'date' },
  { key: 'sku', aliases: ['sku', '子asin', 'childasin', '子sku', '商sku', '商品sku', '产品sku', '商品编码', '产品编码', '商品id'], not: ['父', 'parent', '名称', 'name', '标题'], type: 'text' },
  { key: 'name', aliases: ['商品名称', '产品名称', '商品标题', 'productname', 'title', '名称'], not: ['店铺', 'shop', 'sku'], type: 'text' },
  { key: 'uv', aliases: ['访客数', '独立访客', '访客', 'uv', 'visitors', 'uniquevisitors'], not: ['浏览量', 'pv', '加购', '收藏', '订单'], type: 'num' },
  { key: 'pv', aliases: ['浏览量', '商品浏览量', '页面浏览量', 'pv', 'pageviews', 'views'], not: ['访客', 'uv', '曝光', 'impression', '千次'], type: 'num' },
  { key: 'addToCart', aliases: ['加购件数', '加购人数', '加购数', '加购', 'addtocart', 'addcart', 'cartadd', '加购物车'], not: ['加购转化', '率', 'rate'], type: 'num' },
  { key: 'favorites', aliases: ['收藏数', '收藏人数', '商品收藏', '收藏量', '收藏', 'favorites', 'favourite', 'wishlist', 'collect'], not: ['率', 'rate', '取消'], type: 'num' },
  { key: 'orders', aliases: ['订单量', '订单数', '支付订单', 'orders', 'ordercount', 'ordernum'], not: ['金额', '销售额', 'amount', 'sales', '取消'], type: 'num' },
  { key: 'sales', aliases: ['销售额', '成交金额', '支付金额', '商品销售额', 'sales', 'salesamount', 'gmv', 'revenue', 'amount'], not: ['退款', 'refund', '广告', 'ad', '率', 'rate'], type: 'num' }
];

function norm(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/\s|\u3000/g, '')
    .replace(/[（）()【】\[\]：:%％]/g, '')
    .toLowerCase();
}
function numOf(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[,\s¥$€£%]/g, ''));
  return isNaN(n) ? 0 : n;
}
function parseDate(v) {
  if (v === undefined || v === null || v === '') return '';
  if (v instanceof Date) {
    const d = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && XLSX.SSF) {
    try { const o = XLSX.SSF.parse_date_code(v); if (o) return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`; } catch (e) { }
  }
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) { const n = Number(s); return new Date(s.length === 10 ? n * 1000 : n).toISOString().slice(0, 10); }
  const m = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const ym = s.match(/^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*月?$/);
  if (ym) return `${ym[1]}-${String(ym[2]).padStart(2, '0')}-01`;
  return '';
}

/** 是否是表头行：非空单元格 >=3 且命中 >=2 个字段名，且不含可解析日期 */
function looksHeaderRow(row) {
  const cells = row.filter(c => c !== '' && c !== undefined && c !== null);
  if (cells.length < 3) return false;
  if (cells.some(c => parseDate(c))) return false;
  let hit = 0;
  for (const c of cells) {
    const t = norm(c);
    if (!t) continue;
    for (const f of FIELDS) if (f.aliases.some(a => t === norm(a) || t.includes(norm(a)))) { hit++; break; }
  }
  return hit >= 2;
}

/** 精确优先 + 包含匹配 + 黑名单 */
function matchFields(headerTexts) {
  const map = {};
  const used = new Set();
  // 第一轮：全等
  headerTexts.forEach((raw, idx) => {
    const t = norm(raw);
    if (!t) return;
    for (const f of FIELDS) {
      if (map[f.key] !== undefined) continue;
      if (f.not && f.not.some(n => t.includes(norm(n)))) continue;
      if (f.aliases.some(a => t === norm(a))) { map[f.key] = idx; used.add(idx); return; }
    }
  });
  // 第二轮：包含
  headerTexts.forEach((raw, idx) => {
    const t = norm(raw);
    if (!t || used.has(idx)) return;
    for (const f of FIELDS) {
      if (map[f.key] !== undefined) continue;
      if (f.not && f.not.some(n => t.includes(norm(n)))) continue;
      if (f.aliases.some(a => t.includes(norm(a)))) { map[f.key] = idx; used.add(idx); return; }
    }
  });
  return map;
}

function readSheet(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true, raw: false });
  const name = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: true });
  return { sheet: name, rows };
}

/** 兼容 CSV：直接按 RFC4180 简单解析（无引号场景足够；有引号场景交给 XLSX） */
function readAny(file) {
  if (/\.csv$/i.test(file)) {
    const wb = XLSX.read(fs.readFileSync(file, 'utf8'), { type: 'string', raw: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false });
    return { sheet: wb.SheetNames[0], rows };
  }
  return readSheet(file);
}

function importFile(file, { granularity = 'day' } = {}) {
  const { sheet, rows } = readAny(file);
  // 定位表头块（可能多行：标题行 + 英文表头 + 中文表头），合并同一列的多行文本
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (looksHeaderRow(rows[i])) { headerRowIdx = i; break; }
  }
  if (headerRowIdx < 0) throw new Error('未能识别表头行。请确认报表含「日期 / SKU / 访客数 / 浏览量 / 加购 / 收藏」等列名（前 15 行内）。');

  // 表头块：如果下一行也是表头行，则视为同一表头的第二语言行
  const headerBlock = [rows[headerRowIdx]];
  let dataStart = headerRowIdx + 1;
  if (rows[dataStart] && looksHeaderRow(rows[dataStart])) { headerBlock.push(rows[dataStart]); dataStart++; }

  const width = Math.max(...headerBlock.map(r => r.length));
  const colTexts = [];
  for (let c = 0; c < width; c++) {
    colTexts.push(headerBlock.map(r => (r[c] === undefined ? '' : r[c])).join(' ').trim());
  }
  const map = matchFields(colTexts);
  const missing = FIELDS.filter(f => f.key !== 'name' && map[f.key] === undefined).map(f => f.key);
  if (map.date === undefined) throw new Error('表头未识别到「日期」列。识别到的列：' + colTexts.filter(Boolean).join(' | '));

  const get = (row, key) => { const i = map[key]; return i === undefined ? '' : row[i]; };
  const out = [];
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some(c => c !== '' && c !== null && c !== undefined)) continue;
    const date = parseDate(get(row, 'date'));
    if (!date) continue;
    const sku = String(get(row, 'sku') || '').trim();
    const rec = {
      date, sku,
      name: String(get(row, 'name') || '').trim(),
      uv: numOf(get(row, 'uv')),
      pv: numOf(get(row, 'pv')),
      addToCart: numOf(get(row, 'addToCart')),
      favorites: numOf(get(row, 'favorites')),
      orders: numOf(get(row, 'orders')),
      sales: numOf(get(row, 'sales'))
    };
    // 全 0 行且无 SKU → 视为空行跳过
    if (!sku && !rec.uv && !rec.pv && !rec.addToCart && !rec.favorites && !rec.orders && !rec.sales) continue;
    out.push(rec);
  }
  return { sheet, granularity, headerRow: headerRowIdx + 1, matched: map, missing, rows: out };
}

function writeTemplate() {
  const head = ['日期', 'SKU', '商品名称', '访客数', '浏览量', '加购件数', '收藏数', '订单量', '销售额'];
  const sample = ['2026-09-01', 'JB-SKU-001', '示例商品', '120', '430', '9', '5', '7', '199.00'];
  const csv = '\ufeff' + head.join(',') + '\n' + sample.join(',') + '\n';
  const f = path.join(__dirname, 'JoyBuy流量报表导入模板.csv');
  fs.writeFileSync(f, csv, 'utf8');
  console.log('模板已生成: ' + f);
  return f;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  if (!args.length || args.includes('--help')) {
    console.log(`JoyBuy 流量报表导入
  node import_joybuy_traffic.js <文件.xlsx|.csv> [--granularity day|week|month] [--merge]
  node import_joybuy_traffic.js --template       生成导入模板 CSV`);
    process.exit(0);
  }
  if (args.includes('--template')) { writeTemplate(); process.exit(0); }
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('缺少报表文件路径'); process.exit(1); }
  try {
    const r = importFile(file, { granularity: opt('granularity') || 'day' });
    let payload = { generatedAt: new Date().toISOString(), granularity: r.granularity, sourceFile: path.basename(file), rows: r.rows };
    if (args.includes('--merge') && fs.existsSync(OUT)) {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      const keyOf = x => `${x.date}|${x.sku}`;
      const m = new Map((prev.rows || []).map(x => [keyOf(x), x]));
      r.rows.forEach(x => m.set(keyOf(x), x));      // 同键覆盖取最新
      payload.rows = [...m.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.sku < b.sku ? -1 : 1));
      payload.mergedFrom = prev.sourceFile || '';
    }
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✓ 识别表头位于第 ${r.headerRow} 行，列映射: ${JSON.stringify(r.matched)}`);
    if (r.missing.length) console.log(`⚠ 未识别到的列（将记 0）: ${r.missing.join(', ')}`);
    console.log(`✓ 解析 ${r.rows.length} 行 → ${OUT}`);
    console.log('  日期范围: ' + (r.rows.length ? `${r.rows[0].date} ~ ${r.rows[r.rows.length - 1].date}` : '(空)'));
    const distinct = new Set(r.rows.map(x => x.sku).filter(Boolean));
    console.log(`  SKU 数: ${distinct.size}`);
  } catch (e) {
    console.error('导入失败: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { importFile, matchFields, looksHeaderRow, parseDate, numOf, writeTemplate, FIELDS, OUT };
