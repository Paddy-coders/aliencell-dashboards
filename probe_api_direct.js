// 直接通过API探测投放词接口：Campaign -> AdGroup -> Keyword/Target
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('eccang.com')) { page = p; break; }
  }
  if (!page) { console.log('NO page'); await browser.close(); return; }

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('pro__Access-Token');
    try { return JSON.parse(raw).value; } catch { return raw; }
  });
  console.log('Token 前缀:', token ? token.slice(0, 30) + '...' : '无');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const requestDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  async function callAPI(actionType, body) {
    try {
      const resp = await ctx.request.post('https://amz-ad.eccang.com/netapi/', {
        headers: { 'Content-Type': 'application/json', 'actiontype': actionType },
        data: body,
        timeout: 30000
      });
      const text = await resp.text();
      return { status: resp.status(), text: text.slice(0, 2000) };
    } catch (e) {
      return { status: 0, text: e.message };
    }
  }

  // 1. 测试 Campaign.GetFlatViewList 获取活动列表
  const campaignBody = {
    RequestDate: requestDate,
    Content: {
      Filter: {},
      Attributes: ["CampaignID", "Name", "State", "CampaignType", "TargetingType"],
      PageIndex: 1,
      PageSize: 50
    }
  };
  console.log('\n=== Campaign.GetFlatViewList ===');
  const campRes = await callAPI('Campaign.GetFlatViewList', campaignBody);
  console.log('Status:', campRes.status);
  let campData = null;
  try {
    campData = JSON.parse(campRes.text);
    console.log('ret:', campData.ret, 'items:', campData.Content?.Items?.length);
    if (campData.Content?.Items?.length > 0) {
      console.log('First campaign:', JSON.stringify(campData.Content.Items[0]));
    }
  } catch (e) { console.log('Response:', campRes.text); }

  // 2. 如果有活动，测试 AdGroup.GetFlatViewList
  let campaignId = null;
  if (campData?.Content?.Items?.length > 0) {
    campaignId = campData.Content.Items[0].CampaignID;
  }

  if (campaignId) {
    console.log('\n=== AdGroup.GetFlatViewList (CampaignID=' + campaignId + ') ===');
    const agBody = {
      RequestDate: requestDate,
      Content: {
        Filter: { CampaignID: campaignId },
        Attributes: ["AdGroupID", "Name", "State", "CampaignID"],
        PageIndex: 1,
        PageSize: 50
      }
    };
    const agRes = await callAPI('AdGroup.GetFlatViewList', agBody);
    console.log('Status:', agRes.status);
    let agData = null;
    try {
      agData = JSON.parse(agRes.text);
      console.log('ret:', agData.ret, 'items:', agData.Content?.Items?.length);
      if (agData.Content?.Items?.length > 0) {
        console.log('First adgroup:', JSON.stringify(agData.Content.Items[0]));
      }
    } catch (e) { console.log('Response:', agRes.text); }

    // 3. 如果有广告组，测试投放词接口
    let adGroupId = null;
    if (agData?.Content?.Items?.length > 0) {
      adGroupId = agData.Content.Items[0].AdGroupID;
    }

    if (adGroupId) {
      const keywordBody = {
        RequestDate: requestDate,
        Content: {
          Filter: { AdGroupID: adGroupId },
          Attributes: ["KeywordID", "KeywordText", "MatchType", "State", "Bid"],
          PageIndex: 1,
          PageSize: 50
        }
      };

      const candidates = [
        'Keyword.GetFlatViewList',
        'Targeting.GetFlatViewList',
        'AdKeyword.GetFlatViewList',
        'CampaignKeyword.GetFlatViewList',
        'AdGroupKeyword.GetFlatViewList',
        'ProductTargeting.GetFlatViewList',
        'SponsoredProductsKeyword.GetFlatViewList',
        'SponsoredProductsTarget.GetFlatViewList',
        'SearchTerm.GetFlatViewList',
        'AdTarget.GetFlatViewList',
        'SpKeyword.GetFlatViewList',
        'SdTarget.GetFlatViewList',
        'SbKeyword.GetFlatViewList',
      ];

      for (const actionType of candidates) {
        console.log(`\n=== ${actionType} ===`);
        const res = await callAPI(actionType, keywordBody);
        console.log('Status:', res.status);
        try {
          const d = JSON.parse(res.text);
          console.log('ret:', d.ret, 'msg:', d.msg || d.Message || '');
          if (d.Content?.Items?.length > 0) {
            console.log('items count:', d.Content.Items.length);
            console.log('First item:', JSON.stringify(d.Content.Items[0]).slice(0, 300));
          }
        } catch (e) { console.log('Response:', res.text.slice(0, 200)); }
        await sleep(300);
      }
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
