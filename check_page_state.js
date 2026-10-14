// 检查当前页面状态，截图，不做任何点击
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('home.eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  console.log('URL:', page.url());
  await page.screenshot({ path: 'check_state.png' });

  // 检查"广告"文本是否存在
  const spans = await page.$$('text=广告');
  console.log('找到', spans.length, '个含"广告"的元素');
  for (let i = 0; i < Math.min(spans.length, 5); i++) {
    const tag = await spans[i].evaluate(el => el.tagName);
    const txt = await spans[i].textContent();
    console.log('  ', i, tag, JSON.stringify(txt));
  }

  // 查找顶部导航栏
  const navItems = await page.$$('nav li, .el-menu-item, .nav-item, header li');
  console.log('\n导航栏元素数:', navItems.length);
  for (let i = 0; i < Math.min(navItems.length, 20); i++) {
    const txt = await navItems[i].textContent();
    if (txt && txt.includes('广告')) console.log('  ->', JSON.stringify(txt));
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
