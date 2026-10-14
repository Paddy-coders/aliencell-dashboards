// 打开广告管理页面, 监听 netapi 网络请求, 找到真实接口与状态参数
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }

  const reqs = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('netapi') || url.includes('GetFlatViewList') || url.includes('amz-ad')) {
      let body = '';
      try { body = req.postData() || ''; } catch (e) {}
      reqs.push({ url: url.slice(0, 120), body: body.slice(0, 2000) });
    }
  });

  // 1. 点击顶部"广告"标签页
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.home-ant-tabs-tab, .ant-tabs-tab')];
    const tab = tabs.find(e => (e.textContent || '').trim() === '广告');
    if (tab) tab.click();
  });
  await page.waitForTimeout(3000);

  // 2. 点击"广告管理"
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.entry-menus-item--link, .home-ant-menu-item, .ant-menu-item')];
    const it = items.find(e => (e.textContent || '').trim() === '广告管理');
    if (it) it.click();
  });
  await page.waitForTimeout(12000);

  console.log('URL:', page.url());
  await page.screenshot({ path: 'ad_manage_live.png' });

  // 3. 输出监听到的请求
  console.log('\n=== netapi 请求 ===');
  for (const r of reqs.slice(-15)) {
    console.log('URL:', r.url);
    try {
      const b = JSON.parse(r.body);
      console.log('  actiontype:', b.actiontype || r.url);
      console.log('  Content.Filter:', JSON.stringify(b.Content?.Filter));
      console.log('  Attributes:', (b.Content?.Attributes || []).join(','));
    } catch (e) { console.log('  body(raw):', r.body); }
    console.log('---');
  }

  // 4. 提取页面表格中"状态"列取值
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const states = [...new Set(lines.filter(l => /^(已启用|已暂停|已归档|已关闭|正在投放|投放中|启用|暂停|归档|ENABLED|PAUSED|ARCHIVED)$/i.test(l)))];
    return { states, sampleLines: lines.filter(l => /暂停|归档|启用/.test(l)).slice(0, 30) };
  });
  console.log('\n页面状态取值:', JSON.stringify(info.states));
  console.log('含状态文本行:', JSON.stringify(info.sampleLines, null, 1).slice(0, 2000));

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
