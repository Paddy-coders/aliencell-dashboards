// 通过 playwright + CDP 打开云端看板中心，验证壳页面 + 两个看板 + 切换功能
const { chromium } = require('playwright');
const fs = require('fs');

const OUT_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const URL = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // 1. 默认页应为广告看板
  const info1 = await page.evaluate(() => {
    const f = document.getElementById('frame');
    let inner = {};
    try { const d = f.contentDocument; inner = { title: d.title, bodyLen: d.body.innerText.length }; } catch (e) { inner = { err: e.message }; }
    return {
      title: document.title,
      navCount: document.querySelectorAll('.nav-item').length,
      active: document.querySelector('.nav-item.active')?.getAttribute('data-id'),
      iframeSrc: f.src,
      inner
    };
  });
  console.log('== 默认页 ==', JSON.stringify(info1));
  await page.screenshot({ path: OUT_DIR + '/shell_ad.png', fullPage: false });

  // 2. 点击 产品+广告汇总
  await page.click('.nav-item[data-id="product"]');
  await page.waitForTimeout(5000);
  const info2 = await page.evaluate(() => {
    const f = document.getElementById('frame');
    let inner = {};
    try { const d = f.contentDocument; inner = { title: d.title, hasFilter: !!d.querySelector('.filter-bar, .dd-btn'), bodyLen: d.body.innerText.length }; } catch (e) { inner = { err: e.message }; }
    return { active: document.querySelector('.nav-item.active')?.getAttribute('data-id'), iframeSrc: f.src, hash: location.hash, inner };
  });
  console.log('== 切换后 ==', JSON.stringify(info2));
  await page.screenshot({ path: OUT_DIR + '/shell_product.png', fullPage: false });

  // 3. 刷新保持 hash
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  const info3 = await page.evaluate(() => ({
    hash: location.hash,
    active: document.querySelector('.nav-item.active')?.getAttribute('data-id'),
    iframeSrc: document.getElementById('frame').src
  }));
  console.log('== 刷新后 ==', JSON.stringify(info3));

  // 4. 切回广告看板
  await page.click('.nav-item[data-id="ad"]');
  await page.waitForTimeout(5000);
  const info4 = await page.evaluate(() => {
    const f = document.getElementById('frame');
    let inner = {};
    try { const d = f.contentDocument; inner = { title: d.title }; } catch (e) { inner = { err: e.message }; }
    return { active: document.querySelector('.nav-item.active')?.getAttribute('data-id'), inner };
  });
  console.log('== 切回广告 ==', JSON.stringify(info4));

  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
