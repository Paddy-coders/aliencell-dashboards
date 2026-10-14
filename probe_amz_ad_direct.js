// 在已登录浏览器中直接打开广告模块 amz-ad.eccang.com, 观察跳转与chunk加载
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const chunks = [];
  const apis = [];
  page.on('response', async resp => {
    const u = resp.url();
    if (u.includes('/ecStatic/js/')) { chunks.push(u.split('/').pop()); }
    if (u.includes('netapi')) {
      const at = resp.request().headers()['actiontype'] || '';
      apis.push({ at, status: resp.status() });
    }
  });
  await page.goto('https://amz-ad.eccang.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(10000);
  console.log('URL:', page.url().slice(0, 160));
  console.log('TITLE:', await page.title().catch(() => ''));
  const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 300)).catch(() => '(eval fail)');
  console.log('BODY:', JSON.stringify(body));
  console.log('\nchunks loaded:', JSON.stringify(chunks.slice(0, 40)));
  console.log('\napis:', JSON.stringify(apis.slice(0, 10)));

  // 尝试 hash 路由到关键词页
  for (const route of ['#/keywordsfororders', '#/adkeywordmonitoring']) {
    await page.goto('https://amz-ad.eccang.com/' + route, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto2 warn:', e.message));
    await page.waitForTimeout(6000);
    console.log(`\n--- 路由 ${route} ---`);
    console.log('URL:', page.url().slice(0, 160));
    const t2 = await page.evaluate(() => (document.body.innerText || '').slice(0, 250)).catch(() => '(eval fail)');
    console.log('BODY:', JSON.stringify(t2));
  }
  console.log('\nchunks total:', chunks.length, JSON.stringify(chunks.slice(0, 60)));
  console.log('apis:', JSON.stringify(apis.slice(0, 20)));
  await page.screenshot({ path: 'amz_ad_page.png', timeout: 15000 }).catch(() => {});
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
