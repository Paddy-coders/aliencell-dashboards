// 在广告模块页面控制台中提取 webpack chunk URL 与可能暴露的接口常量
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('https://amz-ad.eccang.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(5000);

  const out = await page.evaluate(() => {
    const res = {};
    // webpack runtime
    res.wJsonp = typeof window.webpackJsonp !== 'undefined';
    res.wChunk = typeof window.__webpack_require__ !== 'undefined';
    res.wPublicPath = window.__webpack_require__ && window.__webpack_require__.p;
    // 遍历 chunk URL 映射
    if (window.__webpack_require__ && window.__webpack_require__.u) {
      try { res.uFunc = window.__webpack_require__.u.toString().slice(0, 400); } catch (e) {}
    }
    if (window.__webpack_require__ && window.__webpack_require__.e) {
      try { res.eFunc = window.__webpack_require__.e.toString().slice(0, 400); } catch (e) {}
    }
    // 尝试找全局常量/接口名映射
    res.globalKeys = Object.keys(window).filter(k => {
      const v = window[k];
      return typeof v === 'object' && v && Object.keys(v).some(sk => /GetFlatViewList|actiontype|Keyword/i.test(String(sk)));
    }).slice(0, 10);
    // vue app instance (expose store or router)
    const div = document.querySelector('#app,#selmuchPlus-app,.__app__');
    res.appTags = (div ? (div.__vue__ || div.__vue_app__) : null);
    // 搜索 DOM 中是否有广告关键词相关文本
    const txt = (document.body.innerText || '').toLowerCase();
    res.hasKeyword = txt.includes('keyword') || txt.includes('关键词');
    res.hasLogin = txt.includes('login') || txt.includes('登录');
    return res;
  });
  console.log('webpack runtime:', JSON.stringify(out, null, 2));

  // 同时尝试从 window 对象的字符串表示里找 actiontype 常量
  const strs = await page.evaluate(() => {
    const s = [];
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (typeof v === 'function' && v.toString().includes('actiontype')) s.push(k + '(fn)');
        if (typeof v === 'string' && /actiontype|GetFlatViewList|Keyword/i.test(v)) s.push(k + ':' + v.slice(0, 60));
      } catch (e) {}
    }
    return s.slice(0, 20);
  });
  console.log('\n全局 string/fn 含 actiontype:', JSON.stringify(strs));

  // 注入脚本: 拦截 netapi 调用并记录
  await page.evaluate(() => {
    if (window.__hooked) return;
    window.__hooked = true;
    const orig = window.fetch;
    window.__apiRecords = [];
    window.fetch = async (...args) => {
      const u = args[0];
      if (typeof u === 'string' && u.includes('netapi')) {
        let body = '';
        try { body = JSON.stringify(args[1]?.body || '').slice(0, 200); } catch (e) {}
        window.__apiRecords.push({ url: u, body });
      }
      return orig.apply(this, args);
    };
  });

  // 尝试用路由 hash 触发加载关键词模块
  await page.evaluate(() => {
    try { history.pushState(null, '', '/#/keywordsfororders'); } catch (e) {}
    if (window.$router) window.$router.push('/keywordsfororders').catch(()=>{});
    if (window.__app__ && window.__app__.$router) window.__app__.$router.push('/keywordsfororders').catch(()=>{});
  });
  await page.waitForTimeout(5000);

  const records = await page.evaluate(() => window.__apiRecords || []);
  console.log('\nfetch 拦截 netapi 记录:', JSON.stringify(records.slice(0, 10)));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
