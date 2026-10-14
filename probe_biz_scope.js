// probe_biz_scope.js — 只读探针：查清「易仓业务报告里某天到底有没有某账号的数据」
//
// 背景（2026-09-24）：daily_data.json 里 9/22 只有 EU 站点 15 行、**完全没有 US 行**（而
//   9/17~9/21 每天都有 11~19 行 US），9/23、9/24 全 0 行。需要区分两种可能：
//     A. 源头还没出数（易仓尚未同步 US 店铺的业务报告）→ 属数据延迟，采集没问题
//     B. 采集只拿到了「半截响应」（响应只含部分账号，却被当成权威结果确认）
//   本探针不改任何文件、不写库，只发查询并把响应按 日期×站点×账号 打出来。
//
// 用法：
//   PROBE_FROM=2026-09-21 PROBE_TO=2026-09-24 node probe_biz_scope.js
//   PROBE_ACCOUNTS=US node probe_biz_scope.js    # 只用 US 账号查（验证单个账号是否真没数据）
//   PROBE_ACCOUNTS=all node probe_biz_scope.js   # 全部 13 个账号（默认）

const { chromium } = require('playwright');

const CDP_PORT = process.env.CDP_PORT || '9223';
const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

const ALL_ACCOUNTS = [
  'Aliencell_Direct_BE', 'Aliencell_Direct_CA', 'Aliencell_Direct_DE', 'Aliencell_Direct_ES',
  'Aliencell_Direct_FR', 'Aliencell_Direct_IE', 'Aliencell_Direct_IT', 'Aliencell_Direct_MX',
  'Aliencell_Direct_NL', 'Aliencell_Direct_PL', 'Aliencell_Direct_SE', 'Aliencell_Direct_UK',
  'Aliencell_Direct_US',
];

const FROM = process.env.PROBE_FROM || '2026-09-21';
const TO = process.env.PROBE_TO || FROM;
const MODE = (process.env.PROBE_ACCOUNTS || 'all').toLowerCase();
const KEEP_ACCOUNTS = MODE === 'keep';           // 不改写账号，用页面自身默认筛选（最贴近真实口径）
const ACCOUNTS = MODE === 'all' ? ALL_ACCOUNTS
  : MODE.split(',').map(s => s.trim()).map(s => /^[A-Z]{2}$/.test(s) ? `Aliencell_Direct_${s}` : s);

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) if (p.url().includes('eccang.com') && !p.url().includes('/login')) page = page || p;
  }
  if (!page) { console.log('ERROR: 未找到已登录的易仓页面，请先跑 auto_login_eccang.js'); process.exit(1); }
  console.log('页面:', page.url().slice(0, 120));
  console.log(`查询范围 ${FROM} ~ ${TO}，账号筛选 = ${KEEP_ACCOUNTS ? 'keep（用页面自身默认）' : MODE + ' (' + ACCOUNTS.length + ' 个)'}`);

  // 确保停在业务报告页
  let frame = page.frames().find(f => f.url().includes('businessReportNew'));
  if (!frame) {
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(9000);
    await page.evaluate(() => {
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
  console.log('业务报告 frame 就绪');

  let reqCount = 0;
  const allRows = new Map();          // key -> row
  const responses = [];               // 每次响应的摘要

  await page.route('**/traffic/list', async (route) => {
    const req = route.request();
    try {
      if (req.method() === 'POST' && req.postData()) {
        const data = JSON.parse(req.postData());
        reqCount++;
        if (reqCount === 1) {
          // 打印页面自身发出的原始请求体（看清 user_account 的真实格式 / 日期字段名）
          const dump = JSON.parse(JSON.stringify(data));
          if (typeof dump.user_account === 'object') dump.user_account = JSON.stringify(dump.user_account);
          console.log('  [原始请求体]', JSON.stringify(dump).slice(0, 900));
        }
        const origAcc = Array.isArray(data.user_account) ? data.user_account.length : typeof data.user_account;
        data.pageSize = 1000;
        data.date_start = FROM + ' 00:00:00';
        data.date_end = TO + ' 23:59:59';
        if (!KEEP_ACCOUNTS) data.user_account = ACCOUNTS;
        data.page = 1;
        if (reqCount <= 2) {
          console.log(`  [请求 ${reqCount}] 原始 user_account=${JSON.stringify(origAcc)} → ${KEEP_ACCOUNTS ? '保持页面原样' : '改写为 ' + ACCOUNTS.length + ' 个账号'}; 日期 ${data.date_start} ~ ${data.date_end}`);
        }
        await route.continue({ postData: JSON.stringify(data) });
        return;
      }
    } catch (e) {}
    await route.continue();
  });

  const pending = new Set();
  const onResp = async (resp) => {
    if (!resp.url().includes('/traffic/list')) return;
    try {
      const j = JSON.parse(await resp.text());
      if (!j || !Array.isArray(j.data)) return;
      const rows = j.data;
      pending.add(resp);
      responses.push({
        n: rows.length,
        total: j.total ?? j.totalNum ?? j.count ?? null,
        dates: [...new Set(rows.map(r => r.date))].sort(),
      });
      for (const r of rows) {
        if (!r || !r.date || !r.asin) continue;
        allRows.set(`${r.date}|${r.asin}|${r.user_account || r.site}`, r);
      }
    } catch (e) {}
  };
  page.on('response', onResp);

  // 点搜索
  const clicked = await frame.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if ((b.textContent || '').replace(/\s/g, '') === '搜索') { b.click(); return true; }
    }
    return false;
  });
  console.log('点击搜索:', clicked);
  await page.waitForTimeout(15000);   // 留足时间接收（可能分多批返回）

  console.log('\n=== 响应批次数 ===', responses.length);
  responses.forEach((r, i) => console.log(`  批 ${i + 1}: 返回 ${r.n} 行, 接口 total=${r.total}, 覆盖日期=${r.dates.join(',')}`));

  const rows = [...allRows.values()];
  console.log('\n=== 汇总（去重后）===', rows.length, '行');
  const byDate = {};
  for (const r of rows) {
    byDate[r.date] = byDate[r.date] || { sites: {}, accounts: {}, n: 0 };
    byDate[r.date].n++;
    byDate[r.date].sites[r.site] = (byDate[r.date].sites[r.site] || 0) + 1;
    byDate[r.date].accounts[r.user_account] = (byDate[r.date].accounts[r.user_account] || 0) + 1;
  }
  for (const d of Object.keys(byDate).sort()) {
    const v = byDate[d];
    console.log(`  ${d}  行=${v.n}`);
    console.log(`     站点: ${JSON.stringify(v.sites)}`);
    console.log(`     账号: ${JSON.stringify(v.accounts)}`);
  }
  const usRows = rows.filter(r => r.user_account === 'Aliencell_Direct_US' || r.site === 'US');
  console.log(`\n=== US 相关行数: ${usRows.length} ===`);
  for (const r of usRows.slice(0, 5)) {
    console.log('   ', r.date, r.site, r.asin, 'sessions=' + r.sessions, 'sales=' + r.ordered_product_sales_amount);
  }

  page.off('response', onResp);
  await page.unroute('**/traffic/list');
  await browser.close();
  console.log('\n（探针只读：未修改任何本地文件、未写任何数据）');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
