// 成功导航到广告管理后，逐层点击：广告活动 -> 广告组 -> 投放
// 捕获每一层的网络请求
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
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();

  const reqs = [];
  const captureReq = (req) => {
    const url = req.url();
    if (url.includes('netapi') || url.includes('amz-ad') || url.includes('report')) {
      reqs.push({
        url: url.slice(0, 200),
        method: req.method(),
        body: (req.postData() || '').slice(0, 2000),
        ts: Date.now()
      });
    }
  };
  page.on('request', captureReq);
  ctx.on('request', captureReq);

  // 监听新页面（弹窗）
  ctx.on('page', p => {
    console.log('[新页面]', p.url().slice(0, 120));
    p.on('request', captureReq);
  });

  // 1. 导航到广告管理入口
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
  await sleep(5000);

  // 2. 点击广告Tab
  await page.click('.home-ant-tabs-tab:has-text("广告")');
  await sleep(3000);

  // 3. 点击广告管理（使用已确认成功的选择器）
  await page.click('.entry-layout-menus-item__text--link:has-text("广告管理")');
  await sleep(12000);
  console.log('Step 3 广告管理加载后 URL:', page.url());
  await page.screenshot({ path: 'step3_campaign_list.png', timeout: 15000 });

  // 关闭可能的弹窗（系统公告等）
  const closeModal = async () => {
    await page.evaluate(() => {
      const closeBtns = [...document.querySelectorAll('.ant-modal-close-x, .ant-modal-close, [class*="close"]')];
      for (const b of closeBtns) { if (b.offsetParent !== null) b.click(); }
      // 点击遮罩层关闭
      const masks = [...document.querySelectorAll('.ant-modal-mask')];
      for (const m of masks) { if (m.offsetParent !== null) m.click(); }
    });
  };
  await closeModal();
  await sleep(1000);

  // 4. 点击第一个广告活动行
  // 广告活动可能在 iframe 里，也可能在当前页面
  const clickFirstCampaign = async () => {
    const r = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          // 找表格行，排除表头
          const rows = [...d.querySelectorAll('tr, .ant-table-row')];
          for (const row of rows) {
            const t = (row.textContent || '').trim();
            if (t.length > 5 && !/ID|广告活动|状态|推广类型|操作/.test(t)) {
              const clickable = row.querySelector('a, button, [role="button"]') || row;
              clickable.click();
              return { ok: true, iframe: true, text: t.slice(0, 80) };
            }
          }
        } catch (e) {}
      }
      // 当前 document
      const rows = [...document.querySelectorAll('tr, .ant-table-row')];
      for (const row of rows) {
        const t = (row.textContent || '').trim();
        if (t.length > 5 && !/ID|广告活动|状态|推广类型|操作/.test(t)) {
          const clickable = row.querySelector('a, button, [role="button"]') || row;
          clickable.click();
          return { ok: true, iframe: false, text: t.slice(0, 80) };
        }
      }
      return { ok: false, rows: rows.length };
    });
    console.log('Step 4 点击广告活动:', r);
    return r;
  };

  const campRes = await clickFirstCampaign();
  if (!campRes.ok) {
    console.log('未找到广告活动行，尝试通过左侧菜单"广告活动"进入');
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('a, div, span')];
      const el = items.find(e => (e.textContent || '').trim() === '广告活动');
      if (el) el.click();
    });
    await sleep(5000);
    await clickFirstCampaign();
  }
  await sleep(8000);
  console.log('Step 4 URL:', page.url());
  await page.screenshot({ path: 'step4_campaign_detail.png', timeout: 15000 });

  // 5. 点击第一个广告组
  const clickFirstAdGroup = async () => {
    const r = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          const rows = [...d.querySelectorAll('tr, .ant-table-row')];
          for (const row of rows) {
            const t = (row.textContent || '').trim();
            if (t.length > 5 && !/ID|广告组|状态|默认竞价|操作/.test(t)) {
              const clickable = row.querySelector('a, button, [role="button"]') || row;
              clickable.click();
              return { ok: true, iframe: true, text: t.slice(0, 80) };
            }
          }
        } catch (e) {}
      }
      const rows = [...document.querySelectorAll('tr, .ant-table-row')];
      for (const row of rows) {
        const t = (row.textContent || '').trim();
        if (t.length > 5 && !/ID|广告组|状态|默认竞价|操作/.test(t)) {
          const clickable = row.querySelector('a, button, [role="button"]') || row;
          clickable.click();
          return { ok: true, iframe: false, text: t.slice(0, 80) };
        }
      }
      return { ok: false, rows: rows.length };
    });
    console.log('Step 5 点击广告组:', r);
    return r;
  };
  await clickFirstAdGroup();
  await sleep(8000);
  console.log('Step 5 URL:', page.url());
  await page.screenshot({ path: 'step5_adgroup_detail.png', timeout: 15000 });

  // 6. 点击"投放"Tab
  const clickTargeting = async () => {
    const r = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const f of iframes) {
        try {
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d) continue;
          const tabs = [...d.querySelectorAll('.ant-tabs-tab, [role="tab"], button, a, div')];
          const t = tabs.find(e => {
            const txt = (e.textContent || '').trim();
            return txt === '投放' || txt === '关键词' || txt === 'Targeting' || txt === '搜索词';
          });
          if (t) { t.click(); return { ok: true, iframe: true, text: (t.textContent || '').trim() }; }
        } catch (e) {}
      }
      const tabs = [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], button, a, div')];
      const t = tabs.find(e => {
        const txt = (e.textContent || '').trim();
        return txt === '投放' || txt === '关键词' || txt === 'Targeting' || txt === '搜索词';
      });
      if (t) { t.click(); return { ok: true, iframe: false, text: (t.textContent || '').trim() }; }
      return { ok: false, tabs: tabs.slice(0, 15).map(t => (t.textContent || '').trim()) };
    });
    console.log('Step 6 点击投放Tab:', r);
    return r;
  };
  await clickTargeting();
  await sleep(8000);
  console.log('Step 6 URL:', page.url());
  await page.screenshot({ path: 'step6_targeting.png', timeout: 15000 });

  // 7. 输出所有请求
  console.log('\n=== 全部 netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    console.log('Method:', r.method);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
      console.log('Filter:', JSON.stringify(b.Content?.Filter));
      console.log('Attributes:', JSON.stringify(b.Content?.Attributes));
    } catch (e) { console.log('body(raw):', r.body.slice(0, 400)); }
  }
  console.log('\n总请求数:', reqs.length, 'netapi:', netReqs.length);
  fs.writeFileSync('probe_targeting_full.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
