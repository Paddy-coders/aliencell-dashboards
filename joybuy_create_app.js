// JoyBuy 创建应用向导（console.joybuy.com/#/app/create）第3步填充 + 提交
// 用法:
//   node joybuy_create_app.js inspect
//   node joybuy_create_app.js fill --name "..." --intro "..." --icon <png路径>
//   node joybuy_create_app.js submit
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

const PORT = '9333';
const URL = 'https://console.joybuy.com/#/app/create';

function arg(n) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : '';
}

async function snap(page) {
  return await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input,textarea')].map((e, i) => ({
      i, type: e.type || '', ph: e.placeholder || '', val: (e.value || '').slice(0, 120)
    }));
    const btns = [...document.querySelectorAll('button')]
      .map(b => ({ t: (b.innerText || '').trim().slice(0, 30), d: /is-disabled/.test(b.className) }))
      .filter(x => x.t);
    return {
      url: location.href,
      inputs, btns,
      tail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-500)
    };
  });
}

// 该站 jd-input 的坑：
//  1) locator.type()/pressSequentially() 逐键发送 → 空格键被吞，'a b' 变 'ab'
//  2) locator.fill() 一次性赋值 → 组件重渲染会把值覆盖成半截（实测 30 字的名称只留 10 字）
//  唯一稳的写法：click + Ctrl+A + Delete + keyboard.insertText(整串)
async function setText(page, locator, value) {
  await locator.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(value);
  await page.waitForTimeout(1200);
  const got = await locator.inputValue();
  if (got !== value) {
    // 兜底：原生 setter + input/change 事件
    await locator.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await page.waitForTimeout(1200);
  }
  return await locator.inputValue();
}

async function main() {
  const cmd = process.argv[2] || 'inspect';
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().filter(p => /console\.joybuy\.com/.test(p.url())).pop()
    || ctx.pages().filter(p => !/^about:blank/.test(p.url())).pop();

  if (!/console\.joybuy\.com/.test(page.url())) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
  }

  if (cmd === 'fill') {
    const name = arg('name'), intro = arg('intro'), icon = arg('icon');
    if (name) {
      const got = await setText(page, page.locator('input[placeholder="Please enter app name"]').first(), name);
      console.log('[app] name  =', JSON.stringify(got), got === name ? 'OK' : 'MISMATCH');
    }
    if (intro) {
      const got = await setText(page, page.locator('textarea').first(), intro);
      console.log('[app] intro =', JSON.stringify(got), got === intro ? 'OK' : 'MISMATCH');
    }
    if (icon) {
      const fi = page.locator('input[type=file]').first();
      await fi.setInputFiles(path.resolve(icon));
      await page.waitForTimeout(4000);
      // 核验上传结果：出现预览图 / 文件回显才算成功
      const up = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')]
          .map(i => i.src).filter(s => /^(blob:|data:image)/.test(s));
        return { previewImgs: imgs.length, first: (imgs[0] || '').slice(0, 60) };
      });
      console.log('[app] icon upload check:', JSON.stringify(up));
      if (!up.previewImgs) {
        // 退回到第二个 file input 再试一次
        await page.locator('input[type=file]').nth(1).setInputFiles(path.resolve(icon)).catch(() => {});
        await page.waitForTimeout(4000);
      }
      // 该上传器会弹出 300x300 裁剪框，需点 Confirm 才算落地
      const crop = page.locator('button.jd-button--primary:not(.is-disabled)').filter({ hasText: /^Confirm$/ }).first();
      if (await crop.isVisible().catch(() => false)) {
        await crop.click({ timeout: 10000 }).catch(e => console.error('[app] crop confirm warn:', e.message));
        await page.waitForTimeout(4000);
        console.log('[app] crop confirmed');
      }
    }
    await page.waitForTimeout(1500);
  } else if (cmd === 'submit') {
    await page.locator('button.jd-button--large:not(.is-disabled)').filter({ hasText: /^Submit$/ })
      .first().click({ timeout: 15000 }).catch(e => console.error('[app] submit warn:', e.message));
    await page.waitForTimeout(7000);
  }

  const s = await snap(page);
  console.log(JSON.stringify(s, null, 1));
  await page.screenshot({ path: path.join(__dirname, 'jb_app_fill.png'), fullPage: true }).catch(() => {});
  process.exit(0);
}

main().catch(e => { console.error('[app] FATAL:', e && e.message); process.exit(2); });
