// _probe_live.js — 线上站点冒烟：带 ?cb= 绕边缘缓存，检查渲染/报错/NaN/VAT 列是否生效（诊断用，勿入回归）
// 用法: node _probe_live.js
const { chromium } = require('./playwright-auth');
const HOST = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host';
const PAGES = ['daily.html', 'monthly.html', 'product.html', 'target.html', 'woot.html', 'ad.html'];

(async () => {
  const browser = await chromium.launch();
  const cb = Date.now();
  for (const f of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 2400, height: 1200 } });
    await ctx.addInitScript(() => {
      // 守卫只做「登录态存在性」同步检查
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'smoke@aliencell.com' } }));
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    let resp = null;
    page.on('response', r => { if (r.url().indexOf(f) >= 0 && !resp) resp = r.status(); });
    try {
      await page.goto(HOST + '/' + f + '?cb=' + cb, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForTimeout(9000);
    } catch (e) {
      console.log(f.padEnd(14), 'GOTO-ERR', String(e).slice(0, 140));
      await ctx.close(); continue;
    }
    const out = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const tbl = document.querySelector('table');
      let totalRow = null;
      if (tbl) {
        const rows = [...tbl.querySelectorAll('tr')];
        const ti = rows.findIndex(tr => /合计|总计/.test(tr.innerText));
        if (ti >= 0) totalRow = [...rows[ti].querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim());
      }
      const head = tbl ? (tbl.querySelector('tr') ? tbl.querySelector('tr').innerText.replace(/\s+/g, ' ') : '') : '';
      return {
        title: document.title,
        len: txt.length,
        nan: (txt.match(/NaN/g) || []).length,
        undef: (txt.match(/undefined/g) || []).length,
        hasVatCol: /VAT/.test(head),
        totalRow,
        head: head.slice(0, 200)
      };
    });
    console.log('================ ' + f + ' (HTTP ' + resp + ') ================');
    console.log('  title:', out.title, '| 文本长度:', out.len, '| NaN:', out.nan, '| undefined:', out.undef, '| VAT列:', out.hasVatCol);
    if (out.head) console.log('  表头:', out.head);
    if (out.totalRow) console.log('  合计行:', JSON.stringify(out.totalRow));
    if (errs.length) console.log('  ⚠ PAGEERR:', errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
