// 在 ERP 壳应用中获取 Vue 路由表并导航到"广告投放词库"
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { page = await ctx.newPage(); }
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(6000);

  const vueInfo = await page.evaluate(() => {
    const res = {};
    // 找 Vue 实例
    const el = document.querySelector('#selmuchPlus-app') || document.querySelector('#app');
    if (el && el.__vue__) {
      const app = el.__vue__;
      res.hasVue = true;
      res.routes = app.$router && app.$router.options && app.$router.options.routes
        ? app.$router.options.routes.map(r => ({ path: r.path, name: r.name, children: r.children ? r.children.map(c => c.path) : [] })).filter(r => /ad|keyword|target/i.test(r.path || r.name || '')).slice(0, 20)
        : [];
      res.allRoutePaths = app.$router && app.$router.options && app.$router.options.routes
        ? app.$router.options.routes.map(r => r.path).filter(p => /ad|keyword|target/i.test(p)).slice(0, 30)
        : [];
    } else {
      res.hasVue = false;
      // 尝试从 window 全局变量找
      const routerKeys = Object.keys(window).filter(k => /router/i.test(k) && window[k] && window[k].push);
      res.routerKeys = routerKeys;
    }
    return res;
  });
  console.log('Vue info:', JSON.stringify(vueInfo, null, 2));

  // 如果找到路由，尝试 push 到广告投放词库
  if (vueInfo.hasVue && vueInfo.allRoutePaths) {
    const target = vueInfo.allRoutePaths.find(p => /keyword|target|adword/i.test(p));
    console.log('目标路由:', target);
    if (target) {
      const nav = await page.evaluate((path) => {
        try {
          const el = document.querySelector('#selmuchPlus-app') || document.querySelector('#app');
          const app = el && el.__vue__;
          if (app && app.$router) {
            app.$router.push(path).catch(e => e.message);
            return 'pushed ' + path;
          }
          return 'no router';
        } catch (e) { return 'err: ' + e.message; }
      }, target);
      console.log('导航结果:', nav);
      await page.waitForTimeout(8000);
    }
  }

  // 点击"广告"Tab 后获取菜单 data-menu-key 映射
  try { await page.locator('.home-ant-tabs-tab:has-text("广告")').first().click(); } catch (e) {}
  await page.waitForTimeout(3000);
  const menus = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-menu-key]').forEach(el => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      out.push({ key: el.getAttribute('data-menu-key'), text: t });
    });
    return out;
  });
  console.log('\n菜单 key 映射:', JSON.stringify(menus.slice(0, 30), null, 2));

  // 尝试点击广告投放词库子项(精确文本)
  const adLib = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a.entry-menus-item__title')];
    const el = els.find(e => (e.textContent || '').trim() === '广告投放词库');
    if (!el) return { err: 'not found', texts: els.slice(0, 20).map(e => e.textContent.trim()) };
    const key = el.closest('[data-menu-key]')?.getAttribute('data-menu-key') || '';
    el.click();
    return { clicked: true, key };
  });
  console.log('广告投放词库点击:', JSON.stringify(adLib));
  await page.waitForTimeout(12000);

  console.log('最终 URL:', page.url().slice(0, 160));
  for (const f of page.frames()) {
    console.log('Frame:', f.url().slice(0, 160));
  }
  await page.screenshot({ path: 'ad_lib_probe.png', timeout: 15000 }).catch(() => {});
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
