/**
 * 拍新版 KPI（5 张 · 可下拉替换）与「无数据项已隐藏」的下拉。
 *   前置：node joybuy_browser.js --keep; sleep 5400
 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/joybuy.html';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = await b.contexts()[0].newPage();
  await page.addInitScript(() => { try { localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'probe' })); } catch (e) {} });
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto(FILE, { waitUntil: 'load', timeout: 40000 });
  await sleep(4200);
  const SHOT = { timeout: 90000 };

  // 1) KPI 卡片下拉展开（默认 5 张）
  await page.evaluate(() => {
    const c = document.querySelector('.kpi[data-slot="1"]');
    c.querySelector('.kpi-head').click();
  });
  await sleep(600);
  await page.screenshot(Object.assign({ path: '_jb_ui_kpi.png' }, SHOT));
  await page.evaluate(() => document.querySelectorAll('.kpi.open').forEach((x) => x.classList.remove('open')));

  // 2) 选出「只有 DE/FR/NL 有货」的系列后，看站点下拉怎么收窄（UK 应消失）
  await page.evaluate(() => {
    const s = document.querySelector('#ddSeries');
    s.classList.add('open');
    const o = [...s.querySelectorAll('.dd-opt')].find((x) => x.innerText.indexOf('Laser Module') >= 0);
    o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    s.classList.remove('open');
  });
  await sleep(1200);
  await page.evaluate(() => document.querySelector('#ddSite .dd-btn').click());
  await sleep(500);
  await page.screenshot(Object.assign({ path: '_jb_ui_hide.png' }, SHOT));
  await page.evaluate(() => document.getElementById('ddSite').classList.remove('open'));

  console.log('截图完成: _jb_ui_kpi.png / _jb_ui_hide.png');
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
