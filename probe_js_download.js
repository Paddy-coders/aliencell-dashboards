// 通过Performance API获取所有加载的JS资源，下载并搜索Keyword/Target相关actiontype
const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function download(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'networkidle', timeout: 120000 }).catch(e => {});
  await sleep(5000);

  const jsUrls = await page.evaluate(() => {
    return performance.getEntriesByType('resource')
      .filter(r => r.name.endsWith('.js'))
      .map(r => r.name);
  });

  console.log('JS 资源数:', jsUrls.length);

  const found = [];
  for (const url of jsUrls) {
    if (!url.includes('amz-ad') && !url.includes('eccang')) continue;
    const text = await download(url);
    if (!text) continue;
    // 搜索 keyword/target 相关的 actiontype
    const matches = text.match(/"[^"]*[Kk]eyword[^"]*\.Get[^"]*"/g) || [];
    const matches2 = text.match(/"[^"]*[Tt]arget[^"]*\.Get[^"]*"/g) || [];
    const matches3 = text.match(/actiontype[^"]*"[^"]*[Kk]eyword[^"]*"/g) || [];
    const matches4 = text.match(/actiontype[^"]*"[^"]*[Tt]arget[^"]*"/g) || [];
    const all = [...matches, ...matches2, ...matches3, ...matches4];
    if (all.length > 0) {
      found.push({ url: url.split('/').pop(), items: [...new Set(all)].slice(0, 10) });
    }
  }

  console.log('\n=== 匹配的JS文件 ===');
  for (const f of found) {
    console.log('\nFile:', f.url);
    for (const item of f.items) {
      console.log(' ', item);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
