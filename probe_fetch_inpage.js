// 在广告管理页面内通过 fetch 直接调用 API（共享浏览器cookie）
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('admanagement') || p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }
  await page.bringToFront();
  console.log('Page URL:', page.url());

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const rd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callViaPage(actionType, body) {
    return await page.evaluate(async ({ actionType, body }) => {
      try {
        const resp = await fetch('https://amz-ad.eccang.com/netapi/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
          body: JSON.stringify(body),
          credentials: 'include'
        });
        const text = await resp.text();
        return { status: resp.status, text: text.slice(0, 3000) };
      } catch (e) {
        return { status: 0, text: e.message };
      }
    }, { actionType, body });
  }

  // 测试 Campaign.GetFlatViewList
  const body = { RequestDate: rd, Content: { Filter: {}, Attributes: ["CampaignID","Name","State"], PageIndex: 1, PageSize: 10 } };
  console.log('\n=== Campaign.GetFlatViewList ===');
  const res = await callViaPage('Campaign.GetFlatViewList', body);
  console.log('Status:', res.status);
  try {
    const d = JSON.parse(res.text);
    console.log('Keys:', Object.keys(d));
    console.log('ret:', d.ret, 'msg:', d.msg || d.Message || '');
    if (d.Content) {
      console.log('Content keys:', Object.keys(d.Content));
      console.log('Items length:', d.Content.Items?.length);
      if (d.Content.Items?.length > 0) {
        console.log('First:', JSON.stringify(d.Content.Items[0]).slice(0, 300));
      }
    }
  } catch (e) { console.log('Raw:', res.text.slice(0, 400)); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
