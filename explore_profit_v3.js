// 进入利润报表 v3：正确的可见节点选择器 .entry-layout-menus-item__text--link
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || '9223';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = path.join(__dirname, '_profit_v3.log');
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(LOG, s + '\n'); console.log(s); };
setTimeout(() => { log('WATCHDOG'); process.exit(3); }, 150000);

(async () => {
  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const pages = [];
    b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
    const page = pages.find(p => p.url().includes('eccang.com'));

    const reqs = [];
    page.on('request', req => {
      const rt = req.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      reqs.push({ url: req.url(), method: req.method(), body: (req.postData() || '').slice(0, 8000) });
    });
    const interesting = [];
    page.on('response', async resp => {
      const u = resp.url();
      if (!/profit|\/ps\/|ntvb7tr-(ps|fin)|sso\/(forward|auth|ticket|login)|token/i.test(u)) return;
      const rt = resp.request().resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      let body = '';
      try { body = await Promise.race([resp.text(), sleep(6000).then(() => '<slow>')]); } catch (e) { body = '<err>'; }
      interesting.push({ url: u, status: resp.status(), len: body.length, body: body.slice(0, 300000) });
      log('[RESP]', resp.status, String(body.length).padStart(8), u.slice(0, 170));
    });
    b.contexts().forEach(ctx => ctx.on('page', p => log('!! 新标签:', p.url().slice(0, 160))));

    // hover 打开财务下拉
    const fin = page.locator('.entry-layout-header-menus__item__label', { hasText: '财务' }).first();
    await fin.hover({ timeout: 10000 });
    await sleep(2200);

    // 点击可见菜单项
    const item = page.locator('.entry-layout-menus-item__text--link', { hasText: '利润报表' }).first();
    log('匹配数:', await item.count());
    log('box:', JSON.stringify(await item.boundingBox().catch(() => null)));
    await item.click({ timeout: 10000 });
    log('已点击');

    // 观察导航
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      const pagesNow = [];
      b.contexts().forEach(ctx => ctx.pages().forEach(p => pagesNow.push(p.url().slice(0, 130))));
      const fr = page.frames().map(f => f.url().slice(0, 140));
      log('t+' + ((i + 1) * 3) + 's', JSON.stringify(pagesNow), '| frames:', JSON.stringify(fr));
      if (/profit|ntvb7tr-ps/i.test(JSON.stringify(pagesNow) + JSON.stringify(fr))) { log('★ 已到利润报表'); break; }
    }

    // 点击后的全部新请求
    log('\n=== 点击后的请求（去重） ===');
    const seen = new Set();
    reqs.forEach(r => {
      const k = r.method + ' ' + r.url.split('?')[0];
      if (seen.has(k)) return; seen.add(k);
      log('[REQ]', r.method, r.url.slice(0, 175));
      if (r.body) log('     ', r.body.replace(/\s+/g, ' ').slice(0, 400));
    });

    const sess = await page.context().newCDPSession(page);
    const r = await Promise.race([sess.send('Page.captureScreenshot', { format: 'png' }).catch(() => null), sleep(9000).then(() => null)]);
    if (r) { fs.writeFileSync(path.join(__dirname, '_shot_profit_v3.png'), Buffer.from(r.data, 'base64')); log('截图 ok'); }
    fs.writeFileSync(path.join(__dirname, '_profit_interesting_v3.json'), JSON.stringify(interesting, null, 2), 'utf8');
    log('完成');
    await b.close().catch(() => {});
    process.exit(0);
  } catch (e) { log('FATAL', e.message); process.exit(1); }
})();
