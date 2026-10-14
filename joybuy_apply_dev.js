// JoyBuy 开发者申请（console.joybuy.com/#/apply）表单填充器
// 复用已启动的调试浏览器（CDP 9333），不新开浏览器。
// 用法:
//   node joybuy_apply_dev.js inspect                       打印当前表单字段与状态
//   node joybuy_apply_dev.js fill --name "张三" --email "a@b.com"
//   node joybuy_apply_dev.js sendcode                      点「Get Verification Code」
//   node joybuy_apply_dev.js submit --code 123456 [--agree] 勾协议并提交
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[k];
  }
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');

const PORT = '9333';
const FORM = 'https://console.joybuy.com/#/apply';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : '';
}

async function activePage(ctx) {
  const p = ctx.pages().filter(x => !/^about:blank/.test(x.url())).pop();
  if (!p) throw new Error('没有可用标签页');
  return p;
}

const NAME_SEL = 'input.jd-input__inner[placeholder="Please enter"]';
const CODE_SEL = 'input.jd-input__inner[placeholder="Please enter verification code"]';

async function inspect(page) {
  return await page.evaluate(() => {
    const pick = (sel, i) => {
      const els = document.querySelectorAll(sel);
      const el = els[i];
      return el ? { val: el.value, ph: el.placeholder } : null;
    };
    const btns = [];
    document.querySelectorAll('button').forEach(el => {
      btns.push({ text: (el.innerText || '').trim().slice(0, 26), disabled: /is-disabled/.test(el.className) });
    });
    const cb = document.querySelector('input.jd-checkbox__original');
    return {
      url: location.href,
      name: pick('input.jd-input__inner[placeholder="Please enter"]', 0),
      email: pick('input.jd-input__inner[placeholder="Please enter"]', 1),
      code: pick('input.jd-input__inner[placeholder="Please enter verification code"]', 0),
      agreeChecked: cb ? cb.checked : null,
      buttons: btns,
      bodyTail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-400)
    };
  });
}

async function main() {
  const cmd = process.argv[2] || 'inspect';
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await activePage(ctx);

  if (!/console\.joybuy\.com/.test(page.url())) {
    await page.goto(FORM, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
  }

  if (cmd === 'fill') {
    const name = arg('name');
    const email = arg('email');
    const inputs = page.locator(NAME_SEL);
    if (name) {
      await inputs.nth(0).click();
      await inputs.nth(0).fill('');
      await inputs.nth(0).type(name, { delay: 30 });
    }
    if (email) {
      await inputs.nth(1).click();
      await inputs.nth(1).fill('');
      await inputs.nth(1).type(email, { delay: 20 });
      await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(1500);
  } else if (cmd === 'sendcode') {
    const btn = page.locator('button', { hasText: /Get Verification Code|获取验证码/i }).first();
    await btn.click({ timeout: 15000 }).catch(e => console.error('[apply] click warn:', e.message));
    await page.waitForTimeout(3500);
  } else if (cmd === 'submit') {
    const code = arg('code');
    if (code) {
      const c = page.locator(CODE_SEL).first();
      await c.click();
      await c.fill('');
      await c.type(code, { delay: 40 });
      await page.waitForTimeout(500);
    }
    if (process.argv.includes('--agree')) {
      const cb = page.locator('input.jd-checkbox__original').first();
      const on = await cb.isChecked().catch(() => false);
      if (!on) await cb.check({ force: true }).catch(async () => {
        await page.locator('label.jd-checkbox, .jd-checkbox').first().click().catch(() => {});
      });
      await page.waitForTimeout(800);
    }
    const sub = page.locator('button', { hasText: /^Submit$/ }).first();
    await sub.click({ timeout: 15000 }).catch(e => console.error('[apply] submit warn:', e.message));
    await page.waitForTimeout(6000);
  }

  const state = await inspect(page);
  console.log(JSON.stringify(state, null, 2));
  await page.screenshot({ path: __dirname + '/jb_apply_state.png', fullPage: true }).catch(() => {});
  process.exit(0);
}

main().catch(e => { console.error('[apply] FATAL:', e && e.message); process.exit(2); });
