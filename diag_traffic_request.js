// 诊断: 连接 Edge CDP, 打开业务报告页, 捕获 /traffic/list 请求的 postData 结构
// 用途: 确认 date_start/date_end 字段名是否变化, 解释 fetch_daily_data.js 拦截改写失效原因
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';
  let page = null;
  const eccPages = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) eccPages.push(p);
  }
  page = eccPages.find(p => !p.url().includes('/login')) || eccPages[0];
  if (!page) { console.log('无易仓页面'); process.exit(1); }
  if (page.url().includes('/login')) {
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto:', e.message));
    await page.waitForTimeout(6000);
  }
  console.log('页面:', page.url().slice(0, 100));

  // 捕获请求 (不修改, 只看结构)
  const captures = [];
  page.on('request', req => {
    if (req.url().includes('/traffic/list') && req.method() === 'POST') {
      captures.push(req.postData());
    }
  });

  // 找业务报告 iframe, 若不在则导航
  let frame = page.frames().find(f => f.url().includes('businessReportNew'));
  if (!frame) {
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(9000);
    await page.evaluate(() => {
      const closeBtns = document.querySelectorAll('.home-ant-modal-close, .home-ant-btn-primary, button');
      for (const b of closeBtns) {
        const t = (b.textContent || '').trim();
        if (t === '知道了' || t === '确定' || t === '关闭' || t === '×') { b.click(); break; }
      }
    }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      for (const tab of document.querySelectorAll('.home-ant-tabs-tab')) {
        if ((tab.textContent || '').trim() === '销售') { tab.click(); break; }
      }
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      for (const item of document.querySelectorAll('.entry-menus-item__title__main')) {
        if ((item.textContent || '').trim() === '业务报告') { item.scrollIntoView({ behavior: 'instant', block: 'center' }); item.click(); return; }
      }
    });
    await page.waitForTimeout(4000);
    for (let i = 0; i < 15; i++) {
      frame = page.frames().find(f => f.url().includes('businessReportNew'));
      if (frame) break;
      await page.waitForTimeout(2000);
    }
  }
  if (!frame) { console.log('未找到业务报告 iframe'); await browser.close(); process.exit(1); }
  console.log('业务报告frame:', frame.url().slice(0, 120));

  // 点搜索触发请求
  const clicked = await frame.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if ((b.textContent || '').replace(/\s/g, '') === '搜索') { b.click(); return true; }
    }
    return false;
  });
  console.log('点击搜索:', clicked);
  await page.waitForTimeout(8000);

  // 同时看看页面上日期筛选控件的显示值
  const uiDates = await frame.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input')) {
      const v = el.value;
      if (v && /\d{4}-\d{2}-\d{2}/.test(v)) out.push(v);
    }
    // 周期下拉
    for (const el of document.querySelectorAll('.home-ant-select-selection-item')) {
      const t = (el.textContent || '').trim();
      if (t) out.push('[周期]' + t);
    }
    return out;
  }).catch(() => []);
  console.log('页面日期控件值:', JSON.stringify(uiDates));

  console.log('捕获到', captures.length, '个 traffic/list 请求:');
  captures.forEach((pd, i) => {
    console.log(`--- 请求#${i + 1} postData (前600字符) ---`);
    console.log((pd || '').slice(0, 600));
  });
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
