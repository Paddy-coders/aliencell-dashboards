// 测试Campaign.GetFlatViewList并打印完整响应
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  const token = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pro__Access-Token')).value; } catch { return null; } });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function call(actionType, body) {
    const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
      data: body, timeout: 30000
    });
    return { status: resp.status(), text: await resp.text() };
  }

  // 测试多种Filter参数
  const filters = [
    {},
    { ShopSite: 'US' },
    { StoreSiteId: 586024, StoreId: 174011 },
    { CampaignType: 'sponsoredProducts' },
    { StartDate: '2026-08-01', EndDate: '2026-08-20' }
  ];

  for (const filter of filters) {
    console.log('\n=== Filter:', JSON.stringify(filter), '===');
    const body = { RequestDate: rd, Content: { Filter: filter, Attributes: ["CampaignID","Name","State"], PageIndex: 1, PageSize: 10 } };
    const res = await call('Campaign.GetFlatViewList', body);
    console.log('Status:', res.status);
    try {
      const d = JSON.parse(res.text);
      console.log('Keys:', Object.keys(d));
      console.log('ret:', d.ret, 'msg:', d.msg || d.Message || '');
      if (d.Content) console.log('Content keys:', Object.keys(d.Content));
      if (d.Content?.Items) console.log('Items length:', d.Content.Items.length, 'First:', JSON.stringify(d.Content.Items[0]).slice(0, 300));
    } catch (e) { console.log('Raw:', res.text.slice(0, 500)); }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
