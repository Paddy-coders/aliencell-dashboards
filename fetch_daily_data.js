// 每日数据采集脚本: 业务报告(日粒度) + 广告数据(按天) 
// 使用方式: node fetch_daily_data.js (需先运行 auto_login_eccang.js 确保 Edge 9223 已登录易仓)
// 强制全量回填: FULL_BACKFILL=1 node fetch_daily_data.js (探测最早数据日期并重拉全部历史)
// 
// 【逻辑】
// 1. 以北京时间日期为准, 计算"今天"
// 2. 抓取范围（2026-09-24 修订：复查 = 补空缺 + 重新校准）:
//    - ① 热区(近14天): 每次运行全量重拉（即原口径"每天往前倒推14天复查覆盖"）
//    - ② 空缺日: 标记为 incomplete / 全天无数据的日期无条件复查（近 CALIB_DAYS 天内，不占轮转名额）
//    - ③ 温区(15~60天): 轮转校准 —— 每次取"最久未被校准"的 CALIB_PER_RUN 天，逐日推进覆盖
//       因为上游会改数（广告花费因无效流量下调、销售额因归因回填后补），
//       已采到的日期同样需要定期重拉核对；实测 46 天前仍有花费被下调 1.2%。
//    - 中断补拉: 若数据文件最后日期早于今天(中间漏跑), 从最后日期+1 补到今天
//    - 首次运行(无数据文件或 FULL_BACKFILL=1): 探测业务报表最早有数据的日期(最多回溯400天), 从该日回填到今天
// 3. 业务报告: 逐天查询(date_start/date_end = 当天), 接口 /traffic/list 返回行自带 date 字段 → 按 date 分组
// 4. 广告数据: ProductAd.GetFlatViewList 的 Report 是日期范围汇总(无日期字段), 必须逐天请求 → 13国 × 天数(同日13国并发)
// 5. 输出 daily_data.json: { generatedAt, days: { 'YYYY-MM-DD': { biz: [], ads: {US:[],...}, lastChecked } },
//    pendingDays, calibration: { hotDays, warmDays, pendingRechecked, checked, changed[], staleRemoved[] } }
//    合并策略: 按日期覆盖, 保留更早的历史日期(环比计算需要前一周同日);
//    每天记录 lastChecked（温区轮转依据）; calibration.changed 记录本次重算后数值确有变化的日期（上游改数可见）
// 6. 环境变量: HOT_DAYS(14) / CALIB_DAYS(60) / CALIB_PER_RUN(6) / STALE_STRIKES(3) / BACKFILL_FROM / FULL_BACKFILL
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const OUT_FILE = path.join(BASE_DIR, 'daily_data.json');

// 全部国家账号(与易仓业务报告账号下拉一致)
const ALL_ACCOUNTS = [
  'Aliencell_Direct_BE','Aliencell_Direct_CA','Aliencell_Direct_DE','Aliencell_Direct_ES',
  'Aliencell_Direct_FR','Aliencell_Direct_IE','Aliencell_Direct_IT','Aliencell_Direct_MX',
  'Aliencell_Direct_NL','Aliencell_Direct_PL','Aliencell_Direct_SE','Aliencell_Direct_UK','Aliencell_Direct_US'
];

// 广告站点参数
const STORES = {
  US: { storeSiteId: 586024, storeId: 174011, marketSiteId: 1 },
  BE: { storeSiteId: 586021, storeId: 174010, marketSiteId: 21 },
  CA: { storeSiteId: 586025, storeId: 174011, marketSiteId: 3 },
  DE: { storeSiteId: 586013, storeId: 174010, marketSiteId: 6 },
  ES: { storeSiteId: 586017, storeId: 174010, marketSiteId: 8 },
  FR: { storeSiteId: 586016, storeId: 174010, marketSiteId: 9 },
  IE: { storeSiteId: 586022, storeId: 174010, marketSiteId: 22 },
  IT: { storeSiteId: 586015, storeId: 174010, marketSiteId: 12 },
  MX: { storeSiteId: 586023, storeId: 174010, marketSiteId: 2 },
  NL: { storeSiteId: 586018, storeId: 174010, marketSiteId: 13 },
  PL: { storeSiteId: 586020, storeId: 174010, marketSiteId: 19 },
  SE: { storeSiteId: 586019, storeId: 174010, marketSiteId: 20 },
  UK: { storeSiteId: 586014, storeId: 174010, marketSiteId: 10 },
};

const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';
const CDP_PORT = process.env.CDP_PORT || '9223';

// ---------- 复查 / 校准口径（2026-09-24 修订）----------
// 关键认识：复查不只是「把空缺的补上」，更要「把已经采到的重新校准」——
//   上游数据本身会变：广告的花费会因无效流量扣减而下调、销售额会因归因回填后补
//   （实测 daily_data.json.bak-20260831 vs 当前：8/30 的 US 销售额 0 → 3497.99；
//     8/02~8/28 多天花费被小幅下调 0.2~6.6；跨度达 29 天仍有修正），
//   而业务报告 session/订单/销售额实测 16~61 天完全稳定（探针 probe_calib_drift.js 验过）。
//   所以「有数据的日期」同样要定期重拉核对，不能只在缺数时才查。
// 分三层：
//   ① 热区（近 HOT_DAYS 天）：每次运行**全量重拉**（即用户原口径「每天往前倒推 14 天复查覆盖」）
//   ② 空缺日（incomplete / 全天无数据）：无条件复查，不占轮转名额
//   ③ 温区（HOT_DAYS ~ CALIB_DAYS 天）：**轮转校准**，每次取「最久没被校准的」CALIB_PER_RUN 天
//      温区共 CALIB_DAYS-HOT_DAYS 天，按默认参数约每 8 天可把整个温区覆盖一轮
//   窗口定 60 天依据（2026-09-24 实测 probe_ads_scope.js 按年龄分层采样）：
//     46 天前的 08-09 花费仍被下调 746.17→737.31（-1.2%）、点击 -3；
//     而 54/60/74/90 天的样本金额完全一致 → 修正集中在 60 天内，再往前的历史可视为稳定。
const HOT_DAYS = Number(process.env.HOT_DAYS || 14);
const CALIB_DAYS = Number(process.env.CALIB_DAYS || 60);
const CALIB_PER_RUN = Number(process.env.CALIB_PER_RUN || 6);
// 某行在连续 N 次「权威响应」中都不被源返回 → 判定源已删除该行，同步移除（防止旧行永久残留使合计偏高）
// 仅在该日数据完整（未标 incomplete）时累计，避免源同步延迟期间误删
const STALE_STRIKES = Number(process.env.STALE_STRIKES || 3);

// ---------- 北京时间日期工具 ----------
function fmtCN(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayCN() {
  // 显式按北京时间计算(避免本机时区偏差)
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000; // 本机UTC偏移
  const beijing = new Date(now.getTime() + (480 + now.getTimezoneOffset()) * 60000);
  return beijing;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function dateRange(start, end) {
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(fmtCN(d));
  return out;
}
// 数值化（接口返回多为字符串，含千分位）
function num(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
const round2 = x => Math.round(x * 100) / 100;

// ---------- 主流程 ----------
(async () => {
  const today = todayCN();
  const todayStr = fmtCN(today);
  // ---- 计算本次抓取日期范围 ----
  // 常规: 最近14天(用户口径: 每天刷新当前阶段往前推的14天)
  // 中断补拉: 若数据文件最后日期早于今天(中间漏跑), 从最后日期+1 补到今天
  // 首次: 无数据文件 → 探测业务报表最早有数据的日期, 从该日回填到今天(历史全量累积)
  let days = [];
  let firstRun = false;
  let prevDays = {};
  let hotDays = [];      // 热区：本次全量重拉的日期
  let warmDays = [];     // 温区：本次轮转校准到的日期
  let pendingDays = [];  // 空缺日：无条件复查
  if (process.env.BACKFILL_FROM) {
    // 指定起始日期回填: BACKFILL_FROM=2026-06-23 node fetch_daily_data.js
    // 用于历史数据漏采/接口当时未返回数据的日期, 从指定日期回填到今天(业务+广告)
    days = dateRange(process.env.BACKFILL_FROM, today);
    hotDays = days.slice();
    console.log(`[${fmtCN(today)}] 指定回填 ${days.length} 天: ${days[0]} ~ ${days[days.length - 1]} (BACKFILL_FROM)`);
  } else if (fs.existsSync(OUT_FILE) && process.env.FULL_BACKFILL !== '1') {
    try { prevDays = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).days || {}; } catch (e) { prevDays = {}; }
    const keys = Object.keys(prevDays).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (keys.length >= 14) {
      const gapStart = addDays(parseDate(keys[keys.length - 1]), 1); // 中断漏跑补拉起点
      const normalStart = addDays(today, -13);                        // 常规14天起点
      const start = gapStart < normalStart ? gapStart : normalStart;
      hotDays = dateRange(start, today);
    } else {
      hotDays = dateRange(addDays(today, -13), today); // 数据不足14天 → 先拉最近14天
    }
    days = hotDays.slice();
    console.log(`[${fmtCN(today)}] ① 热区全量重拉 ${hotDays.length} 天: ${hotDays[0]} ~ ${hotDays[hotDays.length - 1]}`);

    // ---- ② 空缺日复查（2026-09-24 新增）----
    // 由来: 易仓业务报告**按店铺同步**，会出现「US 还没出数、EU 已出」的部分延迟
    //   （实测 9/22 只有 EU 15 行、完全没有 US；9/23~9/24 全 0 行）。
    //   只靠 14 天窗口不够：某天若长期不完整，14 天后会被移出窗口 → 永久缺数。
    //   故：近 CALIB_DAYS 天内被标记 incomplete/无数据的日期，每次运行都无条件复查（不占轮转名额）。
    pendingDays = Object.keys(prevDays)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .filter(d => {
        const v = prevDays[d] || {};
        const bad = !(Array.isArray(v.biz) && v.biz.length) || (Array.isArray(v.incomplete) && v.incomplete.length);
        return bad && (today - parseDate(d)) <= CALIB_DAYS * 86400000;
      })
      .filter(d => !days.includes(d))
      .sort();
    if (pendingDays.length) {
      days = [...new Set([...days, ...pendingDays])].sort();
      console.log(`  ↳ ② 空缺日复查 ${pendingDays.length} 天(近${CALIB_DAYS}天): ${pendingDays.join(', ')}`);
    }

    // ---- ③ 温区轮转校准（2026-09-24 新增）----
    // 为何需要: 数据不只是「缺了要补」，**已经采到的也会被上游改动** —— 广告花费因无效流量扣减下调、
    //   销售额因归因回填后补（实测 8/30 US 销售额 0 → 3497.99，多天花费被改 0.2~6.6，跨度达 29 天；
    //   详见 probe_calib_drift.js / compare_ads_drift.py）。所以有数据的日期同样要定期重拉核对。
    // 怎么选: 热区以外、CALIB_DAYS 以内，按「最久未被校准」（lastChecked 升序，无记录视为最久）取
    //   CALIB_PER_RUN 天。温区共 CALIB_DAYS-HOT_DAYS 天，默认参数下一轮约 (CALIB_DAYS-HOT_DAYS)/CALIB_PER_RUN 天。
    if (CALIB_PER_RUN > 0) {
      const warmPool = Object.keys(prevDays)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .filter(d => !days.includes(d))
        .filter(d => {
          const age = (today - parseDate(d)) / 86400000;
          return age >= 0 && age <= CALIB_DAYS;
        })
        .sort((a, b) => {
          const la = (prevDays[a] && prevDays[a].lastChecked) || '';
          const lb = (prevDays[b] && prevDays[b].lastChecked) || '';
          if (la !== lb) return la < lb ? -1 : 1;   // 最久没校准的优先
          return a < b ? -1 : 1;                     // 同优先级 → 更早的日期先校准
        });
      warmDays = warmPool.slice(0, CALIB_PER_RUN).sort();
      if (warmDays.length) {
        days = [...new Set([...days, ...warmDays])].sort();
        console.log(`  ↳ ③ 温区轮转校准 ${warmDays.length}/${warmPool.length} 天(15~${CALIB_DAYS}天): ${warmDays.join(', ')}`);
        console.log(`     温区最久未校准者优先；按此速度约 ${Math.ceil(warmPool.length / CALIB_PER_RUN)} 天覆盖温区一轮`);
      }
    }
  } else {
    firstRun = true; // 无数据文件 或 强制全量回填 → 探测最早日期后全量回填
  }

  // 连接 Edge(9223, 由 auto_login_eccang.js 启动并登录)
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  } catch (e) {
    console.log('ERROR: 无法连接 Edge。请先运行 node auto_login_eccang.js 自动启动Edge并登录易仓。');
    process.exit(1);
  }

  let page = null;
  // 优先复用已登录的易仓页面（不在 /login 的页面）
  const allEccangPages = [];
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes('eccang.com')) allEccangPages.push(p);
    }
  }
  page = allEccangPages.find(p => !p.url().includes('/login')) || allEccangPages[0];
  if (!page) {
    const ctx0 = browser.contexts()[0] || await browser.newContext();
    page = await ctx0.newPage();
  }
  if (page.url().includes('/login')) {
    // 尝试导航到入口页，利用已写入 profile 的 cookie 恢复会话
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto 警告:', e.message));
    await page.waitForTimeout(6000);
  }
  if (page.url().includes('/login')) {
    console.log('ERROR: 未登录易仓。请先运行 auto_login_eccang.js 完成自动登录。');
    await browser.close(); process.exit(1);
  }
  console.log('当前URL:', page.url().slice(0, 120));

  // ---------- 1. 业务报告 ----------
  async function ensureBusinessReportFrame(pg) {
    for (const f of pg.frames()) {
      if (f.url().includes('businessReportNew')) return f;
    }
    console.log('未在业务报告页, 自动导航...');
    await pg.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err:', e.message));
    await pg.waitForTimeout(9000);
    // 先尝试关闭"版本更新"等弹窗/遮罩（版本更新 tab 激活时其内容会覆盖销售 tab）
    await pg.evaluate(() => {
      // 关闭弹窗：找关闭/确定按钮
      const closeBtns = document.querySelectorAll('.home-ant-modal-close, .home-ant-btn-primary, button');
      for (const b of closeBtns) {
        const t = (b.textContent || '').trim();
        if (t === '知道了' || t === '确定' || t === '关闭' || t === '×') { b.click(); break; }
      }
    }).catch(() => {});
    await pg.waitForTimeout(1500);
    // 用 JS evaluate 直接点击"销售" tab（绕过 Playwright 覆盖层检测）
    const clickedSale = await pg.evaluate(() => {
      const tabs = document.querySelectorAll('.home-ant-tabs-tab');
      for (const tab of tabs) {
        if ((tab.textContent || '').trim() === '销售') {
          tab.click();
          return true;
        }
      }
      return false;
    });
    console.log('  点击"销售":', clickedSale);
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => {
      const items = document.querySelectorAll('.entry-menus-item__title__main');
      for (const item of items) {
        if ((item.textContent || '').trim() === '业务报告') {
          item.scrollIntoView({ behavior: 'instant', block: 'center' });
          item.click();
          return true;
        }
      }
      return false;
    });
    console.log('  已点击"业务报告"');
    await pg.waitForTimeout(4000);
    for (let i = 0; i < 15; i++) {
      const f2 = pg.frames().find(f => f.url().includes('businessReportNew'));
      if (f2) { console.log('  业务报告iframe已加载'); return f2; }
      await pg.waitForTimeout(2000);
    }
    throw new Error('等待业务报告页面超时');
  }

  const reportFrame = await ensureBusinessReportFrame(page);
  console.log('业务报告frame:', reportFrame.url().slice(0, 130));

  // route 拦截: 注入全部账号 + 当前循环日期的日期范围(逐天查询, 避免长范围返回被截断)
  let bizStart = '';
  let bizEnd = '';
  let lastRewriteFor = '';   // 最近一次被改写请求所对应的查询日(用于校验空响应)
  await page.route('**/traffic/list', async (route) => {
    const req = route.request();
    try {
      if (req.method() === 'POST' && req.postData()) {
        const data = JSON.parse(req.postData());
        data.pageSize = 1000;
        data.user_account = ALL_ACCOUNTS;
        data.date_start = bizStart;
        data.date_end = bizEnd;
        lastRewriteFor = bizStart.slice(0, 10);
        await route.continue({ postData: JSON.stringify(data) });
        return;
      }
    } catch (e) {}
    await route.continue();
  });

  async function clickSearch() {
    const clicked = await reportFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        const t = (b.textContent || '').replace(/\s/g, '');
        if (t === '搜索') { b.click(); return true; }
      }
      return false;
    });
    return clicked;
  }

  // ---- 业务报告数据存储(防错位设计) ----
  // primaryByDate: 逐日确认查询的结果(权威); extraByDate: 错误范围响应中按行内 date 归位出来的行(仅补缺)
  // 背景 bug(2026-08-31 发现): 页面残留周筛选时, 未被改写的旧响应先返回, 整周数据被塞进逐日键导致月度重复计数
  const primaryByDate = new Map();  // d -> Map(key -> row)
  const extraByDate = new Map();    // d -> Map(key -> row)
  const confirmedDays = new Set();  // 已获得"确认响应"的日期(含确认空)
  const queriedDays = new Set();    // 已查询过的日期(探测阶段缓存复用)
  const rowKey = r => `${r.date}|${r.asin}|${r.user_account || r.site}`;

  function absorbRows(rows, d) {
    // 按行内 date 归位: 当日行进 primary, 其余日期行进 extra
    for (const r of rows) {
      const rd = r && r.date;
      if (!rd || !/^\d{4}-\d{2}-\d{2}$/.test(rd) || !r.asin) continue;
      const store = rd === d ? primaryByDate : extraByDate;
      if (!store.has(rd)) store.set(rd, new Map());
      store.get(rd).set(rowKey(r), r);
    }
  }

  function captureBiz(d) {
    return new Promise((resolve) => {
      let done = false;
      const onResponse = async (resp) => {
        if (done || !resp.url().includes('/traffic/list')) return;
        try {
          const body = await resp.text();
          const j = JSON.parse(body);
          if (j && Array.isArray(j.data)) {
            const rows = j.data;
            const hasTarget = rows.some(r => r && r.date === d);
            if (hasTarget) {
              // 目标日的响应(无论是否夹带其他日期) → 确认
              absorbRows(rows, d);
              done = true; page.off('response', onResponse); resolve(true);
            } else if (rows.length === 0 && lastRewriteFor === d) {
              // 空响应且确实发出过以 d 为范围的改写请求 → 确认该日无数据
              if (!primaryByDate.has(d)) primaryByDate.set(d, new Map());
              done = true; page.off('response', onResponse); resolve(true);
            } else {
              // 错误日期范围的响应(页面残留筛选) → 行按真实日期归位进 extra, 继续等待正确响应
              absorbRows(rows, d);
              console.log(`  [${d}] 忽略错位响应(行内日期: ${[...new Set(rows.map(r => r.date))].join(',')}), 继续等待...`);
            }
          }
        } catch (e) {}
      };
      page.on('response', onResponse);
      setTimeout(() => {
        if (!done) { done = true; page.off('response', onResponse); resolve(false); }
      }, 25000);
      setTimeout(() => {
        clickSearch().then(ok => { if (!ok) console.log('  警告: 未找到"搜索"按钮'); });
      }, 300);
    });
  }

  // 逐天查询业务报告(避免长日期范围被接口截断)
  function primaryRows(d) {
    const m = primaryByDate.get(d);
    return m ? [...m.values()] : [];
  }
  async function querySingleBizDay(d) {
    if (queriedDays.has(d)) return primaryRows(d); // 探测阶段已缓存, 复用
    queriedDays.add(d);
    bizStart = d + ' 00:00:00';
    bizEnd = d + ' 23:59:59';
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      ok = await captureBiz(d);
      if (!ok) console.log(`  [${d}] 业务报告第${attempt}次未捕获目标响应,重试...`);
    }
    if (ok) {
      confirmedDays.add(d);
    } else {
      console.log(`  [${d}] ⚠️ 3次重试均未确认, 保留该日原有数据不覆盖`);
    }
    console.log(`[业务 ${d}] ${primaryRows(d).length} 行${ok ? '' : '(未确认)'}`);
    return primaryRows(d);
  }

  if (firstRun) {
    // 首次运行: 探测业务报表最早有数据的日期, 从该日回填到今天
    console.log('首次运行: 探测业务报表最早数据日期(最多回溯400天)...');
    const MAX_BACK = 400;
    let probeHas = null, probeNo = null; // probeHas=有数据的探测点(较近), probeNo=最近无数据的探测点(较远)
    for (let back = MAX_BACK; back >= 30; back -= 30) {
      const p = addDays(today, -back);
      const rows = await querySingleBizDay(fmtCN(p));
      if (rows.length > 0) { probeHas = p; break; }
      probeNo = p;
    }
    let scanStart, scanEnd;
    if (probeHas) {
      scanStart = probeNo ? addDays(probeNo, 1) : addDays(today, -MAX_BACK);
      scanEnd = probeHas;
    } else {
      scanStart = addDays(today, -30); // 400天内都无数据, 保守从最近30天开始
      scanEnd = today;
    }
    // 精扫: 从旧到新找最早有数据的日期
    let earliest = null;
    for (let d = scanStart; d <= scanEnd; d = addDays(d, 1)) {
      const rows = await querySingleBizDay(fmtCN(d));
      if (rows.length > 0) { earliest = d; break; }
    }
    if (!earliest) earliest = addDays(today, -30); // 兜底
    // 回填 earliest..today (探测/精扫已查的日期自动命中缓存)
    for (let d = earliest; d <= today; d = addDays(d, 1)) await querySingleBizDay(fmtCN(d));
    days = dateRange(earliest, today);
    hotDays = days.slice();   // 首次/全量回填：全部视作本次重拉范围
    console.log(`[探测完成] 最早有业务数据的日期: ${fmtCN(earliest)}, 本次回填 ${days.length} 天`);
  } else {
    for (const d of days) await querySingleBizDay(d);
  }
  await page.unroute('**/traffic/list');

  // ---------- 2. 广告数据 (逐天) ----------
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('ERROR: 未获取到 token'); await browser.close(); process.exit(1); }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const ctx = browser.contexts()[0];
  async function callAPI(actionType, body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: body, timeout: 30000
      });
      return { status: resp.status(), text: await resp.text() };
    } catch (e) { return { status: 'ERR', text: 'ERROR: ' + e.message }; }
  }

  const makeBody = (store, dateRange) => ({
    RequestDate: requestDate,
    Content: {
      Attributes: [
        "Asin","Sku","AdGroupID","CampaignID","CampaignID_Str","Name","State","IsTotal",
        "Report.Impressions","Report.Clicks","Report.Cost","Report.Orders","Report.SalesAmount",
        "Report.ClickRate","Report.OrdersRate","Report.CPC","Report.ACoS",
        "CampaignName","AdGroupName","PortfolioName","CampaignType"
      ],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: dateRange ? { Report: { ReportDate: [dateRange, dateRange] } } : {},
      Sorter: {}
    },
    StoreSiteID: store.storeSiteId, StoreID: store.storeId, MarketSiteID: store.marketSiteId,
    UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  });

  const adsByDate = {};
  const adsFailByDate = {}; // d -> Set(失败国家): 失败时保留旧数据不覆盖
  for (const d of days) {
    adsByDate[d] = {};
    adsFailByDate[d] = new Set();
    // 同日13国并发请求, 长回填时显著提速
    const results = await Promise.all(Object.entries(STORES).map(async ([country, store]) => {
      const r = await callAPI('ProductAd.GetFlatViewList', makeBody(store, d));
      try {
        const j = JSON.parse(r.text);
        return [country, (j.data?.Items || []).filter(it => !it.IsTotal)];
      } catch (e) {
        console.log(`  [${country}] ${d} FAIL ${String(r.text).substring(0, 80)}`);
        return [country, null];
      }
    }));
    for (const [country, items] of results) {
      if (items === null) adsFailByDate[d].add(country);
      else adsByDate[d][country] = items;
    }
    if (days.length > 14 && (days.indexOf(d) + 1) % 5 === 0) {
      const bizN = primaryRows(d).length;
      const adN = Object.values(adsByDate[d]).reduce((s, v) => s + (v || []).length, 0);
      console.log(`  进度 ${days.indexOf(d) + 1}/${days.length}: ${d} 业务${bizN}行 广告${adN}items`);
    }
  }
  await browser.close();

  // ---------- 3. 应用 ASIN→产品映射 (product_map.json) ----------
  // 每天记录一次映射快照到数据文件, 供看板与后续周度看板使用; 未匹配的 ASIN 默认归属「无」
  const MAP_FILE = path.join(BASE_DIR, 'product_map.json');
  const asinMeta = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      const m = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
      (m.asinMap || []).forEach(x => { if (x && x.asin) asinMeta[x.asin] = { series: x.series || '无', name: x.name || '无' }; });
      console.log(`[映射] product_map.json 已应用, ${Object.keys(asinMeta).length} 个 ASIN 匹配`);
    } catch (e) {
      console.log('警告: product_map.json 解析失败, 本次不应用 ASIN 映射');
    }
  } else {
    console.log('[映射] 未找到 product_map.json, 本次不应用 ASIN 映射 (可手动创建: {"catalog":[],"asinMap":[]})');
  }

  // ---------- 4. 合并保存 ----------
  let existing = {};
  if (fs.existsSync(OUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      if (prev && prev.days) existing = prev.days;
    } catch (e) { console.log('警告: 原数据文件解析失败, 以本次为准'); }
  }
  // 把旧数据里的 biz 行按行内 date 重新归位(修复历史错位污染), 去重合并
  const oldByKey = new Map(); // date|asin|account -> row
  for (const dk of Object.keys(existing)) {
    const bizList = existing[dk] && existing[dk].biz;
    if (!Array.isArray(bizList)) continue;
    for (const r of bizList) {
      const rd = r && r.date;
      if (!rd || !/^\d{4}-\d{2}-\d{2}$/.test(rd) || !r.asin) continue;
      const k = rowKey(r);
      oldByKey.set(k, r); // 后读入者(存储键更晚=采集更晚)优先
    }
  }
  function mergeOldInto(primaryMap, d) {
    // 用旧数据补 primaryMap 缺失的键(仅确认日使用; 未确认日旧数据整体保留)
    if (!primaryMap) return null;
    for (const [k, r] of oldByKey) {
      if (k.startsWith(d + '|') && !primaryMap.has(k)) primaryMap.set(k, r);
    }
    return primaryMap;
  }
  const daySet = new Set(days);

  // ---------- 3.5 完整性判定（2026-09-24 新增） ----------
  // 目的: 源数据延迟时（某店铺还没同步），不能把"少了一半的行"当成正常结果静默入板。
  // 判据: 用历史「好日子」（有数据且未被标记不完整）算**每个站点的中位行数**；
  //       中位数 >= 5 行的站点才算"主力店铺"（实测命中 US，自动排除 DE/FR/IT/CA/MX/NL/SE 这类小体量站点，
  //       它们偶尔某天 0 行属正常，不算缺失 → 避免假告警）。
  //       近端日期（HOT_DAYS 内）若主力店铺行数 < 中位数的 30%，或整天空 → 记 incomplete 并纳入长期复查。
  //       ⚠️ 该基线只用于近端日期：历史日期的业务量本就少（见循环内"口径修正"注释），套用会误报。
  const baselineDays = Object.keys(existing)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !(existing[d].incomplete || []).length)
    .filter(d => Array.isArray(existing[d].biz) && existing[d].biz.length > 0)
    .sort().slice(-14);
  const siteCounts = new Map();   // site -> [每日行数]
  for (const d of baselineDays) {
    const perSite = new Map();
    for (const r of existing[d].biz) perSite.set(r.site, (perSite.get(r.site) || 0) + 1);
    for (const [s, n] of perSite) {
      if (!siteCounts.has(s)) siteCounts.set(s, []);
      siteCounts.get(s).push(n);
    }
    for (const s of siteCounts.keys()) if (!perSite.has(s)) siteCounts.get(s).push(0);
  }
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const SITE_MEDIAN = new Map([...siteCounts].map(([s, arr]) => [s, median(arr)]));
  const MAIN_SITES = [...SITE_MEDIAN].filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]);
  console.log(`[完整性基线] 参考 ${baselineDays.length} 天; 主力店铺=${MAIN_SITES.map(([s, m]) => `${s}(中位${m}行)`).join(', ') || '(无)'}`);
  const incompleteNotes = [];
  const changeNotes = [];   // 本次重新校准后数值确实变了的日期（供看板/汇报）
  const staleNotes = [];    // 因源侧已删除而移除的旧行（连续 STALE_STRIKES 次不返回）

  // 一天的「数值指纹」：重新校准前后各算一次，不同即证明上游改过数
  function daySig(day) {
    const s = { rows: 0, sessions: 0, orders: 0, sales: 0, adItems: 0, adCost: 0, adSales: 0 };
    for (const r of (day.biz || [])) {
      s.rows++;
      s.sessions += num(r.sessions);
      s.orders += num(r.total_order_items);
      s.sales += num(r.ordered_product_sales_amount);
    }
    for (const v of Object.values(day.ads || {})) {
      for (const i of (v || [])) {
        s.adItems++;
        const rp = i.Report || {};
        s.adCost += num(rp.Cost);
        s.adSales += num(rp.SalesAmount);
      }
    }
    s.sessions = round2(s.sessions); s.orders = round2(s.orders); s.sales = round2(s.sales);
    s.adCost = round2(s.adCost); s.adSales = round2(s.adSales);
    return s;
  }
  const SIG_KEYS = ['rows', 'sessions', 'orders', 'sales', 'adItems', 'adCost', 'adSales'];
  function sigDiffs(a, b) {
    const out = {};
    for (const k of SIG_KEYS) if (a[k] !== b[k]) out[k] = [a[k], b[k]];
    return out;
  }

  for (const d of days) {
    const dayObj = existing[d] || {};
    const beforeSig = (dayObj.biz || dayObj.ads) ? daySig(dayObj) : null;  // 必须在改动前取指纹
    const prevRowCount = (existing[d] && Array.isArray(existing[d].biz)) ? existing[d].biz.length : 0;
    const missKeys = [];   // 已存但本次权威响应没返回的行
    if (confirmedDays.has(d)) {
      // 确认日: 用本次权威结果(旧数据补缺, 防本次漏采个别行)
      const m = primaryByDate.get(d) || new Map();
      for (const [k] of oldByKey) if (k.startsWith(d + '|') && !m.has(k)) missKeys.push(k);
      mergeOldInto(m, d);
      dayObj.biz = [...m.values()];
    } else {
      // 未确认日: 保留旧数据(按行内 date 已归位过的), extra 补缺
      const m = new Map();
      for (const [k, r] of oldByKey) if (k.startsWith(d + '|')) m.set(k, r);
      const extra = extraByDate.get(d);
      if (extra) for (const [k, r] of extra) if (!m.has(k)) m.set(k, r);
      dayObj.biz = [...m.values()];
    }
    // 广告: 失败国家保留旧数据
    const oldAds = (existing[d] && existing[d].ads) || {};
    const newAds = adsByDate[d] || {};
    const mergedAds = {};
    for (const cc of new Set([...Object.keys(oldAds), ...Object.keys(newAds)])) {
      if (adsFailByDate[d] && adsFailByDate[d].has(cc)) mergedAds[cc] = oldAds[cc] || [];
      else mergedAds[cc] = newAds[cc] || [];
    }
    dayObj.ads = mergedAds;

    // 完整性标记（保留已有行，仅打标 + 长期复查）
    // 口径修正（2026-09-24）：**"当前主力店铺基线"只套用于近端日期（HOT_DAYS 内）**。
    //   业务量是逐月长起来的（6/23~7/19 每天 1~2 行 → 8 月 US 每天 4~8 行 → 9 月 US 每天 11~19 行），
    //   拿 9 月的中位行数去卡 8 月日期会误报（实测 08-13 本来就只有 4 行 US，却被标成"缺 US"）。
    //   历史日期只在「此前有数据、这次源却返回 0 行」时才判为可疑（那是源侧删除而非本来就稀疏）。
    const bizRows = dayObj.biz || [];
    const perSiteNow = new Map();
    for (const r of bizRows) perSiteNow.set(r.site, (perSiteNow.get(r.site) || 0) + 1);
    const weakSites = MAIN_SITES.filter(([s, m]) => (perSiteNow.get(s) || 0) < m * 0.3).map(([s]) => s);
    const ageDays = Math.round((today - parseDate(d)) / 86400000);
    const nearTerm = hotDays.includes(d) && ageDays <= HOT_DAYS;
    if (!bizRows.length) {
      if (nearTerm || prevRowCount > 0) dayObj.incomplete = ['全天无数据'];
      else delete dayObj.incomplete;
    } else if (nearTerm && weakSites.length) {
      dayObj.incomplete = weakSites;
    } else {
      delete dayObj.incomplete;
    }
    if (dayObj.incomplete) {
      incompleteNotes.push(`${d} 缺 ${dayObj.incomplete.join('/')}（实得 ${bizRows.length} 行: ${[...perSiteNow].map(([s, n]) => s + '×' + n).join(' ') || '空'}）`);
    }

    // 旧行清理（校准的另一半）：某行在连续 STALE_STRIKES 次权威响应中都不返回 → 判定源已删除并移除，
    // 否则 mergeOldInto 会把源已删除的行永久补回来，使合计偏高。
    // 安全阀：仅在该日「数据完整」且为确认日时累计；源同步延迟（整站缺失）期间不推进，避免误删。
    if (STALE_STRIKES > 0 && confirmedDays.has(d) && !dayObj.incomplete) {
      const stale = dayObj.stale || {};
      const missSet = new Set(missKeys);
      for (const k of Object.keys(stale)) if (!missSet.has(k)) delete stale[k]; // 行重新出现 → 计数清零
      const removed = [];
      for (const k of missKeys) {
        stale[k] = (stale[k] || 0) + 1;
        if (stale[k] >= STALE_STRIKES) { removed.push(k); delete stale[k]; }
      }
      if (removed.length) {
        const rs = new Set(removed);
        dayObj.biz = (dayObj.biz || []).filter(r => !rs.has(rowKey(r)));
        staleNotes.push({ date: d, removed });
      }
      if (Object.keys(stale).length) dayObj.stale = stale; else delete dayObj.stale;
    }

    // 校准时间戳：本次确实重拉过该日（温区轮转靠它判断「谁最久没被校准」）
    if (confirmedDays.has(d)) dayObj.lastChecked = todayStr;

    // 数值变化检测（热区每天全量重算 → 上游改动在这里被看见）
    if (beforeSig) {
      const afterSig = daySig(dayObj);
      const diffs = sigDiffs(beforeSig, afterSig);
      if (Object.keys(diffs).length) {
        changeNotes.push({ date: d, age: Math.round((today - parseDate(d)) / 86400000), diffs });
      }
    }
    existing[d] = dayObj;
  }
  // extra 中捕获到的、本次不在刷新窗口内的日期: 行按真实日期补进旧数据(只补缺)
  for (const [d, extra] of extraByDate) {
    if (daySet.has(d)) continue;
    const dayObj = existing[d] || { biz: [], ads: {} };
    const m = new Map();
    for (const r of (dayObj.biz || [])) if (r.date === d) m.set(rowKey(r), r);
    for (const [k, r] of extra) if (!m.has(k)) m.set(k, r);
    dayObj.biz = [...m.values()];
    existing[d] = dayObj;
  }
  const sortedDays = Object.keys(existing).sort();
  const out = { generatedAt: requestDate, asinMeta: asinMeta, days: {} };
  for (const d of sortedDays) out.days[d] = existing[d];
  // 待补日期清单（给看板/自检直接读，无需自己再算）
  out.pendingDays = sortedDays.filter(d => (existing[d].incomplete || []).length);
  // 本次校准台账（复查口径：不只补空缺，已采到的也重新校准并记录是否被上游改动）
  const CALIB_DAYS_EFF = CALIB_DAYS;
  out.calibration = {
    at: requestDate,
    hotDays: hotDays.length,
    warmDays: warmDays,
    pendingRechecked: pendingDays,
    checked: days.length,
    changed: changeNotes,
    staleRemoved: staleNotes,
    window: { hot: HOT_DAYS, calib: CALIB_DAYS_EFF, perRun: CALIB_PER_RUN },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1), 'utf8');
  console.log(`\n=== 完成 === 保存 ${sortedDays.length} 天数据到 ${OUT_FILE}`);
  console.log(`  本次刷新 ${days.length} 天明细(末${Math.min(7, days.length)}天):`);
  for (const d of days.slice(-7)) {
    const bizN = (out.days[d].biz || []).length;
    const adN = Object.values(out.days[d].ads || {}).reduce((s, v) => s + (v || []).length, 0);
    const flag = (out.days[d].incomplete || []).length ? `  ⚠️ 缺 ${out.days[d].incomplete.join('/')}` : '';
    console.log(`    ${d}: 业务 ${bizN} 行, 广告 ${adN} items${flag}`);
  }
  if (incompleteNotes.length) {
    console.log('\n⚠️ 数据完整性告警（源数据延迟，非采集故障；已标记 incomplete，后续每次运行自动复查重拉）:');
    incompleteNotes.forEach(n => console.log('   - ' + n));
    console.log(`   待补日期共 ${out.pendingDays.length} 个；近 ${CALIB_DAYS} 天内会持续复查，补齐后自动清除标记。`);
  } else {
    console.log('\n✅ 本次刷新范围内数据完整（必备站点齐全）');
  }
  // ---- 校准台账 ----
  const LABEL = { rows: '业务行数', sessions: 'Sessions', orders: '订单量', sales: '销售额', adItems: '广告items', adCost: '广告花费', adSales: '广告销售额' };
  console.log(`\n🔁 校准台账（热区${hotDays.length}天全量重算 + 空缺复查${pendingDays.length}天 + 温区轮转${warmDays.length}天，共重算 ${days.length} 天）`);
  if (changeNotes.length) {
    console.log(`   ⚠️ 其中 ${changeNotes.length} 天的数值与上次不同（上游改过数，已按最新值校准）:`);
    for (const c of changeNotes) {
      const items = Object.entries(c.diffs).map(([k, [a, b]]) => `${LABEL[k] || k} ${a}→${b}`).join('; ');
      console.log(`     ${c.date}(${c.age}天前): ${items}`);
    }
  } else {
    console.log('   ✅ 重算范围内数值与上次完全一致（无反算差异）');
  }
  if (staleNotes.length) {
    console.log(`   🧹 源侧已删除的旧行 ${staleNotes.length} 天（连续 ${STALE_STRIKES} 次权威响应未返回，已移除）:`);
    staleNotes.forEach(s => console.log(`     ${s.date}: ${s.removed.slice(0, 5).join(', ')}${s.removed.length > 5 ? ` ... 共${s.removed.length}行` : ''}`));
  }
  console.log(`   温区窗口 15~${CALIB_DAYS} 天；每次取最久未校准的 ${CALIB_PER_RUN} 天，逐日轮转覆盖。`);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
