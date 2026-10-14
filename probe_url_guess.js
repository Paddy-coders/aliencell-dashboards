// 尝试直接导航到广告活动详情、广告组列表、投放页面等URL，捕获请求
const { chromium } = require('playwright');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) { page = p; break; }
  }

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi')) {
      reqs.push({ url: url.slice(0, 200), method: req.method(), body: (req.postData() || '').slice(0, 3000) });
    }
  });

  const base = 'https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web';
  const campaignId = '22010039657137';
  const adGroupId = '501750541660021';

  const urls = [
    `${base}#/admanagement/campaignmanagement`,
    `${base}#/admanagement/campaignmanagement/detail`,
    `${base}#/admanagement/campaignmanagement/detail?id=${campaignId}`,
    `${base}#/admanagement/campaignmanagement/detail?campaignId=${campaignId}`,
    `${base}#/admanagement/adgroupmanagement`,
    `${base}#/admanagement/adgroupmanagement?campaignId=${campaignId}`,
    `${base}#/admanagement/targetingmanagement`,
    `${base}#/admanagement/targetingmanagement?adGroupId=${adGroupId}`,
    `${base}#/admanagement/keywordmanagement`,
    `${base}#/admanagement/keywordmanagement?adGroupId=${adGroupId}`,
    `${base}#/admanagement/adkeywordmanagement`,
    `${base}#/admanagement/adkeywordmanagement?adGroupId=${adGroupId}`,
  ];

  for (const url of urls) {
    console.log('\n=== 导航到:', url.split('#')[1], '===');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
    await sleep(6000);
    console.log('URL after:', page.url().split('#')[1] || page.url());
    await page.screenshot({ path: `td_url_${url.split('#')[1].replace(/[/?=]/g, '_')}.png`, timeout: 10000 });
  }

  console.log('\n=== 所有 netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
    } catch (e) { console.log('body:', r.body.slice(0, 300)); }
  }
  fs.writeFileSync('probe_urls.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
