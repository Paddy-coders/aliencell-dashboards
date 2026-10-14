// 探测易仓ERP登录页结构（隐身上下文隔离cookie，强制显示登录页）
// 输出: 登录表单的关键选择器（input框、按钮、登录模式选项）
const { chromium } = require('playwright');
const fs = require('fs');

const LOGIN_URL = 'https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = await browser.newContext(); // 隔离上下文 => 无cookie => 显示登录页
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => { if (m.type() === 'error') msgs.push(m.text().slice(0, 200)); });

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => msgs.push('goto: ' + e.message));

  // 等待网络安静 + 可能的跳转
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const q = s => { const els = [...document.querySelectorAll(s)]; return els.slice(0, 8).map(e => ({
      tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name'),
      id: e.id, placeholder: e.getAttribute('placeholder'), cls: (e.className || '').toString().slice(0, 60),
      visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
    })); };
    return {
      url: location.href,
      title: document.title,
      bodySnippet: document.body ? document.body.innerText.slice(0, 500) : '(no body)',
      inputs: q('input'),
      buttons: q('button'),
      iframes: [...document.querySelectorAll('iframe')].map(f => f.src || f.id || '(no src)').slice(0, 5),
      labels: [...document.querySelectorAll('label, .el-form-item__label, .form-label')].map(e => (e.innerText || e.textContent || '').trim()).filter(Boolean).slice(0, 20)
    };
  });

  fs.writeFileSync('probe_login_result.json', JSON.stringify({ info, consoleErrors: msgs }, null, 2));
  await page.screenshot({ path: 'probe_login.png', fullPage: true }).catch(() => {});
  console.log('URL:', info.url);
  console.log('Title:', info.title);
  console.log('Inputs:', JSON.stringify(info.inputs, null, 1));
  console.log('Buttons:', JSON.stringify(info.buttons, null, 1));
  console.log('Labels:', JSON.stringify(info.labels, null, 1));
  console.log('Iframes:', JSON.stringify(info.iframes, null, 1));
  console.log('consoleErrors:', JSON.stringify(msgs, null, 1));
  await ctx.close();
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
