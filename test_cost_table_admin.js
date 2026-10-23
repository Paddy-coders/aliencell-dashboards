// test_cost_table_admin.js — 产品成本表 tab：管理员门禁 + 表格正确性 + 编辑保存链路
//
// ⚠️ 沿用 2026-10-21 事故教训（skill 红线 27）：本页会 400ms 后自动 PATCH 写生产云端，
//    所以这里必须 Page 级拦截：
//      ① page.route('**/rest/v1/mapping*')：GET 喂固定 fixture，PATCH 只计数 + 回 204（绝不落库）
//      ② addInitScript 拦 pc_* 的 setItem，避免污染本机 localStorage
//    跑完还会真去核对云端条数没变（第 9 节）—— 护栏有没有兜住，用事实说话。
//
// 用法：先起本地服务   cd _deploy && python -m http.server 8899 --bind 127.0.0.1
//       node test_cost_table_admin.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8899/mapping.html';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

let pass = 0, fail = 0;
const fails = [];
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------------- fixture：故意造出各种「缺」的形态，方便断言 ---------------- */
// OK     = 成本+头程全齐，且被 ASIN 用过
// NOCST  = 成本缺失(0)
// NOHEAD = 成本有，但缺 US 头程
// ORPHAN = 成本表里叫这名字，但目录里没有、也没 ASIN 用它
// PEND   = 目录里有名字，成本表里完全没这一行（最容易被漏掉的那类）
// IDLE   = 成本齐全，但没有任何 ASIN 用它
const COST = {
  'OK产品':     { costRMB: 495.57, headRMB: { US: 29, EU: 52, UK: 41 }, tailLocal: { US: 11, EU: 15.4, UK: 5.98 } },
  'NOCST产品':  { costRMB: 0,      headRMB: { US: 10, EU: 12, UK: 9 },  tailLocal: {} },
  'NOHEAD产品': { costRMB: 120,    headRMB: { US: 0,  EU: 20, UK: 15 }, tailLocal: { US: 5, EU: 6, UK: 7 } },
  'IDLE产品':   { costRMB: 88,     headRMB: { US: 5,  EU: 6,  UK: 4 },  tailLocal: {} },
};
const CATALOG = [
  { series: '系列甲', name: 'OK产品' },
  { series: '系列甲', name: 'NOCST产品' },
  { series: '系列甲', name: 'NOHEAD产品' },
  { series: '系列乙', name: 'IDLE产品' },
  { series: '系列乙', name: 'PEND产品' },     // ← 成本表里没有，必须被列出来
];
const ASINMAP = [
  { asin: 'B0AAAAAAA1', series: '系列甲', name: 'OK产品',     country: 'US' },
  { asin: 'B0AAAAAAA1', series: '系列甲', name: 'OK产品',     country: 'EU' },
  { asin: 'B0BBBBBBB2', series: '系列甲', name: 'NOCST产品',  country: 'US' },
  { asin: 'B0CCCCCCC3', series: '系列甲', name: 'NOHEAD产品', country: 'UK' },
];
const CLOUD_BASE = {
  catalog: CATALOG,
  asinMap: ASINMAP,
  costTable: { products: COST, updatedAt: '2026-10-21', pushedAt: '2026-10-21 10:00:00', source: 'fixture' },
  costAdmins: ['boss@aliencell.com'],
  woot: [], freight: [], wootCfg: {}, unmapped: { count: 0, items: [] },
};

const expectRows = () => {
  // 期望：成本表 4 条 + 目录里有但成本表没有的 1 条（PEND产品）
  const names = Object.keys(COST).concat(['PEND产品']);
  const usage = {};
  ASINMAP.forEach(m => { usage[m.name] = (usage[m.name] || 0) + 1; });
  const cat = new Set(CATALOG.map(c => c.name));
  const health = n => {
    const p = COST[n] || { costRMB: null, headRMB: {}, tailLocal: {} };
    const links = usage[n] || 0;
    if (!links && !cat.has(n)) return 'orphan';
    if (!(p.costRMB > 0)) return 'err';
    const miss = ['US', 'EU', 'UK'].filter(r => !((p.headRMB || {})[r] > 0));
    if (miss.length) return 'warn';
    if (!links) return 'nouse';
    return 'ok';
  };
  return {
    all: names.sort((a, b) => a.localeCompare(b, 'zh')),
    bad: names.filter(n => ['err', 'warn', 'orphan'].includes(health(n)))
      .sort((a, b) => a.localeCompare(b, 'zh')),
  };
};

/* ---------------- 公共：开一个受控页面 ---------------- */
async function openPage(browser, opts) {
  const o = opts || {};
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = [];
  const dialogs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  // 页面用 confirm/alert 做防错确认（产品名不在目录里会二次确认）—— 这里一律接受，
  // 否则 evaluate 里的 dialog 会被自动 dismiss，看起来像「功能坏了」。
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  const counted = { get: 0, patch: 0, patchedCost: null };
  // 【护栏①】网络层拦截：PATCH 一律回 204 不落库，但要留下证据
  await page.route('**/rest/v1/mapping*', async route => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      counted.patch++;
      try { const body = JSON.parse(req.postData() || '{}'); counted.patchedCost = (body.data || {}).costTable; } catch (e) {}
      return route.fulfill({ status: 204, body: '' });
    }
    counted.get++;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, data: JSON.parse(JSON.stringify(o.data || CLOUD_BASE)), updated_at: '2026-10-21T10:00:00' }]),
    });
  });
  // 壳页会对 token 做异步校验，假 token 会 403 → 跳登录，桩掉
  await page.route('**/auth/v1/user', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'x', email: 'x@y.z' }) }));

  // 【护栏②】本机 pc_* 一个字节都不写
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('pc_') === 0) return; return orig.call(this, k, v); };
  });
  // 注入登录态（role / email 决定能不能看到成本页）
  await page.addInitScript(([email, role]) => {
    localStorage.setItem('wb_auth', JSON.stringify({
      access_token: 'fake', expires_at: Date.now() + 3600000,
      user: { id: 'u1', email: email }, role: role,
    }));
  }, [o.email || 'viewer@aliencell.com', o.role || 'viewer']);

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof applyAdminUI === 'function', null, { timeout: 15000 });
  return { page, errs, counted, dialogs };
}
const enter = page => page.evaluate(() => { closeUnmapped(); switchTabView('cost'); });
const tableState = page => page.evaluate(() => ({
  viewOn: document.getElementById('viewCost').classList.contains('active'),
  tabShown: getComputedStyle(document.getElementById('tabBtnCost')).display !== 'none',
  rows: [...document.querySelectorAll('#costTable tbody tr')].map(tr => ({
    name: tr.querySelector('.cname') ? tr.querySelector('.cname').childNodes[0].textContent.trim() : '',
    cells: [...tr.querySelectorAll('input[type=number]')].map(i => i.value),
    stat: (tr.querySelector('.cost-stat') || {}).textContent || '',
    links: (tr.querySelector('.cnum') || {}).textContent || '',
    canDel: !!tr.querySelector('.cact button.danger'),
  })),
  head: [...document.querySelectorAll('#costTable thead tr:last-child th')].map(x => x.textContent.trim()),
  count: (document.getElementById('costCount') || {}).textContent || '',
  missingBtn: (document.getElementById('btnCostMissing') || {}).textContent || '',
  dirty: (document.getElementById('costDirtyTip') || {}).textContent || '',
}));

(async () => {
  const browser = await chromium.launch();
  try {
    /* ========== 1. 访客：看不到，也进不去 ========== */
    console.log('\n【1】访客（role=viewer, 邮箱不在白名单）');
    {
      const { page, errs, counted } = await openPage(browser, { email: 'someone@aliencell.com', role: 'viewer' });
      await page.waitForTimeout(1600);
      let s = await tableState(page);
      t('成本 tab 不显示', !s.tabShown, s.tabShown);
      t('角色徽标注明「看不到产品成本」', /访客/.test(await page.textContent('#roleBadge')), await page.textContent('#roleBadge'));
      await enter(page);
      s = await tableState(page);
      t('强切 #cost 也进不去（被弹回 catalog）', !s.viewOn, s.viewOn);
      t('URL 被改回 #catalog', /#catalog$/.test(page.url()), page.url());
      t('给了明确原因提示', /仅管理员可见/.test(await page.textContent('body')), false);
      t('访客期间零 PATCH', counted.patch === 0, counted.patch);
      t('无 JS 报错', errs.length === 0, errs);
      await page.close();
    }

    /* ========== 2. role=admin：能进，数据与云端一致 ========== */
    console.log('\n【2】管理员（role=admin）· 表格正确性');
    {
      const { page, errs, counted, dialogs } = await openPage(browser, { email: 'boss@aliencell.com', role: 'admin' });
      await page.waitForTimeout(1600);
      const exp = expectRows();
      let s = await tableState(page);
      t('成本 tab 显示', s.tabShown, false);
      t('角色徽标显示管理员', /管理员/.test(await page.textContent('#roleBadge')), await page.textContent('#roleBadge'));
      await enter(page);
      await page.waitForTimeout(700);
      s = await tableState(page);
      t('切进去面板是激活的', s.viewOn, false);

      t('行数 = 成本表 4 + 目录独有 1 = 5', s.rows.length === exp.all.length, { got: s.rows.length, exp: exp.all.length });
      t('★ PEND产品（成本表没行）被列出来了', s.rows.some(r => r.name === 'PEND产品'), s.rows.map(r => r.name));
      t('表头 11 列且含 产品名/成本 ¥', s.head.length === 11 && s.head[0] === '产品名' && s.head[1] === '成本 ¥', s.head);

      const byName = Object.fromEntries(s.rows.map(r => [r.name, r]));
      t('OK产品 数值与 fixture 一致',
        JSON.stringify(byName['OK产品'].cells) === JSON.stringify(['495.57', '29', '52', '41', '11', '15.4', '5.98']),
        byName['OK产品'].cells);
      t('OK产品 状态=OK / 关联=2 条', /OK/.test(byName['OK产品'].stat) && /2 条/.test(byName['OK产品'].links),
        [byName['OK产品'].stat, byName['OK产品'].links]);
      t('NOCST产品 状态=缺成本', /缺成本/.test(byName['NOCST产品'].stat), byName['NOCST产品'].stat);
      t('NOHEAD产品 状态=缺头程 US', /缺头程\s*US/.test(byName['NOHEAD产品'].stat), byName['NOHEAD产品'].stat);
      t('IDLE产品 状态=暂未使用 且关联为 —', /暂未使用/.test(byName['IDLE产品'].stat) && byName['IDLE产品'].links === '—',
        [byName['IDLE产品'].stat, byName['IDLE产品'].links]);
      t('PEND产品 状态=缺成本、操作列不给删除', /缺成本/.test(byName['PEND产品'].stat) && !byName['PEND产品'].canDel,
        [byName['PEND产品'].stat, byName['PEND产品'].canDel]);
      t('PEND产品 8 个输入框全空', byName['PEND产品'].cells.every(v => v === ''), byName['PEND产品'].cells);

      /* ========== 3. 仅看待补 ========== */
      console.log('\n【3】「仅看待补」筛选');
      // 期望：缺成本(NOCST) + 缺头程(NOHEAD) + PEND + ORPHAN(本 fixture 无) = 3
      t('按钮上的待补数与实际一致', s.missingBtn.includes('(' + exp.bad.length + ')'), { btn: s.missingBtn, exp: exp.bad.length });
      await page.click('#btnCostMissing');
      await page.waitForTimeout(300);
      s = await tableState(page);
      t('筛后只剩 ' + exp.bad.length + ' 行', s.rows.length === exp.bad.length, { got: s.rows.length, exp: exp.bad.length });
      t('筛后全是待补（OK 与 IDLE 被滤掉）',
        !s.rows.some(r => r.name === 'OK产品' || r.name === 'IDLE产品'), s.rows.map(r => r.name));
      await page.click('#btnCostMissing');
      await page.waitForTimeout(300);
      s = await tableState(page);
      t('再点一次回到全部 ' + exp.all.length + ' 行', s.rows.length === exp.all.length, s.rows.length);
      t('计数文案含 待补 数量', s.count.includes('待补 ' + exp.bad.length), s.count);

      /* ========== 4. 编辑 → dirty → 保存 ========== */
      console.log('\n【4】编辑与保存链路');
      t('初始是「已与云端一致」', /已与云端一致/.test(s.dirty), s.dirty);
      // 给 PEND产品 填一个成本 —— 这是用户真实要做的动作
      await page.evaluate(() => {
        const inp = [...document.querySelectorAll('#costTable tbody tr')]
          .find(tr => tr.querySelector('.cname').childNodes[0].textContent.trim() === 'PEND产品')
          .querySelector('input[data-f="cost"]');
        inp.value = '321.5'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(200);
      s = await tableState(page);
      t('填值后变「有未保存的改动」', /未保存/.test(s.dirty), s.dirty);
      const landed = await page.evaluate(() => !!(costTable['PEND产品'] && costTable['PEND产品'].costRMB === 321.5));
      t('★ 待补行填值后真的落进 costTable', landed, false);
      const n2 = await page.evaluate(() => Object.keys(costTable).length);
      t('costTable 从 4 条变 5 条', n2 === 5, n2);

      await page.click('#btnCostSave');
      await page.waitForTimeout(900);
      const after = {
        dirty: await page.textContent('#costDirtyTip'),
        patch: counted.patch,
        payloadNames: counted.patchedCost ? Object.keys(counted.patchedCost.products || {}).sort() : null,
        payloadKeys: counted.patchedCost ? Object.keys(counted.patchedCost) : null,
      };
      t('保存后回到「已与云端一致」', /已与云端一致/.test(after.dirty), after.dirty);
      t('确实发起了 PATCH（护栏计数 +1）', after.patch === 1, after.patch);
      t('PATCH 带上了新补的 PEND产品', (after.payloadNames || []).includes('PEND产品'), after.payloadNames);
      t('PATCH 里的 costTable 有 5 个产品', (after.payloadNames || []).length === 5, after.payloadNames);
      t('PATCH 保留了 pushedAt/source 等元信息',
        (after.payloadKeys || []).includes('products') && (after.payloadKeys || []).includes('pushedAt'), after.payloadKeys);

      /* ========== 5. 新增草稿行（含目录自动补全） ========== */
      console.log('\n【5】新增草稿行');
      await page.click('#costTable').catch(() => {});
      await page.evaluate(() => addCostRow());
      await page.waitForTimeout(300);
      s = await tableState(page);
      t('顶部出现草稿行', s.rows.length === 6 && s.rows.some(r => r.stat.includes('草稿')), s.rows.length);
      const dl = await page.evaluate(() => ({
        opts: [...document.querySelectorAll('#costNameList option')].map(o => o.value),
        hintHello: (() => { const e = document.getElementById('costDraftName'); e.value = '不存在的产品名'; e.dispatchEvent(new Event('input', { bubbles: true })); return document.getElementById('costDraftHint').textContent; })(),
        hintOk: (() => { const e = document.getElementById('costDraftName'); e.value = 'OK产品'; e.dispatchEvent(new Event('input', { bubbles: true })); return document.getElementById('costDraftHint').textContent; })(),
      }));
      t('datalist 候选里挂着目录里的产品名', dl.opts.includes('OK产品') && dl.opts.includes('PEND产品'), dl.opts);
      t('输入不存在的名字 → 警告「目录里没有」', /目录里没有/.test(dl.hintHello), dl.hintHello);
      t('输入已有的名字 → 警告「覆盖」', /覆盖/.test(dl.hintOk), dl.hintOk);
      // 正式提交一条新名字（不在目录里 ⇒ 会弹二次确认，这是防拼错的故意设计）
      const before = await page.evaluate(() => Object.keys(costTable).length);
      await page.evaluate(() => {
        const e = document.getElementById('costDraftName'); e.value = 'NEW产品'; e.dispatchEvent(new Event('input', { bubbles: true }));
        const c = document.querySelector('#costTable input[data-n="__DRAFT__"][data-f="cost"]');
        c.value = '66.6'; c.dispatchEvent(new Event('input', { bubbles: true }));
        costDraftCommit();
      });
      await page.waitForTimeout(300);
      const afterAdd = await page.evaluate(() => ({ n: Object.keys(costTable).length, v: costTable['NEW产品'] && costTable['NEW产品'].costRMB }));
      t('提交后 costTable +1', afterAdd.n === before + 1, { before, after: afterAdd.n });
      t('新行的值正确写进去了', afterAdd.v === 66.6, afterAdd.v);
      await page.waitForTimeout(200);
      t('★ 名字不在目录时会先弹二次确认（防拼错）',
        (dialogs || []).some(m => /不在产品目录里/.test(m)), (dialogs || []).slice());
      // 删掉能验证 delCostRow 真的走通（有一条删 ADD 的是刚才那条）
      await page.evaluate(() => {
        const tr = [...document.querySelectorAll('#costTable tbody tr')]
          .find(x => x.querySelector('.cname').childNodes[0].textContent.trim() === 'NEW产品');
        tr.querySelector('.cact button.danger').click();
      });
      await page.waitForTimeout(300);
      const afterDel = await page.evaluate(() => ({ n: Object.keys(costTable).length, has: 'NEW产品' in costTable }));
      t('删除按钮生效（NEW产品 已移除）', afterDel.has === false && afterDel.n === before, afterDel);

      /* ========== 6. 导出 CSV ========== */
      console.log('\n【6】导出 CSV');
      // 拦截 Blob + a.click，把真正要下载的文本拿出来比对（别只看「点了没报错」）
      const csvOut = await page.evaluate(async () => {
        let captured = null;
        const RealBlob = window.Blob;
        window.Blob = function (parts, opts) { captured = String(parts[0] || ''); return new RealBlob(parts, opts); };
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {};
        try { exportCostCsv(); } finally {
          window.Blob = RealBlob; HTMLAnchorElement.prototype.click = realClick;
        }
        return captured;
      });
      const lines = String(csvOut || '').split('\r\n').filter(Boolean);
      const expNames = await page.evaluate(() => Object.keys(allCostRows()).sort((a, b) => a.localeCompare(b, 'zh')));
      t('导出非空且带 UTF-8 BOM', /^\ufeff/.test(csvOut || ''), (csvOut || '').slice(0, 4));
      t('表头是约定的 8 列',
        lines[0] && lines[0].replace(/^\ufeff/, '').split(',').length === 8, lines[0]);
      t('导出行数 = 表格行数（含 PEND）', lines.length - 1 === expNames.length,
        { got: lines.length - 1, exp: expNames.length });
      t('★ 导出里能找到 PEND产品（成本表还没这一行）',
        lines.some(l => l.indexOf('PEND产品') === 0), lines.slice(1, 3));
      {
        const okLine = lines.find(l => l.indexOf('OK产品,') === 0) || '';
        t('OK产品 那行的 8 个数值与 fixture 一致',
          okLine === 'OK产品,495.57,29,52,41,11,15.4,5.98', okLine);
      }

      /* ========== 7. 白名单救急通路 ========== */
      console.log('\n【7】邮箱白名单兜底');
      await page.close();
      {
        const { page: p2 } = await openPage(browser, { email: 'boss@aliencell.com', role: 'viewer' });
        await p2.waitForTimeout(1600);
        const s2 = await tableState(p2);
        t('role=viewer 但邮箱在白名单 → 也能看到成本 tab', s2.tabShown, false);
        await p2.close();
      }
      {
        const { page: p3 } = await openPage(browser, { email: 'nobody@aliencell.com', role: 'viewer' });
        await p3.waitForTimeout(1600);
        const s3 = await tableState(p3);
        t('邮箱不在白名单 → 依然看不到', !s3.tabShown, false);
        await p3.close();
      }
      void afterAdd;
    }
  } finally {
    await browser.close();
  }

  /* ========== 8. 护栏有没有兜住：真去核对云端没被改 ========== */
  console.log('\n【8】云端未被污染（真实核对）');
  const before = await fetch(SB_URL + '?select=data&id=eq.1', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(r => r.json());
  const d = (before[0] || {}).data || {};
  const names = Object.keys(d.costTable && d.costTable.products ? d.costTable.products : {});
  t('云端 costTable 仍是 25 个产品', names.length === 25, names.length);
  t('云端没有 fixture 里的假产品名',
    !names.some(n => /OK产品|NOCST产品|NOHEAD产品|IDLE产品|PEND产品|NEW产品/.test(n)), names.filter(n => /产品$/.test(n)).slice(0, 5));
  t('云端 asinMap 仍是 51 条', (d.asinMap || []).length === 51, (d.asinMap || []).length);
  t('云端 catalog 仍是 26 条', (d.catalog || []).length === 26, (d.catalog || []).length);
  t('云端没有 fixture 的 B0AAAAAAA1', !(d.asinMap || []).some(x => x.asin === 'B0AAAAAAA1'), false);

  console.log('\n────────────────────────────');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  // 顺手写一份结果快照，方便比对
  try { fs.writeFileSync(path.join(__dirname, '_cost_test_result.json'), JSON.stringify({ pass, fail, fails }, null, 2)); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
