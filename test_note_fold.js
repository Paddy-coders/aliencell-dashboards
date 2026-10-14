/* test_note_fold.js — 折叠块浏览器实测（真值校验版）
 *
 * 三个坑（都踩过）：
 * 1) 各看板有「认证守卫」，file:// 打开时 localStorage 无 wb_auth 会跳 login.html
 *    ⇒ 必须先用 addInitScript 预置登录态，否则测的是登录页。
 * 2) Chromium 的 <details> 收起态用 content-visibility:hidden 实现，
 *    收起时子元素 getBoundingClientRect() 仍返回上次布局尺寸（不是 0）
 *    ⇒ 也不能信 checkVisibility({contentVisibilityAuto})（离屏内容判 false）。
 *    真值用 <details> 元素自身高度：收起 = summary 高度，展开 = summary + 正文。
 * 3) 点击 summary 可能触发页面重渲染并**替换掉 details 节点**
 *    ⇒ 绝不能在「点击的同一次 evaluate 里读 open」，否则读到的是已脱落的旧节点。
 *    必须：点击 → wait → 重新 querySelector 再读。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILES = ['monthly.html', 'target.html', 'product.html', 'daily.html',
  'joybuy.html', 'woot.html', 'mapping.html'];

const AUTH = JSON.stringify({
  access_token: 'verify-only-token', refresh_token: 'verify-only-refresh',
  email: 'verify@local', exp: Date.now() + 86400000,
});

const Q = () => {
  const ds = Array.from(document.querySelectorAll('details.noteFold'));
  const d = ds[0];
  const body = d ? d.querySelector('.note,.foot-note') : null;
  return {
    n: ds.length,
    openCount: ds.filter((x) => x.open).length,
    hidden: ds.filter((x) => getComputedStyle(x).display === 'none').length,
    open: d ? d.open : null,
    dH: d ? Math.round(d.getBoundingClientRect().height) : -1,
    sumH: d ? Math.round(d.querySelector('summary').getBoundingClientRect().height) : -1,
    noteTextLen: body ? body.textContent.trim().length : 0,
    summaryText: d ? (d.querySelector('summary').textContent || '').trim().slice(0, 40) : '',
    hasCss: !!Array.from(document.querySelectorAll('style')).find((s) => s.textContent.indexOf('note-fold: 解释块折叠') >= 0),
    emptyOk: ds.every((x) => {
      const b = x.querySelector('.note,.foot-note');
      return (b && b.textContent.trim()) ? true : getComputedStyle(x).display === 'none';
    }),
  };
};

const clickSummary = () => {
  const d = document.querySelector('details.noteFold');
  if (d) d.querySelector('summary').click();
  return !!d;
};

(async () => {
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const bad = [];
  const chk = (ok, msg, extra) => {
    if (ok) pass++;
    else { fail++; bad.push(msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
  };

  for (const f of FILES) {
    const fp = path.resolve(f);
    if (!fs.existsSync(fp)) { console.log(String(f).padEnd(15) + ' 缺失'); continue; }
    // 每个文件独立 context：必须桩掉 Supabase mapping 请求。
    // 真连云端时 cloudWootSync / 映射同步发现本机缓存与云端不同 → location.reload()
    // → evaluate 的 execution context 被销毁（症状：点击 summary 后报
    //   "Execution context was destroyed, most likely because of a navigation"）。
    // 桩成空 catalog/asinMap 且无 woot 键 ⇒ 两处同步都在开头 return，页面不会自己刷新。
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.route('**/rest/v1/mapping*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) });
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
    await page.addInitScript((a) => {
      try {
        localStorage.setItem('wb_auth', a);
        localStorage.setItem('pc_woot', '[]');   // 双保险：本机缓存与空云端一致，不触发刷新
      } catch (e) {}
    }, AUTH);
    await page.goto('file:///' + fp.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const r0 = await page.evaluate(Q);
    if (r0.n === 0) { console.log(f.padEnd(15) + ' 无折叠块'); await ctx.close(); continue; }

    chk(r0.hasCss, f + ' 折叠样式已注入');
    chk(r0.openCount === 0, f + ' 默认应全部收起', { n: r0.n, openCount: r0.openCount });
    chk(r0.dH <= r0.sumH + 6, f + ' 收起时 details 高度≈summary（正文不占位）', { details: r0.dH, summary: r0.sumH });
    chk(r0.emptyOk, f + ' 空内容折叠块被自动隐藏');

    // 展开：点击 → wait → 重新查询再读（防节点被重渲染替换）
    await page.evaluate(clickSummary);
    await page.waitForTimeout(250);
    const r1 = await page.evaluate(Q);
    chk(r1.open === true, f + ' 点击 summary 能展开', { open: r1.open });
    chk(r1.dH > r0.dH + 20, f + ' 展开后 details 变高（证明收起真的省了空间）', { closed: r0.dH, opened: r1.dH });

    // 收起：同样拆开
    await page.evaluate(clickSummary);
    await page.waitForTimeout(250);
    const r2 = await page.evaluate(Q);
    chk(r2.open === false, f + ' 再次点击能收起', { open: r2.open });
    chk(Math.abs(r2.dH - r0.dH) <= 8, f + ' 收起后 details 高度回落', { closed: r0.dH, back: r2.dH });

    chk(errs.length === 0, f + ' 无 JS 报错', errs.slice(0, 2));

    console.log(f.padEnd(15) + ' blocks=' + r0.n + ' 收起=' + r0.dH + 'px 展开=' + r1.dH +
      'px 正文' + r0.noteTextLen + '字  ' + r0.summaryText);
    await ctx.close();
  }

  await browser.close();
  console.log('\n结果: ' + pass + ' pass, ' + fail + ' fail');
  if (bad.length) { console.log('\n失败明细:'); bad.forEach((b) => console.log('  ✗ ' + b)); }
  process.exit(fail ? 1 : 0);
})();
