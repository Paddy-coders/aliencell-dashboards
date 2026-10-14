// 在广告管理页面已加载的所有JS中搜索包含Keyword/Target的actiontype
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  // 导航到广告管理并等待加载
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'networkidle', timeout: 120000 }).catch(e => {});
  await sleep(5000);

  const results = await page.evaluate(() => {
    const found = [];
    // 搜索所有script标签的内容
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (text.includes('Keyword') || text.includes('Target') || text.includes('keyword') || text.includes('target')) {
        // 提取包含 actiontype 附近上下文
        const matches = text.match(/actiontype[^"]*"[^"]*[Kk]eyword[^"]*"/g) || [];
        const matches2 = text.match(/actiontype[^"]*"[^"]*[Tt]arget[^"]*"/g) || [];
        const matches3 = text.match(/"[^"]*[Kk]eyword[^"]*\.Get[^"]*"/g) || [];
        const matches4 = text.match(/"[^"]*[Tt]arget[^"]*\.Get[^"]*"/g) || [];
        found.push(...matches, ...matches2, ...matches3, ...matches4);
      }
    }
    // 搜索 window 对象中可能的接口定义
    const winKeys = Object.keys(window).filter(k => /keyword|target/i.test(k));
    return { found: [...new Set(found)], winKeys: winKeys.slice(0, 20) };
  });

  console.log('=== 找到的actiontype ===');
  for (const f of results.found.slice(0, 50)) {
    console.log(f);
  }
  console.log('\n=== window中含keyword/target的key ===');
  console.log(results.winKeys);

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
