// mapping.html 国家筛选功能回归测试
// 全程拦截 Supabase REST 与 product_map.json（假后端），不触真实云端
const path = require('path');
const { chromium } = require('./playwright-auth');

const FILE = 'file:///' + path.resolve('mapping.html').replace(/\\/g, '/');
let pass = 0, fail = 0, warn = 0;
const fails = [];
function chk(ok, name, detail) {
  if (ok) { pass++; console.log(`PASS | ${name}${detail ? ' | ' + detail : ''}`); }
  else { fail++; fails.push(name); console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`); }
}
function warnIf(cond, name, detail) {
  if (cond) { warn++; console.log(`WARN | ${name}${detail ? ' | ' + detail : ''}`); }
}

// fixture：2 个系列 × 3 国家的匹配数据（X1 含 3 条跨国、X2 1 条、无匹配 1 条）
const FIXTURE = {
  catalog: [
    { series: 'X1', name: '产品A' }, { series: 'X1', name: '产品B' },
    { series: 'X2', name: '产品C' },
  ],
  asinMap: [
    { asin: 'B0AAAAAA01', series: 'X1', name: '产品A', country: 'US' },
    { asin: 'B0AAAAAA02', series: 'X1', name: '产品A', country: 'EU' },
    { asin: 'B0AAAAAA03', series: 'X1', name: '产品B', country: 'UK' },
    { asin: 'B0BBBBBB01', series: 'X2', name: '产品C', country: 'US' },
    { asin: 'B0CCCCCC01', series: '无', name: '无', country: 'EU' },
  ],
};

let cloudGets = 0, cloudPatches = 0;
async function installFakeBackend(page) {
  await page.route('**/rest/v1/mapping*', async route => {
    const req = route.request(), m = req.method();
    if (m === 'GET') {
      cloudGets++;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ data: FIXTURE, updated_at: '2026-09-22T00:00:00Z' }]),
      });
    }
    if (m === 'PATCH') { cloudPatches++; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/product_map.json', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|WebSocket|ERR_/i.test(m.text())) errs.push(m.text()); });
  await installFakeBackend(p);
  p.on('dialog', d => d.accept());

  // 展开当前（过滤后）的全部分组，保证 .grp-row 计数反映完整列表
  const expandAll = () => p.evaluate(() => {
    openAsin.clear();
    const keys = [...new Set(filteredAsinMap().map(m => asinGroupBy === 'country' ? countryOf(m) : (m.series || '无')))];
    keys.forEach(k => openAsin.add(k));
    renderAsinTable();
  });
  const collapseAll = () => p.evaluate(() => { openAsin.clear(); renderAsinTable(); });
  const view = () => p.evaluate(() => {
    const groups = [...document.querySelectorAll('#asinTable .grp')];
    const countOf = gname => {
      const g = groups.find(x => ((x.querySelector('.grp-name') || {}).textContent || '').includes(gname));
      return g ? ((g.querySelector('.grp-count') || {}).textContent || '').trim() : null;
    };
    return {
      groupNames: groups.map(g => ((g.querySelector('.grp-name') || {}).textContent || '').trim()),
      groupCounts: groups.map(g => ((g.querySelector('.grp-count') || {}).textContent || '').trim()),
      x1Count: countOf('X1'),
      rows: [...document.querySelectorAll('#asinTable .grp-row b')].map(x => x.textContent),
      notice: (document.querySelector('#asinTable div[style*="f0f7ff"]') || {}).textContent || '',
      empty: ((document.getElementById('asinTable') || {}).innerText || '').trim(),
      filter: (document.getElementById('asinCountryFilter') || {}).value,
      isCollapsed: groups.every(g => g.querySelector('.grp-head').classList.contains('collapsed')),
    };
  });

  await p.goto(FILE, { waitUntil: 'load' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);

  await p.evaluate(() => switchTabView('asin'));
  await p.waitForTimeout(300);

  // ⓪ 假后端确实被读取
  chk(cloudGets >= 1, '云端假后端被读取（fixture 加载）', `GET ${cloudGets} 次`);

  // 1. 下拉存在与选项
  const selInfo = await p.evaluate(() => {
    const sel = document.getElementById('asinCountryFilter');
    return { exists: !!sel, value: sel ? sel.value : null, opts: sel ? [...sel.options].map(o => o.value) : [],
      texts: sel ? [...sel.options].map(o => o.textContent) : [] };
  });
  chk(selInfo.exists, '国家筛选下拉存在');
  chk(selInfo.value === '', '默认「全部国家」', `value=${JSON.stringify(selInfo.value)}`);
  chk(JSON.stringify(selInfo.opts) === JSON.stringify(['', 'EU', 'UK', 'US', 'CA', 'JP', 'AU']),
    '下拉选项 = 全部 + EU/UK/US/CA/JP/AU', selInfo.opts.join(','));
  chk(/全部国家（5 条）/.test(selInfo.texts[0] || '') && /US（2 条）/.test(selInfo.texts[3] || '') && /CA（无数据）/.test(selInfo.texts[4] || ''),
    '下拉选项显示各国条数（无数据显示「无数据」）', selInfo.texts.join(' / '));

  // 2. 全部国家（展开全部）：3 组 5 条
  await expandAll();
  await p.waitForTimeout(200);
  let v = await view();
  chk(v.groupCounts.length === 3, '全部国家 → 3 个系列分组', v.groupNames.join(' / '));
  chk(v.rows.length === 5, '全部国家 → 5 条匹配', `实际 ${v.rows.length}: ${v.rows.join(',')}`);
  chk(/3 条/.test(v.x1Count || ''), 'X1 组头计数 3 条', v.x1Count + ' | 各组: ' + v.groupCounts.join(' / '));
  chk(v.notice === '', '未筛选时无提示条');

  // 3. 筛选 US（展开全部）：2 组 2 条，X1 计数变 1
  await p.selectOption('#asinCountryFilter', 'US');
  await p.waitForTimeout(250);
  await expandAll();
  await p.waitForTimeout(200);
  v = await view();
  chk(v.groupCounts.length === 2, '筛选 US → 2 个系列分组（X1/X2）', v.groupNames.join(' / '));
  chk(v.rows.length === 2, '筛选 US → 2 条匹配', `实际 ${v.rows.length}: ${v.rows.join(',')}`);
  chk(/1 条/.test(v.x1Count || ''), '筛选 US → X1 组头计数 1 条', v.x1Count + ' | 各组: ' + v.groupCounts.join(' / '));
  chk(/只显示国家/.test(v.notice) && /US/.test(v.notice), '筛选提示条显示 US', v.notice.trim().slice(0, 40));
  chk(v.rows.includes('B0AAAAAA01') && v.rows.includes('B0BBBBBB01') && !v.rows.includes('B0AAAAAA02'),
    '筛选 US → 只含 US 的 ASIN', v.rows.join(','));

  // 4. 分组折叠态也跟随过滤：先全部折叠 → 点一次「全部展开」只展开过滤后的分组
  await collapseAll();
  await p.waitForTimeout(150);
  const collapseCheck = await view();
  chk(collapseCheck.rows.length === 0, '全部折叠后无数据行', `实际 ${collapseCheck.rows.length}`);
  const toggle = await p.evaluate(() => {
    toggleAllAsin();                     // 期望：展开过滤后的全部（X1/X2）
    const expanded = document.querySelectorAll('#asinTable .grp-row').length;
    toggleAllAsin();                     // 期望：全部折叠
    const collapsed = document.querySelectorAll('#asinTable .grp-row').length;
    return { expanded, collapsed };
  });
  chk(toggle.expanded === 2 && toggle.collapsed === 0,
    '筛选 US → 全部展开/折叠只作用于过滤后的 2 条', `展开 ${toggle.expanded} / 折叠 ${toggle.collapsed}`);

  // 5. 持久化：刷新后仍为 US
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1000);
  await p.evaluate(() => switchTabView('asin'));
  await p.waitForTimeout(300);
  await expandAll();
  await p.waitForTimeout(200);
  v = await view();
  chk(v.filter === 'US', '刷新后筛选状态保持 US（localStorage）', `value=${v.filter}`);
  chk(v.rows.length === 2, '刷新后仍只显示 2 条', `实际 ${v.rows.length}`);

  // 6. 按国家分组 + 筛选 US → 仅 US 一组 2 条
  await p.evaluate(() => setAsinGroup('country'));
  await p.waitForTimeout(250);
  await expandAll();
  await p.waitForTimeout(200);
  v = await view();
  chk(v.groupNames.length === 1 && /US/.test(v.groupNames[0]), '按国家分组 + US 筛选 → 仅 US 一组', v.groupNames.join(','));
  chk(v.rows.length === 2, '按国家分组 + US 筛选 → 2 条', `实际 ${v.rows.length}`);
  await p.evaluate(() => setAsinGroup('series'));
  await p.waitForTimeout(200);

  // 7. 空筛选结果：CA（fixture 无数据）
  await p.selectOption('#asinCountryFilter', 'CA');
  await p.waitForTimeout(250);
  v = await view();
  chk(/暂无匹配记录/.test(v.empty), '筛选 CA（无数据）→ 空态提示', v.empty.slice(0, 40));

  // 8. 清除筛选恢复全部
  await p.evaluate(() => setAsinCountryFilter(''));
  await p.waitForTimeout(250);
  await expandAll();
  await p.waitForTimeout(200);
  v = await view();
  chk(v.filter === '' && v.rows.length === 5, '清除筛选 → 恢复全部 5 条', `rows=${v.rows.length}`);

  // 9. 筛选下的编辑联动：把 X1 的 US 行改成 EU，US 视图应少一条
  await p.selectOption('#asinCountryFilter', 'US');
  await p.waitForTimeout(250);
  await expandAll();
  await p.waitForTimeout(200);
  const edit = await p.evaluate(() => {
    const sel = [...document.querySelectorAll('#asinTable select')].find(s => s.dataset.a === 'B0AAAAAA01' && s.title === '国家/地区');
    if (!sel) return { ok: false };
    sel.value = 'EU';
    rowCountryChange(sel);
    return { ok: true, rows: [...document.querySelectorAll('#asinTable .grp-row b')].map(x => x.textContent) };
  });
  chk(edit.ok && !edit.rows.includes('B0AAAAAA01') && edit.rows.length === 1,
    '筛选 US 下把行改到 EU → 该行移出 US 视图', (edit.rows || []).join(','));
  // 还原数据（避免影响后续断言/缓存）
  await p.evaluate(() => {
    const row = asinMap.find(m => m.asin === 'B0AAAAAA01');
    if (row) row.country = 'US';
    saveAll();
    renderAsinTable();
  });

  // 10. 云端写隔离
  warnIf(cloudPatches > 0, '云端 PATCH 次数（期望 0）', `${cloudPatches} 次`);

  console.log('---');
  console.log(`合计 ${pass + fail} 项断言，通过 ${pass}，失败 ${fail}，警告 ${warn}`);
  console.log('运行时报错:', errs.length === 0 ? '无' : errs.join(' / '));
  console.log(`本次拦截：Supabase GET ${cloudGets} 次 / PATCH ${cloudPatches} 次，全部为本地假响应，未触达真实云端`);
  if (fail > 0) process.exitCode = 1;
  await b.close();
})();
