// JoyBuy 开放平台 — 应用详情页管理工具
// 复用 CDP 9333 上的调试浏览器（profile: ~/.workbuddy/edge-joybuy）
//
// 用法:
//   node joybuy_app_admin.js inspect                 查看当前页结构与可见文本
//   node joybuy_app_admin.js edit-open               打开 "Edit app" 抽屉并枚举字段
//   node joybuy_app_admin.js edit-set --name "x" --intro "y"   填写应用名/简介
//   node joybuy_app_admin.js edit-submit             提交编辑
//   node joybuy_app_admin.js secret                  尝试显示 appSecret（点眼睛/复制）
//   node joybuy_app_admin.js tab "<标签名>"           切换顶部 tab
//
// 坑位备忘:
//  1) 该站 jd-input 会吞空格 → 不要用 type()/pressSequentially，用 click + Ctrl+A + Delete + keyboard.insertText()
//  2) fill() 会被 Vue 重渲染截断成半截 → 同样用 insertText
//  3) 应用卡片点击不触发路由 → 详情页直接 goto #/app/info/<appKey>/basic
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');

const APP_KEY = process.env.JB_APP_KEY || 'DF51B75D56FFD5CD5A15C4CCF6526E00';
const DETAIL = `https://console.joybuy.com/#/app/info/${APP_KEY}/basic`;

function opt(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 稳定输入：click → Ctrl+A → Delete → insertText
async function typeStable(page, locator, text) {
  await locator.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await sleep(200);
  await page.keyboard.insertText(text);
  await sleep(400);
}

async function dump(page) {
  return await page.evaluate(() => ({
    url: location.href,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 2600),
    inputs: [...document.querySelectorAll('input,textarea')].map((e, i) => ({
      i, tag: e.tagName, ph: e.placeholder || '', type: e.type || '', val: (e.value || '').slice(0, 80)
    })),
    buttons: [...document.querySelectorAll('button')].map(b => ({
      t: (b.innerText || '').trim().slice(0, 26), disabled: /is-disabled/.test(b.className)
    })).filter(x => x.t)
  }));
}

(async () => {
  const cmd = process.argv[2] || 'inspect';
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  let page = ctx.pages().filter(x => /console\.joybuy\.com/.test(x.url())).pop();
  if (!page) { page = ctx.pages().filter(x => !/^about:blank/.test(x.url())).pop() || ctx.pages()[0]; }

  if (cmd === 'goto-detail') {
    await page.goto(DETAIL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
    await sleep(8000);
    console.log(JSON.stringify(await dump(page), null, 1));
    process.exit(0);
  }

  if (cmd === 'inspect') {
    console.log(JSON.stringify(await dump(page), null, 1));
    process.exit(0);
  }

  if (cmd === 'tab') {
    const name = process.argv[3];
    await page.locator('div,span,li,a').filter({ hasText: new RegExp('^' + name + '$') }).first()
      .click({ timeout: 15000 }).catch(e => console.log('click warn:', e.message));
    await sleep(6000);
    console.log(JSON.stringify(await dump(page), null, 1));
    process.exit(0);
  }

  if (cmd === 'secret') {
    // appSecret 常以 **** 掩码显示，旁边有眼睛/复制按钮
    const before = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/appSecret[\s\S]{0,80}/i);
      return m ? m[0].replace(/\s+/g, ' ') : '(not found)';
    });
    console.log('before:', before);
    // 尝试点所有可能是"显示/眼睛"的图标：含 eye / show / visible 的 class，或纯图标按钮
    const clicked = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('i,svg,span,button').forEach(el => {
        const cls = (el.className || '').toString().toLowerCase();
        if (/eye|show|visible|look|view|copy|secret/i.test(cls)) {
          el.click(); out.push(cls.slice(0, 50));
        }
      });
      return out;
    });
    console.log('clicked candidates:', JSON.stringify(clicked));
    await sleep(3000);
    const after = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/appSecret[\s\S]{0,90}/i);
      return m ? m[0].replace(/\s+/g, ' ') : '(not found)';
    });
    console.log('after :', after);
    console.log(JSON.stringify(await dump(page), null, 1).slice(0, 2500));
    process.exit(0);
  }

  if (cmd === 'edit-open') {
    await page.locator('button,a,span').filter({ hasText: /^(Edit|Edit app)$/i }).first()
      .click({ timeout: 15000 }).catch(e => console.log('click warn:', e.message));
    await sleep(4000);
    const d = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('[class*=drawer],[class*=dialog],[class*=modal]')]
        .filter(e => e.offsetParent !== null);
      const box = vis.sort((a, b) => b.innerText.length - a.innerText.length)[0];
      return {
        drawerText: box ? box.innerText.replace(/\s+/g, ' ').slice(0, 1500) : '(no visible drawer)',
        inputs: [...document.querySelectorAll('input,textarea')].map((e, i) => ({
          i, ph: e.placeholder || '', val: (e.value || '').slice(0, 90), type: e.type || ''
        }))
      };
    });
    console.log(JSON.stringify(d, null, 1));
    process.exit(0);
  }

  if (cmd === 'edit-set') {
    const name = opt('name'), intro = opt('intro');
    if (name) {
      const el = page.locator('input[placeholder="Please enter app name"]').first();
      await typeStable(page, el, name);
      console.log('name ->', JSON.stringify(await el.inputValue()));
    }
    if (intro) {
      const el = page.locator('textarea').first();
      await typeStable(page, el, intro);
      console.log('intro ->', JSON.stringify((await el.inputValue()).slice(0, 120)));
    }
    console.log(JSON.stringify(await dump(page), null, 1).slice(0, 1800));
    process.exit(0);
  }

  if (cmd === 'edit-submit') {
    // 只在可见的 .jd-overlay 抽屉内找 primary OK，避免误点页面其他主按钮
    const btn = page.locator('.jd-overlay:visible button.jd-button--primary').filter({ hasText: /^(OK|Confirm|Submit|Save)$/i }).first();
    await btn.click({ timeout: 20000 }).catch(e => console.log('click warn:', e.message));
    await sleep(7000);
    console.log(JSON.stringify(await dump(page), null, 1));
    process.exit(0);
  }

  console.log('未知命令:', cmd);
  process.exit(2);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
