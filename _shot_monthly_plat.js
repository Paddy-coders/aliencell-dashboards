// _shot_monthly_plat.js — 生成月度看板平台筛选截图（诊断留证用，勿入回归）
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const AUTH = JSON.stringify({ access_token: 't', refresh_token: 't', email: 't@example.com', exp: Date.now() + 864e5 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1080 }, deviceScaleFactor: 1.5 });
  await ctx.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: { catalog: [], asinMap: [] } }]) }));
  const page = await ctx.newPage();
  await page.addInitScript(a => { try { localStorage.setItem('wb_auth', a); localStorage.setItem('pc_woot', '[]'); } catch (e) {} }, AUTH);
  await page.goto('file:///' + path.resolve(BASE, 'monthly.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 收起说明块，避免占据截图版面
  await page.evaluate(() => document.querySelectorAll('details.noteFold').forEach(d => { d.open = false; }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(BASE, '_shot_monthly_all.png'), clip: { x: 0, y: 0, width: 1720, height: 620 } });
  console.log('已存 _shot_monthly_all.png');

  // 打开平台下拉 + 切到 JoyBuy
  await page.click('#ddPlatform .dd-btn');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(BASE, '_shot_monthly_dd.png'), clip: { x: 0, y: 150, width: 1720, height: 600 } });
  await page.click('#ddPlatformList .dd-opt:nth-child(2)');
  await page.waitForTimeout(600);
  await page.evaluate(() => { const el = document.getElementById('ddPlatform'); if (el) el.classList.remove('open'); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(BASE, '_shot_monthly_joybuy.png'), clip: { x: 0, y: 0, width: 1720, height: 620 } });
  console.log('已存 _shot_monthly_dd.png / _shot_monthly_joybuy.png');
  await ctx.close(); await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
