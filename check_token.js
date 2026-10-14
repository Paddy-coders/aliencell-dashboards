const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }
  const raw = await page.evaluate(() => localStorage.getItem('pro__Access-Token')).catch(() => null);
  if (!raw) { console.log('NO TOKEN'); await browser.close(); return; }
  const token = JSON.parse(raw).value;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const now = Date.now();
  console.log('payload:', JSON.stringify(payload));
  console.log('currentTimeMillis:', payload.currentTimeMillis, '=', new Date(parseInt(payload.currentTimeMillis)).toISOString());
  console.log('exp:', payload.exp, '=', new Date(payload.exp * 1000).toISOString());
  console.log('now:', now, '=', new Date(now).toISOString());
  console.log('token alive?', now < payload.exp * 1000);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
