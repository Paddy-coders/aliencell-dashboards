// _probe_woot_cfg.js — woot.html「Woot 成本设置」探针(毛利口径框架)
// 用法: node _probe_woot_cfg.js  (BASE 默认 http://127.0.0.1:8896, 必须从 _deploy/ 起服务)
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8896';
const SUPA = '**://oovvqvgrjqwogjwswaxx.supabase.co/**';

const WOOT_DAY = { start: '2026-09-10', end: '2026-09-10', type: 'day', asin: 'B0H69JJZ1M',
  metrics: { orders: 1, sales: 1899.99, adCost: 518.8, adClicks: 166, adOrders: 0, adImpr: 48035, adSales: 0 } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1720, height: 1100 } });
  await ctx.addInitScript((w) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 't@aliencell.com' } }));
    localStorage.setItem('pc_woot', JSON.stringify(w));
  }, [WOOT_DAY]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  let patched = null;
  await page.route(SUPA, async route => {
    const req = route.request();
    if (req.method() === 'PATCH') { try { patched = JSON.parse(req.postData() || '{}'); } catch (e) {} }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: {}, updated_at: 'x' }]) });
  });
  await page.goto(BASE + '/woot.html?v=cfg1', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const s1 = await page.evaluate(() => ({
    cardExists: !!document.getElementById('cfgPrice'),
    price: document.getElementById('cfgPrice') ? document.getElementById('cfgPrice').value : null,
    rows: document.querySelectorAll('#costWrap table.tbl tbody tr').length,
    asins: [...document.querySelectorAll('#costWrap table.tbl tbody tr')].map(tr => tr.querySelector('code') ? tr.querySelector('code').textContent : ''),
    stat: document.getElementById('cfgStat') ? document.getElementById('cfgStat').textContent : null,
    // 说明里是否有采购价/毛利公式
    hintHasFormula: document.body.innerText.indexOf('采购价 × 订单量') >= 0,
    hintHasWarn: document.body.innerText.indexOf('不参与') >= 0,
    localCfg: localStorage.getItem('pc_woot_cfg'),
  }));
  console.log('=== 初始 ===');
  console.log(JSON.stringify(s1, null, 1));

  // 粘贴成本表(含表头行 + 2 个 ASIN + 1 行无 ASIN)
  await page.fill('#costText', '子ASIN\t产品成本\t运费\nB0H69JJZ1M\t620.5\t38\nB0FN3NPF7Y, 480, 32\n合计, 1100.5, 70');
  await page.click('button:has-text("解析成本表")');
  await page.waitForTimeout(600);
  const s2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#costWrap table.tbl tbody tr').length,
    cells: [...document.querySelectorAll('#costWrap table.tbl tbody tr')].map(tr =>
      [...tr.querySelectorAll('input, td')].map(x => x.tagName === 'INPUT' ? x.value : x.textContent.trim())),
    stat: document.getElementById('cfgStat').textContent,
    localBeforeSave: localStorage.getItem('pc_woot_cfg'),
  }));
  console.log('=== 解析成本表后 ===');
  console.log(JSON.stringify(s2, null, 1));

  // 保存到云端
  await page.click('button:has-text("保存成本设置")');
  await page.waitForTimeout(1500);
  const s3 = await page.evaluate(() => ({ local: localStorage.getItem('pc_woot_cfg'), cloud: document.getElementById('cloudBadge').textContent }));
  console.log('=== 保存后 ===');
  console.log('localStorage pc_woot_cfg =', s3.local);
  console.log('云端状态 =', s3.cloud);
  console.log('PATCH body.data.wootCfg =', JSON.stringify(patched && patched.data ? patched.data.wootCfg : null));
  console.log('PATCH body.data 键 =', patched && patched.data ? Object.keys(patched.data).join(',') : '(no patch)');
  console.log('=== page errors ===');
  console.log(errs.length ? errs : '(none)');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
