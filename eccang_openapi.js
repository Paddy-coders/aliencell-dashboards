// 易仓开放平台 OpenAPI 客户端库 (可复用)
// 用法: const ecc = require('./eccang_openapi.js');
//       const r = await ecc.call('GetAuthAdStoreSiteList', '');
//
// 签名规则(已验证): AES-128-CBC / PKCS7 / IV=1234500000054321 / 字段字母序拼接 / timestamp=毫秒
// 接口模式: 大部分广告接口为异步任务 (创建任务->GetTasksStatus轮询->下载DocumentId)
const crypto = require('crypto');

const DEFAULTS = {
  appKey: 'b70be345c2174684',
  secretKey: 'b85b5ea499b3acdf',
  serviceId: 'EDT7P8',
  url: 'http://openapi-web.eccang.com/openApi/api/unity',
  iv: '1234500000054321',
};

/** 生成签名串 (按字段字母序, 过滤空字段与sign, 末尾不拼密钥——AES模式) */
function buildBase(params) {
  return Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== '' && params[k] !== undefined && params[k] !== null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
}

/** AES 签名 (sign_type=AES) */
function signAES(params, secretKey) {
  const base = buildBase(params);
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(secretKey, 'utf8'), Buffer.from(DEFAULTS.iv, 'utf8'));
  return Buffer.concat([cipher.update(base, 'utf8'), cipher.final()]).toString('base64');
}

/** MD5 签名 (sign_type=MD5, 拼接后末尾追加 secretKey, 32位小写) */
function signMD5(params, secretKey) {
  const base = buildBase(params) + secretKey;
  return crypto.createHash('md5').update(base).digest('hex');
}

/** 构造请求体并签名 */
function buildBody(interfaceMethod, bizContent, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const body = {
    app_key: cfg.appKey,
    service_id: cfg.serviceId,
    nonce_str: opts.nonce_str || crypto.randomBytes(4).toString('hex'),
    interface_method: interfaceMethod,
    biz_content: typeof bizContent === 'string' ? bizContent : JSON.stringify(bizContent),
    sign_type: opts.sign_type || 'AES',
    charset: 'UTF-8',
    timestamp: opts.timestamp || Date.now(),
    version: 'v1.0.0',
  };
  body.sign = body.sign_type === 'MD5' ? signMD5(body, cfg.secretKey) : signAES(body, cfg.secretKey);
  return body;
}

/** 调用接口, 返回 {ok, code, message, bizContent, raw} */
async function call(interfaceMethod, bizContent, opts = {}) {
  const body = buildBody(interfaceMethod, bizContent, opts);
  let r;
  try {
    r = await fetch(DEFAULTS.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: 'network: ' + e.message };
  }
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  if (!j) return { ok: false, status: r.status, raw: text.slice(0, 500) };
  let biz = null;
  if (j.biz_content) {
    try { biz = JSON.parse(j.biz_content); } catch (e) { biz = j.biz_content; }
  }
  return {
    ok: String(j.code) === '200',
    code: j.code,
    message: j.message,
    requestId: j.requestId,
    bizContent: biz,
    raw: text,
  };
}

/** 创建广告数据任务 (GetAdvertisingDetail) */
async function createAdDetailTask({ userAccount, campaignType, dataType, reportDate, statisticsType = 'ByDay', state, campaignState, adGroupState }) {
  const biz = { UserAccount: userAccount, CampaignType: campaignType, DataType: dataType, ReportDate: reportDate, StatisticsType: statisticsType };
  if (state) biz.State = state;
  if (campaignState) biz.CampaignState = campaignState;
  if (adGroupState) biz.AdGroupState = adGroupState;
  return call('GetAdvertisingDetail', biz);
}

/** 查询任务状态 (GetTasksStatus) */
async function queryTasks({ taskNoList, createAfter, createBefore, pageIndex = 1, pageSize = 100, status }) {
  const biz = { CreateAfter: createAfter, CreateBefore: createBefore, PageIndex: pageIndex, PageSize: pageSize };
  if (taskNoList) biz.TaskNoList = taskNoList;
  if (status) biz.Status = status;
  return call('GetTasksStatus', biz);
}

/** 获取有广告数据的店铺列表 */
function listAdStores() {
  return call('GetAuthAdStoreSiteList', '');
}

module.exports = { DEFAULTS, buildBase, signAES, signMD5, buildBody, call, createAdDetailTask, queryTasks, listAdStores };
