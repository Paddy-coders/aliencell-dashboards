// 诊断: 点击第一个活动选项后面板状态
const { chromium } = require('playwright');
const URL = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard.html';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // 打开广告活动下拉
  await page.click('#ddCampaign .dd-btn');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    open: document.getElementById('ddCampaign').classList.contains('open'),
    count: document.querySelectorAll('#ddCampaignList .dd-opt').length,
    visible: [...document.querySelectorAll('#ddCampaignList .dd-opt')].map(o => o.offsetParent !== null),
    panelDisplay: getComputedStyle(document.querySelector('#ddCampaign .dd-panel')).display
  }));
  console.log('点击前:', JSON.stringify(before, null, 2));

  // 点击第一个选项(普通单击)
  await page.locator('#ddCampaignList .dd-opt').nth(0).click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    open: document.getElementById('ddCampaign').classList.contains('open'),
    count: document.querySelectorAll('#ddCampaignList .dd-opt').length,
    visible: [...document.querySelectorAll('#ddCampaignList .dd-opt')].map(o => o.offsetParent !== null),
    panelDisplay: getComputedStyle(document.querySelector('#ddCampaign .dd-panel')).display,
    camps: [...selCampaigns],
    badge: document.getElementById('viewBadge') ? document.getElementById('viewBadge').textContent : ''
  }));
  console.log('点击后:', JSON.stringify(after, null, 2));

  await page.screenshot({ path: 'filter_diag.png' }).catch(() => {});
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
})().catch(e => { console.error('FATAL', e); process.exit(1); });
