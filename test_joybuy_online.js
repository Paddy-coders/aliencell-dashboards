/**
 * 线上发布验收：字节比对（线上 = 本地）+ 入口端到端功能值复核
 *
 * 为什么必须单独有这一支：
 *   「发布成功」≠「线上已是新版」。CDN 边缘缓存有**几十秒的不一致窗口** ——
 *   实测发布后立刻跑线上 e2e，读到的是旧版（trend 18 行 / 日明细 120 行）；
 *   隔一分钟再跑才是新版（13 / 91）。没有这一步，很容易把缓存窗口误判成
 *   「发布没生效」然后去改正确的代码。
 *
 * 用法：
 *   1) 保活调试浏览器：node joybuy_browser.js --keep        （CDP 9333，默认 headless 无窗口）
 *      跑完务必 node joybuy_browser.js --stop 收尾
 *   2) node test_joybuy_online.js                           # 默认线上固定链接
 *      node test_joybuy_online.js http://127.0.0.1:8917/    # 也可指向本地静态服务
 *      node test_joybuy_online.js <baseUrl> --skip-bytes    # 跳过字节比对，只验功能
 *
 * 断言分两段：
 *   A. 字节比对：线上 joybuy.html 与本地逐字节一致（含「缓存窗口」重试，最多 4 次 × 15s）
 *   B. 功能值：入口 #joybuy → iframe → 7 页签行数 / KPI 5 张 / 6 个筛选下拉 /
 *      **图表 X 轴周数 == 周度表行数 == 周数候选数**（三处口径一致，防「空周还在画」）
 *      · 零 JS 报错
 *
 * 退出码：有任一 FAIL → 1（便于接到自动化里）
 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host/';
const SKIP_BYTES = process.argv.indexOf('--skip-bytes') >= 0;
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const LOCAL = 'joybuy.html';
const TABS = ['trend', 'traffic', 'product', 'funnel', 'channel', 'keyword', 'daily'];

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

function fetchBuf(url) {
  return new Promise((res, rej) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); rej(new Error('HTTP ' + r.statusCode)); return; }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    });
    req.on('error', rej);
    req.on('timeout', function () { this.destroy(); rej(new Error('请求超时')); });
  });
}

(async () => {
  console.log('base =', BASE);

  // ---------------- A. 字节比对 ----------------
  console.log('\n=== A. 线上与本地逐字节比对 ===');
  if (SKIP_BYTES) {
    console.log('  （已按 --skip-bytes 跳过）');
  } else {
    const localBuf = fs.readFileSync(LOCAL);
    const localMd5 = md5(localBuf);
    let remoteBuf = null, remoteMd5 = '', tries = 0;
    for (let i = 1; i <= 4; i++) {
      tries = i;
      try {
        // ⚠ 必须带唯一 cb：裸 URL 与入口真正用的 ?v=<当前小时数> 都会被 CDN 边缘缓存命中旧变体。
        //   不带 cb 时比到的「线上」其实是缓存副本，会把刚发布的新版误判成旧版（2026-09-28 实测踩到）。
        remoteBuf = await fetchBuf(BASE + 'joybuy.html?cb=' + Date.now() + Math.random().toString(16).slice(2));
        remoteMd5 = md5(remoteBuf);
      } catch (e) { console.log('  第 ' + i + ' 次取回失败：' + e.message); }
      if (remoteMd5 && remoteMd5 === localMd5) break;
      if (i < 4) {
        console.log('  第 ' + i + ' 次不一致（线上 ' + (remoteBuf ? remoteBuf.length + 'B' : '—') +
          ' / 本地 ' + localBuf.length + 'B），等 15s 重试…');
        await sleep(15000);
      }
    }
    ck('线上 joybuy.html 与本地逐字节一致', remoteMd5 === localMd5 && remoteMd5 !== '',
      remoteMd5 === localMd5 ? 'md5 ' + localMd5.slice(0, 8) + '… ' + localBuf.length + 'B'
        : '线上 ' + (remoteMd5 || '—') + ' ≠ 本地 ' + localMd5 + '（重试 ' + tries + ' 次）');
    if (remoteMd5 !== localMd5) {
      console.log('  ⚠ 若刚发布完，这可能是 **CDN 缓存不一致窗口**（几十秒）——' +
        '先等 30~60s 重跑本脚本，别急着改代码。');
    } else {
      // 源站已是新版。顺手体检入口真正使用的那个变体（?v=<当前小时数>）在边缘缓存里的状态：
      // CDN 按完整 URL 缓存，若同一小时内已有人抓过旧内容，「当小时」就会持续命中旧版。
      // 每周自动化 15:30 发布时正好与 15:00 那条任务同属一个小时 —— 这条提示能把它暴露出来。
      const hourly = BASE + 'joybuy.html?v=' + Math.floor(Date.now() / 3600000);
      try {
        const hb = await fetchBuf(hourly);
        const same = md5(hb) === localMd5;
        console.log('  ℹ 入口变体 ' + hourly.split('/').pop() + ' → ' + hb.length + 'B' +
          (same ? '（与本地一致 ✓）'
                : '（⚠ 边缘缓存仍是旧版，换到下一个整点、?v 变化后自动恢复；'
                  + '这期间从入口点进 JoyBuy 会看到上一版）'));
      } catch (e) { console.log('  ℹ 入口变体体检跳过：' + e.message); }
    }
  }

  // ---------------- B. 功能值 ----------------
  console.log('\n=== B. 入口端到端功能值 ===');
  const b = await chromium.connectOverCDP(CDP);
  const page = await b.contexts()[0].newPage();
  const errs = [];
  // 关掉浏览器 HTTP 缓存：否则 iframe 会命中磁盘缓存里的旧 joybuy.html?v=<小时数>，
  // 让「刚发布的新版」在功能断言里表现为旧版（2026-09-28 实测踩到）。
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (e) { console.log('  ℹ 关闭浏览器缓存失败（忽略）：' + e.message); }
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

  // 外壳会异步校验 Supabase 会话，只桩掉 auth/v1，其余（含看板本体）走真实文件
  await page.route('**/auth/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'online', email: 'online@local', role: 'authenticated' }),
  }));
  await page.addInitScript(() => {
    try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'online', user: { email: 'online@local', role: 'admin' } })); } catch (e) {}
  });
  await page.setViewportSize({ width: 1680, height: 1100 });

  await page.goto(BASE + 'index.html#joybuy', { waitUntil: 'load', timeout: 60000 });
  await sleep(6000);

  const shell = await page.evaluate(() => ({
    active: (document.querySelector('.nav-item.active') || {}).getAttribute
      ? document.querySelector('.nav-item.active').getAttribute('data-id') : '',
    frame: (document.getElementById('frame') || {}).src || '',
  }));
  ck('外壳 #joybuy 直达高亮', shell.active === 'joybuy', shell.active);
  ck('iframe 指向 joybuy.html', /joybuy\.html/.test(shell.frame), shell.frame.split('/').pop());

  const fr = page.frames().find((f) => f.url().indexOf('joybuy.html') >= 0);
  ck('找到 joybuy iframe', !!fr, fr ? fr.url().split('/').pop() : '');
  if (fr) {
    // 入口塞给 iframe 的 src 是 joybuy.html?v=<小时数>，会命中 CDN 边缘缓存；这里再用唯一 cb
    // 取一次「源站当前内容」，下面的功能断言全部基于它 —— 验的是**部署的文件本身**，
    // 而不是 CDN 副本（否则会把边缘缓存的旧版当成"线上没生效"）。
    await fr.goto(BASE + 'joybuy.html?cb=' + Date.now(), { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await fr.waitForSelector('.tab[data-p="keyword"]', { timeout: 20000 }).catch(() => {});
    await sleep(1800);

    const head = await fr.evaluate(() => ({
      kpis: document.querySelectorAll('.kpi').length,
      dd: document.querySelectorAll('.dd').length,
      wkOpts: document.querySelectorAll('#ddWeekList .dd-opt').length,
      siteOpts: document.querySelectorAll('#ddSiteList .dd-opt').length,
      tabs: document.querySelectorAll('.tab').length,
      win: (document.getElementById('winBadge') || {}).textContent || '',
    }));
    ck('KPI 固定 5 张', head.kpis === 5, '实际 ' + head.kpis);
    ck('筛选下拉 6 个', head.dd === 6, '实际 ' + head.dd);
    ck('标签页 7 个', head.tabs === 7, '实际 ' + head.tabs);
    ck('国家候选 4 站', head.siteOpts === 4, '实际 ' + head.siteOpts);
    ck('周数候选非空', head.wkOpts > 0, head.wkOpts + ' 项');
    ck('窗口标签已渲染', /^\s*窗口\s+\d{4}-\d{2}-\d{2}/.test(head.win), head.win.trim());

    // 逐页签行数（.tbl-wrap 各自 tbody tr）
    const rows = {};
    for (const t of TABS) {
      await fr.evaluate((x) => document.querySelector('.tab[data-p="' + x + '"]').click(), t);
      await sleep(1200);
      const st = await fr.evaluate((x) => {
        const p = document.getElementById('pane-' + x);
        if (!p || p.offsetParent === null) return null;
        const out = {};
        p.querySelectorAll('.tbl-wrap').forEach((w) => { out[w.id] = w.querySelectorAll('tbody tr').length; });
        return out;
      }, t);
      rows[t] = st || {};
      ck('页签 ' + t + ' 有内容', st && Object.values(st).some((n) => n > 0),
        st ? JSON.stringify(st) : '不可见');
    }

    // ★ 口径一致性：图表 X 轴周数 == 周度表行数 == 周数候选（防「空周还在画 / 筛选没作用到图」）
    await fr.evaluate(() => document.querySelector('.tab[data-p="trend"]').click());
    await sleep(1200);
    const axis = await fr.evaluate(() => {
      const c = window.Chart && Chart.getChart('c1');
      return c ? c.data.labels.map(String) : [];
    });
    const wkRows = (rows.trend || {}).tblWeeks || 0;
    ck('图表 X 轴周数 == 周度表行数', axis.length > 0 && axis.length === wkRows,
      axis.length + ' vs ' + wkRows + ' 周');
    ck('图表 X 轴周数 == 周数候选数', axis.length > 0 && axis.length === head.wkOpts,
      axis.length + ' vs ' + head.wkOpts);
    ck('每日明细行数 ≈ 周数 × 7（无早期空周残留）',
      rows.daily && rows.daily.tblDaily > 0 &&
      rows.daily.tblDaily <= axis.length * 7 && rows.daily.tblDaily > (axis.length - 1) * 7,
      (rows.daily || {}).tblDaily + ' 行 / ' + axis.length + ' 周');
    console.log('    X 轴: ' + axis.join(' '));

    // 周度表首行必须与图表首个周一致（空周不展示的直接判据）
    const firstRowWeek = await fr.evaluate(() => {
      const r = document.querySelector('#tblWeeks table tbody tr');
      return r ? (r.innerText || '').split('\t')[0].trim() : '';
    });
    ck('周度表首行 == 图表首个周', !!firstRowWeek && firstRowWeek.indexOf(axis[0]) === 0,
      firstRowWeek + ' / ' + axis[0]);
  }

  ck('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); process.exit(1); });
