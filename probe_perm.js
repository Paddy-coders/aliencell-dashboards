// 测试基础 ERP 接口 vs 广告接口，判断权限范围
const crypto = require('crypto');
const APP_KEY = 'b70be345c2174684';
const SECRET_KEY = 'b85b5ea499b3acdf';
const SERVICE_ID = 'EDT7P8';
const URL = 'http://openapi-web.eccang.com/openApi/api/unity';
const IV = Buffer.from('1234500000054321', 'utf8');

function sign(params) {
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== '' && params[k] !== undefined && params[k] !== null).sort();
  const base = keys.map(k => `${k}=${params[k]}`).join('&');
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(SECRET_KEY, 'utf8'), IV);
  return Buffer.concat([c.update(base, 'utf8'), c.final()]).toString('base64');
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
    timestamp: Date.now(),
    version: 'v1.0.0',
  };
  body.sign = sign(body);
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    const bc = j && j.biz_content ? (() => { try { return JSON.parse(j.biz_content); } catch (e) { return j.biz_content; } })() : null;
    return { status: r.status, j, bc, text: text.slice(0, 600) };
  } catch (e) {
    return { status: -1, j: null, bc: null, text: 'fetch error: ' + e.message };
  }
}

(async () => {
  const tests = [
    ['getStockOrderList', { page: 1, page_size: 1 }],   // 基础库存接口（文档示例）
    ['getProductList', { page: 1, page_size: 1 }],      // 产品列表（轻易云文档里有）
    ['GetAuthAdStoreSiteList', ''],                      // 广告店铺列表
  ];
  for (const [m, biz] of tests) {
    const r = await call(m, biz);
    const code = r.j ? (r.j.code || '') : '';
    const msg = r.j ? (r.j.message || '') : '';
    console.log(`[${m}] HTTP${r.status} code=${code} msg=${msg}`);
    if (r.j && r.j.biz_content) console.log('  biz_content:', JSON.stringify(r.bc || r.j.biz_content).slice(0, 400));
    else if (!r.j) console.log('  raw:', r.text);
    await new Promise(res => setTimeout(res, 1200));
  }
})();
