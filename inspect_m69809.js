// 详细检查 m_69809 页面的DOM结构，找到广告导航元素
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
  await page.waitForTimeout(2000);

  // 查找所有包含"广告"的元素并输出标签和路径
  const els = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const result = [];
    for (const el of all) {
      if (el.textContent && el.textContent.trim() === '广告' && el.children.length === 0) {
        result.push({ tag: el.tagName, id: el.id, className: el.className, path: el.getAttribute('data-path') || '' });
      }
    }
    return result;
  });
  console.log('纯文本"广告"元素数:', els.length);
  for (const e of els.slice(0, 10)) {
    console.log('  ', e.tag, 'id='+e.id, 'class='+e.className, 'path='+e.path);
  }

  // 查找所有可见的li或span元素含广告
  const visible = await page.evaluate(() => {
    const result = [];
    for (const el of document.querySelectorAll('li, span, a, div')) {
      if (el.textContent && el.textContent.trim() === '广告') {
        const rect = el.getBoundingClientRect();
        result.push({ tag: el.tagName, className: el.className, x: rect.x, y: rect.y, w: rect.width, h: rect.height, visible: rect.width > 0 && rect.height > 0 });
      }
    }
    return result;
  });
  console.log('\n可见广告元素:', visible.length);
  for (const e of visible) {
    console.log('  ', e.tag, 'class='+e.className, 'pos='+e.x+','+e.y, 'size='+e.w+'x'+e.h, 'visible='+e.visible);
  }

  await page.screenshot({ path: 'm69809_look.png', type: 'png', timeout: 10000 });

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
