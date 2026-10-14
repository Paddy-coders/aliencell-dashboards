// probe_calib_drift.js — 只读探针：历史日期的数据「会不会变、会变多久」
//
// 背景（2026-09-24，用户指出）：每日复查的意义不只是「补空缺」，更在于**重新校准**——
//   已经采到的数据在上游也会发生变化（订单取消/退款/归因回填、易仓侧修正），
//   所以「有数据的日期」同样需要定期重拉核对。
//   当前 fetch_daily_data.js 只在最近 14 天做覆盖式刷新，14 天以外只有 incomplete 日期才复查。
//   本探针回答两个问题：
//     Q1. 14 天以外的历史日期，重拉结果与已存数据是否一致？（若不一致 → 需要扩大校准窗口）
//     Q2. 漂移能持续多久？（决定校准窗口该设多长）
//
// 做法：挑不同「年龄」的日期（15/18/21/25/28/35/45/60 天前），逐日重新查询易仓业务报告，
//   与 daily_data.json 已存行按 (date|asin|account) 逐键对比：
//     - 仅已存有 → 源已不再返回该行
//     - 仅新查有 → 源新增了行
//     - 两边都有但指标不同 → 数值被上游修改（真正的「校准」场景）
//   完全不写任何文件、不改数据库。
//
// 用法：
//   node probe_calib_drift.js                       # 默认测 15/18/21/25/28/35/45/60 天前
//   DRIFT_DATES=2026-09-09,2026-09-03 node probe_calib_drift.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const DATA_FILE = path.join(BASE_DIR, 'daily_data.json');
const CDP_PORT = process.env.CDP_PORT || '9223';
const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

const ALL_ACCOUNTS = [
  'Aliencell_Direct_BE', 'Aliencell_Direct_CA', 'Aliencell_Direct_DE', 'Aliencell_Direct_ES',
  'Aliencell_Direct_FR', 'Aliencell_Direct_IE', 'Aliencell_Direct_IT', 'Aliencell_Direct_MX',
  'Aliencell_Direct_NL', 'Aliencell_Direct_PL', 'Aliencell_Direct_SE', 'Aliencell_Direct_UK',
  'Aliencell_Direct_US',
];

// 对比的关键指标（字符串数字，需 Number 化）
const METRICS = ['sessions', 'total_order_items', 'ordered_product_sales_amount'];

function dstr(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// 北京时间今天
const now = new Date();
const today = new Date(now.getTime() + (480 + now.getTimezoneOffset()) * 60000);

const AGES = process.env.DRIFT_DATES
  ? null
  : [15, 18, 21, 25, 28, 35, 45, 60];
const DATES = process.env.DRIFT_DATES
  ? process.env.DRIFT_DATES.split(',').map(s => s.trim())
  : AGES.map(n => dstr(addDays(today, -n)));

const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const storedDays = stored.days || {};

const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const keyOf = r => `${r.date}|${r.asin}|${r.user_account || r.site}`;

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) if (p.url().includes('eccang.com') && !p.url().includes('/login')) page = page || p;
  }
  if (!page) { console.log('ERROR: 未找到已登录的易仓页面，请先跑 auto_login_eccang.js'); process.exit(1); }
  console.log('页面:', page.url().slice(0, 120));

  let frame = page.frames().find(f => f.url().includes('businessReportNew'));
  if (!frame) {
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(9000);
    // 先关掉可能遮挡的弹窗/遮罩，再切到销售 tab
    await page.evaluate(() => {
      const closeBtns = document.querySelectorAll('.home-ant-modal-close, .home-ant-btn-primary');
      closeBtns.forEach(b => { try { b.click(); } catch (e) {} });
      const tabs = document.querySelectorAll('.home-ant-tabs-tab');
      for (const t of tabs) if ((t.textContent || '').trim() === '销售') { t.click(); return; }
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const items = document.querySelectorAll('.entry-menus-item__title__main');
      for (const it of items) if ((it.textContent || '').trim() === '业务报告') { it.scrollIntoView({ block: 'center' }); it.click(); return; }
    });
    for (let i = 0; i < 15 && !frame; i++) { await page.waitForTimeout(2000); frame = page.frames().find(f => f.url().includes('businessReportNew')); }
  }
  if (!frame) { console.log('ERROR: 未进入业务报告 iframe'); await browser.close(); process.exit(1); }
  console.log('业务报告 frame 就绪\n');

  let CUR = DATES[0];
  let reqCount = 0;
  const freshRows = new Map();   // CUR -> Map(key -> row)

  await page.route('**/traffic/list', async (route) => {
    const req = route.request();
    try {
      if (req.method() === 'POST' && req.postData()) {
        const data = JSON.parse(req.postData());
        reqCount++;
        data.pageSize = 1000;
        data.date_start = CUR + ' 00:00:00';
        data.date_end = CUR + ' 23:59:59';
        data.user_account = ALL_ACCOUNTS;   // 与现网采集同形态（13 账号数组）
        data.page = 1;
        await route.continue({ postData: JSON.stringify(data) });
        return;
      }
    } catch (e) {}
    await route.continue();
  });

  const onResp = async (resp) => {
    if (!resp.url().includes('/traffic/list')) return;
    try {
      const j = JSON.parse(await resp.text());
      if (!j || !Array.isArray(j.data)) return;
      if (!freshRows.has(CUR)) freshRows.set(CUR, new Map());
      const m = freshRows.get(CUR);
      for (const r of j.data) {
        if (!r || r.date !== CUR || !r.asin) continue;   // 只收目标日的行（丢弃错位响应）
        m.set(keyOf(r), r);
      }
    } catch (e) {}
  };
  page.on('response', onResp);

  async function clickSearch() {
    return frame.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if ((b.textContent || '').replace(/\s/g, '') === '搜索') { b.click(); return true; }
      }
      return false;
    });
  }

  // 先确保 route 生效：先做一次搜索触发改写（结果丢弃）
  await clickSearch();
  await page.waitForTimeout(4000);

  for (const d of DATES) {
    CUR = d;
    freshRows.set(d, new Map());
    const ok = await clickSearch();
    if (!ok) { console.log(`[${d}] 未找到搜索按钮，跳过`); continue; }
    await page.waitForTimeout(11000);
    const n = freshRows.get(d).size;
    console.log(`  已查 ${d}  新结果 ${n} 行（已存 ${(storedDays[d]?.biz || []).length} 行）`);
  }
  page.off('response', onResp);
  await page.unroute('**/traffic/list');
  await browser.close();

  // ===== 对比 =====
  console.log('\n' + '='.repeat(78));
  console.log('历史数据漂移对比（新查 vs 已存，按 date|asin|account 逐键）');
  console.log('='.repeat(78));
  console.log('年龄  日期          已存行 新查行 | 仅已存 仅新查 数值改动 | 已存Sessions 新查Sessions');

  const summary = [];
  for (const d of DATES) {
    const fresh = freshRows.get(d) || new Map();
    const oldM = new Map();
    for (const r of (storedDays[d]?.biz || [])) if (r && r.date === d) oldM.set(keyOf(r), r);

    const onlyOld = [], onlyNew = [], changed = [];
    for (const [k, r] of oldM) if (!fresh.has(k)) onlyOld.push(r);
    for (const [k, r] of fresh) if (!oldM.has(k)) onlyNew.push(r);
    for (const [k, o] of oldM) {
      const f = fresh.get(k);
      if (!f) continue;
      const diffs = {};
      for (const m of METRICS) if (num(o[m]) !== num(f[m])) diffs[m] = [num(o[m]), num(f[m])];
      if (Object.keys(diffs).length) changed.push({ k, diffs });
    }
    const sumS = m => [...(m === 'old' ? oldM : fresh).values()].reduce((s, r) => s + num(r.sessions), 0);
    const ageDays = Math.round((today - new Date(d + 'T00:00:00')) / 86400000);
    const drift = onlyOld.length + onlyNew.length + changed.length > 0;
    console.log(
      `${String(ageDays).padStart(3)}d  ${d}   ${String(oldM.size).padStart(5)} ${String(fresh.size).padStart(5)} | ` +
      `${String(onlyOld.length).padStart(6)} ${String(onlyNew.length).padStart(6)} ${String(changed.length).padStart(8)} | ` +
      `${String(sumS('old')).padStart(12)} ${String(sumS('new')).padStart(12)}  ${drift ? '⚠ 有漂移' : '✓ 一致'}`
    );
    summary.push({ d, ageDays, oldN: oldM.size, newN: fresh.size, onlyOld: onlyOld.length, onlyNew: onlyNew.length, changed: changed.length });
    if (changed.length) {
      for (const c of changed.slice(0, 6)) console.log(`        · ${c.k}  ${JSON.stringify(c.diffs)}`);
      if (changed.length > 6) console.log(`        · ... 共 ${changed.length} 个键指标变动`);
    }
    if (onlyNew.length) console.log(`        + 新增示例: ${onlyNew.slice(0, 4).map(r => `${r.site}/${r.asin}`).join(', ')}`);
    if (onlyOld.length) console.log(`        - 消失示例: ${onlyOld.slice(0, 4).map(r => `${r.site}/${r.asin}`).join(', ')}`);
  }

  console.log('\n' + '='.repeat(78));
  const drifted = summary.filter(s => s.onlyOld + s.onlyNew + s.changed > 0);
  if (!drifted.length) {
    console.log('结论：所选历史日期重拉结果与已存完全一致 → 上游已不再变动这些日期。');
  } else {
    console.log(`结论：${drifted.length}/${summary.length} 个历史日期存在漂移；漂移最大年龄 = ${Math.max(...drifted.map(s => s.ageDays))} 天`);
    console.log('      漂移年龄分布: ' + drifted.map(s => s.ageDays + 'd').join(', '));
    console.log('      → 校准窗口应覆盖上述最大年龄（当前 14 天常规窗口不足以覆盖）。');
  }
  console.log('\n（探针只读：未修改任何本地文件、未写任何数据）');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
