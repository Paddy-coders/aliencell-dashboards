// 试探易仓开放平台广告相关接口名（小驼峰）
const crypto = require('crypto');

const APP_KEY = 'b70be345c2174684';
const SECRET_KEY = 'b85b5ea499b3acdf';
const SERVICE_ID = 'EDT7P8';
const URL = 'http://openapi-web.eccang.com/openApi/api/unity';

function sign(params, signType = 'AES') {
  const base = `app_key=${params.app_key}&biz_content=${params.biz_content}&charset=${params.charset}&interface_method=${params.interface_method}&nonce_str=${params.nonce_str}&service_id=${params.service_id}&sign_type=${signType}&timestamp=${params.timestamp}&version=${params.version}`;
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(SECRET_KEY, 'utf8'), null);
  const enc = Buffer.concat([c.update(base, 'utf8'), c.final()]).toString('base64');
  return enc;
}

async function tryMethod(name, biz, delayMs = 2500) {
  const params = {
    app_key: APP_KEY,
    service_id: SERVICE_ID,
    interface_method: name,
    biz_content: JSON.stringify(biz),
    charset: 'UTF-8',
    sign_type: 'AES',
    nonce_str: crypto.randomBytes(8).toString('hex'),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    version: 'v1.0.0',
  };
  params.sign = sign(params);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    const out = j ? `${j.code || ''} ${j.message || ''}` : `HTTP${r.status}`;
    console.log(`[${name}] => ${out}`);
    if (j && j.code === 'saas.api.error.code.0024') {
      // 接口不存在
    } else if (r.status === 429) {
      console.log('  限流, 等待更久...');
      await new Promise(res => setTimeout(res, 8000));
    } else {
      console.log('  ★ 非0024, 接口可能存在! 完整返回:', text.slice(0, 400));
      await new Promise(res => setTimeout(res, 10000));
    }
    return j;
  } catch (e) {
    console.log(`[${name}] fetch error: ${e.message}`);
    return null;
  }
}

(async () => {
  await new Promise(res => setTimeout(res, 2000)); // 先等限流解除
  const candidates = [
    'getCampaignList',
    'getAdGroupList',
    'getAdGroupBidKeywordList',
    'getAdvPerformanceList',
    'getProductAdList',
  ];
  for (const name of candidates) {
    await tryMethod(name, { page: 1, page_size: 5 });
  }
})();
