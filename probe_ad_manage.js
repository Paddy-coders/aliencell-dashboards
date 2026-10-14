// 进入"广告管理", 查看广告列表状态列
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 点击"广告管理"
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.entry-menus-item--link')];
    const el = els.find(e => (e.textContent || '').trim() === '广告管理');
    if (el) { el.click(); return true; }
    return false;
  });
  console.log('点击广告管理:', clicked);
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'ad_manage_page.png' });
  console.log('URL:', page.url());

  // 提取页面表格的状态相关文本
  const info = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const lines = body.split('\n').map(l => l.trim()).filter(l => l && /投放|暂停|关闭|结束|启用|禁用|停止|状态/i.test(l));
    const table = document.querySelector('.home-ant-table-tbody, .ant-table-tbody');
    const rows = table ? table.innerText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30) : [];
    return { lines: lines.slice(0, 50), rows };
  });
  console.log('状态文本:', JSON.stringify(info.lines, null, 1).slice(0, 2500));
  console.log('表格前30行:', JSON.stringify(info.rows, null, 1).slice(0, 2500));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
