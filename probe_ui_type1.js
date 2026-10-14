// 导航 type=1 活动详情, 观察 URL 变化与请求; 再点击广告组行进入投放页
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }

  const captured = [];
  ctx.on('response', async resp => {
    if (resp.url().includes('amz-ad.eccang.com/netapi')) {
      try {
        const action = resp.request().headers()['actiontype'] || '';
        if (/AdGroupBidKw|AdGroupPAT|AdGroupQuery|AdGroup\.GetList|Report/.test(action)) {
          const txt = await resp.text();
          captured.push({ action, req: resp.request().postData() || '', resp: txt.slice(0, 900), time: new Date().toISOString().slice(11, 19) });
        }
      } catch (e) {}
    }
  });

  const url = 'https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement?type=1&newId=43472039186019';
  console.log('导航 type=1:', url.slice(-70));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(10000);
  console.log('URL:', page.url().slice(0, 160));

  // radio tabs
  const tabs = await page.locator('.el-radio-button').allInnerTexts().catch(() => []);
  console.log('radio-tabs:', tabs.slice(0, 15));

  // 找表格行: 广告组列表
  const rows = await page.locator('.vxe-body--row').count().catch(() => 0);
  console.log('表格行数:', rows);
  const firstRowText = await page.locator('.vxe-body--row').first().innerText().catch(() => '');
  console.log('首行:', firstRowText.slice(0, 150).replace(/\n/g, ' | '));

  // 尝试点击包含 Laser Cutter 的行
  const row = page.locator('.vxe-body--row', { hasText: 'Laser Cutter' }).first();
  if (await row.count()) {
    console.log('\n点击广告组行: Laser Cutter');
    await row.click().catch(e => console.log('click warn:', e.message));
    await page.waitForTimeout(8000);
    console.log('URL:', page.url().slice(0, 160));
    const tabs2 = await page.locator('.el-radio-button').allInnerTexts().catch(() => []);
    console.log('radio-tabs:', tabs2.slice(0, 15));
  }

  // 打印捕获
  console.log('\n捕获 ' + captured.length + ' 条:');
  for (const c of captured) {
    console.log('>>> ' + c.action + ' @' + c.time);
    console.log('  REQ:', c.req.slice(0, 500));
    console.log('  RESP:', c.resp.slice(0, 400));
    console.log('');
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
