// test_search_confirm.js — 搜索下拉回归: 输入→过滤→点击选项→确认生效→表格更新, 全程无页面错误
// 背景: 2026-09-17 daily.html 的 seller_sku 变为数组导致 ASIN 搜索抛错、renderAll 中断、看板冻结
// 用法: BASE=<url> node test_search_confirm.js  (默认 http://127.0.0.1:8899)
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  ${JSON.stringify(detail)}`); }
}
// 各看板的下拉定义: [面板id, 搜索input id后缀, 摘要元素id, 搜索词来源选项选择器]
const CASES = [
  { page: '/daily.html', dds: [
    { dd: 'ddAsin', search: 'ddAsinSearch', summary: 'ddAsinSummary', term: 'ACD' },
    { dd: 'ddSeries', search: 'ddSeriesSearch', summary: 'ddSeriesSummary', term: null }, // term=null: 用第一个选项文本
    { dd: 'ddName', search: 'ddNameSearch', summary: 'ddNameSummary', term: null },
  ], tableSel: '#tableWrap tbody tr' },
  { page: '/ad.html', dds: [
    { dd: 'ddAsin', search: 'ddAsinSearch', summary: 'ddAsinSummary', term: 'B0H' },
    { dd: 'ddSeries', search: 'ddSeriesSearch', summary: 'ddSeriesSummary', term: null },
    { dd: 'ddName', search: 'ddNameSearch', summary: 'ddNameSummary', term: null },
  ], tableSel: '#tableWrap tbody tr' },
  { page: '/product.html', dds: [
    { dd: 'ddAsin', search: 'ddAsinSearch', summary: 'ddAsinSummary', term: 'B0H' },
    { dd: 'ddSeries', search: 'ddSeriesSearch', summary: 'ddSeriesSummary', term: null },
    { dd: 'ddName', search: 'ddNameSearch', summary: 'ddNameSummary', term: null },
  ], tableSel: '#tableWrap tbody tr' },
];
(async () => {
  const browser = await chromium.launch();
  // 认证守卫: 注入 wb_auth stub + 拦截 Supabase auth 校验, 否则线上页面守卫中途跳转打断测试(竞态)
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 960 } });
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"email":"test@aliencell.com","role":"viewer"}' }));
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'stub-token', refresh_token: 'stub-refresh', expires_at: Date.now() + 3600000, user: { email: 'test@aliencell.com' }, role: 'viewer' })); } catch (e) {}
  });
  const browserCtx = ctx;
  for (const c of CASES) {
    console.log(`===== ${c.page}`);
    const page = await browserCtx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    try { await page.goto(BASE + c.page, { waitUntil: 'load', timeout: 90000 }); }
    catch (e) { t(`${c.page} 加载`, false, e.message); await page.close(); continue; }
    await page.waitForTimeout(2500);
    errs.length = 0; // 忽略加载期既有噪音
    for (const d of c.dds) {
      const r = await page.evaluate(({ dd, search, term }) => {
        const box = document.getElementById(dd);
        if (!box) return { missing: true };
        const inp = box.querySelector('input');
        if (!inp) return { noInput: true };
        const sumEl = document.getElementById(search.replace('Search', 'Summary')) || document.getElementById(dd + 'Summary');
        const summaryBefore = sumEl ? sumEl.textContent : null;
        // 打开面板(触发 toggleDD 以复现真实路径)
        if (typeof toggleDD === 'function') { box.classList.remove('open'); toggleDD(dd); }
        else box.classList.add('open');
        const nAll = box.querySelectorAll('.dd-opt').length;
        // 取第一个选项的名称文本作为搜索词
        const firstName = term || ((box.querySelector('.dd-opt .opt-name') || box.querySelector('.dd-opt') || {}).textContent || '').trim().slice(0, 3);
        const inp2 = document.getElementById(search) || box.querySelector('input');
        inp2.value = firstName;
        inp2.dispatchEvent(new Event('input', { bubbles: true }));
        const nFiltered = box.querySelectorAll('.dd-opt').length;
        // 点击第一个"非置灰"选项 (置灰=无数据, 点击不生效属设计行为); 无非置灰时点置灰项验证不误选
        const opt = box.querySelector('.dd-opt:not(.dim)') || box.querySelector('.dd-opt');
        const clickedDim = opt && opt.classList.contains('dim');
        if (opt) opt.click();
        const summaryAfter = sumEl ? sumEl.textContent : null;
        return { nAll, firstName, nFiltered, summaryBefore, summaryAfter, clicked: !!opt, clickedDim, panelOpen: box.classList.contains('open') };
      }, d);
      if (r.missing) { t(`${d.dd} 存在`, false, '元素不存在'); continue; }
      if (r.noInput) { console.log(`  - ${d.dd}: 无搜索框, 跳过`); continue; }
      t(`${c.page} ${d.dd} 搜索"${r.firstName}"后列表过滤 (${r.nAll}→${r.nFiltered})`, r.nFiltered > 0 && r.nFiltered <= r.nAll, r);
      if (r.clickedDim) {
        console.log(`  - ${c.page} ${d.dd}: 首个匹配项为置灰(无数据), 点击不选中属设计行为, 跳过断言`);
      } else {
        t(`${c.page} ${d.dd} 点击选项后选择生效 (摘要: ${r.summaryBefore} → ${r.summaryAfter})`, r.summaryBefore !== r.summaryAfter, r);
      }
      // 收尾: 清空选择恢复
      await page.evaluate(() => { if (typeof renderAll === 'function') { document.querySelectorAll('.dd').forEach(x => x.classList.remove('open')); } });
    }
    // 表格仍在更新: 点击后渲染执行过 (daily 用 #tableWrap, ad/product 通用 table)
    const rows = await page.evaluate(() => {
      const tw = document.querySelector('#tableWrap tbody tr');
      if (tw) return document.querySelectorAll('#tableWrap tbody tr').length;
      return document.querySelectorAll('table tbody tr').length;
    });
    t(`${c.page} 表格渲染正常 (${rows} 行)`, rows > 0, rows);
    t(`${c.page} 全程无页面错误`, errs.length === 0, errs.slice(0, 3));
    await page.close();
  }
  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
