// test_unmapped_notice.js — 未维护成本依据提醒（2026-10-21 新增）
// 覆盖: ① mapping.html 顶部红条按云端 unmapped 显示 ② 点开弹窗列出明细 ③ 选产品名后「建立」可用
//      ④ index.html 左侧「产品关系管理」红色感叹号随 unmapped 出现 ⑤ 全程无 console 报错
// 用法: node test_unmapped_notice.js
const { chromium } = require('./playwright-auth');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + JSON.stringify(detail)); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 期望值：直接读云端 unmapped，独立算一遍（不做硬编码）
  const res = await fetch(SB_URL, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  const row = (await res.json())[0].data;
  const rep = row.unmapped;
  const costNames = new Set(Object.keys((row.costTable || {}).products || {}));
  const mapped = {};
  (row.asinMap || []).forEach(m => { if (m.asin) mapped[String(m.asin).toUpperCase()] = m; });
  const expectLeft = (rep && rep.items || []).filter(it => {
    const m = mapped[String(it.asin || '').toUpperCase()];
    if (!m) return true;
    return !costNames.has(m.name);
  });
  console.log('云端 unmapped: %s 条 · 实时过滤后待处理 %d 条',
    (rep && rep.items || []).length, expectLeft.length);

  const browser = await chromium.launch();
  const errs = [];

  // ---------- ① mapping.html ----------
  {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push('mapping: ' + m.text()); });
    page.on('pageerror', e => errs.push('mapping pageerror: ' + e.message));
    await page.goto('file:///' + BASE.replace(/\\/g, '/') + '/mapping.html');
    await sleep(2600);                       // 等 cloudLoad + loadUnmapped(900ms 后)

    const barOn = await page.evaluate(() => {
      const b = document.getElementById('umBar');
      return b ? b.classList.contains('on') : null;
    });
    const cnt = await page.evaluate(() => Number(document.getElementById('umCount').textContent || 0));
    t('未映射提醒条按需显示', expectLeft.length ? barOn === true : barOn === false, { barOn, expect: expectLeft.length });
    t('提醒条数量 = 实时过滤后的待处理数', cnt === expectLeft.length, { 页面: cnt, 期望: expectLeft.length });

    if (expectLeft.length) {
      // 首次发现条目会自动弹一次（同一会话只弹一次）→ 已弹就不用再点红条
      const auto = await page.evaluate(() => document.getElementById('umMask').classList.contains('on'));
      t('首次发现未维护项 → 自动弹窗提醒', auto === true, { auto });
      if (!auto) { await page.click('#umBar'); await sleep(300); }
      const st = await page.evaluate(() => {
        const mask = document.getElementById('umMask');
        const rows = document.querySelectorAll('#umTable tbody tr');
        const firstSel = document.querySelector('#umTable tbody select');
        const btn = document.querySelector('#umTable tbody button');
        return {
          open: mask.classList.contains('on'),
          rows: rows.length,
          hasSelect: !!firstSel,
          selectOpts: firstSel ? firstSel.options.length : 0,
          btnDisabled: btn ? btn.disabled : null,
          firstAsin: rows.length ? rows[0].children[0].textContent.trim() : ''
        };
      });
      t('弹窗可打开', st.open);
      t('弹窗行数 = 待处理数', st.rows === expectLeft.length, { 页面: st.rows, 期望: expectLeft.length });
      t('每行有产品名下拉', st.hasSelect && st.selectOpts > 1, { opts: st.selectOpts });
      t('未选产品名时「建立」禁用', st.btnDisabled === true);
      t('首行是金额最大的那条', st.firstAsin === expectLeft[0].asin, { 页面: st.firstAsin, 期望: expectLeft[0].asin });

      // 选一个产品名 → 按钮启用
      const r = await page.evaluate(() => {
        const sel = document.querySelector('#umTable tbody select');
        const opt = [...sel.options].find(o => o.value);
        if (!opt) return { ok: false };
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change'));
        const btn = sel.closest('tr').querySelector('button');
        return { ok: true, name: opt.value, enabled: !btn.disabled };
      });
      t('选完产品名后「建立」可用', r.ok && r.enabled === true, r);
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('#umMask .um-foot button')];
        const b = btns.find(x => x.textContent.trim() === '关闭') || btns[btns.length - 1];
        b.click();
      });
      await sleep(200);
      const closed = await page.evaluate(() => !document.getElementById('umMask').classList.contains('on'));
      t('「关闭」可收起弹窗', closed);
    }
    await page.close();
  }

  // ---------- ② index.html 红色感叹号 ----------
  {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push('index: ' + m.text()); });
    page.on('pageerror', e => errs.push('index pageerror: ' + e.message));
    // 壳页会异步校验 token（假 token → 403 → 跳登录页）⇒ 桩掉 /auth/v1/user
    await page.route('**/auth/v1/user', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'test-user', email: 'tester@aliencell.com' })}));
    await page.goto('file:///' + BASE.replace(/\\/g, '/') + '/_deploy/index.html');
    await sleep(2600);
    const st = await page.evaluate(() => {
      const el = document.getElementById('mapAlert');
      return el ? { display: getComputedStyle(el).display, text: el.textContent, title: el.title } : null;
    });
    t('入口红色感叹号按需显示',
      expectLeft.length ? (st && st.display !== 'none' && st.text === '!') : (st && st.display === 'none'),
      { st, expect: expectLeft.length });
    if (expectLeft.length) t('感叹号 tooltip 带数量',
      (st.title || '').indexOf(expectLeft.length + ' 个 ASIN') >= 0, st.title);
    await page.close();
  }

  t('无 console / pageerror', errs.length === 0, errs.slice(0, 4));

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(2); });
