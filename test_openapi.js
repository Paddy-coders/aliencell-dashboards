// 易仓开放平台 OpenAPI 接入测试
// 凭证: AppKey / SecretKey / serviceId=EDT7P8
const crypto = require('crypto');

const APP_KEY = 'b70be345c2174684';
const SECRET_KEY = 'b85b5ea499b3acdf';
const SERVICE_ID = 'EDT7P8';
const URL = 'http://openapi-web.eccang.com/openApi/api/unity';
const CHARSET = 'UTF-8';
const VERSION = 'v1.0.0';

// 文档拼接顺序: app_key & biz_content & charset & interface_method & nonce_str & service_id & sign_type & timestamp & version
function joinStr(params, signType) {
  return `app_key=${params.app_key}&biz_content=${params.biz_content}&charset=${params.charset}&interface_method=${params.interface_method}&nonce_str=${params.nonce_str}&service_id=${params.service_id}&sign_type=${signType}&timestamp=${params.timestamp}&version=${params.version}`;
}

// 按字母序排序拼接（另一常见变体）
function joinSorted(params, signType) {
  const keys = Object.keys(params).filter(k => k !== 'sign').sort();
  return keys.map(k => `${k}=${params[k]}`).join('&');
}

// ---------- 签名变体 ----------
function signVariants(params) {
  const base = joinStr(params, 'AES');
  const baseSorted = joinSorted({ ...params, sign_type: 'AES' }, 'AES');
  const md5base = joinStr(params, 'MD5');
  const md5Sorted = joinSorted({ ...params, sign_type: 'MD5' }, 'MD5');

  const v = {};
  // AES-128-ECB PKCS7
  const aesEcb = (data) => {
    const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(SECRET_KEY, 'utf8'), null);
    return Buffer.concat([c.update(data, 'utf8'), c.final()]);
  };
  // AES-128-CBC PKCS7 IV=0
  const aesCbc = (data) => {
    const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(SECRET_KEY, 'utf8'), Buffer.alloc(16, 0));
    return Buffer.concat([c.update(data, 'utf8'), c.final()]);
  };

  v['AES-ECB-b64'] = { sign_type: 'AES', sign: aesEcb(base).toString('base64') };
  v['AES-ECB-hex'] = { sign_type: 'AES', sign: aesEcb(base).toString('hex') };
  v['AES-CBC-b64'] = { sign_type: 'AES', sign: aesCbc(base).toString('base64') };
  v['AES-CBC-hex'] = { sign_type: 'AES', sign: aesCbc(base).toString('hex') };
  v['AES-ECB-b64-sorted'] = { sign_type: 'AES', sign: aesEcb(baseSorted).toString('base64') };

  // MD5 变体
  v['MD5-suffix'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(md5base + SECRET_KEY).digest('hex') };
  v['MD5-prefix'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(SECRET_KEY + md5base).digest('hex') };
  v['MD5-wrap'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(SECRET_KEY + md5base + SECRET_KEY).digest('hex') };
  v['MD5-amp-key'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(md5base + '&key=' + SECRET_KEY).digest('hex') };
  v['MD5-sorted-suffix'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(md5Sorted + SECRET_KEY).digest('hex') };
  v['MD5-upper'] = { sign_type: 'MD5', sign: crypto.createHash('md5').update(md5base + SECRET_KEY).digest('hex').toUpperCase() };
  return v;
}

function buildParams(interfaceMethod, bizContent) {
  return {
    app_key: APP_KEY,
    service_id: SERVICE_ID,
    interface_method: interfaceMethod,
    biz_content: JSON.stringify(bizContent),
    charset: CHARSET,
    nonce_str: crypto.randomBytes(8).toString('hex'),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    version: VERSION,
  };
}

async function call(params, signInfo) {
  const body = { ...params, sign: signInfo.sign, sign_type: signInfo.sign_type };
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, body: j || text.slice(0, 300) };
  } catch (e) {
    return { status: -1, body: 'fetch error: ' + e.message };
  }
}

(async () => {
  // 用最小 biz_content 测试签名是否通过
  const biz = { Pager: { PageIndex: 1, PageSize: 5 }, Sorter: {}, Attributes: ['CampaignID', 'Name'], Filter: {} };
  const params = buildParams('Campaign.GetList', biz);
  const variants = signVariants(params);

  for (const [name, sig] of Object.entries(variants)) {
    const res = await call(params, sig);
    const errMsg = res.body && typeof res.body === 'object' ? JSON.stringify(res.body).slice(0, 200) : String(res.body).slice(0, 200);
    console.log(`[${name}] status=${res.status} => ${errMsg}`);
    // 若返回业务数据或明确非签名错误, 打印详细信息
    if (res.body && typeof res.body === 'object' && (res.body.data || res.body.ret === 0 || res.body.code === 0 || res.body.success)) {
      console.log('  ★ 可能成功:', JSON.stringify(res.body).slice(0, 500));
    }
    await new Promise(r => setTimeout(r, 300));
  }
})();
