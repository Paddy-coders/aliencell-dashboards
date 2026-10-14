// ASIN 维度全量抓包（所有 XHR 响应体，去重保存）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || '9223';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = path.join(__dirname, '_profit_asin2.log');
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(LOG, s + '\n'); console.log(s); };
setTimeout(() => { log('WATCHDOG'); process.exit(3); }, 150000);

(async () => {
  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const pages = [];
    b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
    const page = pages.find(p => p.url().includes('profit_system'));
    log('页面:', page.url().slice(0, 120));

    const caps = [];
    page.on('response', async resp => {
      const rt = resp.request().resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      const u = resp.url();
      if (/traffic\/list|announcement|notice|msgNotice|menuStatistics/.test(u)) return; // 噪音
      let body = '';
      try { body = await Promise.race([resp.text(), sleep(10000).then(() => '<slow>')]); } catch (e) { body = '<err>'; }
      caps.push({ url: u, method: resp.request().method(), reqBody: resp.request().postData() || '', status: resp.status(), len: body.length, body: body.slice(0, 3000000) });
      log('[CAP]', String(body.length).padStart(9), u.slice(0, 150));
    });

    // 先切到别的维度再切回 ASIN，确保触发完整查询
    const tabShop = page.locator('.profit-statement-tabs-tab', { hasText: '店铺' }).first();
    if (await tabShop.count()) { await tabShop.click({ timeout: 8000 }).catch(e => log('切店铺失败', e.message)); await sleep(6000); }
    const tab = page.locator('.profit-statement-tabs-tab', { hasText: 'ASIN' }).first();
    await tab.click({ timeout: 10000 });
    log('已点 ASIN');
    await sleep(18000);

    fs.writeFileSync(path.join(__dirname, '_profit_asin_all.json'), JSON.stringify(caps, null, 1), 'utf8');
    log('已保存', caps.length, '个响应');

    const sess = await page.context().newCDPSession(page);
    const r = await Promise.race([sess.send('Page.captureScreenshot', { format: 'png' }).catch(() => null), sleep(8000).then(() => null)]);
    if (r) { fs.writeFileSync(path.join(__dirname, '_shot_profit_asin2.png'), Buffer.from(r.data, 'base64')); log('截图 ok'); }
    await b.close().catch(() => {});
    process.exit(0);
  } catch (e) { log('FATAL', e.message); process.exit(1); }
})();
