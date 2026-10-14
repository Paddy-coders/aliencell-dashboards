// 易仓开放平台 OpenAPI 验证脚本 v2（正确签名）
// 签名规则: 字段按字母序排序拼接(AES), timestamp=毫秒, AES-128-CBC PKCS7, IV=1234500000054321
const crypto = require('crypto');

const APP_KEY = 'b70be345c2174684';
const SECRET_KEY = 'b85b5ea499b3acdf';
const SERVICE_ID = 'EDT7P8';
const URL = 'http://openapi-web.eccang.com/openApi/api/unity';
const IV = Buffer.from('1234500000054321', 'utf8');

function sign(params, secretKey) {
  // 按字段名排序, 过滤空字段和 sign
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== '' && params[k] !== undefined && params[k] !== null).sort();
  const base = keys.map(k => `${k}=${params[k]}`).join('&');
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(secretKey, 'utf8'), IV);
  const enc = Buffer.concat([cipher.update(base, 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

async function call(interfaceMethod, bizContent) {
  const body = {
    app_key: APP_KEY,
    service_id: SERVICE_ID,
    nonce_str: crypto.randomBytes(4).toString('hex'),
    interface_method: interfaceMethod,
    biz_content: typeof bizContent === 'string' ? bizContent : JSON.stringify(bizContent),
    sign_type: 'AES',
    charset: 'UTF-8',
    timestamp: Date.now(), // 毫秒
    version: 'v1.0.0',
  };
  body.sign = sign(body, SECRET_KEY);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, j, text: text.slice(0, 800) };
  } catch (e) {
    return { status: -1, j: null, text: 'fetch error: ' + e.message };
  }
}

(async () => {
  // 1. 验证签名: 获取有广告数据的店铺列表 (biz_content 空)
  console.log('=== 1. GetAuthAdStoreSiteList (验证签名) ===');
  const r1 = await call('GetAuthAdStoreSiteList', '');
  console.log('HTTP', r1.status);
  if (r1.j) {
    console.log('code:', r1.j.code, '| message:', r1.j.message);
    if (r1.j.biz_content) {
      try {
        const bc = JSON.parse(r1.j.biz_content);
        console.log('biz_content:', JSON.stringify(bc).slice(0, 1000));
        if (bc.Content) {
          console.log('店铺数:', bc.Content.length);
          bc.Content.slice(0, 5).forEach(s => console.log(' ', s.MarketplaceID, '|', s.UserAccount, '|', s.PlatformUserName));
        }
      } catch (e) { console.log('biz_content 原文:', r1.j.biz_content.slice(0, 500)); }
    }
  } else {
    console.log('返回:', r1.text);
  }
})();
