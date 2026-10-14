// 在易仓 UI 中查找广告模块, 确认广告状态列的真实取值
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  // 1. 在页面里搜索"广告"相关菜单
  const menuInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const hits = [];
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 12 && /广告/.test(t) && el.children.length <= 2) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) hits.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), text: t, id: el.id || '' });
      }
    }
    return hits.slice(0, 40);
  });
  console.log('含"广告"的元素:', JSON.stringify(menuInfo, null, 1).slice(0, 3000));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
