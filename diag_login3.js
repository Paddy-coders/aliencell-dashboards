const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('https://home.eccang.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(8000);
  const html = await page.evaluate(() => {
    // 找包含"登录"且是表单提交区域的元素
    const els = [...document.querySelectorAll('*')].filter(e => {
      const t = (e.innerText || e.textContent || '').trim();
      return t === '登录' && e.tagName !== 'A';
    });
    return els.map(e => ({
      tag: e.tagName, id: e.id, cls: (e.className||'').slice(0, 120),
      parentCls: (e.parentElement?.className||'').slice(0, 120),
      type: e.type || '', parentTag: e.parentElement?.tagName
    }));
  });
  console.log('登录元素:', JSON.stringify(html, null, 1));
  // 检查所有 primary 类
  const p2 = await page.evaluate(() => [...document.querySelectorAll('.home-ant-btn-primary')].map(e => ({
    tag: e.tagName, type: e.type, cls: e.className.slice(0, 120),
    text: (e.innerText||e.textContent||'').trim().slice(0, 40)
  })));
  console.log('所有 home-ant-btn-primary:', JSON.stringify(p2, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
