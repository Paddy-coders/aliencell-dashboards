// 在广告管理页面精确点击UK店铺，然后深入广告活动->广告组->投放
const { chromium } = require('playwright');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) { page = p; break; }
  }
  await page.bringToFront();

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi')) {
      const body = (req.postData() || '').slice(0, 3000);
      reqs.push({ url: url.slice(0, 200), method: req.method(), body });
    }
  });

  // 导航到广告管理
  await page.goto('https://home.eccang.com/entry/EDT7P8/ERP/selmuch-web#/admanagement/campaignmanagement', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {});
  await sleep(5000);

  // 点击店铺选择下拉（精确选择包含"UK"的元素）
  const clickUK = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const uk = all.find(e => (e.textContent || '').trim() === 'Aliencell_Direct_UK');
    if (uk) { uk.click(); return { ok: true, tag: uk.tagName }; }
    // 兜底：找任何包含 UK 文本的元素
    const uk2 = all.find(e => (e.textContent || '').trim() === 'UK');
    if (uk2) { uk2.click(); return { ok: true, tag: uk2.tagName, text: 'UK' }; }
    return { ok: false };
  });
  console.log('点击UK:', clickUK);
  await sleep(5000);
  await page.screenshot({ path: 'td_uk_shop.png', timeout: 15000 });

  // 关闭弹窗
  await page.evaluate(() => {
    document.querySelector('.ant-modal-close')?.click();
    document.querySelector('.ant-modal-close-x')?.click();
  });
  await sleep(500);

  // 提取表格行
  const rows = await page.evaluate(() => {
    const result = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const trs = table.querySelectorAll('tr');
      for (let i = 1; i < trs.length; i++) {
        const cells = [...trs[i].querySelectorAll('td')];
        if (cells.length > 1) {
          result.push({
            idx: i,
            cells: cells.map(c => (c.textContent || '').trim().slice(0, 40)),
            hasLink: cells[1]?.querySelector('a') ? true : false
          });
        }
      }
    }
    return result;
  });
  console.log('\n=== 数据行 ===');
  for (const r of rows.slice(0, 5)) {
    console.log('Row', r.idx, ':', JSON.stringify(r.cells));
  }

  // 点击第一个广告活动
  if (rows.length > 0) {
    await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const trs = table.querySelectorAll('tr');
        for (let i = 1; i < trs.length; i++) {
          const cells = trs[i].querySelectorAll('td');
          if (cells.length > 1) {
            const link = cells[1]?.querySelector('a');
            if (link) { link.click(); return 'clicked'; }
          }
        }
      }
      return 'not found';
    });
    console.log('已点击广告活动');
    await sleep(8000);
    await page.screenshot({ path: 'td_uk_campaign.png', timeout: 15000 });

    // 获取Tab
    const tabs = await page.evaluate(() => {
      return [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item')]
        .map(t => (t.textContent || '').trim())
        .filter(Boolean);
    });
    console.log('Tabs:', tabs);

    // 点击投放/关键词Tab
    for (const name of ['投放', '关键词', 'Targeting', '搜索词']) {
      if (tabs.includes(name)) {
        await page.evaluate((n) => {
          const t = [...document.querySelectorAll('.ant-tabs-tab, [role="tab"], .tab-item, a, button, div')]
            .find(e => (e.textContent || '').trim() === n);
          if (t) t.click();
        }, name);
        console.log(`点击了 "${name}" Tab`);
        await sleep(5000);
        await page.screenshot({ path: `td_uk_${name}.png`, timeout: 15000 });
        break;
      }
    }
  }

  // 输出请求
  console.log('\n=== netapi 请求 ===');
  const netReqs = reqs.filter(r => r.url.includes('netapi'));
  for (const r of netReqs) {
    console.log('\nURL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('actiontype:', b.actiontype);
      if (b.Content?.Filter) console.log('Filter:', JSON.stringify(b.Content.Filter).slice(0, 200));
      if (b.Content?.Attributes) console.log('Attributes:', JSON.stringify(b.Content.Attributes).slice(0, 200));
    } catch (e) { console.log('body:', r.body.slice(0, 300)); }
  }
  fs.writeFileSync('probe_uk.json', JSON.stringify(netReqs, null, 2), 'utf-8');

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
