// test_auth_guard.js — 子页面认证守卫回归
//
// 背景：2026-09-23 给 7 个看板子页面加了认证守卫（此前只有壳页 index.html 有守卫，
//       拿到直链就能绕过登录直接打开）。本测试锁住：
//         1. 未登录 → 7 个子页面都必须跳转 login.html
//         2. 已登录 → 7 个子页面都必须正常渲染（不被守卫误伤）
//         3. 壳页 index.html 守卫仍在；login.html 自身不能被守卫（否则死循环）
//         4. 子页面被嵌在 iframe 里且未登录 → 让顶层窗口跳转（壳页场景）
//         5. 遗留地址 ad_dashboard.html 是墓碑跳转页：链到 ad.html，且没被塞回旧看板副本
//
// 关键：本文件刻意「不使用」登录态注入（noAuth: true），否则测不到守卫本身。
//       已登录路径用 playwright-auth 的默认注入（不传 noAuth）验证。

const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

// 子页面 → 期望标题（用于确认「真的渲染了」而不是白屏）
const PAGES = [
  ['woot.html',    'Aliencell Woot 数据管理'],
  ['daily.html',   'Aliencell 每日数据看板'],
  ['product.html', 'Aliencell 多国产品报告 + 广告总览 - Week 汇总'],
  ['ad.html',      'Aliencell 广告周度分析看板'],
  ['monthly.html', 'Aliencell 月度数据看板'],
  ['target.html',  'Aliencell 月度目标追踪看板'],
  ['mapping.html', 'Aliencell 产品映射管理'],
];

const short = u => String(u).replace(BASE, '');

// 必须带 cache-buster 请求：线上（CDN）对裸 URL 会返回旧的「压缩变体」
// （实测 curl 不带 Accept-Encoding 拿到新版、浏览器带 gzip 拿到旧版），
// 不带 cb 会验到上一版，导致冒烟测试结论完全反了。
let _seq = 0;
const U = f => `${BASE}/${f}?cb=${Date.now()}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---------- 1. 未登录：每个子页面都必须被重定向到 login.html ----------
  console.log('-- 未登录：子页面应跳转登录页 --');
  for (const [file] of PAGES) {
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(U(file), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(800);
      const url = page.url();
      let title = ''; try { title = await page.title(); } catch (e) {}
      t(`未登录 ${file} → 跳转登录页`, /login\.html/.test(url), { url: short(url), title });
    } catch (e) {
      t(`未登录 ${file} → 跳转登录页`, false, { error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }

  // ---------- 2. 已登录：每个子页面都必须正常渲染（守卫不误伤） ----------
  console.log('-- 已登录：子页面应正常渲染 --');
  for (const [file, expectTitle] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    try {
      await page.goto(U(file), { waitUntil: 'domcontentloaded', timeout: 30000 });
      // daily.html 有 4MB+，固定 sleep 会读到「Loading …」这种临时标题，
      // 这里等到标题被真正设置（最多 20s），再断言。
      await page.waitForFunction(exp => document.title === exp, expectTitle, { timeout: 20000 }).catch(() => {});
      const url = page.url();
      let title = ''; try { title = await page.title(); } catch (e) {}
      const notRedirected = !/login\.html/.test(url);
      t(`已登录 ${file} 未被重定向`, notRedirected, { url: short(url) });
      t(`已登录 ${file} 渲染出正确页面`, title === expectTitle, { title, expectTitle });
      t(`已登录 ${file} 无 JS 错误`, errs.length === 0, errs.slice(0, 2));
    } catch (e) {
      t(`已登录 ${file} 正常渲染`, false, { error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }

  // ---------- 3. 壳页与登录页自身 ----------
  console.log('-- 壳页 / 登录页 --');
  {
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(U('index.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(800);
    t('未登录 index.html → 跳转登录页（壳页守卫仍在）', /login\.html/.test(page.url()), { url: short(page.url()) });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(U('login.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(600);
    const title = await page.title();
    // login.html 若也被守卫会导致「跳自己」死循环，这里必须能停留并渲染
    t('login.html 无需登录即可访问且不自我重定向（无死循环）',
      /login\.html/.test(page.url()) && /登录/.test(title), { url: short(page.url()), title });
    await ctx.close();
  }

  // ---------- 4. iframe 内未登录：应让顶层窗口跳转 ----------
  console.log('-- iframe 场景（壳页入口）--');
  {
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    // 用一个带标记 query 的父页承载 iframe；若顶层被跳转，标记会消失
    await page.goto(`${BASE}/login.html?me=parent&cb=${Date.now()}${Math.random().toString(36).slice(2, 7)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      const f = document.createElement('iframe');
      f.id = 'authProbeFrame';
      f.style.cssText = 'width:600px;height:400px';
      f.src = 'daily.html?cb=' + Date.now() + Math.random();
      document.body.appendChild(f);
    });
    await page.waitForTimeout(1500);
    const topUrl = page.url();
    t('iframe 内未登录 → 顶层窗口跳转登录页（不是只在框内跳）',
      !topUrl.includes('me=parent'), { topUrl: short(topUrl) });
    await ctx.close();
  }

  // ---------- 5. 遗留地址墓碑页（2026-09-23） ----------
  // 背景：ad_dashboard.html 是广告看板的旧构建产物名，早已改名为 ad.html，但**已上线过**——
  //       发布工具只增不删（本地删掉重新部署，线上仍 200 返回 727KB 旧副本），
  //       故改放同名小跳转页覆盖。此处锁住「浏览器里的真实跳转链」，
  //       curl 比字节只能证明文件对，证明不了用户点旧书签会被带到哪儿。
  console.log('-- 遗留地址 /ad_dashboard.html（应跳转到正式看板）--');
  const AD_TITLE = 'Aliencell 广告周度分析看板';
  {
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(U('ad_dashboard.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      t('未登录旧地址 ad_dashboard.html → 墓碑→ad.html→守卫→login.html',
        /login\.html/.test(page.url()), { url: short(page.url()) });
    } catch (e) {
      t('未登录旧地址 ad_dashboard.html → 跳转链', false, { error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    try {
      await page.goto(U('ad_dashboard.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(exp => document.title === exp, AD_TITLE, { timeout: 20000 }).catch(() => {});
      const title = await page.title();
      t('已登录旧地址 ad_dashboard.html → 落到 ad.html 并渲染广告看板',
        /\/ad\.html/.test(page.url()) && title === AD_TITLE, { url: short(page.url()), title });
      t('旧地址跳转后无 JS 错误', errs.length === 0, errs.slice(0, 2));
    } catch (e) {
      t('已登录旧地址 ad_dashboard.html → 正常渲染', false, { error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }
  {
    // 墓碑页本身必须「小且只跳转」—— 若有人把旧看板副本塞回这个文件名，这里会红
    const ctx = await browser.newContext({ noAuth: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(U('login.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const info = await page.evaluate(async (url) => {
        const res = await fetch(url, { cache: 'no-store' });
        const txt = await res.text();
        return {
          status: res.status,
          bytes: new TextEncoder().encode(txt).length,
          tomb: txt.includes('wb-tombstone'),
          refresh: /http-equiv="refresh"/.test(txt),
        };
      }, U('ad_dashboard.html'));
      t('旧地址仍是墓碑页（<2KB + wb-tombstone + refresh），未变回旧看板副本',
        info.status === 200 && info.bytes < 2048 && info.tomb && info.refresh, info);
    } catch (e) {
      t('旧地址墓碑页探针', false, { error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
