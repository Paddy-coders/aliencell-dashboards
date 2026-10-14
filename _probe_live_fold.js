// _probe_live_fold.js — 线上版本核对：说明块折叠 + 各筛选器默认值（诊断用，勿入回归）
// 用法: node _probe_live_fold.js
const { chromium } = require('./playwright-auth');
const HOST = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host';
const PAGES = ['daily.html', 'monthly.html', 'target.html', 'product.html', 'joybuy.html', 'woot.html', 'mapping.html', 'ad.html'];

(async () => {
  const browser = await chromium.launch();
  const cb = Date.now();
  for (const f of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'smoke@aliencell.com' } }));
    });
    const page = await ctx.newPage();
    let resp = null;
    page.on('response', r => { if (r.url().indexOf(f) >= 0 && !resp) resp = r.status(); });
    try {
      await page.goto(HOST + '/' + f + '?cb=' + cb, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(6000);
    } catch (e) {
      console.log(f.padEnd(14), 'GOTO-ERR', String(e).slice(0, 120));
      await ctx.close(); continue;
    }
    if (/login\.html/.test(page.url())) { console.log(f.padEnd(14), '被守卫重定向到 login'); await ctx.close(); continue; }
    const out = await page.evaluate(() => ({
      title: document.title,
      hasCss: !!Array.from(document.querySelectorAll('style')).find(s => s.textContent.indexOf('note-fold: ') >= 0),
      foldN: document.querySelectorAll('details.noteFold').length,
      foldOpen: Array.from(document.querySelectorAll('details.noteFold')).filter(d => d.open).length,
      foldH: (() => { const d = document.querySelector('details.noteFold'); return d ? Math.round(d.getBoundingClientRect().height) : -1; })(),
      sums: Array.from(document.querySelectorAll('.dd-summary')).map(e => (e.textContent || '').trim()),
      badge: (document.getElementById('rangeBadge') || {}).textContent || '',
      plat: (() => { const e = document.getElementById('ddPlatformSummary'); return e ? e.textContent.trim() : ''; })(),
    }));
    console.log('==== ' + f + ' (HTTP ' + resp + ') ' + out.title);
    console.log('   折叠块: ' + out.foldN + ' 个 / 展开 ' + out.foldOpen + ' / 首个高 ' + out.foldH + 'px / 折叠CSS: ' + out.hasCss);
    console.log('   筛选器: ' + out.sums.join(' | '));
    if (out.badge) console.log('   徽标: ' + out.badge.slice(0, 100));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
