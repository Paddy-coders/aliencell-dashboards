// JoyBuy 调试浏览器通用驱动器（复用已启动的 CDP 实例，不启动新浏览器）
// 用法:
//   node joybuy_driver.js state                     输出所有标签页 URL + 登录态判定
//   node joybuy_driver.js shot <文件名> [--full]    当前活跃页截图
//   node joybuy_driver.js goto <url>                在活跃页打开 URL
//   node joybuy_driver.js dump [n]                  输出活跃页正文（默认 1500 字）
//   node joybuy_driver.js click "<文本>" [--wait]   按文本点击
// 退出码: 0=已登录  3=需登录  2=异常
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[k];
  }
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');
const path = require('path');

const PORT = (process.env.CDP_PORT || '9333').replace('http://127.0.0.1:', '');
const LOGIN_HINT = /seller\/login|account\.joybuy\.com|Passport|passport/i;

function pickPage(ctx) {
  const pages = ctx.pages().filter(p => !/^about:blank/.test(p.url()));
  const pool = pages.length ? pages : ctx.pages();
  return pool[pool.length - 1];
}

async function readState(page) {
  return await page.evaluate(() => {
    const txt = (document.body && document.body.innerText || '').replace(/\s+/g, ' ');
    const hasLoginForm = /Log in|登录|Password|密码/i.test(txt) &&
      (document.querySelectorAll('input[type=password]').length > 0 ||
       document.querySelectorAll('input').length >= 2);
    return {
      url: location.href,
      title: document.title,
      inputs: document.querySelectorAll('input').length,
      hasPasswordInput: document.querySelectorAll('input[type=password]').length > 0,
      hasLoginForm,
      excerpt: txt.slice(0, 800),
      lsKeys: Object.keys(localStorage || {}).slice(0, 50)
    };
  }).catch(e => ({ error: e.message }));
}

async function main() {
  const [cmd = 'state', ...rest] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(e => {
    console.log(JSON.stringify({ ok: false, mode: 'no_browser', error: e.message }));
    process.exit(2);
  });
  const ctx = browser.contexts()[0] || await browser.newContext();
  let page = pickPage(ctx);

  if (cmd === 'goto') {
    await page.goto(rest[0], { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(e => console.error('[driver] goto warn:', e.message));
    await page.waitForTimeout(4000);
  } else if (cmd === 'shot') {
    const full = rest.includes('--full');
    const out = path.join(__dirname, rest.find(a => !a.startsWith('--')) || 'joybuy_shot.png');
    await page.screenshot({ path: out, fullPage: full });
    console.log(JSON.stringify({ ok: true, file: out }, null, 2));
    process.exit(0);
  } else if (cmd === 'dump') {
    const n = parseInt(rest[0] || '1500', 10);
    const txt = await page.evaluate(k => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, k), n);
    console.log(txt);
    process.exit(0);
  } else if (cmd === 'click') {
    const label = rest.find(a => !a.startsWith('--'));
    const el = page.locator('a,button,div,span,li').filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    await el.click({ timeout: 15000 }).catch(e => console.error('[driver] click warn:', e.message));
    await page.waitForTimeout(rest.includes('--wait') ? 8000 : 3000);
  }

  const state = await readState(page);
  const urls = ctx.pages().map(p => p.url());
  const needLogin = LOGIN_HINT.test(state.url || '') && state.hasLoginForm;
  console.log(JSON.stringify({ ok: !needLogin, mode: needLogin ? 'need_login' : 'ok', urls, ...state }, null, 2));
  process.exit(needLogin ? 3 : 0);
}

main().catch(e => {
  console.error('[driver] FATAL:', e && e.message);
  process.exit(2);
});
