/**
 * 统一入口端到端回归：index.html（外壳）→ JoyBuy 页签 → iframe 内 joybuy.html
 *
 * 为什么需要它：外壳 index.html 只做一件事 —— 把 #frame 的 src 指向 joybuy.html。
 * 这层「接线」是静态检查看不全的（hash 直达、cacheBust 版本号、认证守卫是否会误跳登录页），
 * 必须真的在浏览器里点一遍。而外壳会**异步校验** Supabase 会话，没有真实登录态就会跳 login.html，
 * 所以本脚本只桩掉 `auth/v1/user`，其余（含看板本体、iframe、Chart.js）全部走真实文件。
 *
 * 用法：
 *   1) 先起静态服务（必须从 _deploy 目录起，页面里的相对路径才成立）
 *        cd _deploy && python -m http.server 8917 --bind 127.0.0.1
 *   2) 保活调试浏览器：node joybuy_browser.js --keep   （CDP 9333）
 *   3) node test_joybuy_entry_e2e.js [baseUrl]         # 默认 http://127.0.0.1:8917/
 *
 * 断言：外壳 nav 含 joybuy · hash 直达高亮 · iframe 加载 joybuy.html ·
 *       5 张 KPI 卡片（可下拉替换指标）· 6 个筛选下拉（国家/产品系列/产品名/套装/SKU/周数）
 *       · 7 标签页全部有内容 · 零 JS 报错
 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = process.argv[2] || 'http://127.0.0.1:8917/';
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const TABS = ['trend', 'traffic', 'product', 'funnel', 'channel', 'keyword', 'daily'];

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

(async () => {
  const b = await chromium.connectOverCDP(CDP);
  const page = await b.contexts()[0].newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

  // 只桩 Supabase 会话校验（外壳异步校验 + token 刷新），其余接口不拦截
  await page.route('**/auth/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'e2e', email: 'e2e@local', role: 'authenticated' }),
  }));
  await page.addInitScript(() => {
    try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'e2e', user: { email: 'e2e@local', role: 'admin' } })); } catch (e) {}
  });
  await page.setViewportSize({ width: 1680, height: 1100 });

  console.log('base =', BASE);
  await page.goto(BASE + 'index.html#joybuy', { waitUntil: 'load', timeout: 60000 });
  await sleep(6000);

  // ---- 外壳 ----
  const shell = await page.evaluate(() => {
    const act = document.querySelector('.nav-item.active');
    return {
      navs: [...document.querySelectorAll('.nav-item')].map((n) => n.getAttribute('data-id')),
      active: act && act.getAttribute('data-id'),
      hash: location.hash,
      frame: (document.getElementById('frame') || {}).src || '',
    };
  });
  check('外壳 page', !/login\.html/.test(page.url()), '当前 ' + page.url().split('/').pop());
  check('nav 含 joybuy', shell.navs.indexOf('joybuy') >= 0, '[' + shell.navs.join(', ') + ']');
  check('#joybuy 直达高亮', shell.active === 'joybuy' && shell.hash === '#joybuy');
  check('iframe 指向 joybuy.html', /joybuy\.html/.test(shell.frame), shell.frame.split('/').pop());

  // ---- iframe 内看板 ----
  const fr = page.frames().find((f) => f.url().indexOf('joybuy.html') >= 0);
  check('找到 joybuy iframe', !!fr);
  if (fr) {
    await fr.waitForSelector('.tab[data-p="keyword"]', { timeout: 20000 }).catch(() => {});
    await sleep(1800);
    const info = await fr.evaluate(() => ({
      kpis: [...document.querySelectorAll('.kpi')].length,
      kpiHeads: [...document.querySelectorAll('.kpi .kpi-head .k')].map((x) => x.innerText.trim()),
      kpiDrops: document.querySelectorAll('.kpi .kpi-head').length,
      // 站点选择从「chip 一排」改成了下拉筛选（国家/产品系列/产品名/SKU/周数 五维）
      dd: [...document.querySelectorAll('.dd')].length,
      siteOpts: [...document.querySelectorAll('#ddSiteList .dd-opt')].length,
      tabs: [...document.querySelectorAll('.tab')].map((t) => t.innerText.trim()),
    }));
    // KPI 从「12 张平铺」改为「固定 5 张 + 可下拉替换指标」
    check('KPI 固定 5 张', info.kpis === 5, '实际 ' + info.kpis);
    check('5 张卡片都可下拉替换', info.kpiDrops === 5, info.kpiDrops + ' 个下拉');
    check('KPI 指标名为中文（无 UV/PV/PDP）',
      info.kpiHeads.every((h) => !/UV|PV|PDP/.test(h)), info.kpiHeads.join(','));
    check('筛选下拉 6 个（国家/系列/产品名/套装/SKU/周数）', info.dd === 6, '实际 ' + info.dd);
    check('国家候选 4 个站点', info.siteOpts === 4, '实际 ' + info.siteOpts);
    check('标签页 7 个', info.tabs.length === 7, JSON.stringify(info.tabs));

    // 逐页签必须有可见内容（图表 canvas 有尺寸，或表格有行）
    for (const t of TABS) {
      await fr.evaluate((x) => document.querySelector('.tab[data-p="' + x + '"]').click(), t);
      await sleep(1500);
      const st = await fr.evaluate((x) => {
        const pane = document.getElementById('pane-' + x);
        if (!pane || pane.offsetParent === null) return { visible: false };
        return {
          visible: true,
          cvs: [...pane.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height),
          rows: [...pane.querySelectorAll('.tbl-wrap')].map((w) => w.querySelectorAll('tbody tr').length),
        };
      }, t);
      const hasContent = st.visible && ((st.cvs || []).length > 0 || (st.rows || []).some((n) => n > 0));
      const detail = st.visible
        ? 'canvas[' + (st.cvs || []).join(',') + '] 行[' + (st.rows || []).join(',') + ']'
        : '不可见';
      check('页签 ' + t, hasContent, detail);
    }
    await fr.evaluate(() => document.querySelector('.tab[data-p="keyword"]').click());
    await sleep(1500);
  }

  check('零 JS 报错', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 5)) : '');
  await page.screenshot({ path: '_jb_e2e_entry.png' });
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
