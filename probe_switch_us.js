// 在广告管理页面切换店铺到US，然后点击广告活动 -> 广告组 -> 投放，捕获真实接口
const { chromium } = require('playwright');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('admanagement')) { page = p; break; }
  }
  if (!page) { console.log('NO admanage page'); await browser.close(); return; }
  await page.bringToFront();
  console.log('URL:', page.url());

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi')) {
      reqs.push({
        url: url.slice(0, 200),
        method: req.method(),
        body: (req.postData() || '').slice(0, 3000)
      });
    }
  });

  // 1. 关闭弹窗
  await page.evaluate(() => {
    document.querySelector('.ant-modal-close')?.click();
    document.querySelector('.ant-modal-close-x')?.click();
  });
  await sleep(500);

  // 2. 点击店铺选择下拉（左上角）
  console.log('点击店铺下拉...');
  await page.evaluate(() => {
    // 找包含 "Aliencell_Direct_BE" 或店铺名称的下拉框
    const triggers = [...document.querySelectorAll('.ant-select-selection__rendered, .ant-select-selector, [class*="select"]')];
    for (const t of triggers) {
      const txt = (t.textContent || '').trim();
      if (txt.includes('Aliencell') || txt.includes('Direct') || txt.includes('店铺') || txt.includes('BE')) {
        t.click();
        return { clicked: true, text: txt };
      }
    }
    return { clicked: false };
  });
  await sleep(2000);

  // 3. 在下拉列表中选择 US
  console.log('选择 US 店铺...');
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option-content, [class*="option"]')];
    for (const item of items) {
      const txt = (item.textContent || '').trim();
      if (txt.includes('US') || txt.includes('美国') || txt === 'Aliencell_Direct_US') {
        item.click();
        return { selected: true, text: txt };
      }
    }
    return { selected: false, items: items.slice(0, 10).map(i => (i.textContent || '').trim()) };
  });
  await sleep(5000);
  await page.screenshot({ path: 'td_us_shop.png', timeout: 15000 });

  // 4. 提取页面表格内容
  const tableInfo = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map(t => {
      const rows = [...t.querySelectorAll('tr')];
      return {
        header: rows[0] ? [...rows[0].querySelectorAll('th')].map(th => (th.textContent || '').trim()) : [],
        firstRow: rows[1] ? [...rows[1].querySelectorAll('td')].map(td => (td.textContent || '').trim().slice(0, 60)) : [],
        rowCount: rows.length
      };
    });
  });
  console.log('\n=== 表格 ===');
  for (const t of tableInfo) {
    console.log('Header:', t.header);
    console.log('FirstRow:', t.firstRow);
    console.log('Rows:', t.rowCount);
  }

  // 5. 点击第一个广告活动名称
  const clickResult = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('td');
        if (cells.length >= 2) {
          const link = cells[1]?.querySelector('a');
          if (link) {
            link.click();
            return { ok: true, name: (cells[1].textContent || '').trim() };
          }
        }
      }
    }
    return { ok: false };
  });
  console.log('点击广告活动:', clickResult);
  await sleep(8000);
  console.log('点击后 URL:', page.url());
  await page.screenshot({ path: 'td_campaign_detail_us.png', timeout: 15000 });

  // 6. 提取当前页面Tab
  const tabs = await page.evaluate(() => {
    return [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item')]
      .map(t => (t.textContent || '').trim())
      .filter(Boolean);
  });
  console.log('\n=== Tab ===', tabs);

  // 7. 如果有"广告组"或"投放"Tab，点击
  for (const name of ['广告组', '投放', '关键词', 'Targeting']) {
    if (tabs.includes(name)) {
      await page.evaluate((n) => {
        const t = [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item, a, button, div')]
          .find(e => (e.textContent || '').trim() === n);
        if (t) t.click();
      }, name);
      console.log(`点击了 "${name}" Tab`);
      await sleep(5000);
      await page.screenshot({ path: `td_tab_${name}.png`, timeout: 15000 });
      break;
    }
  }

  // 8. 输出请求
  console.log('\n=== netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
      console.log('Filter:', JSON.stringify(b.Content?.Filter || b.Filter).slice(0, 300));
      console.log('Attributes:', JSON.stringify(b.Content?.Attributes || b.Attributes).slice(0, 300));
    } catch (e) { console.log('body:', r.body.slice(0, 400)); }
  }
  fs.writeFileSync('probe_targeting_us.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
