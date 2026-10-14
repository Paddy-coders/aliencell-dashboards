// 临时探测脚本: 验证业务报告接口对 6月~7月 各天是否返回数据, 找出最早有数据的日期
// 使用方式: node probe_early.js (需先运行 auto_login_eccang.js 确保 Edge 9223 已登录)
const { chromium } = require('playwright');

const ALL_ACCOUNTS = [
  'Aliencell_Direct_BE','Aliencell_Direct_CA','Aliencell_Direct_DE','Aliencell_Direct_ES',
  'Aliencell_Direct_FR','Aliencell_Direct_IE','Aliencell_Direct_IT','Aliencell_Direct_MX',
  'Aliencell_Direct_NL','Aliencell_Direct_PL','Aliencell_Direct_SE','Aliencell_Direct_UK','Aliencell_Direct_US'
];
const ENTRY_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

// 生成 2026-06-01 ~ 2026-06-30 全部日期
const DATES = [];
for (let d = 1; d <= 30; d++) DATES.push(`2026-06-${String(d).padStart(2, '0')}`);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) if (p.url().includes('eccang.com')) { page = p; break; }
    if (page) break;
  }
  if (!page) {
    const ctx0 = browser.contexts()[0] || await browser.newContext();
    page = await ctx0.newPage();
    await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000);
  }
  if (page.url().includes('/login')) { console.log('ERROR: 未登录'); process.exit(1); }
  console.log('当前URL:', page.url().slice(0, 100));

  // 确保业务报告 frame
  async function ensureFrame(pg) {
    for (const f of pg.frames()) if (f.url().includes('businessReportNew')) return f;
    await pg.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pg.waitForTimeout(9000);
    const tabs = await pg.locator('.home-ant-tabs-tab').all();
    for (const tab of tabs) {
      const text = (await tab.textContent() || '').trim();
      if (text === '销售') { await tab.click(); break; }
    }
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => {
      const items = document.querySelectorAll('.entry-menus-item__title__main');
      for (const item of items) {
        if ((item.textContent || '').trim() === '业务报告') { item.click(); return true; }
      }
      return false;
    });
    await pg.waitForTimeout(4000);
    for (let i = 0; i < 15; i++) {
      const f2 = pg.frames().find(f => f.url().includes('businessReportNew'));
      if (f2) return f2;
      await pg.waitForTimeout(2000);
    }
    throw new Error('等待业务报告页面超时');
  }
  const reportFrame = await ensureFrame(page);
  console.log('业务报告frame OK');

  let bizStart = '', bizEnd = '';
  await page.route('**/traffic/list', async (route) => {
    const req = route.request();
    try {
      if (req.method() === 'POST' && req.postData()) {
        const data = JSON.parse(req.postData());
        data.pageSize = 1000;
        data.user_account = ALL_ACCOUNTS;
        data.date_start = bizStart;
        data.date_end = bizEnd;
        await route.continue({ postData: JSON.stringify(data) });
        return;
      }
    } catch (e) {}
    await route.continue();
  });

  async function clickSearch() {
    return reportFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if ((b.textContent || '').replace(/\s/g, '') === '搜索') { b.click(); return true; }
      }
      return false;
    });
  }

  function captureBiz() {
    return new Promise((resolve) => {
      let done = false;
      const onResponse = async (resp) => {
        if (done || !resp.url().includes('/traffic/list')) return;
        try {
          const body = await resp.text();
          const j = JSON.parse(body);
          if (j && Array.isArray(j.data)) { done = true; resolve({ rows: j.data }); }
        } catch (e) {}
      };
      page.on('response', onResponse);
      setTimeout(() => { if (!done) { done = true; page.off('response', onResponse); resolve(null); } }, 25000);
      setTimeout(() => { clickSearch().then(ok => { if (!ok) console.log('  警告: 未找到搜索按钮'); }); }, 300);
    });
  }

  async function queryOne(d) {
    bizStart = d + ' 00:00:00';
    bizEnd = d + ' 23:59:59';
    let rows = null;
    for (let attempt = 1; attempt <= 3 && rows === null; attempt++) {
      const captured = await captureBiz();
      if (captured) rows = captured.rows;
      else console.log(`  [${d}] 第${attempt}次未捕获,重试`);
    }
    if (rows === null) rows = [];
    // 统计国家数
    const countries = new Set();
    let sessions = 0;
    for (const r of rows) {
      countries.add(r.user_account || r.site);
      sessions += Number(r.sessions || 0);
    }
    console.log(`[${d}] 行数=${rows.length} 国家=${countries.size} Sessions合计=${sessions}`);
  }

  for (const d of DATES) await queryOne(d);
  await page.unroute('**/traffic/list');
  await browser.close();
  console.log('=== 探测完成 ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
