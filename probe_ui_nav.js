// 导航到广告管理 → 活动 → 广告组 → 投放, 拦截所有 netapi 请求（含 headers）
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('当前页面:');
  for (const p of pages) console.log(' -', p.url().slice(0, 120));

  let page = pages.find(p => p.url().includes('eccang.com')) || pages[0];
  console.log('\n使用页面:', page.url().slice(0, 120));

  // 拦截 netapi 请求
  const captured = [];
  ctx.on('request', req => {
    if (req.url().includes('amz-ad.eccang.com/netapi')) {
      const hdrs = req.headers();
      captured.push({ action: hdrs['actiontype'] || '', body: req.postData() || '', time: new Date().toISOString().slice(11, 19) });
      if (captured.length > 60) captured.shift();
    }
  });

  // 打开广告管理页
  console.log('\n打开广告管理...');
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(8000);
  console.log('URL:', page.url().slice(0, 160));

  // 打印已捕获请求
  const dump = () => {
    const acts = {};
    for (const c of captured) acts[c.action] = (acts[c.action] || 0) + 1;
    console.log('已捕获接口:', JSON.stringify(acts));
  };
  dump();

  // 点击活动行（X1-词组匹配 43472039186019）
  console.log('\n查找活动行...');
  // 表格行可能包含活动名，尝试文本定位
  for (const txt of ['X1-词组匹配', '43472039186019']) {
    const row = page.locator('tr', { hasText: txt }).first();
    if (await row.count()) {
      console.log('找到行:', txt);
      await row.click().catch(e => console.log('click warn:', e.message));
      await page.waitForTimeout(6000);
      break;
    }
  }
  console.log('URL:', page.url().slice(0, 160));
  dump();

  // 点击广告组行（Laser Cutter+PH-260805）
  console.log('\n查找广告组行...');
  for (const txt of ['Laser Cutter+PH-260805', '218449056837479']) {
    const row = page.locator('tr', { hasText: txt }).first();
    if (await row.count()) {
      console.log('找到行:', txt);
      await row.click().catch(e => console.log('click warn:', e.message));
      await page.waitForTimeout(6000);
      break;
    }
  }
  console.log('URL:', page.url().slice(0, 160));
  dump();

  // 当前页面的投放Tab - 先看页面结构
  console.log('\n页面 tab 结构:');
  const tabs = await page.locator('.el-radio-button, .el-tabs__item, [role=tab]').allInnerTexts().catch(() => []);
  console.log('tabs:', tabs.slice(0, 20));

  // 点击「投放」Tab（如果有）
  for (const t of ['投放', 'Keywords', '关键词']) {
    const tb = page.locator('.el-radio-button, .el-tabs__item, [role=tab]', { hasText: t }).first();
    if (await tb.count()) {
      console.log('点击Tab:', t);
      await tb.click().catch(e => console.log('click warn:', e.message));
      await page.waitForTimeout(5000);
      break;
    }
  }
  dump();

  // 输出捕获的 AdGroupBidKw/PAT/Query 请求完整内容
  for (const c of captured) {
    if (/AdGroupBidKw|AdGroupPAT|AdGroupQuery|AdGroupNegKw/.test(c.action)) {
      console.log('\n>>> ' + c.action + ' @' + c.time);
      try {
        const b = JSON.parse(c.body);
        console.log('Content:', JSON.stringify(b.Content).slice(0, 900));
      } catch (e) { console.log(c.body.slice(0, 900)); }
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
