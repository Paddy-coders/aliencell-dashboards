// 直接在 m_69809 页面探查广告活动列表，观察点击广告管理后的真实页面结构
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
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi') || url.includes('amz-ad') || url.includes('report')) {
      reqs.push({ url: url.slice(0, 200), method: req.method(), body: (req.postData() || '').slice(0, 2000) });
    }
  });

  // 导航到广告管理入口
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/iframe#/m_69809', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
  await sleep(5000);
  console.log('m_69809 URL:', page.url());

  // 点击广告Tab
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const t = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (t) t.click();
  });
  await sleep(3000);

  // 点击广告管理
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('a.entry-menus-item__title, .entry-menus-item--link, .ant-menu-item')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) it.click();
  });
  await sleep(10000);

  console.log('After click URL:', page.url());
  await page.screenshot({ path: 'probe_admanage_struct.png', timeout: 15000 });

  // 详细检查页面结构：iframe、表格、Tab、可点击元素
  const struct = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('iframe')];
    const iframeInfo = iframes.map(f => {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        return {
          src: f.src,
          url: (f.contentWindow?.location?.href || ''),
          bodyText: d ? (d.body?.innerText || '').slice(0, 200) : 'no access'
        };
      } catch (e) { return { src: f.src, error: e.message }; }
    });

    // 查找所有表格
    const tables = [...document.querySelectorAll('table')].map(t => ({
      rows: t.rows.length,
      text: (t.innerText || '').slice(0, 200)
    }));

    // 查找所有含 "广告活动" 文本的元素
    const campaignEls = [...document.querySelectorAll('*')].filter(e =>
      (e.textContent || '').trim().includes('广告活动')
    ).slice(0, 10).map(e => ({
      tag: e.tagName,
      className: e.className,
      text: (e.textContent || '').trim().slice(0, 100)
    }));

    // 查找所有Tab
    const tabs = [...document.querySelectorAll('.ant-tabs-tab, .home-ant-tabs-tab, [role="tab"]')].map(t =>
      (t.textContent || '').trim()
    );

    // 查找 body 文本中包含关键信息的行
    const bodyLines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 60);

    return { iframeInfo, tables, campaignEls, tabs, bodyLines };
  });

  console.log('\n=== iframe 信息 ===');
  struct.iframeInfo.forEach((f, i) => console.log(`[${i}]`, JSON.stringify(f)));

  console.log('\n=== 表格 ===');
  struct.tables.forEach((t, i) => console.log(`[${i}] rows=${t.rows} text=${t.text}`));

  console.log('\n=== 含"广告活动"的元素 ===');
  struct.campaignEls.forEach((e, i) => console.log(`[${i}]`, JSON.stringify(e)));

  console.log('\n=== Tab ===');
  console.log(struct.tabs);

  console.log('\n=== Body 前60行 ===');
  struct.bodyLines.forEach((l, i) => console.log(`${i}: ${l}`));

  fs.writeFileSync('probe_admanage_struct.json', JSON.stringify(struct, null, 2), 'utf-8');

  // 输出请求
  console.log('\n=== netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('URL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype, 'Filter:', JSON.stringify(b.Content?.Filter));
    } catch (e) { console.log('body:', r.body.slice(0, 300)); }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
