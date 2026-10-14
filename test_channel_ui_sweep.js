// test_channel_ui_sweep.js — 「销售店铺」筛选在 5 个看板上的 UI 一致性巡检
//
// 用户口径：「在各个看板里面增加一个筛选条件，销售店铺 …… 默认就是一起合并看，然后也可以筛选单独看」
// 单个看板各自能跑还不够 —— 位置/文案/默认值/交互必须一致，否则用户每换一个看板都要重新找。
//
// 巡检项(逐看板)：
//   ① 「销售店铺」下拉存在，且是筛选栏第一个控件
//   ② 选项 = Aliencell官方店铺 + Woot店铺，两渠道都有数据(不置灰)
//   ③ 默认汇总 = 「全部（合并）」，且有「合并看（全部）」按钮
//   ④ 单击 Woot店铺 → 汇总含「Woot」、selChannel = {woot}
//   ⑤ 单击「合并看（全部）」→ selChannel 清空、汇总回「全部（合并）」
//   ⑥ 无 JS 报错、无 location.reload() 循环
//
// 用法: node test_channel_ui_sweep.js
//   ⚠️ 必须从 _deploy/ 起 http 服务 (BASE 默认 http://127.0.0.1:8896，可用环境变量覆盖)
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

// 2026-09-10 属 W37，落在所有看板都有数据的月份/周内
const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

const BOARDS = [
  ['daily.html',   '日看板'],
  ['monthly.html', '月看板'],
  ['product.html', '周看板(产品)'],
  ['target.html',  '目标看板'],
  ['ad.html',      '广告看板'],
];
const btnClasses = [];   // 收集各看板的按钮样式，最后统一比对(一致性由数据说话，不写死某个 class)

let pass = 0, fail = 0;
const fails = [];
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  console.log('== 巡检 BASE: ' + BASE + ' ==');

  for (const [file, cn] of BOARDS) {
    console.log('\n----- ' + cn + ' (' + file + ') -----');
    const ctx = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
    await ctx.addInitScript((w) => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'sweep@aliencell.com' } }));
      localStorage.setItem('pc_woot', JSON.stringify(w));
    }, [WOOT_DAY]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
    let navs = 0;
    page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
    await page.route(SUPA, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));

    await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3000);

    // ---------- ① ② ③ 结构 ----------
    const s = await page.evaluate(() => {
      const bar = document.querySelector('.filter-bar');
      const dd = document.getElementById('ddChannel');
      const sum = document.getElementById('ddChannelSummary');
      return {
        exists: !!dd,
        firstChild: (bar && bar.firstElementChild) ? bar.firstElementChild.id : '',
        nBarChildren: bar ? bar.children.length : -1,
        label: dd ? dd.querySelector('.dd-label').textContent.replace(/\s+/g, ' ').trim() : '',
        opts: [...document.querySelectorAll('#ddChannelList .dd-opt')].map(o => ({
          name: (o.querySelector('.opt-name') || {}).textContent ? o.querySelector('.opt-name').textContent.replace(/\s+/g, ' ').trim().replace(/^[^ ]+ /, '') : '',
          dim: o.classList.contains('dim')
        })),
        summary: sum ? sum.textContent.trim() : '',
        mergeBtn: (() => {
          const b = dd && dd.querySelector('.dd-tools .btn');
          return b ? { cls: b.className.trim(), html: b.getAttribute('onclick') || '', text: b.textContent.trim() } : null;
        })(),
        nToolsBtn: dd ? dd.querySelectorAll('.dd-tools .btn').length : 0,
        hasList: !!document.getElementById('ddChannelList'),
      };
    });
    t(cn + ' ① 有「销售店铺」下拉', s.exists === true, s);
    if (!s.exists) { await ctx.close(); continue; }
    t(cn + ' ① 位于筛选栏首位', s.firstChild === 'ddChannel', { first: s.firstChild, n: s.nBarChildren });
    t(cn + ' ① 标题含「销售店铺」', s.label.indexOf('销售店铺') >= 0, s.label);
    t(cn + ' ② 选项 = Aliencell官方店铺 | Woot店铺', s.opts.map(o => o.name).join('|') === 'Aliencell官方店铺|Woot店铺', s.opts);
    t(cn + ' ② 两渠道均有数据(不置灰)', s.opts.length === 2 && s.opts.every(o => !o.dim), s.opts);
    t(cn + ' ③ 默认汇总 = 全部（合并）', s.summary === '全部（合并）', s.summary);
    t(cn + ' ③ 有「合并看（全部）」按钮', !!s.mergeBtn && s.mergeBtn.text.indexOf('合并看') >= 0, s.mergeBtn);
    t(cn + ' ③ 按钮绑定 setAll(\'channel\')', !!s.mergeBtn && /setAll\(['"]channel['"]/.test(s.mergeBtn.html), s.mergeBtn);
    btnClasses.push({ cn, cls: s.mergeBtn ? s.mergeBtn.cls : '(缺按钮)' });

    // ---------- ④ ⑤ 交互(用合成事件，不依赖面板可见性) ----------
    const st = () => page.evaluate(() => ({
      size: selChannel.size, list: [...selChannel],
      summary: document.getElementById('ddChannelSummary').textContent.trim()
    }));
    await page.evaluate(() => {
      document.querySelectorAll('#ddChannelList .dd-opt')[1]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(400);
    const w = await st();
    t(cn + ' ④ 单击 Woot店铺 => 单选(仅 woot)', w.size === 1 && w.list[0] === 'woot', w);
    t(cn + ' ④ 汇总显示「Woot店铺 单独看」', w.summary.indexOf('Woot') >= 0, w.summary);

    const btnClicked = await page.evaluate(() => {
      const b = document.querySelector('#ddChannel .dd-tools .btn');
      if (!b) return false;
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
    await page.waitForTimeout(400);
    const m = await st();
    t(cn + ' ⑤ 「合并看（全部）」按钮点到', btnClicked === true);
    t(cn + ' ⑤ 清空选择回到合并', m.size === 0, m);
    t(cn + ' ⑤ 汇总回「全部（合并）」', m.summary === '全部（合并）', m.summary);

    // ---------- ⑥ 报错 ----------
    const real = errs.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
    t(cn + ' ⑥ 无 JS 报错', real.length === 0, real.slice(0, 3));
    t(cn + ' ⑥ 无 reload 循环', navs === 1, { navs });

    await ctx.close();
  }

  // ---------- 跨看板一致性(由收集到的实际值判定，不写死期望 class) ----------
  {
    console.log('\n-- 跨看板一致性 --');
    const uniq = [...new Set(btnClasses.map(b => b.cls))];
    t('5 个看板的「合并看（全部）」按钮样式完全一致', uniq.length === 1, btnClasses);
    console.log('   按钮样式: ' + uniq.join(' / '));
  }

  console.log('\n===== 渠道筛选 UI 一致性: ' + pass + ' pass / ' + fail + ' fail =====');
  if (fail) console.log('失败项: ' + fails.join(' | '));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
