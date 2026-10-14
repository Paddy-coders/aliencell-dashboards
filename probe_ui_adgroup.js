// 直接导航到广告组详情路由(type=2), 拦截 AdGroupBidKw.GetList 请求+响应
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  // 拦截 netapi 响应
  const captured = [];
  ctx.on('response', async resp => {
    if (resp.url().includes('amz-ad.eccang.com/netapi')) {
      try {
        const hdrs = resp.request().headers();
        const action = hdrs['actiontype'] || '';
        if (/AdGroupBidKw|AdGroupPAT|AdGroupQuery|AdGroupNegKw|Report/.test(action)) {
          const txt = await resp.text();
          captured.push({ action, req: resp.request().postData() || '', resp: txt.slice(0, 1200), time: new Date().toISOString().slice(11, 19) });
        }
      } catch (e) {}
    }
  });

  const url = 'https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement?type=2&newId=43472039186019&groupId=218449056837479';
  console.log('导航:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(10000);
  console.log('URL:', page.url().slice(0, 180));

  // 页面上的tab
  const tabs = await page.locator('.el-radio-button').allInnerTexts().catch(() => []);
  console.log('radio-tabs:', tabs.slice(0, 15));

  // 表格标题/列头
  const headers = await page.locator('.vxe-header__column, th').allInnerTexts().catch(() => []);
  console.log('表头:', headers.slice(0, 25));

  // 输出捕获
  console.log('\n捕获 ' + captured.length + ' 条:');
  for (const c of captured) {
    console.log('>>> ' + c.action + ' @' + c.time);
    console.log('  REQ:', c.req.slice(0, 700));
    console.log('  RESP:', c.resp.slice(0, 500));
    console.log('');
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
