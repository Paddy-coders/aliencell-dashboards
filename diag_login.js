const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);
  console.log('URL:', page.url());
  const info = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ id: i.id, name: i.name, type: i.type, ph: i.placeholder }));
    const btns = [...document.querySelectorAll('button')].map(b => ({ text: (b.innerText||'').trim().slice(0, 30), cls: (b.className||'').slice(0, 60) }));
    const hasUsername = !!document.querySelector('#userName');
    return { inputs, btns, hasUsername, bodyStart: (document.body.innerText||'').slice(0, 200) };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: 'login_diag.png', fullPage: false });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
