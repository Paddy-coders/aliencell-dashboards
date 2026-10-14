// 检查广告管理元素的具体DOM结构
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('iframe#/m_69809')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();

  // 先点击广告标签
  await page.click('.home-ant-tabs-tab:has-text("广告")');
  await page.waitForTimeout(1500);

  // 遍历所有含"广告管理"的元素
  const info = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const result = [];
    let el;
    while ((el = walker.nextNode())) {
      if (el.textContent && el.textContent.trim() === '广告管理') {
        const parent = el.parentElement;
        const grand = parent ? parent.parentElement : null;
        result.push({
          tag: el.tagName,
          className: el.className,
          parentTag: parent?.tagName,
          parentClass: parent?.className,
          grandTag: grand?.tagName,
          grandClass: grand?.className,
          rect: el.getBoundingClientRect(),
          hasClick: el.onclick !== null || (parent && parent.onclick !== null),
          href: el.getAttribute('href') || parent?.getAttribute('href') || ''
        });
      }
    }
    return result;
  });

  console.log('广告管理元素数:', info.length);
  for (let i = 0; i < info.length; i++) {
    const e = info[i];
    console.log(`\n[${i}] ${e.tag}.${e.className}`);
    console.log(`  parent: ${e.parentTag}.${e.parentClass}`);
    console.log(`  grand: ${e.grandTag}.${e.grandClass}`);
    console.log(`  rect: ${JSON.stringify(e.rect)}`);
    console.log(`  href: ${e.href}`);
    console.log(`  hasClick: ${e.hasClick}`);
  }

  await page.screenshot({ path: 'inspect_admanage.png', timeout: 10000 });

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
