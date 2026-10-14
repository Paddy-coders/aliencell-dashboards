// 按用户路径探查: 广告 -> 广告管理 -> 点击广告活动 -> 点击广告组 -> 点击投放
// 捕获每一层的网络请求，定位投放词 API
const { chromium } = require('playwright');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('home.eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO home page'); await browser.close(); return; }
  await page.bringToFront();

  // 收集所有 netapi 请求
  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi') || url.includes('amz-ad') || url.includes('report')) {
      const body = (req.postData() || '').slice(0, 2000);
      reqs.push({ url: url.slice(0, 200), method: req.method(), body });
    }
  });
  ctx.on('request', req => {
    const url = req.url();
    if (url.includes('netapi') || url.includes('report')) {
      reqs.push({ url: url.slice(0, 200), method: req.method(), body: (req.postData() || '').slice(0, 2000) });
    }
  });

  // 1. 导航到业务报告页面确保顶部 Tab 存在
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_71579', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
  await sleep(5000);
  console.log('Step 0 URL:', page.url());

  // 2. 点击顶部"广告"Tab
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const t = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (t) { t.click(); return 'clicked'; }
    return 'not found';
  });
  await sleep(4000);
  console.log('Step 1: 已点击顶部广告Tab');

  // 3. 点击"广告管理"
  const clickAdManage = async () => {
    const r = await page.evaluate(() => {
      // 尝试多种选择器
      const sels = ['a.entry-menus-item__title', '.home-ant-menu-item', '.ant-menu-item', '.entry-menus-item--link', 'a[href]'];
      for (const sel of sels) {
        const els = [...document.querySelectorAll(sel)];
        const el = els.find(e => (e.textContent || '').trim() === '广告管理');
        if (el) { el.click(); return { ok: true, sel }; }
      }
      return { ok: false };
    });
    console.log('Step 2 广告管理点击:', r);
  };
  await clickAdManage();
  await sleep(12000);

  const takeSnap = async (name) => {
    try { await page.screenshot({ path: `${name}.png`, timeout: 15000 }); } catch (e) {}
  };
  await takeSnap('step2_admanage');
  console.log('Step 2 URL:', page.url());

  // 4. 在页面中找广告活动列表并点击第一个
  const findAndClickCampaign = async () => {
    const r = await page.evaluate(() => {
      // 查找广告活动行（通常是带 Campaign 名称的链接或按钮）
      // 先尝试在 iframe 里
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          // 找表格行
          const rows = [...d.querySelectorAll('tr, .ant-table-row, .campaign-row, [class*="campaign"]')];
          if (rows.length > 1) {
            const first = rows.find(r => {
              const t = (r.textContent || '').trim();
              return t.length > 3 && !t.includes('广告活动') && !t.includes('状态');
            });
            if (first) {
              // 找可点击元素
              const clickable = first.querySelector('a, button, [role="button"]') || first;
              clickable.click();
              return { ok: true, iframe: true, text: (first.textContent || '').slice(0, 80) };
            }
          }
        } catch (e) {}
      }
      // 在当前 document 中找
      const rows = [...document.querySelectorAll('tr, .ant-table-row, .campaign-row, [class*="campaign"]')];
      if (rows.length > 1) {
        const first = rows.find(r => {
          const t = (r.textContent || '').trim();
          return t.length > 3 && !t.includes('广告活动') && !t.includes('状态');
        });
        if (first) {
          const clickable = first.querySelector('a, button, [role="button"]') || first;
          clickable.click();
          return { ok: true, iframe: false, text: (first.textContent || '').slice(0, 80) };
        }
      }
      return { ok: false, rows: rows.length };
    });
    console.log('Step 3 广告活动点击:', r);
    return r;
  };

  const campRes = await findAndClickCampaign();
  if (!campRes.ok) {
    // 可能页面是 SPA 路由，需要找特定元素点击
    const r2 = await page.evaluate(() => {
      const allA = [...document.querySelectorAll('a')];
      const a = allA.find(e => (e.textContent || '').trim() === '广告管理');
      if (a) { a.click(); return 'clicked a'; }
      return 'not found a';
    });
    console.log('Fallback 点击 a 标签:', r2);
    await sleep(8000);
    await findAndClickCampaign();
  }
  await sleep(10000);
  await takeSnap('step3_campaign');
  console.log('Step 3 URL:', page.url());

  // 5. 找广告组并点击第一个
  const findAndClickAdGroup = async () => {
    const r = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          const rows = [...d.querySelectorAll('tr, .ant-table-row, .adgroup-row, [class*="adgroup"]')];
          if (rows.length > 1) {
            const first = rows.find(r => {
              const t = (r.textContent || '').trim();
              return t.length > 3 && !t.includes('广告组') && !t.includes('状态');
            });
            if (first) {
              const clickable = first.querySelector('a, button, [role="button"]') || first;
              clickable.click();
              return { ok: true, iframe: true, text: (first.textContent || '').slice(0, 80) };
            }
          }
        } catch (e) {}
      }
      const rows = [...document.querySelectorAll('tr, .ant-table-row, .adgroup-row, [class*="adgroup"]')];
      if (rows.length > 1) {
        const first = rows.find(r => {
          const t = (r.textContent || '').trim();
          return t.length > 3 && !t.includes('广告组') && !t.includes('状态');
        });
        if (first) {
          const clickable = first.querySelector('a, button, [role="button"]') || first;
          clickable.click();
          return { ok: true, iframe: false, text: (first.textContent || '').slice(0, 80) };
        }
      }
      return { ok: false, rows: rows.length };
    });
    console.log('Step 4 广告组点击:', r);
    return r;
  };
  await findAndClickAdGroup();
  await sleep(10000);
  await takeSnap('step4_adgroup');
  console.log('Step 4 URL:', page.url());

  // 6. 找"投放"Tab 并点击
  const clickTargetingTab = async () => {
    const r = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          const tabs = [...d.querySelectorAll('.ant-tabs-tab, .home-ant-tabs-tab, [role="tab"]')];
          const t = tabs.find(e => {
            const txt = (e.textContent || '').trim();
            return txt === '投放' || txt === '关键词' || txt === 'Targeting' || txt === 'targeting';
          });
          if (t) { t.click(); return { ok: true, iframe: true, text: (t.textContent || '').trim() }; }
        } catch (e) {}
      }
      const tabs = [...document.querySelectorAll('.ant-tabs-tab, .home-ant-tabs-tab, [role="tab"]')];
      const t = tabs.find(e => {
        const txt = (e.textContent || '').trim();
        return txt === '投放' || txt === '关键词' || txt === 'Targeting' || txt === 'targeting';
      });
      if (t) { t.click(); return { ok: true, iframe: false, text: (t.textContent || '').trim() }; }
      // 兜底：找包含"投放"文本的任何可点击元素
      const all = [...document.querySelectorAll('button, a, div, span')];
      const t2 = all.find(e => (e.textContent || '').trim() === '投放');
      if (t2) { t2.click(); return { ok: true, fallback: true, text: '投放' }; }
      return { ok: false, tabs: tabs.map(t => (t.textContent || '').trim()).slice(0, 15) };
    });
    console.log('Step 5 投放Tab点击:', r);
    return r;
  };
  await clickTargetingTab();
  await sleep(8000);
  await takeSnap('step5_targeting');
  console.log('Step 5 URL:', page.url());

  // 7. 输出所有捕获到的 netapi 请求
  console.log('\n=== 捕获的 netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    console.log('Method:', r.method);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
      console.log('Content.Filter:', JSON.stringify(b.Content?.Filter));
      console.log('Content.Attributes:', JSON.stringify(b.Content?.Attributes));
    } catch (e) { console.log('body(raw):', r.body.slice(0, 500)); }
  }

  console.log('\n全部请求数量:', reqs.length, 'netapi数量:', netReqs.length);
  fs.writeFileSync('probe_targeting_reqs.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
