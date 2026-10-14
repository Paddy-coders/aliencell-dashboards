// JoyBuy 授权管理 — 「Add Service Target」弹窗操作器
// 用法:
//   node joybuy_auth_add.js rel-open              展开 Ownership Relationship 下拉并列出选项
//   node joybuy_auth_add.js rel-pick "<文本>"      选择 Ownership Relationship 选项
//   node joybuy_auth_add.js store-open            展开 StoreAccount 下拉并列出选项
//   node joybuy_auth_add.js store-pick "<文本>"    选择店铺
//   node joybuy_auth_add.js duration "<值>"        填 Application Duration
//   node joybuy_auth_add.js submit                提交
//   node joybuy_auth_add.js inspect               查看弹窗当前状态
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const visFn = `(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}`;

async function state(p) {
  return await p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
    const pops = [...document.querySelectorAll('.jd-select-dropdown,.jd-popper,[class*=dropdown],[class*=select-menu]')]
      .filter(vis).map(e => (e.innerText || '').replace(/\s+/g, ' | ').slice(0, 500));
    const vals = ov ? [...ov.querySelectorAll('input')].map(x => ({ ph: x.placeholder || '', val: (x.value || '').slice(0, 60), ro: x.readOnly })) : [];
    return { hasOverlay: !!ov, vals, pops, ovText: ov ? (ov.innerText || '').replace(/\s+/g, ' ').slice(0, 1000) : '' };
  });
}

(async () => {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const p = ctx.pages().filter(x => /console\.joybuy/.test(x.url())).pop();

  // 按 label 文本找到 select 触发器，取其坐标后用真实鼠标点击（jd-select 需要真实事件才展开）
  const clickSelectByLabel = async (labelTxt) => {
    const pos = await p.evaluate((lb) => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
      if (!ov) return { ok: false, why: 'no overlay' };
      const items = [...ov.querySelectorAll('.jd-form-item,[class*=form-item]')];
      let target = null;
      for (const it of items) {
        const l = it.querySelector('[class*=form-item__label]');
        if (l && (l.innerText || '').trim() === lb) {
          target = it.querySelector('.jd-select') || it.querySelector('.select-trigger') ||
                   it.querySelector('.jd-input') || it.querySelector('input');
          break;
        }
      }
      if (!target) {
        const all = [...ov.querySelectorAll('.jd-select')].filter(vis);
        if (!all.length) return { ok: false, why: 'no select' };
        // StoreAccount 是弹窗内第 2 个 select
        target = lb === 'StoreAccount' ? all[all.length - 1] : all[0];
      }
      const r = target.getBoundingClientRect();
      return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, labelTxt);
    if (!pos.ok) return pos;
    await p.mouse.click(pos.x, pos.y);
    return { ok: true, at: [pos.x, pos.y] };
  };

  if (cmd === 'inspect') {
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'rel-open') {
    console.log('click:', JSON.stringify(await clickSelectByLabel('Ownership Relationship')));
    await sleep(3000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'store-open') {
    console.log('click:', JSON.stringify(await clickSelectByLabel('StoreAccount')));
    await sleep(3500);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  const pickOption = async (txt) => {
    const pos = await p.evaluate((t) => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const opts = [...document.querySelectorAll('.jd-select-dropdown__item,.jd-option,[class*=option]')].filter(vis);
      const exact = opts.find(o => (o.innerText || '').trim() === t);
      const loose = exact || opts.find(o => (o.innerText || '').includes(t));
      if (!loose) return { ok: false, opts: opts.map(o => (o.innerText || '').trim()).slice(0, 20) };
      const r = loose.getBoundingClientRect();
      return { ok: true, txt: (loose.innerText || '').trim().slice(0, 60), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, txt);
    if (pos.ok) await p.mouse.click(pos.x, pos.y);
    return pos;
  };

  if (cmd === 'rel-pick' || cmd === 'store-pick') {
    console.log(JSON.stringify(await pickOption(arg), null, 1));
    await sleep(4000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'store-type') {
    // 用真实鼠标+键盘输入：该站组件对纯 JS 赋值不敏感，必须走真实输入事件链
    const box = await p.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
      if (!ov) return null;
      const items = [...ov.querySelectorAll('.jd-form-item,[class*=form-item]')];
      for (const it of items) {
        const l = it.querySelector('[class*=form-item__label]');
        if (l && /StoreAccount/i.test(l.innerText || '')) {
          const el = it.querySelector('input:not([readonly])');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      return null;
    });
    if (!box) { console.log('StoreAccount 输入框未找到'); process.exit(0); }
    await p.mouse.click(box.x, box.y);
    await sleep(400);
    await p.keyboard.press('Control+A');
    await p.keyboard.press('Delete');
    await sleep(300);
    await p.keyboard.insertText(arg);
    console.log('typed via real keyboard:', arg);
    await sleep(4500);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'blur') {
    // 点抽屉的空白标题区让输入框失焦，触发 change/远程校验
    const t = await p.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
      if (!ov) return null;
      const h = ov.querySelector('[class*=drawer__header],[class*=header]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (t) await p.mouse.click(t.x, t.y);
    await sleep(4000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'duration' || cmd === 'dur-open') {
    // Application Duration 是 jd-select 下拉
    console.log('click:', JSON.stringify(await clickSelectByLabel('Application Duration')));
    await sleep(3000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === 'dur-pick') {
    console.log(JSON.stringify(await pickOption(arg), null, 1));
    await sleep(3000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    process.exit(0);
  }

  if (cmd === '_unused_duration') {
    const r = await p.evaluate((v) => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
      if (!ov) return { ok: false };
      const inputs = [...ov.querySelectorAll('input')].filter(vis).filter(x => !x.readOnly);
      if (!inputs.length) return { ok: false, why: 'no editable input' };
      const el = inputs[0];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, val: el.value };
    }, arg);
    console.log(JSON.stringify(r));
    await sleep(1500);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 2500));
    process.exit(0);
  }

  if (cmd === 'submit') {
    const r = await p.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ov = [...document.querySelectorAll('.jd-overlay')].filter(vis).pop();
      if (!ov) return { ok: false };
      const btn = [...ov.querySelectorAll('button.jd-button--primary')].find(b => /^(OK|Confirm|Submit)$/i.test((b.innerText || '').trim()));
      if (!btn) return { ok: false, why: 'no OK button' };
      btn.click();
      return { ok: true };
    });
    console.log('submit:', JSON.stringify(r));
    await sleep(8000);
    console.log(JSON.stringify(await state(p), null, 1).slice(0, 3000));
    const txt = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1600));
    console.log('PAGE:', txt);
    process.exit(0);
  }

  console.log('未知命令');
  process.exit(2);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
