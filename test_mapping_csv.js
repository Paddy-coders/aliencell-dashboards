// 产品关系管理(mapping.html) CSV 导出回归测试
// 覆盖: 按钮存在 / 导出内容与转义 / 导出→导入回环无损 / 未匹配导出 / 空数据提示 / 旧粘贴格式向后兼容
// 运行: node test_mapping_csv.js         (本地 http.server 8899, 需从 _deploy 启动)
//       BASE=https://xxx.app.workbuddy.host node test_mapping_csv.js   (线上)
const { chromium } = require('./playwright-auth');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const URL_MAP = BASE + '/mapping.html';

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 300) : '')); }
};

// ---- Node 侧 RFC4180 解析(校验导出是否合法 CSV) ----
function parseCsv(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

const CAT = [
  { series: 'X1', name: 'X1主机' },
  { series: 'X1', name: '含逗号,产品名' },
  { series: 'X1', name: '含"双引号"产品名' },
  { series: 'X2', name: '多行\n产品名' },
  { series: 'E1', name: '普通产品' },
];
const MAP = [
  { asin: 'B0TEST00001', series: 'X1', name: 'X1主机', country: 'US' },
  { asin: 'B0TEST00002', series: 'X1', name: 'X1主机', country: 'EU' },
  { asin: 'B0TEST00003', series: '无', name: '无', country: 'EU' },
  { asin: 'B0TEST00004', series: '无', name: '无', country: 'US' },
  { asin: 'B0TEST00005', series: 'E1', name: '含逗号,产品名', country: 'CA' },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1680, height: 950 } });
  const page = await ctx.newPage();

  // 拦截 Supabase: 测试不得读写云端映射数据, 也避免云端数据干扰断言
  await page.route('**/*.supabase.co/**', r => r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  await page.goto(URL_MAP, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);   // 等 seed() 的异步预填充结束, 避免覆盖注入的测试数据

  // ---------- 1. 按钮存在 ----------
  const btns = await page.evaluate(() => {
    const txt = [...document.querySelectorAll('.card-title button')].map(b => b.textContent.trim());
    return { all: txt, hasCatCsv: txt.includes('⬇️ 导出 CSV'), hasAsinCsv: txt.includes('⬇️ 导出 CSV'), hasUnmatched: txt.includes('⬇️ 导出未匹配') };
  });
  t('产品目录/ASIN 卡片存在「⬇️ 导出 CSV」按钮', btns.hasCatCsv && btns.hasAsinCsv, btns.all);
  t('ASIN 卡片存在「⬇️ 导出未匹配」按钮', btns.hasUnmatched, btns.all);

  // ---------- 注入测试数据(不落盘不推云端) ----------
  await page.evaluate(({ CAT, MAP }) => {
    catalog = CAT.map(o => ({ ...o }));
    asinMap = MAP.map(o => ({ ...o }));
    renderAll();
  }, { CAT, MAP });

  // ---------- 2. 产品目录 CSV ----------
  async function grab(fnExpr) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 12000 }),
      page.evaluate(fnExpr),
    ]);
    const p = await dl.path();
    return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
  }

  const cat = await grab(() => exportCatalogCsv());
  t('目录导出文件名含「产品目录」+ 日期', /^产品目录_\d{8}\.csv$/.test(cat.name), cat.name);
  t('CSV 带 UTF-8 BOM(Excel 中文不乱码)', cat.text.charCodeAt(0) === 0xFEFF, cat.text.slice(0, 3));
  const catRows = parseCsv(cat.text);
  t('表头 = 产品系列,产品名', JSON.stringify(catRows[0]) === JSON.stringify(['产品系列', '产品名']), catRows[0]);
  t('目录行数 = 数据 5 条 + 表头', catRows.length === CAT.length + 1, catRows.length);
  t('每行 2 列(含逗号/引号字段未错列)', catRows.slice(1).every(r => r.length === 2), catRows.slice(1).filter(r => r.length !== 2));
  const catSet = new Set(catRows.slice(1).map(r => r[0] + '|' + r[1]));
  const catWant = new Set(CAT.map(o => o.series + '|' + o.name));
  t('导出内容与目录数据完全一致', catSet.size === catWant.size && [...catWant].every(k => catSet.has(k)), { got: [...catSet], want: [...catWant] });
  t('含逗号字段被引号包裹', cat.text.includes('"含逗号,产品名"'));
  t('含引号字段按 CSV 规则转义(双写)', cat.text.includes('"含""双引号""产品名"'));
  t('含换行字段被引号包裹', /"多行\n产品名"/.test(cat.text));

  // ---------- 3. 回环: 导出的 CSV 再导入应无损 ----------
  const rt = await page.evaluate((csvText) => {
    catalog = [];
    document.getElementById('cText').value = csvText;
    importCatalogFromText();
    return { n: catalog.length, items: catalog.map(p => p.series + '|' + p.name).sort() };
  }, cat.text);
  t('回环导入: 条数一致(5)', rt.n === CAT.length, rt.n);
  const rtWant = CAT.map(o => o.series + '|' + o.name).sort();
  t('回环导入: 含逗号/引号/换行的名称无损还原', JSON.stringify(rt.items) === JSON.stringify(rtWant), { got: rt.items, want: rtWant });

  // ---------- 4. ASIN 匹配 CSV ----------
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(({ CAT, MAP }) => { catalog = CAT.map(o => ({ ...o })); asinMap = MAP.map(o => ({ ...o })); renderAll(); }, { CAT, MAP });

  const asinAll = await grab(() => exportAsinCsv(false));
  t('ASIN 导出文件名含「ASIN映射」', /^ASIN映射_\d{8}\.csv$/.test(asinAll.name), asinAll.name);
  const asinRows = parseCsv(asinAll.text);
  t('ASIN 表头 = ASIN,产品系列,产品名,国家', JSON.stringify(asinRows[0]) === JSON.stringify(['ASIN', '产品系列', '产品名', '国家']), asinRows[0]);
  t('ASIN 行数 = 5 条 + 表头，均 4 列', asinRows.length === MAP.length + 1 && asinRows.slice(1).every(r => r.length === 4), asinRows.length);
  const asinSet = new Set(asinRows.slice(1).map(r => r.join('|')));
  t('ASIN 内容与匹配数据一致', MAP.every(m => asinSet.has([m.asin, m.series, m.name, m.country].join('|'))), [...asinSet]);
  t('ASIN 导出按 国家→系列→ASIN 排序', asinRows[1][3] === 'CA' && asinRows[asinRows.length - 1][3] === 'US', asinRows.slice(1).map(r => r[3]));

  const asinUn = await grab(() => exportAsinCsv(true));
  const unRows = parseCsv(asinUn.text);
  t('未匹配导出文件名含「ASIN未匹配」', /^ASIN未匹配_\d{8}\.csv$/.test(asinUn.name), asinUn.name);
  t('未匹配仅含 series/name = 无 的 2 条', unRows.length === 3 && unRows.slice(1).every(r => r[1] === '无' && r[2] === '无'), unRows);

  // ---------- 5. 三个看板通用: 空数据/全匹配 不产生下载 ----------
  async function noDownload(fnExpr) {
    let got = false;
    const h = () => { got = true; };
    page.on('download', h);
    await page.evaluate(fnExpr);
    await page.waitForTimeout(700);
    page.off('download', h);
    return got;
  }
  t('目录为空时导出: 不下载(仅提示)', !(await noDownload(() => { catalog = []; exportCatalogCsv(); })));
  t('全部已匹配时「导出未匹配」: 不下载(仅提示)', !(await noDownload(() => { asinMap = asinMap.filter(m => m.series !== '无'); exportAsinCsv(true); })));

  // ---------- 6. 旧粘贴格式向后兼容 ----------
  const compat = await page.evaluate(() => {
    const cases = {
      comma: '产品系列,产品名\nX9,产品A\nX9,产品B',
      tab: '产品系列\t产品名\nX8\t产品C',
      cnComma: '产品系列，产品名\nX7，产品D',
      noHeader: 'X6,支架E',   // 注意: 若数据行含「产品/系列/名称」字样会被既有表头识别规则当作表头(旧行为, 未改动)
      bom: '\uFEFF产品系列,产品名\nX5,产品F',
      singleQuoted: "产品系列,产品名\n'X4','产品G'",
      quotedWithSep: '产品系列,产品名\n"X3","含,逗号的产品"',
    };
    const out = {};
    for (const [k, v] of Object.entries(cases)) {
      catalog = [];
      document.getElementById('cText').value = v;
      importCatalogFromText();
      out[k] = catalog.map(p => p.series + '|' + p.name);
    }
    return out;
  });
  t('兼容: 逗号分隔 + 表头', JSON.stringify(compat.comma) === JSON.stringify(['X9|产品A', 'X9|产品B']), compat.comma);
  t('兼容: 制表符分隔', JSON.stringify(compat.tab) === JSON.stringify(['X8|产品C']), compat.tab);
  t('兼容: 中文逗号分隔', JSON.stringify(compat.cnComma) === JSON.stringify(['X7|产品D']), compat.cnComma);
  t('兼容: 无表头两列', JSON.stringify(compat.noHeader) === JSON.stringify(['X6|支架E']), compat.noHeader);
  t('兼容: 带 BOM 的 Excel 导出 CSV', JSON.stringify(compat.bom) === JSON.stringify(['X5|产品F']), compat.bom);
  t('兼容: 单引号包裹字段(旧格式)', JSON.stringify(compat.singleQuoted) === JSON.stringify(['X4|产品G']), compat.singleQuoted);
  t('兼容: 引号包裹且含逗号的字段(RFC4180)', JSON.stringify(compat.quotedWithSep) === JSON.stringify(['X3|含,逗号的产品']), compat.quotedWithSep);

  // ---------- 7. 无页面错误 ----------
  t('全程无 JS 页面错误', errs.length === 0, errs);

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
