// 精确探查广告管理：关闭弹窗 -> 提取表格 -> 点击广告活动 -> 广告组 -> 投放
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
    if (url.includes('netapi')) {
      const body = (req.postData() || '').slice(0, 3000);
      reqs.push({ url: url.slice(0, 200), method: req.method(), body });
    }
  });

  // 直接导航到广告管理活动列表
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
  await sleep(8000);
  console.log('导航后 URL:', page.url());
  await page.screenshot({ path: 'td_step1_list.png', timeout: 15000 });

  // 关闭弹窗：找"关闭"按钮或 X 按钮
  await page.evaluate(() => {
    // 找系统公告弹窗的关闭按钮
    const closeBtns = [...document.querySelectorAll('button, span, i, div')].filter(e => {
      const t = (e.textContent || '').trim();
      return t === '关闭' || t === '×' || t === 'X' || e.getAttribute('aria-label') === 'Close';
    });
    for (const b of closeBtns) {
      if (b.offsetParent !== null) { b.click(); }
    }
    // 点击 ant-modal-close
    document.querySelector('.ant-modal-close')?.click();
    document.querySelector('.ant-modal-close-x')?.click();
  });
  await sleep(1000);
  await page.screenshot({ path: 'td_step1_list_nomodal.png', timeout: 15000 });

  // 提取广告活动表格行的精确信息
  const tableInfo = await page.evaluate(() => {
    const result = [];
    // 在当前 document 和所有 iframe 中查找
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { docs.push(f.contentDocument || f.contentWindow.document); } catch (e) {}
    }
    for (const d of docs) {
      if (!d) continue;
      const tables = d.querySelectorAll('table');
      for (const table of tables) {
        const rows = [...table.querySelectorAll('tr')];
        if (rows.length > 1) {
          const dataRows = rows.slice(1).map((r, idx) => {
            const cells = [...r.querySelectorAll('td')];
            return {
              idx,
              text: (r.textContent || '').trim().slice(0, 120),
              cellCount: cells.length,
              firstCellText: (cells[0]?.textContent || '').trim().slice(0, 40),
              secondCellText: (cells[1]?.textContent || '').trim().slice(0, 40),
              clickableSelector: cells[1]?.querySelector('a') ? 'td:nth-child(2) a' : 'tr'
            };
          });
          result.push({
            rows: rows.length,
            header: (rows[0]?.textContent || '').trim().slice(0, 80),
            dataRows: dataRows.slice(0, 5)
          });
        }
      }
    }
    return result;
  });

  console.log('\n=== 表格信息 ===');
  for (const t of tableInfo) {
    console.log('Header:', t.header);
    for (const r of t.dataRows) {
      console.log(`  [${r.idx}] cells=${r.cellCount} first="${r.firstCellText}" second="${r.secondCellText}" text="${r.text}"`);
    }
  }

  // 点击第一个广告活动（通常是第二列的链接）
  const clickCampaign = async () => {
    const r = await page.evaluate(() => {
      const docs = [document];
      for (const f of document.querySelectorAll('iframe')) {
        try { docs.push(f.contentDocument || f.contentWindow.document); } catch (e) {}
      }
      for (const d of docs) {
        if (!d) continue;
        const tables = d.querySelectorAll('table');
        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll('td');
            if (cells.length >= 2) {
              const nameCell = cells[1];
              const link = nameCell.querySelector('a');
              if (link) {
                link.click();
                return { ok: true, name: (nameCell.textContent || '').trim().slice(0, 60) };
              }
              // 如果没有 a 标签，尝试点击 td 本身
              nameCell.click();
              return { ok: true, name: (nameCell.textContent || '').trim().slice(0, 60), clicked: 'td' };
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
  await page.screenshot({ path: 'td_step2_campaign.png', timeout: 15000 });

  // 提取当前页面所有Tab文本
  const tabsInfo = await page.evaluate(() => {
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { docs.push(f.contentDocument || f.contentWindow.document); } catch (e) {}
    }
    const allTabs = [];
    for (const d of docs) {
      if (!d) continue;
      const tabs = [...d.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item, .nav-item')];
      allTabs.push(...tabs.map(t => (t.textContent || '').trim()).filter(Boolean));
    }
    return allTabs;
  });
  console.log('\n=== 页面所有Tab ===');
  console.log(tabsInfo);

  // 如果页面有"广告组"相关Tab或链接，点击它
  const clickAdGroupTab = async () => {
    const r = await page.evaluate(() => {
      const docs = [document];
      for (const f of document.querySelectorAll('iframe')) {
        try { docs.push(f.contentDocument || f.contentWindow.document); } catch (e) {}
      }
      for (const d of docs) {
        if (!d) continue;
        // 找Tab
        const tabs = [...d.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item, .nav-item, a, div, button')];
        const t = tabs.find(e => {
          const txt = (e.textContent || '').trim();
          return txt === '广告组' || txt === 'Ad Groups' || txt === '投放' || txt === '关键词';
        });
        if (t) { t.click(); return { ok: true, type: 'tab', text: (t.textContent || '').trim() }; }
      }
      return { ok: false };
    });
    console.log('点击广告组/投放Tab:', r);
    return r;
  };

  await clickAdGroupTab();
  await sleep(5000);
  await page.screenshot({ path: 'td_step3_adgroup_tab.png', timeout: 15000 });

  // 再次尝试点击投放Tab
  await page.evaluate(() => {
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { docs.push(f.contentDocument || f.contentWindow.document); } catch (e) {}
    }
    for (const d of docs) {
      if (!d) continue;
      const all = [...d.querySelectorAll('*')];
      const t = all.find(e => (e.textContent || '').trim() === '投放');
      if (t) { t.click(); console.log('found 投放'); break; }
    }
  });
  await sleep(5000);
  await page.screenshot({ path: 'td_step4_targeting.png', timeout: 15000 });

  // 输出请求
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
  fs.writeFileSync('probe_targeting_final.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
