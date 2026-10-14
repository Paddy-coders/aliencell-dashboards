// test_panel_defaults.js — 各看板「进入默认状态」回归测试
//
// 需求（用户 2026-10-12）：面板进去默认就展示所有的站点平台数据之和。
// 即：**任何看板首屏都不得预置筛选** —— 每个筛选器默认都应是「全部」。
//
// 核心不变式（对所有看板通用）：
//   页面上每一个 .dd-summary（筛选器当前值）默认文本都必须表达「全部/不筛选」。
// 另加各看板的具体默认值断言（日期范围、月份数、平台、KPI 副标等）。
//
// 坑：各看板有「认证守卫」，file:// 打开时 localStorage 无 wb_auth 会跳 login.html
//     ⇒ 必须先 addInitScript 预置登录态。
//
// 用法：node test_panel_defaults.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; fails.push(name); console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}
const lg = (t) => console.log(t);

// 有筛选器的看板（woot / mapping 无筛选器，不参与）
const PAGES = [
  { file: 'daily.html', name: '每日数据看板' },
  { file: 'monthly.html', name: '月度数据看板' },
  { file: 'target.html', name: '月度目标追踪' },
  { file: 'product.html', name: '周度汇总看板' },
  { file: 'joybuy.html', name: 'JoyBuy 看板' },
  { file: 'ad_dashboard.html', name: '广告周度看板' },
];

const AUTH = JSON.stringify({ access_token: 't', refresh_token: 't', email: 't@example.com', exp: Date.now() + 864e5 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route('**/rest/v1/mapping*', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) });
  });

  const snap = {};
  for (const p of PAGES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
    await page.addInitScript((a) => { try { localStorage.setItem('wb_auth', a); } catch (e) {} }, AUTH);
    await page.goto('file:///' + path.resolve(BASE, p.file).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);

    const r = await page.evaluate(() => ({
      login: location.href.indexOf('login.html') >= 0,
      sums: Array.from(document.querySelectorAll('.dd-summary')).map((e) => ({ id: e.id, text: (e.textContent || '').trim() })),
      badge: (document.getElementById('rangeBadge') || {}).textContent || '',
      kpiSubs: Array.from(document.querySelectorAll('.kpi .sub,.kpi-sub')).map((e) => (e.textContent || '').trim()),
      kpiCount: document.querySelectorAll('#kpiRow .kpi').length,
    }));

    lg('\n===== ' + p.name + ' (' + p.file + ') =====');
    if (r.login) { ok(false, p.name + ' 未被认证守卫重定向'); await page.close(); continue; }

    // ① 通用不变式：每个筛选器默认都表达「全部」
    const bad = r.sums.filter((s) => !/全部|不筛选/.test(s.text));
    ok(r.sums.length > 0, p.name + ' 存在筛选器', String(r.sums.length));
    ok(bad.length === 0, p.name + ' 所有筛选器默认都为「全部」',
      bad.length ? bad.map((b) => (b.id || '?') + '=' + b.text).join(' ; ') : r.sums.map((s) => s.text).join(' / '));

    // ② 无 JS 报错
    ok(errs.length === 0, p.name + ' 加载无 JS 报错', errs.slice(0, 2).join(' | ') || '(none)');

    snap[p.file] = r;
    await page.close();
  }

  // ---------- 各看板具体默认值 ----------
  lg('\n===== 各看板默认口径明细 =====');

  // 每日：日期范围必须覆盖全部有数据的天
  {
    const r = snap['daily.html'];
    if (r) {
      const m = r.badge.match(/(\d+)\s*天/);
      const days = JSON.parse(fs.readFileSync(path.join(BASE, 'daily_data.json'), 'utf8')).days;
      const expect = Array.isArray(days) ? days.length : Object.keys(days || {}).length;
      ok(!!m && Number(m[1]) === expect, '每日看板默认日期范围 = 全部天数',
        (m ? m[1] : '?') + ' 天 vs 数据 ' + expect + ' 天');
      ok(/币种:\$\(默认\)|币种:\$/.test(r.badge) || /默认/.test(r.badge),
        '每日看板默认币种为多国混合（$ 默认）', r.badge.slice(0, 80));
    }
  }

  // 月度：KPI 副标 = 全部月份合计（月份来自 daily_data.json 的 day→ym 去重）
  {
    const r = snap['monthly.html'];
    if (r) {
      const dd = JSON.parse(fs.readFileSync(path.join(BASE, 'daily_data.json'), 'utf8')).days || {};
      const ymSet = new Set(Object.keys(dd).map((d) => d.slice(0, 7)));
      const allSum = r.kpiSubs.length > 0 && r.kpiSubs.every((t) => /合计/.test(t));
      ok(allSum, '月度看板 KPI 副标全部为「N 个月合计」', r.kpiSubs.slice(0, 3).join(' | '));
      ok(new RegExp(ymSet.size + '\\s*个月').test(r.badge), '月度看板徽标月份数 = 数据月份数',
        r.badge + ' / 数据 ' + ymSet.size + ' 个月');
    }
  }

  // 目标：默认平台 = 全部平台
  {
    const r = snap['target.html'];
    if (r) {
      const plat = r.sums.find((s) => s.id === 'ddPlatformSummary');
      ok(!!plat && /全部平台/.test(plat.text), '目标看板默认平台 = 🌐 全部平台', plat ? plat.text : '(缺)');
    }
  }

  // 周看板 / 广告看板：渠道默认合并
  ['product.html', 'ad_dashboard.html'].forEach((f) => {
    const r = snap[f];
    if (r) {
      const ch = r.sums.find((s) => s.id === 'ddChannelSummary');
      ok(!!ch && /合并/.test(ch.text), (f === 'product.html' ? '周度' : '广告') + '看板默认销售店铺 = 全部（合并）',
        ch ? ch.text : '(缺)');
    }
  });

  await browser.close();
  lg('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  if (fails.length) { lg('失败项: ' + fails.join('; ')); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL: ' + e.message); process.exitCode = 1; });
