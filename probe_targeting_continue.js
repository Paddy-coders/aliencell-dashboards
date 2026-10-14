// 在当前已登录的广告管理页面继续探查：广告活动 -> 广告组 -> 投放
const { chromium } = require('playwright');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('selmuch-web') || p.url().includes('admanagement')) { page = p; break; }
  }
  if (!page) { console.log('NO admanage page'); await browser.close(); return; }
  await page.bringToFront();
  console.log('当前URL:', page.url());
  await sleep(3000);

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi')) {
      reqs.push({ url: url.slice(0, 200), method: req.method(), body: (req.postData() || '').slice(0, 3000) });
    }
  });

  // 1. 关闭弹窗
  await page.evaluate(() => {
    document.querySelector('.ant-modal-close')?.click();
    document.querySelector('.ant-modal-close-x')?.click();
    const closeBtn = [...document.querySelectorAll('button, span, a')].find(e => (e.textContent || '').trim() === '关闭');
    if (closeBtn && closeBtn.offsetParent !== null) closeBtn.click();
  });
  await sleep(1000);
  await page.screenshot({ path: 'td_list.png', timeout: 15000 });

  // 2. 提取广告活动表格结构
  const tableStruct = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    const result = [];
    for (const table of tables) {
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length > 1) {
        const header = [...rows[0].querySelectorAll('th')].map(th => (th.textContent || '').trim());
        const firstDataRow = [...(rows[1]?.querySelectorAll('td') || [])].map(td => ({
          text: (td.textContent || '').trim().slice(0, 60),
          hasLink: !!td.querySelector('a')
        }));
        result.push({ header, firstDataRow, rowCount: rows.length });
      }
    }
    return result;
  });

  console.log('\n=== 表格结构 ===');
  for (const t of tableStruct) {
    console.log('Header:', t.header);
    console.log('First row:', JSON.stringify(t.firstDataRow));
    console.log('Rows:', t.rowCount);
  }

  // 3. 点击第一个广告活动名称（第二列的链接）
  const clickCampaign = async () => {
    const r = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          if (cells.length >= 2) {
            const link = cells[1]?.querySelector('a');
            if (link) {
              link.click();
              return { ok: true, name: (cells[1].textContent || '').trim().slice(0, 60) };
            }
          }
        }
      }
      return { ok: false };
    });
    console.log('点击广告活动:', r);
    return r;
  };

  await clickCampaign();
  await sleep(8000);
  console.log('点击后 URL:', page.url());
  await page.screenshot({ path: 'td_campaign_detail.png', timeout: 15000 });

  // 4. 提取当前页面所有Tab
  const tabs = await page.evaluate(() => {
    return [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item')]
      .map(t => (t.textContent || '').trim())
      .filter(Boolean);
  });
  console.log('\n=== 当前Tab ===', tabs);

  // 5. 点击"广告组"Tab（如果存在）
  const clickTab = async (name) => {
    const r = await page.evaluate((n) => {
      const tabs = [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item, a, button, div')];
      const t = tabs.find(e => (e.textContent || '').trim() === n);
      if (t) { t.click(); return { ok: true, text: n }; }
      return { ok: false };
    }, name);
    console.log(`点击 "${name}" Tab:`, r);
    return r;
  };

  if (tabs.includes('广告组')) {
    await clickTab('广告组');
    await sleep(5000);
    await page.screenshot({ path: 'td_adgroup_tab.png', timeout: 15000 });
  }

  // 6. 点击"投放"Tab
  if (tabs.includes('投放') || tabs.includes('关键词')) {
    await clickTab('投放');
    await sleep(5000);
    await page.screenshot({ path: 'td_targeting_tab.png', timeout: 15000 });
  } else {
    // 尝试在所有可点击元素中找"投放"
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];
      const t = all.find(e => (e.textContent || '').trim() === '投放');
      if (t) t.click();
    });
    await sleep(5000);
    await page.screenshot({ path: 'td_targeting_fallback.png', timeout: 15000 });
  }

  // 7. 输出请求
  console.log('\n=== netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
      console.log('Filter:', JSON.stringify(b.Content?.Filter));
      console.log('Attributes:', JSON.stringify(b.Content?.Attributes));
    } catch (e) { console.log('body:', r.body.slice(0, 500)); }
  }
  fs.writeFileSync('probe_targeting_real.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
