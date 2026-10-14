/* 从利润计算器提取官方 MCF 费率卡 → mcf_rate_card.json
 *
 * 为什么这样取：计算器里的 MCF_RATES 是当初从亚马逊官方费率卡 PDF（MCF-EU-2026.pdf /
 * MCF-UK.pdf）+ Seller Central 帮助页提取、并带四道自检生成的，是本地唯一权威副本。
 * 与其重新抄一遍费率（抄错一个数就是静默错值），不如从源头原样搬过来，并做等价性自检。
 *
 * 用法：node gen_mcf_rate_card.js [计算器目录] [输出文件]
 */
const fs = require('fs');
const path = require('path');

const CALC = process.argv[2] || 'C:/Users/paddy/WorkBuddy/2026-10-08-10-47-30';
const OUT = process.argv[3] || 'mcf_rate_card.json';

const html = fs.readFileSync(path.join(CALC, 'profit-calculator.html'), 'utf8');

// 括号配对取 var MCF_RATES = {...};
const i0 = html.indexOf('var MCF_RATES');
if (i0 < 0) throw new Error('未找到 MCF_RATES');
const b0 = html.indexOf('{', i0);
let depth = 0, end = -1, inStr = false, esc = false;
for (let i = b0; i < html.length; i++) {
  const c = html[i];
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
  if (c === '"') { inStr = true; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error('MCF_RATES 括号不闭合');
const RATES = new Function('return (' + html.slice(b0, end) + ')')();

/* ---------- 自检（与计算器 gen_mcf_embed.js 的口径一致） ---------- */
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(RATES.eu.dimDivisor === 5000, 'EU 体积重除数应为 5000');
ok(RATES.eu.unit === 'g', 'EU 单位应为 g');
ok(RATES.euFuelPct === 1.5, 'EU 燃油附加应为 1.5%');

const tierBands = RATES.eu.tierDefs.reduce((a, d) => a.concat(d.w), []);
ok(tierBands.length === 30, `EU 分档总数应为 30，实为 ${tierBands.length}`);
['DE', 'FR', 'IT', 'ES', 'UK', 'DE_Z1', 'DE_Z2', 'DE_Z3'].forEach((k) => {
  ok(Array.isArray(RATES.eu.std[k]) && RATES.eu.std[k].length === 30,
    `eu.std.${k} 应 30 档，实为 ${(RATES.eu.std[k] || []).length}`);
});
ok(JSON.stringify(RATES.eu.deZoneOf) === JSON.stringify({ FR: 'Z2', IT: 'Z2', ES: 'Z3', DE: 'DOM', NL: 'Z1' }),
  'deZoneOf 与业务口径不符');
ok(!!RATES.us && !!RATES.us.tiers && Object.keys(RATES.us.tiers).length === 8,
  'US 尺寸分段数应为 8：' + (RATES.us ? Object.keys(RATES.us.tiers || {}).join(',') : 'none'));
ok(!!RATES.peakFrom && !!RATES.peakTo, 'US 旺季窗口缺失');

/* 单调性：**同一分段内**费率不随重量档下降。
   ⚠ 不能对 30 档平铺数组整体做单调检查 —— small_parcel 的最后一档（3900g）比
     std_parcel 的第一档（150g）贵，跨分段必然下降，那是官方表结构不是错误。 */
{
  let at = 0;
  RATES.eu.tierDefs.forEach((def) => {
    const arr = [];
    def.w.forEach((bandG) => { arr.push({ bandG: bandG, fee: RATES.eu.std.DE[at++] }); });
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].fee < arr[i - 1].fee - 1e-9) {
        ok(false, `DE ${def.key} 内 ${arr[i].bandG}g(${arr[i].fee}) < ${arr[i - 1].bandG}g(${arr[i - 1].fee})`);
      }
    }
  });
  ok(at === 30, 'EU 30 档索引未走满，实际走了 ' + at);
}
/* 分段门槛：nested（小分段的上限不应大于大分段的对应上限）—— 保证「从小到大找第一个满足」的语义成立 */
{
  const seq = RATES.eu.tierDefs;
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1], cur = seq[i];
    if (cur.maxW < prev.maxW - 1e-9) {
      ok(false, `${cur.key}.maxW(${cur.maxW}) < ${prev.key}.maxW(${prev.maxW})：分段顺序不单调，会让大货误判进小档`);
    }
  }
}
console.log('US 分段：' + Object.keys(RATES.us.tiers).join(' / '));

if (fails.length) {
  console.error('❌ MCF 费率卡自检未通过：');
  fails.forEach((f) => console.error('   - ' + f));
  process.exit(1);
}

const out = {
  _src: 'Amazon Multi-Channel Fulfilment 官方费率卡（经 profit-calculator.html 的 MCF_RATES 提取）',
  _extractedFrom: path.join(CALC, 'profit-calculator.html').replace(/\\/g, '/'),
  _extractedAt: new Date().toISOString().slice(0, 10),
  _tierBandsFlat: tierBands,
  rates: RATES
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('✅ 自检通过，已写出 ' + OUT + '（' + fs.statSync(OUT).size + ' B）');
console.log('   EU 生效 ' + RATES.euEff + ' · 燃油 ' + RATES.euFuelPct + '% · 30 档 × 8 列');
