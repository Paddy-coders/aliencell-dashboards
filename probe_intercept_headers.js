// 在广告管理页面拦截所有请求，查看完整的请求头和body（特别是认证相关）
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('admanagement')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();

  // 拦截 amz-ad.eccang.com 的所有请求
  await page.route('https://amz-ad.eccang.com/**', async (route, request) => {
    const url = request.url();
    const headers = request.headers();
    const body = request.postData() || '';
    if (url.includes('netapi')) {
      console.log('\n=== 拦截请求 ===');
      console.log('URL:', url);
      console.log('Headers:', JSON.stringify(headers, null, 2).slice(0, 800));
      console.log('Body:', body.slice(0, 1000));
    }
    route.continue();
  });

  // 刷新页面触发请求
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('reload warn', e.message));
  await sleep(10000);

  // 也尝试点击"查询"按钮触发请求
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, span, a, div')];
    const q = btns.find(e => (e.textContent || '').trim() === '查询' || (e.textContent || '').trim() === '搜索');
    if (q) q.click();
  });
  await sleep(5000);

  console.log('\nDone');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
