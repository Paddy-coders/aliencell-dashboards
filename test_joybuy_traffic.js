/**
 * JoyBuy 流量报表导入器回归测试
 * 覆盖本项目历史上踩过的表头误匹配坑：多行表头、加购转化率 vs 加购件数、
 * 收藏率 vs 收藏数、曝光 vs 浏览量、退款金额 vs 销售额、父ASIN vs 子ASIN、日期带时间后缀。
 * 用法: node test_joybuy_traffic.js   （有 FAIL 时退出码 1）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('./xlsx.full.min.js');
const imp = require('./import_joybuy_traffic');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jbtr-'));
let pass = 0, fail = 0;
const fails = [];
// xlsx.full.min.js 是浏览器 UMD 构建，Node 下没有绑定 fs，writeFile 会失败 → 自己落盘
function LXSX_writeFile(wb, file) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(file, buf);
}
function chk(name, ok, detail) {
  if (ok) pass++; else { fail++; fails.push(name); }
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail === undefined ? '' : detail}`);
}

/* ---------- 用例 1：官方风格多行表头 + 干扰列 ---------- */
const headerEn = ['Date', 'childAsin', 'Product Title', 'Visitors', 'Page Views', 'Impressions', 'Add to Cart', 'Add to Cart Rate', 'Favorites', 'Favorite Rate', 'Orders', 'Sales Amount', 'Refund Amount'];
const headerZh = ['报告日期', '子ASIN', '商品名称', '访客数', '浏览量', '曝光量', '加购件数', '加购转化率', '收藏数', '收藏率', '订单量', '销售额', '退款金额'];
const data = [
  ['2026-09-01 00:00:00', 'JB-001', '测试商品A', 120, 430, 9800, 9, '0.075', 5, '0.0416', 7, '199.00', '12.00'],
  ['2026-09-02', 'JB-001', '测试商品A', 100, 380, 8100, 6, '0.06', 3, '0.03', 5, '150.50', '0'],
  ['2026-09-02', 'JB-002', '测试商品B', 30, 90, 2200, 2, '0.0667', 1, '0.0333', 1, '49.90', '0'],
  ['', '', '', '', '', '', '', '', '', '', '', '', ''], // 空行
  ['2026-09-03', '', '汇总行', 250, 900, 20100, 17, '0.068', 9, '0.036', 13, '399.40', '12.00']
];
const f1 = path.join(TMP, 'report1.xlsx');
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['商品每日流量表现'], headerEn, headerZh, ...data]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  LXSX_writeFile(wb, f1);
}
const r1 = imp.importFile(f1, { granularity: 'day' });
chk('识别表头行位置（标题行后）', r1.headerRow === 2, '实际 headerRow=' + r1.headerRow);
chk('数据行数（空行跳过，含无SKU汇总行）', r1.rows.length === 4, '实际 ' + r1.rows.length);
chk('加购件数不被「加购转化率」抢走', r1.rows[0].addToCart === 9, 'addToCart=' + r1.rows[0].addToCart);
chk('收藏数不被「收藏率」抢走', r1.rows[0].favorites === 5, 'favorites=' + r1.rows[0].favorites);
chk('浏览量不被「曝光量」抢走', r1.rows[0].pv === 430, 'pv=' + r1.rows[0].pv);
chk('访客数正确', r1.rows[0].uv === 120, 'uv=' + r1.rows[0].uv);
chk('销售额不被「退款金额」抢走', r1.rows[0].sales === 199, 'sales=' + r1.rows[0].sales);
chk('日期带时间后缀可解析', r1.rows[0].date === '2026-09-01', r1.rows[0].date);
chk('SKU 取自「子ASIN」列', r1.rows[0].sku === 'JB-001', r1.rows[0].sku);
chk('缺失列清单不含 date/sku', !r1.missing.includes('date') && !r1.missing.includes('sku'), JSON.stringify(r1.missing));

/* ---------- 用例 2：中文单行表头 + 千分位 ---------- */
const f2 = path.join(TMP, 'report2.csv');
fs.writeFileSync(f2, '\ufeff' + [
  '统计日期,商品SKU,商品名称,访客数,浏览量,加购人数,收藏人数,订单数,成交金额',
  '2026-09-05,JB-003,商品C,"1,204","5,600","21","13","44","12,300.50"',
  '2026/09/06,JB-003,商品C,900,4100,15,9,30,8800'
].join('\n'), 'utf8');
const r2 = imp.importFile(f2, { granularity: 'day' });
chk('CSV 解析行数', r2.rows.length === 2, '实际 ' + r2.rows.length);
chk('千分位金额解析正确', r2.rows[0].sales === 12300.5, 'sales=' + r2.rows[0].sales);
chk('千分位访客数解析正确', r2.rows[0].uv === 1204, 'uv=' + r2.rows[0].uv);
chk('斜杠日期 2026/09/06 可解析', r2.rows[1].date === '2026-09-06', r2.rows[1].date);
chk('加购人数识别', r2.rows[0].addToCart === 21, 'addToCart=' + r2.rows[0].addToCart);

/* ---------- 用例 3：无日期列应明确报错 ---------- */
const f3 = path.join(TMP, 'bad.csv');
fs.writeFileSync(f3, 'SKU,访客数,浏览量\nJB-001,10,20\n', 'utf8');
let threw = '';
try { imp.importFile(f3); } catch (e) { threw = e.message; }
chk('无日期列时抛出可读错误', /日期/.test(threw), threw.slice(0, 80));

/* ---------- 用例 4：全 0 且无 SKU 的行被跳过 ---------- */
const f4 = path.join(TMP, 'zero.csv');
fs.writeFileSync(f4, '\ufeff日期,SKU,访客数,浏览量,加购件数,收藏数\n2026-09-07,,,,,\n2026-09-08,JB-009,5,12,1,0\n', 'utf8');
const r4 = imp.importFile(f4);
chk('全 0 无 SKU 行跳过', r4.rows.length === 1 && r4.rows[0].sku === 'JB-009', 'rows=' + r4.rows.length);

/* ---------- 用例 5：表头识别函数正负样本 ---------- */
chk('looksHeaderRow 命中中文表头', imp.looksHeaderRow(['日期', 'SKU', '访客数', '浏览量']) === true);
chk('looksHeaderRow 对数据行返回 false', imp.looksHeaderRow(['2026-09-01', 'JB-001', '10', '20']) === false);
chk('looksHeaderRow 对空行返回 false', imp.looksHeaderRow(['', '', '']) === false);

/* ---------- 用例 6：模板可生成且能被自己导入（闭环） ---------- */
const tpl = imp.writeTemplate();
const r6 = imp.importFile(tpl);
chk('模板可被自身导入器解析', r6.rows.length === 1, 'rows=' + r6.rows.length);
chk('模板示例行字段正确', r6.rows[0].sku === 'JB-SKU-001' && r6.rows[0].addToCart === 9 && r6.rows[0].favorites === 5,
  JSON.stringify(r6.rows[0]));

/* ---------- 收尾 ---------- */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
