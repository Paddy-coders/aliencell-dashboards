#!/usr/bin/env node
/**
 * 数据完整性自检 check_data_integrity.js
 * 背景: 2026-08~09 连续踩坑(重复计数/漏部署/State过滤丢欧洲/坏数据覆盖)——均为坏数据静默上线。
 * 目标: 每次数据自动化结束后运行, 任何 FAIL 都必须在汇报中标出, 禁止静默忽略。
 *
 * 检查项:
 *  A. 周度汇总 weekly_all_data.json: 周数基线 / 每个已结束周 sales&sessions>0
 *  B. 周度 vs 每日源 交叉验证(同源 /traffic/list, 差异>25% 即 FAIL)
 *  C. 广告源 ad_weekly_all.json: 国家覆盖 >=10, US/DE/UK 花费>0
 *  D. 广告看板 ad_dashboard_data.json: 含最新完整周, records 非空
 *  E. 本地部署一致性: _deploy/product.html == filterable_dashboard.html, _deploy/ad.html == ad_dashboard.html
 *  F. 线上一致性(防漏部署): 线上 product/ad.html 与 _deploy 相同 (网络失败降级 WARN)
 *  G. daily_data.json: generatedAt 新鲜度 + 近4天 biz 行数(全空 WARN, 业务报告延迟属正常)
 *
 * 用法: node check_data_integrity.js   (退出码: 0=通过, 1=有 FAIL)
 */
const fs = require('fs');
const path = require('path');

const MAIN = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const PRODUCT = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33';
const DEPLOY = path.join(MAIN, '_deploy');
const LIVE = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host';
// 曾经上线、现已废弃的地址（本地删了线上还在 → 必须是 _deploy 下的墓碑跳转页）
const LEGACY_URLS = ['ad_dashboard.html'];

let pass = 0, fail = 0, warn = 0;
function report(level, name, info) {
  const tag = level === 'PASS' ? 'PASS' : level === 'FAIL' ? 'FAIL' : 'WARN';
  console.log(`${tag} | ${name}` + (info ? ' | ' + JSON.stringify(info) : ''));
  if (level === 'PASS') pass++; else if (level === 'FAIL') fail++; else warn++;
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

// 从 HTML 中取出 `const <name> = {...};` 的对象(花括号配平, 跳过字符串)
function extractJsonAfter(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const k = html.indexOf('{', i);
  if (k < 0) return null;
  let depth = 0;
  for (let end = k; end < html.length; end++) {
    const ch = html[end];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(html.slice(k, end + 1)); }
    else if (ch === '"') { end++; while (html[end] !== '"') { if (html[end] === '\\') end++; end++; } }
  }
  return null;
}

// 周六~周五: 返回某日期所在周的 [start, end] (ISO yyyy-mm-dd)
function weekRange(ds) {
  const dt = new Date(ds + 'T00:00:00Z');
  const offset = (dt.getUTCDay() + 2) % 7; // Sat=6 -> 0
  const s = new Date(dt); s.setUTCDate(s.getUTCDate() - offset);
  const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
  return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
}
// 最近一个已过去的周五(含今天若为周五)
function lastFriday() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // 从"昨天"起往回找周五: 今天若是周五, 本周要到今晚 24 点才结束, 不能算完整周
  // (否则周五当天 D1 会期望一个尚不存在/必然延迟的新周, 产生日历边界误报)
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
// 周五所在周标签 W{n} (周五 ISO 周数, 与 week_label 口径一致)
function isoWeek(ds) {
  const d = new Date(ds + 'T00:00:00Z');
  const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

(async () => {
  const lastFri = lastFriday();
  console.log(`# 数据完整性自检  ${new Date().toLocaleString('zh-CN')}  (最近完整周结束日: ${lastFri})\n`);

  // ---------- A. 周度汇总 ----------
  const wkPath = path.join(PRODUCT, 'weekly_all_data.json');
  if (!fs.existsSync(wkPath)) { report('FAIL', 'A 周度文件存在', { path: wkPath }); }
  else {
    const weeks = loadJson(wkPath);
    report(weeks.length >= 10 ? 'PASS' : 'FAIL', 'A1 周度周数基线(>=10)', { count: weeks.length });
    const ended = weeks.filter(w => w.end <= lastFri);
    // 近8个完整周必须非零(FAIL); 更早的老周历史数据源本身稀疏, 为零降级 WARN
    const recentEnds = new Set(ended.slice(-8).map(w => w.end));
    const badF = [], badW = [];
    for (const w of ended) {
      const sales = w.data.reduce((s, r) => s + (+r.ordered_product_sales_amount || 0), 0);
      const sess = w.data.reduce((s, r) => s + (+r.sessions || 0), 0);
      if (sales <= 0 || sess <= 0) (recentEnds.has(w.end) ? badF : badW).push(w.start + '~' + w.end);
    }
    report(badF.length === 0 ? 'PASS' : 'FAIL', 'A2 近8个完整周 sales/sessions 均>0', badF.length ? { bad: badF } : undefined);
    if (badW.length) report('WARN', 'A2b 更早老周为零(历史数据源稀疏, 已知)', { weeks: badW });
  }

  // ---------- B. 周度 vs 每日源 交叉 ----------
  const daily = loadJson(path.join(MAIN, 'daily_data.json'));
  if (fs.existsSync(wkPath)) {
    const weeks = loadJson(wkPath);
    const days = daily.days || {};
    const mism = [];
    for (const w of weeks) {
      if (w.end > lastFri) continue; // 只校验已结束周
      let dsales = 0, has = false;
      for (const [d, p] of Object.entries(days)) {
        if (d >= w.start && d <= w.end) { has = true; for (const b of (p.biz || [])) dsales += (+b.ordered_product_sales_amount || 0); }
      }
      if (!has || !dsales) continue;
      const wsales = w.data.reduce((s, r) => s + (+r.ordered_product_sales_amount || 0), 0);
      const diff = Math.abs(wsales - dsales) / dsales;
      if (diff > 0.25) mism.push({ week: w.start + '~' + w.end, weekly: +wsales.toFixed(0), daily: +dsales.toFixed(0), diff: (diff * 100).toFixed(1) + '%' });
    }
    report(mism.length === 0 ? 'PASS' : 'FAIL', 'B1 周度vs每日源 销售额交叉(差异<=25%)', mism.length ? { mism } : undefined);
  }

  // ---------- B2. 月度看板 vs 每日源 交叉 ----------
  const mPath = path.join(MAIN, 'monthly.html');
  if (fs.existsSync(mPath)) {
    const mh = fs.readFileSync(mPath, 'utf-8');
    const start = mh.indexOf('const DATA = ');
    if (start < 0) {
      report('FAIL', 'B2 月度看板内嵌数据解析');
    } else {
      let k = mh.indexOf('{', start), depth = 0, end = k;
      for (; end < mh.length; end++) {
        const ch = mh[end];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        else if (ch === '"') { end++; while (mh[end] !== '"') { if (mh[end] === '\\') end++; end++; } }
      }
      const md = JSON.parse(mh.slice(k, end + 1));
      const dRows = md.rows || [];
      // ⚠️ 2026-10-13: 月度看板并入 JoyBuy 行后, 本项**只能拿 Amazon 行**与每日源比
      //    （JoyBuy 的 sales 是站点本币 EUR/GBP, 且来自 Data Compass, 与业务报告不同源）。
      const amzRows = dRows.filter(r => r.plat !== 'joybuy');
      const jbRows = dRows.filter(r => r.plat === 'joybuy');
      const mByMon = {};
      for (const r of amzRows) {
        const m = (mByMon[r.ym] = mByMon[r.ym] || { sessions: 0, sales: 0 });
        m.sessions += (+r.sessions || 0);
        m.sales += (+r.sales || 0);
      }
      const dByMon = {};
      for (const [ds, day] of Object.entries(daily.days || {})) {
        const ym = ds.slice(0, 7);
        const m = (dByMon[ym] = dByMon[ym] || { sessions: 0, sales: 0 });
        for (const b of (day.biz || [])) {
          m.sessions += (+b.sessions || 0);
          m.sales += (+b.ordered_product_sales_amount || 0);
        }
      }
      const mism2 = [];
      for (const ym of Object.keys(dByMon)) {
        const a = mByMon[ym], b = dByMon[ym];
        if (!a) { mism2.push({ ym, reason: '看板缺少该月' }); continue; }
        if (Math.abs(a.sessions - b.sessions) > 1) mism2.push({ ym, metric: 'sessions', monthly: a.sessions, daily: b.sessions });
        if (Math.abs(a.sales - b.sales) > Math.max(1, b.sales * 0.01)) mism2.push({ ym, metric: 'sales', monthly: +a.sales.toFixed(2), daily: +b.sales.toFixed(2) });
      }
      report(mism2.length === 0 ? 'PASS' : 'FAIL',
        'B2 月度看板vs每日源 交叉(sessions/sales·仅Amazon行)',
        mism2.length ? { mism: mism2 } : { amazon行: amzRows.length });

      // ---------- B2b. 月度看板的 JoyBuy 行 = joybuy_monthly.json（并入无损、且确实是两平台之和） ----------
      try {
        const jb = loadJson(path.join(MAIN, 'joybuy_monthly.json'));
        const jbBy = {};
        for (const r of (jb.rows || [])) {
          const m = (jbBy[r.ym] = jbBy[r.ym] || { sessions: 0, sales: 0, units: 0 });
          m.sessions += (+r.sessions || 0); m.sales += (+r.sales || 0); m.units += (+r.units || 0);
        }
        const gotBy = {};
        for (const r of jbRows) {
          const m = (gotBy[r.ym] = gotBy[r.ym] || { sessions: 0, sales: 0, units: 0 });
          m.sessions += (+r.sessions || 0); m.sales += (+r.sales || 0); m.units += (+r.units || 0);
        }
        const probsB2b = [];
        const yms = new Set([...Object.keys(jbBy), ...Object.keys(gotBy)]);
        for (const ym of yms) {
          const a = jbBy[ym], b = gotBy[ym];
          if (!a) { probsB2b.push(ym + ' 看板多出 JoyBuy 行（源里没有）'); continue; }
          if (!b) { probsB2b.push(ym + ' 看板缺 JoyBuy 行'); continue; }
          for (const key of ['sessions', 'sales', 'units']) {
            if (Math.abs(a[key] - b[key]) > 0.01) probsB2b.push(ym + ' ' + key + ' 看板 ' + b[key] + ' ≠ 源 ' + a[key]);
          }
        }
        // 两平台之和: 该项要证明「全部平台」不是替换而是相加
        const totAll = dRows.reduce((s, r) => s + (+r.sessions || 0), 0);
        const totAmz = amzRows.reduce((s, r) => s + (+r.sessions || 0), 0);
        const totJb = jbRows.reduce((s, r) => s + (+r.sessions || 0), 0);
        if (Math.abs(totAll - (totAmz + totJb)) > 0.01) probsB2b.push('全部平台 ≠ Amazon + JoyBuy');
        report(probsB2b.length === 0 ? 'PASS' : 'FAIL',
          'B2b 月度看板 JoyBuy 行 = joybuy_monthly.json(并入无损)',
          probsB2b.length ? { 问题: probsB2b } : { joybuy行: jbRows.length, 合计sessions: { amazon: totAmz, joybuy: totJb, 全部: totAll } });
      } catch (e) {
        report('FAIL', 'B2b JoyBuy 并入核对(检查失败)', { error: String((e && e.message) || e) });
      }
    }
  }

  // ---------- C. 广告源 ----------
  const adPath = path.join(PRODUCT, 'ad_weekly_all.json');
  if (!fs.existsSync(adPath)) { report('FAIL', 'C 广告源文件存在', { path: adPath }); }
  else {
    const ad = loadJson(adPath);
    const out = ad.output || {};
    const countries = Object.keys(out);
    report(countries.length >= 10 ? 'PASS' : 'FAIL', 'C1 广告源国家覆盖(>=10)', { n: countries.length, sample: countries.slice(0, 5) });
    for (const cc of ['US', 'DE', 'UK']) {
      const cost = Object.values((out[cc] || {}).weeks || {}).flat()
        .reduce((s, it) => s + ((it.Report || {}).Cost || 0), 0);
      report(cost > 0 ? 'PASS' : 'FAIL', `C2 ${cc} 广告花费>0`, { cost: +cost.toFixed(2) });
    }
  }

  // ---------- D. 广告看板数据 ----------
  const adbPath = path.join(MAIN, 'ad_dashboard_data.json');
  if (!fs.existsSync(adbPath)) { report('FAIL', 'D 广告看板数据存在', { path: adbPath }); }
  else {
    const adb = loadJson(adbPath);
    const labels = (adb.weeks || []).map(w => w.label);
    const expect = 'W' + isoWeek(lastFri);
    report(labels.includes(expect) ? 'PASS' : 'FAIL', 'D1 广告看板含最新完整周', { expect, have: labels });
    report((adb.records || []).length > 0 ? 'PASS' : 'FAIL', 'D2 广告记录非空', { n: (adb.records || []).length });
  }

  // ---------- E. 本地部署一致性 ----------
  const pairs = [
    [path.join(PRODUCT, 'filterable_dashboard.html'), path.join(DEPLOY, 'product.html'), 'product'],
    [path.join(MAIN, 'ad_dashboard.html'), path.join(DEPLOY, 'ad.html'), 'ad'],
  ];
  for (const [src, dst, name] of pairs) {
    if (!fs.existsSync(src) || !fs.existsSync(dst)) { report('FAIL', `E 本地部署一致(${name})`, { srcExists: fs.existsSync(src), dstExists: fs.existsSync(dst) }); continue; }
    report(fs.readFileSync(src, 'utf-8') === fs.readFileSync(dst, 'utf-8') ? 'PASS' : 'FAIL', `E 本地部署一致(${name})`);
  }
  // 2026-10-13 补充: `_deploy/` 里的**运行期 JSON** 也是被线上页面真实 fetch 的资产,
  //   陈旧 = 线上静默少数据(映射快照陈旧还会让「产品关系管理」的离线预填充回退到旧映射, 保存时可能覆盖云端)。
  //   实测本轮就漏同步过 product_map.json(48 条 vs 51 条)。
  const jsonPairs = ['product_map.json', 'daily_data.json', 'monthly_targets.json', 'finance_inputs.json'];
  for (const j of jsonPairs) {
    const src = path.join(MAIN, j), dst = path.join(DEPLOY, j);
    if (!fs.existsSync(src)) continue;                       // 主目录没有的(只在 _deploy 维护)跳过
    if (!fs.existsSync(dst)) { report('FAIL', `E 本地部署一致(${j})`, { srcExists: true, dstExists: false }); continue; }
    const a = fs.readFileSync(src), b = fs.readFileSync(dst);
    report(a.equals(b) ? 'PASS' : 'FAIL', `E 本地部署一致(${j})`, a.equals(b) ? undefined : { 源字节: a.length, 部署字节: b.length });
  }

  // ---------- F. 线上一致性(防漏部署) ----------
  // 注意: 裸 URL 会命中 CDN 旧缓存(实测部署成功后裸 URL 仍返回上一版, 加 ?chk= 才拿到源站新文件),
  // 故这里带 cache-buster 校验"源站真相"; 用户侧由壳 index.html 的 iframe ?v=<时间戳> 保证拿到新版。
  for (const [local, url] of [[path.join(DEPLOY, 'product.html'), LIVE + '/product.html'], [path.join(DEPLOY, 'ad.html'), LIVE + '/ad.html']]) {
    try {
      const res = await fetch(url + '?chk=' + Date.now(), { signal: AbortSignal.timeout(20000) });
      const remote = await res.text();
      const same = remote === fs.readFileSync(local, 'utf-8');
      report(same ? 'PASS' : 'FAIL', `F 线上与本地一致(${path.basename(local)})`, same ? undefined : { remoteLen: remote.length, localLen: fs.readFileSync(local, 'utf-8').length });
    } catch (e) {
      report('WARN', `F 线上检查失败(${path.basename(local)}), 网络不可达或超时`, { err: e.message.slice(0, 80) });
    }
  }

  // ---------- G. 禁缓存标记(防浏览器缓存导致"看不到更新") ----------
  const noCacheFiles = ['index.html', 'daily.html', 'monthly.html', 'target.html', 'ad.html', 'product.html', 'mapping.html'];
  const missingNC = [];
  for (const f of noCacheFiles) {
    const p = path.join(DEPLOY, f);
    if (!fs.existsSync(p)) { missingNC.push(f + '(缺失)'); continue; }
    if (!/http-equiv="Cache-Control"/.test(fs.readFileSync(p, 'utf-8'))) missingNC.push(f);
  }
  report(missingNC.length === 0 ? 'PASS' : 'FAIL', 'G0 各看板含禁缓存 meta(防"看着没更新")', missingNC.length ? { missing: missingNC } : undefined);

  // ---------- G3. Woot 数据跨浏览器可见性(防"只有上传者本机能看") ----------
  // 并入 Woot 的看板必须含 cloudWootSync：若只读 localStorage，上传者本机可见、
  // 别人打开看不到（历史缺陷：ad.html 曾漏掉此段）。
  const wootSyncFiles = ['daily.html', 'monthly.html', 'target.html', 'ad.html', 'product.html'];
  const noWootSync = [];
  for (const f of wootSyncFiles) {
    const p = path.join(DEPLOY, f);
    if (!fs.existsSync(p)) { noWootSync.push(f + '(缺失)'); continue; }
    if (!/cloudWootSync/.test(fs.readFileSync(p, 'utf-8'))) noWootSync.push(f);
  }
  report(noWootSync.length === 0 ? 'PASS' : 'FAIL', 'G3 各 Woot 并入看板含云端同步(否则别人看不到)', noWootSync.length ? { missing: noWootSync } : undefined);

  // ---------- G4. 子页面认证守卫(防"拿到直链就能绕过登录") ----------
  // 7 个数据子页面都必须含认证守卫；login.html 必须「不含」(否则跳自己 → 死循环)。
  const guardFiles = ['woot.html', 'daily.html', 'product.html', 'ad.html', 'monthly.html', 'target.html', 'mapping.html'];
  const GUARD_MARK = '认证守卫(子页面)';
  const noGuard = [], guardBad = [];
  for (const f of guardFiles) {
    const p = path.join(DEPLOY, f);
    if (!fs.existsSync(p)) { noGuard.push(f + '(缺失)'); continue; }
    if (!fs.readFileSync(p, 'utf-8').includes(GUARD_MARK)) noGuard.push(f);
  }
  {
    const p = path.join(DEPLOY, 'login.html');
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf-8').includes(GUARD_MARK)) guardBad.push('login.html(不应有守卫)');
  }
  report(noGuard.length === 0 && guardBad.length === 0 ? 'PASS' : 'FAIL',
    'G4 七个数据子页面含认证守卫(且 login.html 不含)',
    (noGuard.length || guardBad.length) ? { missing: noGuard, bad: guardBad } : undefined);

  // ---------- G5. 云端更新提示条(防「别人上传后已开的页面不自知」) ----------
  // 五套看板必须各含「恰好 1 份」cloudUpdateWatch：缺失 = 又退回"只能手动刷新"，
  // 重复 = 生成链路双重注入(integrate_ads.py 会往已注入的 html 再注一遍)。
  const watchFiles = ['daily.html', 'monthly.html', 'target.html', 'ad.html', 'product.html'];
  const noWatch = [], dupWatch = [];
  for (const f of watchFiles) {
    const p = path.join(DEPLOY, f);
    if (!fs.existsSync(p)) { noWatch.push(f + '(缺失)'); continue; }
    const n = (fs.readFileSync(p, 'utf-8').match(/cloudUpdateWatch/g) || []).length;
    if (n === 0) noWatch.push(f);
    else if (n !== 1) dupWatch.push(`${f}(${n}份)`);
  }
  report(noWatch.length === 0 && dupWatch.length === 0 ? 'PASS' : 'FAIL',
    'G5 五套看板各含 1 份云端更新提示(防缺失/重复注入)',
    (noWatch.length || dupWatch.length) ? { missing: noWatch, dup: dupWatch } : undefined);

  // ---------- G6. 部署目录不得含「孤儿页面副本」(防陈旧数据用 URL 直接打开) ----------
  // 背景(2026-09-23): _deploy/ad_dashboard.html 是 9/20 的旧副本, 无人引用却已上线,
  // 谁存了书签打开看到的就是旧数字(且 727KB)。规则: 除入口 index.html 外,
  // 每个 .html 的文件名必须至少被另一个部署页面引用, 否则视为孤儿 → FAIL。
  const ENTRY_OK = ['index.html'];
  const htmlFiles = fs.readdirSync(DEPLOY).filter(f => f.endsWith('.html'));
  const contents = {};
  for (const f of htmlFiles) contents[f] = fs.readFileSync(path.join(DEPLOY, f), 'utf-8');
  const isTombstone = f => contents[f].includes('wb-tombstone');
  const orphans = htmlFiles.filter(f => {
    if (ENTRY_OK.includes(f) || isTombstone(f)) return false;
    return !htmlFiles.some(g => g !== f && contents[g].includes(f));
  });
  // 墓碑页必须"小且只跳转"，否则等于用墓碑名重新上线了一个真页面
  const badTomb = htmlFiles.filter(f => isTombstone(f) &&
    (Buffer.byteLength(contents[f], 'utf-8') >= 2048 || !/http-equiv="refresh"/.test(contents[f])));
  report(orphans.length === 0 && badTomb.length === 0 ? 'PASS' : 'FAIL',
    'G6 无孤儿页面副本(未被引用的 html 只允许墓碑跳转页)',
    (orphans.length || badTomb.length) ? { orphans, badTomb, hint: '废弃地址见 make_tombstones.py' } : undefined);

  // ---------- G10. target.html 平台筛选 + JoyBuy 月度数据(2026-10-09) ----------
  // 三件事必须同时成立，否则「平台筛选」是空壳或数据没进板：
  //   ① 部署版含平台下拉与切换函数(用户点得到)；② 含 JoyBuy 月度数据(不是空数组)；
  //   ③ 无未替换的构建占位符 —— 真实踩过：速卖通占位说明文案里写了占位符名字，
  //      构建期全局替换后整段 JSON 被印到页面上(文案里出现 \"generatedAt\":\"202...)。
  {
    const tp = path.join(DEPLOY, 'target.html');
    if (!fs.existsSync(tp)) {
      report('FAIL', 'G10 target 平台筛选(部署版缺失 target.html)', undefined);
    } else {
      const s = fs.readFileSync(tp, 'utf-8');
      const hasDD = s.includes('id="ddPlatform"') && s.includes('function setPlatform');
      const hasJby = s.includes('"siteTotals"') && s.includes('"rows":[');
      const leak = (s.match(/__[A-Z][A-Z0-9_]{3,}__/g) || []).filter((v, i, a) => a.indexOf(v) === i);
      let jbyFresh = null;
      try {
        const jd = loadJson(path.join(MAIN, 'joybuy_monthly.json'));
        jbyFresh = { rows: (jd.rows || []).length, at: jd.generatedAt || '' };
      } catch (e) { jbyFresh = null; }
      const okG10 = hasDD && hasJby && leak.length === 0 && !!jbyFresh && jbyFresh.rows > 0;
      report(okG10 ? 'PASS' : 'FAIL', 'G10 target 平台筛选(Amazon/JoyBuy/速卖通)+JoyBuy月度数据+无占位符泄漏',
        okG10 ? { joybuyRows: jbyFresh.rows } : { hasPlatformDD: hasDD, hasJoybuyData: hasJby, placeholderLeak: leak, joybuyMonthly: jbyFresh });
    }
  }

  // ---------- G11. 毛利+费用占比+头程数据 → 日/月/周三看板 (2026-10-10 新增/扩容) ----------
  // 六件事必须同时成立, 否则「毛利列」只是空壳:
  //   ① profit_data.json 新鲜(利润报表按结算日期归属, 上游滞后 1~2 天; 超 3 天视为采集链路没跑)
  //   ② profit_metrics.json 有行(均摊计算产物)
  //   ③ 三个看板都含毛利列定义 + 真正的毛利数据(不是只有列头)
  //   ④ 无未替换的构建占位符(__PROFIT_JSON__ / __HF_JSON__ 等; 参考 G10 踩过的坑)
  //   ⑤ 六项费用占比 + 五项绝对值都在(2026-10-10 用户口径②; 重建时最容易被静默丢掉)
  //   ⑥ 头程成本表真实注入且非空(2026-10-10 用户口径③④; 空表也能通过"键存在"检查, 必须查数据)
  {
    try {
      const pf = loadJson(path.join(MAIN, 'profit_data.json'));
      const pmk = loadJson(path.join(MAIN, 'profit_metrics.json'));
      const ageDaysP = pf.generatedAt ? Math.floor((Date.now() - new Date(pf.generatedAt)) / 86400000) : 999;
      // [文件, 毛利数据标记(必须出现在看板里), 说明]
      const boards = [
        ['daily.html', 'const PROFIT = {"generatedAt":', '日看板'],
        ['monthly.html', '"pStorage":', '月度看板'],
        ['product.html', 'const PROFIT = {"B0', '周度看板'],
      ];
      const probs = [];
      // 精确列出构建占位符 —— 不能用 __[A-Z_]+__ 泛匹配: 周看板里有同形的 JS 变量名 __PC_MAP__,
      // 会被误报成"占位符泄漏"(2026-10-10 实测)。
      const PLACEHOLDERS = ['__DATA_JSON__', '__GEN_TIME__', '__MAP_JSON__', '__TARGET_JSON__',
        '__JOYBUY_JSON__', '__FX_JSON__', '__DATA_NOTE__', '__PROFIT_JSON__', '__HF_JSON__',
        '__COST_JSON__',   // 2026-10-13: Woot 成本表(经产品关系管理解析成本用)
      ];
      // 六项费用占比 + 五项绝对值(除成本外) —— 三看板键名统一, 缺一列就说明重建时口径被回退
      const RATIO_KEYS = ['costPct', 'fbaAbs', 'fbaPct', 'promoAbs', 'promoPct',
        'storageAbs', 'storagePct', 'headAbs', 'headPct', 'otherAbs', 'otherPct'];
      // ⑦ 2026-10-12 用户口径④⑤ + 第二轮: 毛利(RMB) / FBA库存费 8 细项 / 退款 5 列
      //   多渠道销量·损失 / 其他渠道已剔除 / 测评费
      //   —— 只在 METRICS 里加列、忘了 build_profit_metrics 注入对应字段时, 列会永远显示 —
      const NEW_COLS = ['mcfQty', 'mcfLoss', 'mcfAdj', 'reviewAbs',
        'profitRmb',
        'fbRetAbs', 'fbOthAbs', 'fbOvrAbs', 'fbConAbs', 'fbCarAbs', 'fbRemAbs', 'fbMstAbs', 'fbLstAbs',
        'refAbs', 'refPromo', 'refComm', 'refNetAbs', 'refRate'];
      // 新列的数据来源字段(必须有真实数据字段名, 只有列定义不算)
      //   ⚠️ 三看板键名必须统一到这三个 —— 任意一个可被证实键(如 pMcost)在三处都注入, 才算真接线
      const NEW_DATA_KEYS = ['pMcAdj', 'pReview', 'pMqty',
        'pFbRet', 'pFbLst', 'pFbMst', 'pRefSales', 'pRefPromo', 'pRefComm', 'pRefQty'];
      // 毛利(RMB) 折算率助手: 三看板实现不同(daily 用逐月 cnyPerDisp, 月/周用自身汇率表)
      const RMB_MARK = {
        'daily.html': ['cnyPerDisp', 'pCnyPer'],
        'monthly.html': ['rmbOf', 'pRmb'],
        'product.html': ['rmbRate', 'profitRmbOf'],
      };
      // 反向护栏: 「FBA物流国际货运费(入境)」按用户口径已下线(不展示/不计入毛利)
      //   —— 若哪天重建又把它带回来, 会造成头程重复扣减, 必须报错
      const REMOVED_MARKS = ['inbAbs', 'pInb', 'pInvx', 'invxAbs'];
      // 头程表注入标记: 三看板实现不同(日=HF.products 嵌套, 月/周=扁平 HF/HEADRMB)
      const HEAD_MARK = {
        'daily.html': ['hfCnyPerUsd', 'headRmbOf', 'HF.products'],
        'monthly.html': ['fxHeadCny', 'headRmbOf'],
        'product.html': ['fxHeadCny', 'headRmbOf', 'HEADRMB'],
      };
      // 头程表「真数据」标记: 从成本表取第一个产品名, 断言其 US 头程被真实序列化进看板。
      // 只查键名(如 headRmbOf)是不够的 —— 空表 {} 也能通过, 看板会静默显示头程=0。
      let headDataMark = null, headCount = 0;
      try {
        const tcost = loadJson(path.join(MAIN, 'product_cost_table.json'));
        const pks = Object.keys(tcost.products || {});
        headCount = pks.length;
        const fn0 = pks[0];
        if (fn0 && (tcost.products[fn0].headRMB || {}).US) {
          // 键序无关匹配: 构建改走云端成本缓存(_cost_cache.json)后 headRMB 序列化键序为 EU→UK→US,
          // 精确相邻串 '"X":{"US":' 会误报(2026-10-22 实测)。改为「产品名:{...内含 "US":」的键序无关断言。
          headDataMark = new RegExp('"' + fn0 + '":\\{[^{}]*"US":');
        }
      } catch (e) { /* 空表/文件缺失 → 下面统一报错 */ }
      if (!headDataMark) probs.push('成本表(product_cost_table.json)无 US 头程数据或文件缺失');
      for (const [bf, dataMark, label] of boards) {
        const fp = path.join(DEPLOY, bf);
        if (!fs.existsSync(fp)) { probs.push(label + '缺失'); continue; }
        const s = fs.readFileSync(fp, 'utf-8');
        if (!s.includes("key:'profit'") || !s.includes("key:'margin'")) probs.push(label + '无毛利列');
        if (!s.includes(dataMark)) probs.push(label + '无毛利数据');
        const missRatio = RATIO_KEYS.filter(k => !s.includes(k));
        if (missRatio.length) probs.push(label + '缺费用占比列:' + missRatio.join(','));
        const missNew = NEW_COLS.filter(k => !s.includes(k));
        if (missNew.length) probs.push(label + '缺新增财务列:' + missNew.join(','));
        const missNewData = NEW_DATA_KEYS.filter(k => !s.includes(k));
        if (missNewData.length) probs.push(label + '缺新增财务数据字段:' + missNewData.join(','));
        const missRmb = (RMB_MARK[bf] || []).filter(k => !s.includes(k));
        if (missRmb.length) probs.push(label + '缺毛利(RMB)折算:' + missRmb.join(','));
        const backAgain = REMOVED_MARKS.filter(k => s.includes(k));
        if (backAgain.length) probs.push(label + '已被口径下线的字段复活(入境货运费):' + backAgain.join(','));
        const missHead = (HEAD_MARK[bf] || []).filter(k => !s.includes(k));
        if (missHead.length) probs.push(label + '缺头程注入:' + missHead.join(','));
        if (headDataMark && !headDataMark.test(s)) probs.push(label + '头程表为空(未真实注入)');
        const leak = PLACEHOLDERS.filter(p => s.includes(p));
        if (leak.length) probs.push(label + '占位符泄漏:' + leak.join(','));
      }
      const rowsP = (pmk.rows || []).length;
      // 退款/细项真数据校验: profit_metrics 里必须有非零的细项与退款(否则"列在但恒 0"也是空壳)
      const sumOf = k => (pmk.rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
      const fbMstSum = sumOf('fbMst'), refSalesSum = sumOf('refSales'), refQtySum = sumOf('refQty');
      const okG11 = ageDaysP <= 3 && rowsP > 0 && probs.length === 0;
      report(okG11 ? 'PASS' : 'FAIL', 'G11 毛利+费用占比+头程+库存费细项/退款/毛利RMB(日/月/周三看板)',
        okG11 ? {
          毛利行: rowsP, 采集距今: ageDaysP + '天', 覆盖至: pf.through,
          费用占比列: RATIO_KEYS.length + '项×3看板', 头程表: headCount + '产品(RMB, 预估值)',
          新增财务列: NEW_COLS.length + '项×3看板', 毛利RMB折算: '已接线×3看板',
          实数据抽样: '月仓租 ' + fbMstSum.toFixed(2) + ' · 退款 ' + refSalesSum.toFixed(2) + '(' + refQtySum + '件)',
        } : { 采集距今: ageDaysP + '天', 毛利行: rowsP, 问题: probs });
    } catch (e) {
      report('FAIL', 'G11 毛利数据(读取 profit_data/profit_metrics 失败)', { error: String((e && e.message) || e) });
    }
  }

  // ---------- G12. 广告 ASIN 归属规则单一来源 (2026-10-10 新增) ----------
  // 背景: 季度/月度/广告三处构建脚本长期各带一份 SPECIAL_ASIN + 正则副本, 改一漏二。
  //   2026-10-10 收敛到 ad_asin_rules.py 后, 这里守住"不许再出现副本"这条线 ——
  //   因为副本漂移的代价是**毛利挂到别的产品上**, 而看板里完全看不出来。
  try {
    const rulesPath = path.join(MAIN, 'ad_asin_rules.py');
    const rulesSrc = fs.readFileSync(rulesPath, 'utf8');
    const consumers = [
      ['aggregate_ads.py', path.join(MAIN, '..', '2026-08-17-14-21-33', 'aggregate_ads.py')],
      ['build_monthly_dashboards.py', path.join(MAIN, 'build_monthly_dashboards.py')],
      ['build_ad_dashboard_data.py', path.join(MAIN, 'build_ad_dashboard_data.py')],
    ];
    const probsG12 = [];
    for (const [name, p] of consumers) {
      let src;
      try {
        src = fs.readFileSync(p, 'utf8');
      } catch (e) {
        probsG12.push(name + ' 读不到');
        continue;
      }
      if (!/from ad_asin_rules import/.test(src)) probsG12.push(name + ' 未引用共享规则模块');
      // 副本特征: 自己又写了一份 SPECIAL_ASIN 字面量表
      if (/SPECIAL_ASIN\s*=\s*\{/.test(src)) probsG12.push(name + ' 又出现 SPECIAL_ASIN 副本');
    }
    if (!/X1_FALLBACK/.test(rulesSrc) || !/LITE_FALLBACK/.test(rulesSrc)) {
      probsG12.push('ad_asin_rules.py 缺少兜底规则(X1_FALLBACK/LITE_FALLBACK)');
    }
    // 日看板是**唯一**在前端 JS 里跑归因的看板(周/月/ad 都在 Python 侧算), 于是它天然会有一份 JS 镜像。
    // 这份镜像不许退化成两级(自带 Asin + SPECIAL_ASIN) —— 那样筛单个 ASIN 时 SB 会被 filterRows 丢掉,
    // 该 ASIN 广告花费偏低、毛利偏高, 页面上完全看不出来。2026-10-10 修过这一处。
    const jsMirrors = [
      ['daily_dashboard_template.html', path.join(MAIN, 'daily_dashboard_template.html')],
      ['daily.html(已构建)', path.join(MAIN, 'daily.html')],
    ];
    for (const [name, p] of jsMirrors) {
      let src;
      try {
        src = fs.readFileSync(p, 'utf8');
      } catch (e) {
        probsG12.push(name + ' 读不到');
        continue;
      }
      if (!/function extractAsin\(it,\s*cc\)/.test(src)) probsG12.push(name + ' extractAsin 未接收站点参数');
      if (!/const X1_FALLBACK\s*=/.test(src)) probsG12.push(name + ' 缺 X1_FALLBACK(系列兜底)');
      if (!/LITE_FALLBACK/.test(src)) probsG12.push(name + ' 缺 LITE_FALLBACK(系列兜底)');
      if (!src.includes('X1\\d')) probsG12.push(name + ' 缺 X140 挡板(会被误归到 X1 兜底)');
      // 所有调用点都必须带国家/站点 —— 同 SKU 在北美与欧洲是不同 ASIN
      const bare = (src.match(/extractAsin\(it\)/g) || []).length;
      if (bare) probsG12.push(name + ' 有 ' + bare + ' 处 extractAsin(it) 漏传站点');
    }
    report(probsG12.length === 0 ? 'PASS' : 'FAIL', 'G12 广告ASIN归属规则单一来源(构建侧共用 ad_asin_rules + 日看板 JS 镜像同规则)',
      probsG12.length ? { 问题: probsG12 } : { 消费者: consumers.length, JS镜像: jsMirrors.length });
  } catch (e) {
    report('FAIL', 'G12 广告ASIN归属规则单一来源(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G13 销售店铺(渠道)筛选 + Woot 成本设置框架 (2026-10-10) ----------
  // 用户口径: Woot 数据统一并入各看板, 但必须能按「销售店铺」切换(默认合并, 也可单看)。
  // 五看板筛选丢了 = 用户再也分不开 Woot 与官方店铺; woot.html 成本字段丢了 = 毛利口径无从录入。
  //
  // 两个实现流派(都是对的, 别互相"对齐"):
  //   行过滤式(日/月/目标/广告): rowMatch/channelOk + 记录上带 channel:'woot'
  //   逐键相减式(周看板 product): 它拿到的是"合并值", 只能额外记 wootParts/wootAdParts 再减出来
  // 毛利只有日/月/周接(wootProfitOf + pc_woot_cfg); 目标/广告看板只做渠道拆分, 不要求毛利字段。
  try {
    const probsG13 = [];
    const chFiles = [
      // [文件, 必含的渠道标记] —— 'wootTag' 是正则, 其余按字面量
      ['daily.html', ['channelOf', 'wootTag']],
      ['monthly.html', ['channelOf', 'wootTag']],
      ['product.html', ['channelMerged', 'wootParts', 'wootAdParts']],
      ['target.html', ['channelOf', 'wootTag', 'channelMerged']],
      ['ad.html', ['channelOf', 'wootTag', 'channelOk']],
    ];
    const MARK = { wootTag: { label: "channel:'woot' 注入标记", re: /channel:\s*['"]woot['"]/ } };
    const profitFiles = ['daily.html', 'monthly.html', 'product.html'];
    for (const [name, marks] of chFiles) {
      const p = path.join(DEPLOY, name);
      if (!fs.existsSync(p)) { probsG13.push(name + ' 读不到'); continue; }
      const src = fs.readFileSync(p, 'utf-8');
      if (!src.includes('销售店铺')) probsG13.push(name + ' 缺「销售店铺」筛选');
      if (!/CHANNELS\s*=/.test(src)) probsG13.push(name + ' 缺 CHANNELS 常量');
      if (!src.includes('Woot店铺')) probsG13.push(name + ' 缺「Woot店铺」选项');
      if (!src.includes('Aliencell官方店铺')) probsG13.push(name + ' 缺「Aliencell官方店铺」选项');
      if (!src.includes('selChannel')) probsG13.push(name + ' 缺 selChannel 选择集');
      for (const m of marks) {
        if (MARK[m]) { if (!MARK[m].re.test(src)) probsG13.push(name + ' 缺' + MARK[m].label); }
        else if (!src.includes(m)) probsG13.push(name + ' 缺' + m + ' 判定函数');
      }
      if (profitFiles.indexOf(name) >= 0) {
        // Woot 毛利接入: 没配成本时不生效, 但代码不能被弄丢(否则成本表接进来也算不出毛利)
        if (!src.includes('wootProfitOf')) probsG13.push(name + ' 缺 Woot 毛利接入(wootProfitOf)');
        if (!src.includes('pc_woot_cfg')) probsG13.push(name + ' 缺 pc_woot_cfg 读取(成本表接不进来)');
        // 采购价「每行可填」(2026-10-10 补充口径): 必须按行取价算收入, 不能只认一个全局单价
        //   → 缺 wootPriceOf 说明退化成「默认价 × 订单量」, 同一 ASIN 不同批次采购价就会算错
        if (!src.includes('wootPriceOf')) probsG13.push(name + ' 缺 wootPriceOf 逐行采购价取值(退化成单一价会算错)');
        if (!/en\.price/.test(src) && !/row\.price/.test(src)) probsG13.push(name + ' 分摊/聚合处没读行内 price');
      }
    }
    const wpath = path.join(DEPLOY, 'woot.html');
    if (!fs.existsSync(wpath)) probsG13.push('woot.html 读不到');
    else {
      const s = fs.readFileSync(wpath, 'utf-8');
      if (!s.includes('pc_woot_cfg')) probsG13.push('woot.html 缺 pc_woot_cfg 存储键');
      if (!/WOOT_PRICE_DEFAULT\s*=\s*1380/.test(s)) probsG13.push('woot.html 采购价默认值不是 1380');
      if (!/wootCfg:\s*wootCfg/.test(s)) probsG13.push('woot.html 云端保存未带上 wootCfg(别人看不到成本)');
      // 采购价「每行可填」的录入侧: 表头识别列 + 列表逐行可改 + 导出带列(否则用户上传时填不进来)
      if (!/key:\s*'price'/.test(s)) probsG13.push('woot.html 表头识别缺 price 列(上传表格的「采购价」列读不进来)');
      if (!/onRowPrice/.test(s)) probsG13.push('woot.html 记录列表缺逐行改采购价(onRowPrice)');
      if (!/'采购价'/.test(s)) probsG13.push('woot.html 缺「采购价」字样(导出 CSV / 表头)');
    }
    report(probsG13.length === 0 ? 'PASS' : 'FAIL',
      'G13 销售店铺渠道筛选(日/月/周/目标/广告)+Woot成本设置+每行采购价',
      probsG13.length ? { 问题: probsG13 } : { 看板: chFiles.length });
  } catch (e) {
    report('FAIL', 'G13 销售店铺渠道筛选(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G14 财务录入窗口 + Supabase 单行合并写回 (2026-10-12) ----------
  // 用户口径③④: 其他渠道订单(月/ASIN/数量) 与 测评费用(月/站点/ASIN/金额/币种/备注) 要能在线上录入,
  //   且导入后能从亚马逊毛利里「月度剔除」多渠道成本。
  // 单行共用是本条的真正风险点: mapping 表 id=1 的 data 被 6 个页面共用, 任一页面「只写自己的键」
  //   就会把 finance 抹掉(反之 finance 页写回也会抹掉 catalog/asinMap/woot) → 每次写回必须 Object.assign 合并。
  try {
    const probsG14 = [];
    // ① 录入窗口本体
    const finPath = path.join(DEPLOY, 'finance_inputs.html');
    if (!fs.existsSync(finPath)) probsG14.push('finance_inputs.html 未部署(用户没有录入入口)');
    else {
      const s = fs.readFileSync(finPath, 'utf-8');
      const need = ['otherOrders', 'reviewFees', 'pc_finance', 'parseDelimited', 'normAsin', 'normYm'];
      const miss = need.filter(k => !s.includes(k));
      if (miss.length) probsG14.push('finance_inputs.html 缺:' + miss.join(','));
      // 写回必须是「读最新 → 合并 → 整体 PATCH」, 只写 finance 一个键会抹掉别人的
      if (!/Object\.assign\(\{\},\s*cur/.test(s)) probsG14.push('finance_inputs.html 云端写回未合并(会把 catalog/asinMap/woot 抹掉)');
      // 表头误判护栏: 仅凭「含『月』字」判表头会把备注「10月」当表头整行丢弃
      if (!/looksData/.test(s)) probsG14.push('finance_inputs.html 缺表头误判护栏(looksData)');
    }
    // ② 入口: index.html 有按钮能打开
    const idxPath = path.join(DEPLOY, 'index.html');
    if (fs.existsSync(idxPath)) {
      const s = fs.readFileSync(idxPath, 'utf-8');
      if (!s.includes('finance_inputs.html')) probsG14.push('index.html 缺「财务录入」入口(用户找不到窗口)');
    }
    // ③ 兄弟页面写回不得抹掉 finance —— mapping / woot 是历史遗留的「只写自己键」
    for (const [f, label] of [['mapping.html', '映射页'], ['woot.html', 'Woot页']]) {
      const p = path.join(DEPLOY, f);
      if (!fs.existsSync(p)) continue;
      const s = fs.readFileSync(p, 'utf-8');
      if (!/Object\.assign\(\{\},\s*cur\w*/.test(s)) probsG14.push(label + '(' + f + ') 云端写回未合并(会抹掉 finance)');
    }
    // ④ 构建期快照文件存在且结构完整(构建读它注入剔除/测评费; 缺失会静默退化为全空)
    const finJson = path.join(MAIN, 'finance_inputs.json');
    if (!fs.existsSync(finJson)) probsG14.push('finance_inputs.json 缺失(构建期无剔除/测评费数据)');
    else {
      const d = loadJson(finJson) || {};
      if (!Array.isArray(d.otherOrders) || !Array.isArray(d.reviewFees)) probsG14.push('finance_inputs.json 缺 otherOrders/reviewFees 数组');
    }
    report(probsG14.length === 0 ? 'PASS' : 'FAIL',
      'G14 财务录入窗口(其他渠道订单/测评费)+Supabase单行合并写回',
      probsG14.length ? { 问题: probsG14 } : { 入口: 'index→finance_inputs.html', 写回: 'mapping/woot/finance 三页均合并' });
  } catch (e) {
    report('FAIL', 'G14 财务录入窗口(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G15 月度看板「平台」筛选 + JoyBuy 行并入 (2026-10-13) ----------
  // 用户需求: 月度数据面板并入 JoyBuy 平台数据, 并要有平台筛选条件。
  // 本条的真正风险点(全是静默错):
  //   ① rowMatch() 的调用点漏传 plat → 不报错, 只是 地区/国家/ASIN/系列/品名 的候选列表
  //      按「全部平台」算(选项多出/少掉)。本项用「调用点数 == 带 plat 数」把它钉死。
  //   ② monthly 与 target 共用同一个 __DATA_JSON__ 变量 → 若把 JoyBuy 行塞进共用的 data_json,
  //      target 会与它自己的 __JOYBUY_JSON__/JBY_ROWS 双计。故必须单独派生 monthly_data_json,
  //      并断言 target 的 DATA.rows 里**不含** plat:'joybuy'。
  //   ③ 只改模板不重建 → 产物没平台筛选(用户看到的永远是旧版)。
  try {
    const probsG15 = [];
    const mTpl = path.join(MAIN, 'monthly_dashboard_template.html');
    const mOut = path.join(MAIN, 'monthly.html');
    const mDep = path.join(DEPLOY, 'monthly.html');
    const MUST = ['id="ddPlatform"', 'ddPlatformSummary', 'PLATFORMS', 'platOf', 'buildPlatformOptions', "setAll('platform'"];
    for (const [, p, label] of [[0, mTpl, '模板'], [1, mOut, 'monthly.html'], [2, mDep, '_deploy/monthly.html']]) {
      if (!fs.existsSync(p)) { probsG15.push(label + ' 读不到'); continue; }
      const s = fs.readFileSync(p, 'utf-8');
      const miss = MUST.filter(k => !s.includes(k));
      if (miss.length) probsG15.push(label + ' 缺:' + miss.join(','));
      // ① 漏传护栏: 每个 rowMatch 调用点都必须带 plat: selPlatform
      const allCalls = (s.match(/rowMatch\(r,\s*\{\s*channel:\s*selChannel,/g) || []).length;
      const withPlat = (s.match(/rowMatch\(r,\s*\{\s*channel:\s*selChannel,\s*plat:\s*selPlatform,/g) || []).length;
      if (!allCalls) probsG15.push(label + ' 找不到 rowMatch 调用点(结构已变)');
      else if (allCalls !== withPlat) probsG15.push(label + ' 有 ' + (allCalls - withPlat) + '/' + allCalls + ' 处 rowMatch 漏传 plat（候选列表会按全部平台算）');
      // 平台选项必须挂进 renderAll（否则只是空壳下拉）
      if (!/function renderAll\(\)[\s\S]{0,200}buildPlatformOptions\(\)/.test(s)) probsG15.push(label + ' renderAll 未调用 buildPlatformOptions');
      // JoyBuy 行没有 ASIN → asinList 必须过滤空值
      if (!/ROWS\.map\(r => r\.asin\)\.filter\(Boolean\)/.test(s)) probsG15.push(label + ' asinList 未过滤空 ASIN(下拉会多空选项)');
    }
    // ② 产物数据: monthly 有 JoyBuy 行, target 没有
    if (fs.existsSync(mOut)) {
      const d = extractJsonAfter(fs.readFileSync(mOut, 'utf-8'), 'const DATA =');
      const jb = loadJson(path.join(MAIN, 'joybuy_monthly.json'));
      const jbRows = d && Array.isArray(d.rows) ? d.rows.filter(r => r.plat === 'joybuy') : [];
      const expect = ((jb && jb.rows) || []).length;
      // aggMonth() 里没有 `||0` 兜底的字段必须齐全, 否则 undefined 参与加法 → NaN 污染整月 KPI
      const NEED = ['ym', 'cc', 'sessions', 'mob', 'brw', 'pv', 'units', 'b2b', 'orders', 'sales',
        'bbSum', 'bbCnt', 'adClicks', 'adCost', 'adOrders', 'adSales', 'adImpr', 'series', 'name'];
      const badRow = jbRows.find(r => NEED.some(k => r[k] === undefined || r[k] === null && k !== 'asin'));
      if (badRow) probsG15.push('monthly.html 的 JoyBuy 行字段不全(缺 ' + NEED.filter(k => badRow[k] === undefined).join(',') + ') ⇒ 会把 NaN 带进月 KPI');
      if (jbRows.length !== expect) probsG15.push('monthly.html JoyBuy 行数 ' + jbRows.length + ' ≠ joybuy_monthly.json ' + expect + ' 行（构建未并入）');
      if (jbRows.some(r => r.asin)) probsG15.push('monthly.html 的 JoyBuy 行带 ASIN（应为 null）');
    }
    const tOut = path.join(MAIN, 'target.html');
    if (fs.existsSync(tOut)) {
      const d = extractJsonAfter(fs.readFileSync(tOut, 'utf-8'), 'const DATA =');
      const leaked = d && Array.isArray(d.rows) ? d.rows.filter(r => r.plat === 'joybuy').length : 0;
      if (leaked) probsG15.push('target.html 的 DATA.rows 混进了 ' + leaked + ' 行 JoyBuy（会与 JBY_ROWS 双计）');
    }
    report(probsG15.length === 0 ? 'PASS' : 'FAIL',
      'G15 月度看板平台筛选(Amazon/JoyBuy)+JoyBuy行并入(不污染target)+rowMatch无漏传',
      probsG15.length ? { 问题: probsG15 } : { 平台: '全部平台/Amazon/JoyBuy', 并入: 'monthly 专用 data_json' });
  } catch (e) {
    report('FAIL', 'G15 月度看板平台筛选(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G16. Woot 成本「经产品关系管理解析」+ Woot 行等效利润字段齐全 (2026-10-13 新增) ----------
  // 背景: Woot 行原只认「Woot 成本设置」里逐 ASIN 手工录入的成本, 该配置为空 ⇒ 毛利恒为 —。
  //   用户口径改为「Woot 产品就是 X1 40W, 通过产品关系管理匹配」⇒ 回退链
  //   ①手工配置 ②asinMap→产品名→成本表 costRMB/headRMB.US÷(CNY/USD)。
  // 三类风险各一句护栏:
  //   ① 模板/产物漏了回退 → 成本永远解析不出来(功能静默失效)
  //   ② 构建脚本没注入 __COST_JSON__ → 模板占位符残留(会把整段 JSON 印到页面上)
  //   ③ 月看板 Woot 行缺 profitOf() 直接相加的字段 → 「合并视图毛利 = NaN」(启用回退后才暴露)
  try {
    const probsG16 = [];
    // ① 回退链必须同时出现在 3 个算 Woot 毛利的看板(日/月/周)
    const WOOT_BOARDS = [
      ['daily_dashboard_template.html', path.join(MAIN, 'daily_dashboard_template.html'), '日看板模板'],
      ['monthly_dashboard_template.html', path.join(MAIN, 'monthly_dashboard_template.html'), '月看板模板'],
      ['daily.html', path.join(MAIN, 'daily.html'), 'daily.html'],
      ['monthly.html', path.join(MAIN, 'monthly.html'), 'monthly.html'],
      ['_deploy/daily.html', path.join(DEPLOY, 'daily.html'), '_deploy/daily.html'],
      ['_deploy/monthly.html', path.join(DEPLOY, 'monthly.html'), '_deploy/monthly.html'],
      ['_deploy/product.html', path.join(DEPLOY, 'product.html'), '_deploy/product.html'],
    ];
    for (const [, p, label] of WOOT_BOARDS) {
      if (!fs.existsSync(p)) { probsG16.push(label + ' 读不到'); continue; }
      const s = fs.readFileSync(p, 'utf-8');
      for (const k of ['COSTRMB', 'wootCostFromMap', 'wootUnitCost']) {
        if (!s.includes(k)) probsG16.push(label + ' 缺 ' + k);
      }
      // 回退必须真的被 wootUnitCost 调用（只定义不调用 = 空壳）
      if (!/function wootUnitCost\(asin\)\{[\s\S]{0,400}wootCostFromMap\(asin\)/.test(s)
          && !/function wootUnitCost\(asin\)\{[\s\S]{0,400}return wootCostFromMap/.test(s)) {
        probsG16.push(label + ' wootUnitCost 未回退到 wootCostFromMap');
      }
      // 手工配置仍须优先(否则用户的覆盖会失效)
      if (!/WOOT_CFG\.cost \|\| \{\}\)\[asin\]/.test(s)) probsG16.push(label + ' wootUnitCost 丢了「手工配置优先」分支');
    }
    // ② 构建脚本必须注入 __COST_JSON__（否则模板里的占位符原样留在产物里）
    for (const [f, label] of [['build_daily_dashboard.py', '日'], ['build_monthly_dashboards.py', '月']]) {
      const p = path.join(MAIN, f);
      if (!fs.existsSync(p)) { probsG16.push(f + ' 读不到'); continue; }
      const s = fs.readFileSync(p, 'utf-8');
      if (!s.includes('__COST_JSON__')) probsG16.push(f + ' 未注入 __COST_JSON__');
      if (!/costRMB/.test(s)) probsG16.push(f + ' 未从 product_cost_table 取 costRMB');
      void label;
    }
    // ③ 内置成本表必须非空(空表 = 回退恒为 null, 静默失效)
    for (const [f, label] of [['daily.html', 'daily.html'], ['monthly.html', 'monthly.html']]) {
      const p = path.join(MAIN, f);
      if (!fs.existsSync(p)) continue;
      const s = fs.readFileSync(p, 'utf-8');
      const m = s.match(/const COSTRMB = (\{[\s\S]*?\});/);
      if (!m) { probsG16.push(label + ' 找不到 const COSTRMB 注入值'); continue; }
      let n = -1;
      try { n = Object.keys(JSON.parse(m[1])).length; } catch (e) { n = -2; }
      if (n <= 0) probsG16.push(label + ' 的 COSTRMB 为空/解析失败(n=' + n + ') ⇒ Woot 成本回退恒为 null');
    }
    // ④ 月看板 Woot 行必须带全 profitOf() 直接相加的字段(缺一个 → 合并视图毛利 NaN)
    const mTplG16 = path.join(MAIN, 'monthly_dashboard_template.html');
    if (fs.existsSync(mTplG16)) {
      const s = fs.readFileSync(mTplG16, 'utf-8');
      const wm = s.match(/const wmar = [\s\S]*?pHead: wc\.freight \* od \};/);
      if (!wm) probsG16.push('月看板找不到 wmar(Woot 等效利润字段) 定义');
      else {
        const miss = ['pSales', 'pPromo', 'pComm', 'pFba', 'pCost', 'pStorage', 'pOther', 'pN', 'pQty', 'pHead']
          .filter(k => !new RegExp('\\b' + k + ':').test(wm[0]));
        if (miss.length) probsG16.push('月看板 Woot 行缺 ' + miss.join(',') + '（profitOf 直接相加 → 合并视图毛利变 NaN）');
      }
    }
    // ⑤ 周看板(integrate_ads.py 的等效字段)与日看板(累加器)是另外两条路径, 断言其形状护栏仍在
    const iaPath = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33/integrate_ads.py';
    if (fs.existsSync(iaPath)) {
      const s = fs.readFileSync(iaPath, 'utf-8');
      if (!/const acc = \{[\s\S]{0,2500}pRefQty:0 \};/.test(s)) probsG16.push('integrate_ads.py 的 wootPartAcc acc 键形状变了(单看 Woot 合计会变 NaN)');
      if (!s.includes('wootCostFromMap')) probsG16.push('integrate_ads.py 的 woot_inject 未加产品关系管理回退');
    } else {
      probsG16.push('integrate_ads.py 读不到(周看板回退无法校验)');
    }
    report(probsG16.length === 0 ? 'PASS' : 'FAIL',
      'G16 Woot成本经产品关系管理解析(手工配置优先/回退生效/成本表非空/Woot行字段齐全)',
      probsG16.length ? { 问题: probsG16 } : { 看板: '日/月/周', 回退源: 'asinMap→产品名→costRMB+headRMB.US' });
  } catch (e) {
    report('FAIL', 'G16 Woot成本经产品关系管理解析(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G17. 映射块必须排在「Woot 装配块」之前 (2026-10-13 新增) ----------
  // 背景: 启用 G16 的「产品关系管理回退」后, 月看板加载期直接抛
  //   ReferenceError: Cannot access 'EMBED_MAP' before initialization
  // —— 装配期的 IIFE(injectWootMonthly / 日看板页脚状态块)会调 wootCostFromMap→asinMetaOf,
  //    而 asinMetaOf 读的 const EMBED_MAP / localMeta / embeddedMeta 定义在后面 ⇒ const 的 TDZ。
  //    后果是**整段 script 后面全部不执行**(selChannel 未定义 → 点「销售店铺」报错、页面空白)。
  //    日看板当时没炸, 是因为调用被 try/catch 吞了 → 页脚「产品关系管理回退 N 个」恒显示 0(静默错数)。
  // 护栏: 模板与**已构建产物**里, 映射块起点必须早于 Woot 装配块起点。
  //   ① 只改模板不重建 → 产物仍带 TDZ; ② 有人把映射块挪回去 → 立刻 FAIL。
  try {
    const probsG17 = [];
    // 每行: [文件名, 路径, 标签, 映射块锚点, 「加载期会用映射」的代码锚点]
    // ⚠️ 日看板的 WOOT_INJECTED 装配块**不**用映射(成本是渲染期按行算的), 真正在加载期调
    //    wootCostFromMap 的是紧随其后的「Woot 毛利率状态提示」块 → 用后者当锚点才有意义。
    const POS = [
      ['daily_dashboard_template.html', path.join(MAIN, 'daily_dashboard_template.html'), '日看板模板',
        'const EMBED_MAP = __MAP_JSON__;', '// ---------- Woot 毛利率状态提示 ----------'],
      ['monthly_dashboard_template.html', path.join(MAIN, 'monthly_dashboard_template.html'), '月看板模板',
        'const EMBED_MAP = __MAP_JSON__;', '(function injectWootMonthly(){'],
      ['daily.html', path.join(MAIN, 'daily.html'), 'daily.html',
        'const EMBED_MAP =', '// ---------- Woot 毛利率状态提示 ----------'],
      ['monthly.html', path.join(MAIN, 'monthly.html'), 'monthly.html',
        'const EMBED_MAP =', '(function injectWootMonthly(){'],
      ['_deploy/daily.html', path.join(DEPLOY, 'daily.html'), '_deploy/daily.html',
        'const EMBED_MAP =', '// ---------- Woot 毛利率状态提示 ----------'],
      ['_deploy/monthly.html', path.join(DEPLOY, 'monthly.html'), '_deploy/monthly.html',
        'const EMBED_MAP =', '(function injectWootMonthly(){'],
    ];
    for (const [f, p, label, mapKey, asmKey] of POS) {
      if (!fs.existsSync(p)) { probsG17.push(label + ' 读不到'); continue; }
      const s = fs.readFileSync(p, 'utf-8');
      const iMap = s.indexOf(mapKey), iAsm = s.indexOf(asmKey);
      if (iMap < 0) { probsG17.push(label + ' 找不到映射块(' + mapKey + ')'); continue; }
      if (iAsm < 0) { probsG17.push(label + ' 找不到 Woot 装配块(' + asmKey + ')'); continue; }
      if (iMap > iAsm) probsG17.push(label + ' 映射块在 Woot 装配块之后 ⇒ 加载期 TDZ(整页脚本中断)');
      // asinMetaOf 必须在装配块之前就已经能取到映射(即函数定义也在前面)
      const iFn = s.indexOf('function asinMetaOf(');
      if (iFn < 0) probsG17.push(label + ' 找不到 asinMetaOf');
      else if (iFn > iAsm) probsG17.push(label + ' asinMetaOf 定义在装配块之后');
      void f;
    }
    report(probsG17.length === 0 ? 'PASS' : 'FAIL',
      'G17 映射块先于 Woot 装配块(防加载期 const TDZ 打断整页脚本)',
      probsG17.length ? { 问题: probsG17 } : { 覆盖: '日/月 模板 + 已构建产物 + _deploy 副本' });
  } catch (e) {
    report('FAIL', 'G17 映射块先于 Woot 装配块(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G18. 「商品成本」口径体检 (2026-10-13 重写: 成本表口径) ----------
  // 背景: 用户 2026-10-13 明确「商品成本全部取成本表匹配, 不要从易仓取数」⇒
  //   build_profit_metrics.py 的 `cost` 改为「成本表 costRMB × 件数 ÷ 当月汇率」,
  //   易仓原值退居 `costErp`(仅审计, 不参与任何计算)。旧 G18 盯的两个「易仓源数据毛病」
  //   (单台离群 / 有销量但成本=0) 已因口径切换而**不再影响看板**, 故改为盯新口径的三件事:
  //     ⓐ FAIL 级: 成本表口径**真的生效**(costSource='table' + 存在 cost≠costErp 的行)
  //        —— 防「cost_from_table 导入失败被静默降级回易仓」这种无感事故
  //     ⓑ WARN 级: 有件数但**成本表未匹配**(miss=1) ⇒ 成本按 0, 毛利虚高 ⇒ 需补映射/补成本表
  //     ⓒ WARN 级: 成本表与易仓单台成本偏差 ≥30% 的 ASIN ⇒ 两边必有一个要改, 需人工确认
  try {
    let g18 = null;
    const pmPath = path.join(MAIN, 'profit_metrics.json');
    if (!fs.existsSync(pmPath)) {
      g18 = { level: 'FAIL', probs: ['profit_metrics.json 读不到'], detail: {} };
    } else {
      let pm = null;
      try { pm = JSON.parse(fs.readFileSync(pmPath, 'utf-8')); } catch (e) { pm = null; }
      if (!pm || !Array.isArray(pm.rows)) {
        g18 = { level: 'FAIL', probs: ['profit_metrics.json 结构异常(缺 rows)'], detail: {} };
      } else {
        const rows = pm.rows;
        const hard = [], soft = [];
        // ⓐ 口径生效
        const srcOk = (pm.costSource === 'table');
        let nDiff = 0, nCost = 0;
        for (const r of rows) { if (r.cost) nCost++; if (r.cost !== r.costErp) nDiff++; }
        if (!srcOk) hard.push('costSource=' + (pm.costSource || '(缺失)') + '（应为 table ⇒ 成本表口径没生效, 可能已静默降级回易仓）');
        if (!nDiff) hard.push('所有行 cost==costErp ⇒ 成本表口径疑似未生效(或成本表与易仓恰好相同)');
        if (!nCost) hard.push('所有行 cost 均为 0 ⇒ 成本表未接入');
        if (!('costErp' in (rows[0] || {}))) hard.push('行里没有 costErp 字段 ⇒ 易仓原值审计链断了');

        // ⓑ 未匹配(成本按 0 ⇒ 毛利虚高)
        const missAgg = new Map();
        for (const r of rows) {
          if (!r.miss) continue;
          const k = r.as + '|' + r.site;
          const o = missAgg.get(k) || { asin: r.as, site: r.site, qty: 0, sales: 0 };
          o.qty += (r.qty || 0) + (r.mqty || 0);
          o.sales += (r.sales || 0);
          missAgg.set(k, o);
        }
        const missList = [...missAgg.values()].sort((a, b) => b.qty - a.qty);
        const missQty = missList.reduce((s, x) => s + x.qty, 0);
        if (missList.length) {
          soft.push('成本表未匹配 ' + missList.length + ' 个 ASIN×站点 / ' + missQty +
                    ' 件(成本按 0 ⇒ 毛利虚高)');
        }

        // ⓒ 表成本 vs 易仓成本 单台偏差(同币种, 都已是站点币种) ≥30%
        //   ⚠️ 易仓单台必须用「**逐行单台的中位数**」, 不能用 ΣcostErp/Σqty(加权均值) ——
        //     后者会被两类行同时污染: ①某行漏记成本(costErp=0)把均值**拉低**
        //     ②离群行(B0H69JJZ1M 2026-08-29 的 22.4 倍)把均值**拉高**。
        //     实测这两种污染各制造了一个假告警(B0H6Q5MFT1 假报 −77%、B0H69JJZ1M 假报 38%),
        //     而逐行中位数的真实偏差分别是 −11% / −10% —— 都属「成本表比易仓略低」的正常区间。
        //     (与旧 G18 学到的「基准必须用中位数」是同一条教训, 换口径后别又忘了。)
        const agg = new Map();
        for (const r of rows) {
          const k = r.as + '|' + r.site;
          const o = agg.get(k) || { asin: r.as, site: r.site, q: 0, c: 0, per: [], erpZero: 0 };
          o.q += (r.qty || 0) + (r.mqty || 0);
          o.c += (r.cost || 0);
          if (r.qty > 0) {
            if (r.costErp) o.per.push(Math.abs(r.costErp) / r.qty);
            else o.erpZero++;
          }
          agg.set(k, o);
        }
        const devs = [];
        for (const o of agg.values()) {
          if (!o.q || !o.c || !o.per.length) continue;   // 易仓全期没记过成本(新品)不比较, 属设计预期
          const srt = o.per.slice().sort((a, b) => a - b);
          const med = srt[Math.floor(srt.length / 2)];
          if (!med) continue;
          const unit = o.c / o.q;                        // 表单台(负)
          const dev = (Math.abs(unit) - med) / med;      // 正 = 表比易仓高
          if (Math.abs(dev) >= 0.3) {
            devs.push({ asin: o.asin, 站点: o.site, 件数: o.q,
              表单台: +unit.toFixed(2), 易仓单台中位: +med.toFixed(2),
              偏差: +(dev * 100).toFixed(1) + '%',
              易仓漏记成本行: o.erpZero || undefined });
          }
        }
        devs.sort((a, b) => Math.abs(parseFloat(b.偏差)) - Math.abs(parseFloat(a.偏差)));
        if (devs.length) soft.push('成本表与易仓单台成本偏差 ≥30% 共 ' + devs.length + ' 个 ASIN(需人工确认哪边对)');

        const detail = {};
        if (hard.length) detail.口径未生效 = hard;
        if (missList.length) detail.未匹配成本表 = { 个数: missList.length, 件数: missQty, 明细: missList.slice(0, 5) };
        if (devs.length) detail.表与易仓偏差 = devs.slice(0, 6);
        g18 = { level: hard.length ? 'FAIL' : (soft.length ? 'WARN' : 'PASS'),
                probs: hard.concat(soft), detail,
                ok: { 说明: '商品成本全部由成本表匹配, 无未匹配/无大偏差',
                      口径: pm.costSource, 与易仓不同的行: nDiff + '/' + rows.length } };
      }
    }
    report(g18.level, 'G18 商品成本口径体检(成本表匹配生效/未匹配/与易仓偏差 —— 后两项是源数据问题, 看板如实展示)',
      g18.probs.length ? g18.detail : g18.ok);
  } catch (e) {
    report('WARN', 'G18 商品成本口径体检(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- G19. 映射一致性: 内嵌映射 vs 生效映射 (2026-10-13 新增) ----------
  // 背景(实测事故): Resolver 取映射走 load_map_prefer_local() → **优先 _map_cache.json**
  //   (测试等外部流程会从云端刷新它), 而构建期内嵌的是 product_map.json。
  //   refresh_map 原按 product_map.json 自己的 mtime 判新鲜度 ⇒ 只要缓存被别的流程刷新过,
  //   它就"以为够新"而跳过同步 ⇒ 两文件分叉。后果: 商品成本已按成本表解析(走缓存),
  //   但页面头程按内嵌映射算 ⇒ **同一行 两个口径**, 完全无感。
  //   (2026-10-13 实测: 缓存 51 条 vs 内嵌 48 条, 差 3 个 US ASIN ⇒ 商品成本少 1,498.48)
  //   ⇒ ⓐ 缓存里的 ASIN 必须全部内嵌; ⓑ 凡是 profit_metrics 已解析出非 0 成本的 ASIN
  //      必须能在内嵌映射里找到(否则该行「成本有值、头程恒 0」)。
  //   ⓒ 已构建页面若不含映射里的 ASIN ⇒ 该页面没随映射重建(WARN, 因为周报链只在周一跑)。
  try {
    const mpPath = path.join(MAIN, 'product_map.json');
    const cachePath = path.join(MAIN, '_map_cache.json');
    const readMap = (p) => {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
    };
    const mp = readMap(mpPath);
    if (!mp) {
      report('FAIL', 'G19 映射一致性(内嵌映射 product_map.json vs 生效映射)', { error: 'product_map.json 读不到或结构异常' });
    } else {
      const baked = new Set((mp.asinMap || []).map(x => String(x.asin || '').toUpperCase()).filter(Boolean));
      const hard = [], soft = [], detail = {};
      const cache = readMap(cachePath);
      if (cache && Array.isArray(cache.asinMap)) {
        const missCache = [...new Set(cache.asinMap.map(x => String(x.asin || '').toUpperCase()).filter(Boolean))]
          .filter(a => !baked.has(a));
        if (missCache.length) {
          hard.push('生效映射(_map_cache.json)有 ' + missCache.length +
                    ' 个 ASIN 未被内嵌进 product_map.json ⇒ 商品成本按映射解析、页面头程按 0 算(同一行两个口径)');
          detail.仅缓存里有 = missCache.slice(0, 10);
        }
      } else {
        soft.push('_map_cache.json 读不到 ⇒ 跳过缓存↔内嵌 一致性比对');
      }
      // ⓑ profit_metrics 已解析出成本的 ASIN 必须在内嵌映射里
      let pmr = null;
      try { pmr = JSON.parse(fs.readFileSync(path.join(MAIN, 'profit_metrics.json'), 'utf-8')); } catch (e) { pmr = null; }
      if (pmr && Array.isArray(pmr.rows)) {
        const resolved = [...new Set(pmr.rows.filter(r => (r.cost || 0) !== 0)
          .map(r => String(r.as || '').toUpperCase()))].filter(a => a && !baked.has(a));
        if (resolved.length) {
          hard.push('profit_metrics.json 里已算出商品成本的 ' + resolved.length +
                    ' 个 ASIN 不在内嵌映射里 ⇒ 这些行「成本有值、页面头程恒 0」');
          detail.成本已解析但未内嵌 = resolved.slice(0, 10);
        }
      }
      // ⓒ 已构建页面是否含映射里的 ASIN(页面未随映射重建)
      if (baked.size) {
        const stale = [];
        for (const f of ['daily.html', 'monthly.html', 'product.html']) {
          const p = path.join(MAIN, f);
          if (!fs.existsSync(p)) continue;
          const s = fs.readFileSync(p, 'utf-8');
          const miss = [...baked].filter(a => s.indexOf(a) < 0);
          if (miss.length) stale.push(f + ' 缺 ' + miss.length + ' 个(例: ' + miss.slice(0, 3).join(',') + ')');
        }
        if (stale.length) soft.push('有页面未随映射重建: ' + stale.join(' · '));
        detail.内嵌映射 = baked.size + ' 个 ASIN';
      }
      report(hard.length ? 'FAIL' : (soft.length ? 'WARN' : 'PASS'),
        'G19 映射一致性(内嵌 product_map.json ⊇ 生效 _map_cache.json / 成本已解析的 ASIN 必在内嵌 / 页面已重建)',
        hard.length ? Object.assign({ 问题: hard }, detail)
          : (soft.length ? Object.assign({ 提示: soft }, detail) : detail));
    }
  } catch (e) {
    report('WARN', 'G19 映射一致性(检查失败)', { error: String((e && e.message) || e) });
  }

  // ---------- H. 每日数据新鲜度 ----------
  const genAt = daily.generatedAt || '';
  const ageDays = genAt ? Math.floor((Date.now() - new Date(genAt)) / 86400000) : 999;
  report(ageDays <= 2 ? 'PASS' : 'WARN', 'G1 daily_data 生成时间新鲜度(<=2天)', { generatedAt: genAt, ageDays });
  const dates = Object.keys(daily.days || {}).sort();
  const recentEmpty = [];
  for (let i = dates.length - 4; i < dates.length; i++) {
    if (i < 0) continue;
    const n = (daily.days[dates[i]].biz || []).length;
    if (n === 0) recentEmpty.push(dates[i]);
  }
  report(recentEmpty.length < 4 ? 'PASS' : 'WARN', 'G2 近4天 biz 数据(全空提示业务报告延迟)', recentEmpty.length ? { empty: recentEmpty } : undefined);

  // ---------- G8. 日数据完整性（防"源数据延迟"被静默当成正常数据入板） ----------
  // 背景(2026-09-24 用户反馈「日数据不对」): 易仓业务报告**按店铺同步**，会出现部分延迟——
  //   实测 9/22 只有 EU 15 行、US 整段缺失；9/23~9/24 全空。看板照常渲染，用户看到"数字不对"却不知原因。
  //   fetch_daily_data.js 现在会写 days[d].incomplete 与顶层 pendingDays（并纳入 30 天复查窗口）。
  const pendingDays = Array.isArray(daily.pendingDays) ? daily.pendingDays : [];
  const last7 = Object.keys(daily.days || {}).sort().slice(-7);
  const recentPending = last7.filter(d => (daily.days[d].incomplete || []).length);
  if (recentPending.length) {
    report('WARN', 'G8 近7天日数据完整性(源数据延迟, 系统会自动复查补齐)', {
      pending: recentPending,
      detail: recentPending.map(d => `${d} 缺 ${(daily.days[d].incomplete || []).join('/')}`).join('; '),
      totalPending: pendingDays.length,
    });
  } else {
    report('PASS', 'G8 近7天日数据完整', undefined);
  }

  // ---------- G9. 重新校准新鲜度（防"轮转卡住"而无人发现） ----------
  // 背景(2026-09-24 用户指出): 复查不只是补空缺，**已采到的日期也要重新校准** —— 上游会改数
  //   （广告花费因无效流量下调、销售额因归因回填后补，实测跨度达 29 天仍有修正）。
  //   fetch_daily_data.js 现在分三层重算：热区(近14天)每天全量 + 空缺日无条件 + 温区(15~45天)轮转，
  //   并把每次重算过的日期写进 days[d].lastChecked，台账写进顶层 calibration。
  // 本项校验：45 天窗口内**每个日期都应有一个"最近被重算过"的时间戳**，且不过期（默认 ≤12 天）。
  //   若普遍缺失 → 说明采集脚本没在跑/被降级；若个别过期 → 说明轮转没推进到位。
  const calib = daily.calibration || null;
  const CALIB_WINDOW = (calib && calib.window && calib.window.calib) || 45;
  const STALE_LIMIT = 12;   // 温区一轮约 7 天，留一倍余量
  const dkeys = Object.keys(daily.days || {}).sort();
  if (!dkeys.length) {
    report('WARN', 'G9 重新校准新鲜度(无数据可校验)', undefined);
  } else {
    const latest = dkeys[dkeys.length - 1];
    const dayMs = 86400000;
    const asMs = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
    const inWindow = dkeys.filter(d => (asMs(latest) - asMs(d)) / dayMs <= CALIB_WINDOW);
    const missing = [], stale = [];
    for (const d of inWindow) {
      const lc = (daily.days[d] || {}).lastChecked;
      if (!lc) { missing.push(d); continue; }
      const age = (asMs(latest) - asMs(lc)) / dayMs;
      if (age > STALE_LIMIT) stale.push({ d, lastChecked: lc, ageDays: age });
    }
    // 热区(最近14天)必须天天空有 lastChecked（它们本就每天全量重拉）—— 缺失即脚本没升级/没跑
    const hotMissing = inWindow.filter(d => (asMs(latest) - asMs(d)) / dayMs <= 13 && !(daily.days[d] || {}).lastChecked);
    if (hotMissing.length) {
      report('FAIL', 'G9 校准台账缺失(近14天无 lastChecked, 采集脚本未升级或未运行)', {
        missingHot: hotMissing.length,
        sample: hotMissing.slice(0, 5),
        hasCalibrationField: !!calib,
      });
    } else if (missing.length || stale.length) {
      report('WARN', `G9 重新校准新鲜度(${CALIB_WINDOW}天窗口内应全部有最近重算记录)`, {
        windowDays: CALIB_WINDOW,
        totalInWindow: inWindow.length,
        neverChecked: missing.length,
        neverCheckedSample: missing.slice(0, 6),
        staleCount: stale.length,
        staleSample: stale.slice(0, 6),
        note: '温区轮转每次取最久未校准的 6 天，约 8 天覆盖温区一轮；刚进入温区的日期需等一轮才会被记录',
      });
    } else {
      report('PASS', `G9 重新校准新鲜度(${inWindow.length}天全部在${STALE_LIMIT}天内重算过)`, {
        lastRunChecked: (calib && calib.checked) || null,
        lastRunChanged: (calib && (calib.changed || []).length) || 0,
      });
    }
  }

  // ---------- H. BuyBox 占有率口径护栏(防"超100%"回归) ----------
  // 历史 bug: product.html 的 asinWeekData() 分子是"该国各天 bb 求和", 分母却写成 acc.bbCount++(每国家+1)
  // → 某 ASIN 一周 7 天各 100% 会显示成 700%。修复见 HANDOVER §8-16。
  // H1 源行值域
  const bbOver = [];
  for (const [day, p] of Object.entries(daily.days || {})) {
    for (const b of (p.biz || [])) {
      const v = parseFloat(b.buy_box_percentage);
      if (!isNaN(v) && (v > 100 || v < 0)) bbOver.push({ day, asin: b.asin, v });
    }
  }
  report(bbOver.length === 0 ? 'PASS' : 'FAIL', 'H1 源数据单行 buy_box_percentage ∈ 0~100', bbOver.length ? { n: bbOver.length, sample: bbOver.slice(0, 5) } : undefined);

  // H2 前端公式(分母必须用 bb_cnt)
  const prodDeploy = path.join(DEPLOY, 'product.html');
  if (fs.existsSync(prodDeploy)) {
    const ph = fs.readFileSync(prodDeploy, 'utf-8');
    const buggy = ph.includes('acc.bbCount++');
    const fixed = ph.includes('acc.bbCount += (d.bb_cnt || 1)');
    report(!buggy && fixed ? 'PASS' : 'FAIL', 'H2 product.html BuyBox 分母用 bb_cnt(非每国家+1)', { buggy, fixed });
  } else {
    report('FAIL', 'H2 product.html 存在');
  }

  // H3 载荷模拟: 逐 ASIN×周 的 bbSum/bbCnt 必须 <=100
  if (fs.existsSync(prodDeploy)) {
    try {
      const pd = extractJsonAfter(fs.readFileSync(prodDeploy, 'utf-8'), 'const DATA');
      const over3 = [];
      let n = 0, mx = 0;
      for (const [asin, av] of Object.entries(pd.asins || {})) {
        for (const [lab, sites] of Object.entries(av.weeks || {})) {
          let s = 0, c = 0;
          for (const v of Object.values(sites)) { s += (+v.bb || 0); c += (+v.bb_cnt || 0); }
          if (!c) continue;
          n++; const avg = s / c; mx = Math.max(mx, avg);
          if (avg > 100.0001) over3.push({ asin, lab, avg: +avg.toFixed(2) });
        }
      }
      report(over3.length === 0 ? 'PASS' : 'FAIL', 'H3 product.html 各 ASIN×周 BuyBox ≤100%', over3.length ? { n: over3.length, sample: over3.slice(0, 5) } : { combos: n, max: +mx.toFixed(2) });
    } catch (e) {
      report('FAIL', 'H3 product.html BuyBox 载荷模拟', { err: e.message.slice(0, 80) });
    }
  }

  // ---------- G7. 线上历史遗留地址必须已是墓碑(部署工具只增不删) ----------
  // 背景(2026-09-23 实测): 本地删掉 _deploy/ad_dashboard.html 再部署, 线上 /ad_dashboard.html
  // 仍 200 返回 727KB 的 9/20 旧副本 —— **本地删 ≠ 线上删**。必须用同名小跳转页覆盖。
  // 判据: 线上该 URL 存在时必须 < 2KB 且正文含 wb-tombstone; 404 也算通过(真被删掉更好)。
  for (const u of LEGACY_URLS) {
    try {
      const res = await fetch(LIVE + '/' + u + '?chk=' + Date.now(), { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) {
        report('PASS', `G7 遗留地址已下线(${u})`, { http: 404 });
        continue;
      }
      const body = await res.text();
      const ok = res.status === 200 && Buffer.byteLength(body, 'utf-8') < 2048 && body.includes('wb-tombstone');
      report(ok ? 'PASS' : 'FAIL', `G7 遗留地址须为墓碑页(${u})`,
        ok ? { http: res.status, bytes: Buffer.byteLength(body, 'utf-8') }
           : { http: res.status, bytes: Buffer.byteLength(body, 'utf-8'), hint: '跑 make_tombstones.py 后重新部署' });
    } catch (e) {
      report('WARN', `G7 遗留地址探测失败(${u}), 网络不可达或超时`, { err: e.message.slice(0, 80) });
    }
  }

  console.log(`\n结果: ${pass} pass, ${warn} warn, ${fail} fail  ${fail === 0 ? '✅ 可上线' : '❌ 存在 FAIL 项, 禁止静默上线'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
