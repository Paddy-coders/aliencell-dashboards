// 测试 Campaign.GetList 接口，获取不同状态的数据
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('selmuch-web')) { page = p; break; }
  }
  if (!page) { console.log('NO selmuch page'); await browser.close(); return; }

  const token = await page.evaluate(() => { const raw = localStorage.getItem('pro__Access-Token'); try { return JSON.parse(raw).value; } catch { return raw; } });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // 获取当前页面URL中的store参数
  const u = new URL(page.url());
  const storeSiteId = 586024; // US
  const storeId = 174011;
  const marketSiteId = 1;

  async function call(actiontype, content) {
    const body = { RequestDate: requestDate, Content: content, StoreSiteID: storeSiteId, StoreID: storeId, MarketSiteID: marketSiteId, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
      headers: { 'Content-Type': 'application/json', 'actiontype': actiontype },
      data: body,
      timeout: 30000
    });
    try {
      const j = JSON.parse(await r.text());
      const items = (j.data?.Items || []).filter(it => !it.IsTotal);
      const states = {};
      for (const it of items) { states[it.State] = (states[it.State] || 0) + 1; }
      return { count: items.length, states, names: items.slice(0, 5).map(it => it.Name) };
    } catch (e) { return { count: -1, text: String(await r.text()).slice(0, 200) }; }
  }

  // 测试不同状态过滤
  console.log('=== Campaign.GetList 状态探测 ===');
  const tests = [
    { label: '无状态过滤', filter: {"AttributeFilters":[]} },
    { label: 'enabled', filter: {"AttributeFilters":[{"AttributeCode":"State","Operator":"=","Value":"enabled"}]} },
    { label: 'paused', filter: {"AttributeFilters":[{"AttributeCode":"State","Operator":"=","Value":"paused"}]} },
    { label: 'archived', filter: {"AttributeFilters":[{"AttributeCode":"State","Operator":"=","Value":"archived"}]} },
    { label: 'disabled', filter: {"AttributeFilters":[{"AttributeCode":"State","Operator":"=","Value":"disabled"}]} },
    { label: 'enabled OR paused', filter: {"AttributeFilters":[{"AttributeCode":"State","Operator":"in","Value":["enabled","paused"]}]} },
  ];

  for (const t of tests) {
    const r = await call('Campaign.GetList', {
      Attributes: ["CampaignID","State","Name","CampaignType","SponsoredType"],
      Pager: { PageIndex: 1, PageSize: 500 },
      Filter: t.filter,
      Sorter: {}
    });
    console.log(`\n${t.label}:`);
    console.log('  count:', r.count);
    console.log('  states:', r.states);
    if (r.names) console.log('  names:', r.names);
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
