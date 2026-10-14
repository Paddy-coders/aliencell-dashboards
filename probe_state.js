// 探测: 去掉 Filter.State 限制后, API 返回的状态分布与周数据情况
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('selmuch-web') || p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO PAGE'); await browser.close(); return; }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  if (!token) { console.log('NO TOKEN'); await browser.close(); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // 1. mapping: 不带 State 过滤
  const bodyNoState = {
    RequestDate: requestDate,
    Content: { Attributes: ["Asin", "Sku", "AdGroupID", "CampaignID", "CampaignID_Str", "Name", "State", "IsTotal", "CampaignName", "AdGroupName", "PortfolioName", "CampaignType"], Pager: { PageIndex: 1, PageSize: 500 }, Filter: {}, Sorter: {} },
    StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token
  };
  const r1 = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' }, data: bodyNoState, timeout: 30000 });
  const j1 = JSON.parse(await r1.text());
  const items1 = (j1.data?.Items || []).filter(it => !it.IsTotal);
  const dist = {};
  for (const it of items1) dist[it.State] = (dist[it.State] || 0) + 1;
  console.log('[US mapping 无状态过滤] 总条数:', items1.length, 'State分布:', JSON.stringify(dist));

  // 2. 周数据: 不带 State 过滤 (用最近一周)
  const lastFri = new Date();
  lastFri.setDate(lastFri.getDate() - (lastFri.getDay() >= 5 ? lastFri.getDay() - 5 : lastFri.getDay() + 2));
  const fmt = d => d.toLocaleDateString('en-CA');
  const end = lastFri, start = new Date(end); start.setDate(end.getDate() - 6);
  const bodyWeek = { ...bodyNoState, Content: { ...bodyNoState.Content, Filter: { Report: { ReportDate: [fmt(start), fmt(end)] } } } };
  const r2 = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' }, data: bodyWeek, timeout: 30000 });
  const j2 = JSON.parse(await r2.text());
  const items2 = (j2.data?.Items || []).filter(it => !it.IsTotal);
  const dist2 = {};
  for (const it of items2) dist2[it.State] = (dist2[it.State] || 0) + 1;
  console.log(`[US 周 ${fmt(start)}~${fmt(end)} 无状态过滤] 条数:`, items2.length, 'State分布:', JSON.stringify(dist2));
  const dis = items2.filter(it => it.State !== 'enabled');
  console.log('非enabled示例:', dis.slice(0, 3).map(it => ({ Name: it.Name, State: it.State, CampaignName: it.CampaignName, Report: it.Report })));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
