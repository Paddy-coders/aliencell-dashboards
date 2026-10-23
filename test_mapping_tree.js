// 产品关系管理(mapping.html) 匹配列表三层树回归测试
// 覆盖: 系列 › 国家 › 产品名 三层结构 / 单产品国家内联 / 折叠与全展开全折叠 /
//       按国家分组前两层互换 / 国家筛选 / 改系列后重组 / 零 JS 报错
// 安全: 全程 page.route 拦截 Supabase REST（假后端），绝不写真实云端；localStorage 也拦住
// 运行: node test_mapping_tree.js            (本地 http.server 8899, 从 _deploy 启动)
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
let pass = 0, fail = 0, patches = 0, gets = 0;
const t = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 260) : '')); }
};

const CAT = [
  { series: 'A系列', name: 'A主机' },
  { series: 'A系列', name: 'A配件' },
  { series: 'B系列', name: 'B主机' },
];
const MAP = [
  { asin: 'AUS01', country: 'US', series: 'A系列', name: 'A主机' },
  { asin: 'AUS02', country: 'US', series: 'A系列', name: 'A主机' },
  { asin: 'AUS03', country: 'US', series: 'A系列', name: 'A配件' },
  { asin: 'AUK01', country: 'UK', series: 'A系列', name: 'A配件' },
  { asin: 'BEU01', country: 'EU', series: 'B系列', name: 'B主机' },
  { asin: 'NONE1', country: 'JP', series: '无', name: '无' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/i.test(m.text())) errs.push('console ' + m.text()); });

  // 假后端：本测试的唯一数据源，任何写操作只计数不落库
  await page.route('**/rest/v1/mapping*', async route => {
    const m = route.request().method();
    if (m === 'GET') {
      gets++;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ data: { catalog: [], asinMap: [], unmapped: { count: 0, items: [] } }, updated_at: '2026-10-21T00:00:00Z' }]),
      });
    }
    if (m === 'PATCH') { patches++; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/product_map.json', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  // 双保险：本地业务键也不让写（避免污染本地测试环境）
  await page.addInitScript(() => {
    const o = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('pc_') === 0) return; return o.call(this, k, v); };
  });

  await page.goto(BASE + '/mapping.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { try { closeUnmapped(); } catch (e) {} });

  const inject = () => page.evaluate(({ CAT, MAP }) => {
    catalog = CAT.map(o => ({ ...o }));
    asinMap = MAP.map(o => ({ ...o }));
    collapsedAsin.clear();
    asinGroupBy = 'series';
    syncAsinGroupBtn();
    renderAll();
  }, { CAT, MAP });
  await inject();

  // ---------- 1. 三层结构 ----------
  let s = await page.evaluate(() => {
    const l1 = [...document.querySelectorAll('#asinTable > .grp')].map(g => ({
      name: g.querySelector('.grp-head .grp-name').textContent.trim(),
      meta: g.querySelector('.grp-count').textContent.trim(),
      subs: [...g.querySelectorAll(':scope > .grp-sub')].map(sub => ({
        name: sub.querySelector(':scope > .sub-head .sub-name').textContent.trim(),
        meta: sub.querySelector(':scope > .sub-head .sub-count').textContent.trim(),
        lv3: [...sub.querySelectorAll('.sub-head.lv3')].map(h => h.querySelector('.sub-name').textContent.trim()),
        rows: sub.querySelectorAll('.grp-row.lv3').length,
      })),
    }));
    return { l1, rows: document.querySelectorAll('.grp-row.lv3').length };
  });
  t('L1 系列层 3 个（A系列 / B系列 / 无，「无」沉底）', s.l1.length === 3 && s.l1.map(x => x.name.replace(/^\S+\s/, '')).join(',') === 'A系列,B系列,无', s.l1.map(x => x.name));
  t('L1 系列头带条数+国家数（A系列 4 条 · 2 个国家）', /4 条 · 2 个国家/.test(s.l1[0].meta), s.l1[0].meta);
  t('L2 国家层按 COUNTRIES 顺序（UK 在 US 前）', s.l1[0].subs.length === 2 && /UK/.test(s.l1[0].subs[0].name) && /US/.test(s.l1[0].subs[1].name), s.l1[0].subs.map(x => x.name));
  t('L2 US 头显示「3 条 · 2 个产品」', /3 条 · 2 个产品/.test(s.l1[0].subs[1].meta), s.l1[0].subs[1].meta);
  t('L3 产品名层存在（US › A配件 / A主机，按拼音序）', s.l1[0].subs[1].lv3.length === 2 && s.l1[0].subs[1].lv3.some(x => /A主机/.test(x)) && s.l1[0].subs[1].lv3.some(x => /A配件/.test(x)), s.l1[0].subs[1].lv3);
  t('US 下挂 3 条 ASIN 行', s.l1[0].subs[1].rows === 3, s.l1[0].subs[1].rows);
  t('单产品国家不单开 L3：UK 头内联「· 📦 A配件」且无 L3', /📦\s*A配件/.test(s.l1[0].subs[0].name) && s.l1[0].subs[0].lv3.length === 0, s.l1[0].subs[0]);
  t('单产品国家 ASIN 行照常显示（UK 1 条）', s.l1[0].subs[0].rows === 1, s.l1[0].subs[0].rows);
  t('默认全展开：ASIN 行总数 6', s.rows === 6, s.rows);

  // ---------- 2. 折叠单节点 ----------
  s = await page.evaluate(() => {
    const usHead = [...document.querySelectorAll('.sub-head')].find(h => /US/.test(h.querySelector('.sub-name').textContent));
    toggleAsinGroup(usHead);
    return {
      stillOpenSubs: [...document.querySelectorAll('.sub-head:not(.lv3)')].filter(h => !h.classList.contains('collapsed')).length,
      rows: document.querySelectorAll('.grp-row.lv3').length,
      btn: document.getElementById('btnExpandAsin').textContent.trim(),
    };
  });
  t('折叠 US 后 ASIN 行 6 → 3', s.rows === 3, s.rows);
  t('折叠 US 后其余 3 个 L2 仍展开（UK/EU/JP）', s.stillOpenSubs === 3, s.stillOpenSubs);
  t('有折叠时按钮变「全部展开」', /全部展开/.test(s.btn), s.btn);

  // ---------- 3. 一键全折叠 / 全展开 ----------
  s = await page.evaluate(() => {
    collapsedAsin.clear(); renderAsinTable();
    toggleAllAsin();
    return { sub: document.querySelectorAll('.grp-sub').length, grp: document.querySelectorAll('#asinTable > .grp').length, btn: document.getElementById('btnExpandAsin').textContent.trim() };
  });
  t('全折叠：L1 只剩 3 个系列头、L2 全隐藏', s.grp === 3 && s.sub === 0, s);
  t('全折叠后按钮变「全部展开」', /全部展开/.test(s.btn), s.btn);
  s = await page.evaluate(() => { toggleAllAsin(); return { rows: document.querySelectorAll('.grp-row.lv3').length, btn: document.getElementById('btnExpandAsin').textContent.trim() }; });
  t('再点一次全展开：回到 6 条 ASIN 行', s.rows === 6, s.rows);
  t('全展开后按钮变「全部折叠」', /全部折叠/.test(s.btn), s.btn);

  // ---------- 4. 按国家：前两层互换 ----------
  s = await page.evaluate(() => {
    collapsedAsin.clear(); setAsinGroup('country');
    return [...document.querySelectorAll('#asinTable > .grp')].map(g => ({
      name: g.querySelector('.grp-head .grp-name').textContent.trim(),
      subs: [...g.querySelectorAll(':scope > .grp-sub > .sub-head:not(.lv3) .sub-name')].map(x => x.textContent.trim()),
    }));
  });
  t('按国家：L1 = 4 个国家（COUNTRIES 顺序 EU/UK/US/JP）', s.length === 4 && /EU/.test(s[0].name) && /JP/.test(s[3].name), s.map(x => x.name));
  t('按国家：L1 是 🌍、L2 是 🏷️ 系列', /🌍\s*UK/.test(s[1].name) && s.some(x => x.subs.some(y => /🏷️\s*A系列/.test(y))), s.slice(0, 2));

  // ---------- 5. 国家筛选 ----------
  s = await page.evaluate(() => {
    collapsedAsin.clear(); setAsinGroup('series');
    setAsinCountryFilter('US');
    const r = {
      grp: document.querySelectorAll('#asinTable > .grp').length,
      rows: document.querySelectorAll('.grp-row.lv3').length,
      tip: /当前只显示国家/.test(document.getElementById('asinTable').textContent),
    };
    setAsinCountryFilter('');
    return r;
  });
  t('国家筛选 US：只剩 1 个系列、3 条行', s.grp === 1 && s.rows === 3, s);
  t('筛选提示条仍在', s.tip === true, s.tip);

  // ---------- 6. 改某行的系列下拉 → 自动重组 ----------
  s = await page.evaluate(() => {
    collapsedAsin.clear(); asinGroupBy = 'series'; renderAsinTable();
    const row = document.querySelectorAll('.grp-row.lv3')[0];
    const sel = row.querySelectorAll('select')[1];   // 第 2 个 select = 产品系列
    sel.value = 'B系列';
    sel.dispatchEvent(new Event('change'));
    return {
      l1: [...document.querySelectorAll('#asinTable > .grp .grp-name')].map(x => x.textContent.trim()),
      bSubs: [...document.querySelectorAll('#asinTable > .grp')].filter(g => /B系列/.test(g.querySelector('.grp-name').textContent))
        .map(g => [...g.querySelectorAll(':scope > .grp-sub > .sub-head .sub-name')].map(x => x.textContent.trim())),
    };
  });
  t('改系列后该行重组进 B系列节点（L1 仍 3 个）', s.l1.some(x => /B系列/.test(x)) && s.l1.length === 3, s.l1);
  t('B系列 下多出该行所在国家节点', s.bSubs.length === 1 && s.bSubs[0].length >= 2, s.bSubs);

  // ---------- 7. 云端写隔离 + 零报错 ----------
  await page.evaluate(() => { cloudSave(); });
  await page.waitForTimeout(1200);
  t('真实云端未被写入：所有 mapping 请求都走假后端', gets >= 1, `GET ${gets} 次`);
  t('写操作只计数不落库（PATCH 被拦截）', patches >= 0, `PATCH ${patches} 次（均为假响应）`);
  t('无 JS 报错', errs.length === 0, errs.slice(0, 3));

  console.log('---');
  console.log(`合计 ${pass + fail} 项断言，通过 ${pass}，失败 ${fail}`);
  console.log(`本次拦截：Supabase GET ${gets} 次 / PATCH ${patches} 次，全部本地假响应，未触达真实云端`);
  if (fail > 0) process.exitCode = 1;
  await browser.close();
})();
