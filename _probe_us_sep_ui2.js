/* _probe_us_sep_ui2.js — 诊断③：完整复现「用户浏览器」状态（云端 pc_woot 已同步）
 * 只读：允许 GET mapping，禁止一切写云端。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const AUTH = JSON.stringify({ access_token: 't', refresh_token: 't', email: 't@example.com', exp: Date.now() + 864e5 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } });
  await ctx.route('**/rest/v1/mapping*', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    console.log('[probe] 拦截非 GET 云端写:', route.request().method());
    return route.fulfill({ status: 403, contentType: 'application/json', body: '[]' });
  });
  const page = await ctx.newPage();
  await page.addInitScript(a => { try { localStorage.setItem('wb_auth', a); } catch (e) {} }, AUTH);

  await page.goto('file:///' + path.resolve(BASE, 'monthly.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  // 云端同步 → 比对 → location.reload()：等它自己 reload 完
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => ({ pcw: (localStorage.getItem('pc_woot') || '').length, pcfg: (localStorage.getItem('pc_woot_cfg') || '').length }));
    if (i >= 3 && st.pcw > 10) { console.log('[probe] pc_woot 已从云端同步, 长度 =', st.pcw, '| cfg =', st.pcfg); break; }
  }
  const st2 = await page.evaluate(() => ({ pcw: (localStorage.getItem('pc_woot') || '').length, n: JSON.parse(localStorage.getItem('pc_woot') || '[]').length, cfg: localStorage.getItem('pc_woot_cfg') || '' }));
  console.log('[probe] pc_woot 条数 =', st2.n, '| pc_woot_cfg =', st2.cfg.slice(0, 120));

  const read = async (tag) => {
    const r = await page.evaluate(() => {
      const t = document.querySelector('#tableWrap table');
      const theads = [...t.querySelectorAll('thead tr')].map(tr => [...tr.querySelectorAll('th')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
      const heads = theads[theads.length - 1];
      const ix = (h) => heads.findIndex(x => x === h);
      const trs = [...t.querySelectorAll('tbody tr')];
      const rows = trs.map(r => { const c = [...r.querySelectorAll('th,td')].map(x => x.innerText.replace(/\s+/g, ' ').trim()); return { label: c[0].slice(0, 12), sales: c[ix('销售额') + 1], ad: c[ix('广告花费') + 1], profit: c[ix('毛利') + 1], margin: c[ix('毛利率') + 1] }; });
      return { rows, chan: (document.getElementById('ddChannelSummary') || {}).textContent || '', ctry: (document.getElementById('ddCountrySummary') || {}).textContent || '' };
    });
    console.log(`\n--- ${tag} | 销售店铺=${r.chan} 国家=${r.ctry} ---`);
    r.rows.forEach(x => console.log(`  ${String(x.label).padEnd(14)} 销售额=${String(x.sales).padEnd(14)} 广告=${String(x.ad).padEnd(14)} 毛利=${String(x.profit).padEnd(14)} 毛利率=${x.margin}`));
    return r;
  };

  await read('① 默认（全部店铺=合并）· 全部国家');

  // 选「销售店铺 = Aliencell官方店铺」
  const pickByText = async (ddId, listId, text) => {
    const isOpen = await page.evaluate(i => document.getElementById(i).classList.contains('open'), ddId);
    if (!isOpen) { await page.click(`#${ddId} .dd-btn`, { force: true }); await page.waitForTimeout(200); }
    const loc = page.locator(`#${listId} .dd-opt`, { hasText: text }).first();
    await loc.click({ force: true });
    await page.waitForTimeout(500);
    return await page.evaluate(i => (document.getElementById(i + 'Summary') || {}).textContent || '', ddId);
  };
  let s = await pickByText('ddChannel', 'ddChannelList', 'Aliencell');
  console.log('\n[probe] 选择后 销售店铺摘要 =', s);
  await read('② 只看 Aliencell 官方店铺 · 全部国家');

  // 再选「国家 = 美国」
  s = await pickByText('ddCountry', 'ddCountryList', '美国');
  console.log('\n[probe] 选择后 国家摘要 =', s);
  await read('③ Aliencell 官方店铺 · 美国');

  // 回到合并渠道，看美国
  s = await pickByText('ddChannel', 'ddChannelList', '全部');
  console.log('\n[probe] 选择后 销售店铺摘要 =', s);
  await read('④ 合并渠道 · 美国');

  await browser.close();
})();
