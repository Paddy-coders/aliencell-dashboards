// _probe_monthly_plat.js — 月度看板平台筛选诊断（勿入回归）
// 用法: node _probe_monthly_plat.js
const { chromium } = require('playwright');
const path = require('path');

const AUTH = JSON.stringify({ access_token: 'probe', refresh_token: 'probe', email: 'probe@local', exp: Date.now() + 864e5 });
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';

const READ = () => {
  const tbl = document.querySelector('#tableWrap table');
  const rows = tbl ? [...tbl.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim())) : [];
  const total = rows.find(r => /合计|总计/.test(r[0] || '')) || null;
  const kpis = [...document.querySelectorAll('#kpiRow .kpi')].map(k => (k.querySelector('.kpi-label') || {}).innerText + '=' + (k.querySelector('.kpi-value') || {}).innerText);
  return {
    platSummary: (document.getElementById('ddPlatformSummary') || {}).textContent,
    platOptions: [...document.querySelectorAll('#ddPlatformList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    seriesOptions: [...document.querySelectorAll('#ddSeriesList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    asinOptions: [...document.querySelectorAll('#ddAsinList .dd-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    monthRows: rows.length,
    total,
    kpis,
    nan: ((document.body.innerText || '').match(/NaN/g) || []).length,
    undef: ((document.body.innerText || '').match(/undefined/g) || []).length,
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  await ctx.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(a => { try { localStorage.setItem('wb_auth', a); localStorage.setItem('pc_woot', '[]'); } catch (e) {} }, AUTH);
  await page.goto('file:///' + path.resolve(BASE, 'monthly.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const show = (tag, r) => {
    console.log('\n===== ' + tag + ' =====');
    console.log('平台摘要: ' + r.platSummary + ' | 平台选项: ' + r.platOptions.join(' / '));
    console.log('KPI: ' + r.kpis.join(' · '));
    console.log('表体行数: ' + r.monthRows);
    if (r.total) console.log('合计行: ' + JSON.stringify(r.total.slice(0, 12)));
    console.log('系列选项: ' + r.seriesOptions.join(' / '));
    console.log('ASIN 选项数: ' + r.asinOptions.length);
    console.log('NaN=' + r.nan + ' undefined=' + r.undef);
  };

  show('① 默认（应为全部平台）', await page.evaluate(READ));

  // 选平台：下拉可能是开的（选完不自动收起），先确保打开再点
  const pickPlat = async (idx) => {
    const open = await page.evaluate(() => { const el = document.getElementById('ddPlatform'); return !!el && el.classList.contains('open'); });
    if (!open) { await page.click('#ddPlatform .dd-btn'); await page.waitForTimeout(150); }
    await page.click(`#ddPlatformList .dd-opt:nth-child(${idx})`);
    await page.waitForTimeout(600);
  };

  // ② 只看 JoyBuy：真实点 UI
  await pickPlat(2);
  show('② 只看 JoyBuy', await page.evaluate(READ));

  // ③ 只看 Amazon
  await pickPlat(1);
  show('③ 只看 Amazon', await page.evaluate(READ));

  // ④ 「看全部平台」按钮
  {
    const open = await page.evaluate(() => { const el = document.getElementById('ddPlatform'); return !!el && el.classList.contains('open'); });
    if (!open) { await page.click('#ddPlatform .dd-btn'); await page.waitForTimeout(150); }
  }
  await page.click('#ddPlatform .dd-tools .btn');
  await page.waitForTimeout(600);
  show('④ 点「看全部平台」后', await page.evaluate(READ));

  if (errs.length) console.log('\n⚠️ PAGEERR: ' + errs.slice(0, 3).join(' | '));
  else console.log('\n无 JS 报错');
  await ctx.close(); await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
