const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) { if (p.url().includes('eccang.com')) { page = p; break; } }
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const attrs = ["Asin", "Sku", "AdGroupID", "CampaignID", "CampaignID_Str", "Name", "State", "IsTotal", "CampaignName", "AdGroupName", "PortfolioName", "CampaignType"];
  async function mapFor(stateFilter) {
    const body = { RequestDate: requestDate, Content: { Attributes: attrs, Pager: { PageIndex: 1, PageSize: 500 }, Filter: stateFilter ? { State: stateFilter } : {}, Sorter: {} }, StoreSiteID: 586024, StoreID: 174011, MarketSiteID: 1, UniqueID: 0, EmployeeID: 0, PersonOrganizationID: 0, AccountType: 0, ToKen: token };
    const r = await ctx.request.post('https://amz-ad.eccang.com/netapi/', { headers: { 'Content-Type': 'application/json', 'actiontype': 'ProductAd.GetFlatViewList' }, data: body, timeout: 30000 });
    try { const j = JSON.parse(await r.text()); return (j.data?.Items || []).filter(it => !it.IsTotal); } catch (e) { return []; }
  }
  for (const v of ['1', '2', '0', 'ended', 'archived', 'deleted', 'stop', 'off']) {
    const items = await mapFor(v);
    const d = {}; for (const it of items) d[it.State] = (d[it.State] || 0) + 1;
    console.log(`State=${JSON.stringify(v)} -> ${items.length}条 ${JSON.stringify(d)}`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
