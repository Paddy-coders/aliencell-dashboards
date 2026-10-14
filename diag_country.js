// 诊断: 国家下拉的 dim 逻辑
const { chromium } = require('playwright');
const URL = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard.html';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const dump = async (tag) => {
    const d = await page.evaluate(() => ({
      open: document.getElementById('ddCountry').classList.contains('open'),
      opts: [...document.querySelectorAll('#ddCountryList .dd-opt')].map(o => ({
        cls: o.className,
        name: o.querySelector('.opt-name').textContent.trim(),
        vis: o.offsetParent !== null
      })),
      scope: [...countryInScope()],
      selCountry: [...selCountry], selWeek: [...selWeek], selAsin: [...selAsin], selType: [...selType], selCampaigns: [...selCampaigns]
    }));
    console.log(`--- ${tag} ---`);
    console.log(JSON.stringify(d, null, 1));
  };

  await page.click('#ddCountry .dd-btn');
  await page.waitForTimeout(400);
  await dump('打开国家下拉后');

  // 点击第一个非dim选项(DE)
  await page.locator('#ddCountryList .dd-opt:not(.dim)').nth(0).click();
  await page.waitForTimeout(800);
  await dump('点击DE后');

  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
})().catch(e => { console.error('FATAL', e); process.exit(1); });
