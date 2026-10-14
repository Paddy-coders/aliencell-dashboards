/**
 * JoyBuy 开放平台 SP-API 签名调用 SDK（Node.js，零依赖，仅用 node:crypto / node:https）
 *
 * 覆盖指南 ④ 全流程：
 *   - 签名：MD5(secret + 排序拼接串 + secret).toUpperCase()  /  HmacSHA256 / HmacMD5
 *   - 签名只覆盖 3 个固定头 + 路径参数 + query + 紧凑 JSON body：
 *       X-JOS-App-Key / X-JOS-Access-Token / X-JOS-Timestamp
 *   - 请求头：X-JOS-App-Key / X-JOS-Access-Token / X-JOS-Timestamp / X-JOS-Sign
 *     （非 MD5 另加 X-JOS-Sign-Method）。
 *     ⚠️ 除签名头外，接口文档还要求若干「业务维度头」（不参与签名）：
 *       X-JOS-Request-Identity = vender | supplier | userPin  ← 多业务聚合接口必填，POP 店铺填 vender
 *       X-JOS-Request-BizId    = venderId（请求 POP 商家数据时填）
 *       X-JOS-site             = UK-Site | NL-Site | DE-Site | FR-Site   ← JoyBuy 为欧洲站点，没有 US 站
 *       X-JOS-timeZone / X-JOS-currency / X-JOS-language
 *       X-JOS-Content-Type     = application/json; charset=utf-8（POST/PATCH/PUT 必填）
 *   - 网关：生产 https://api-eu.joybuy.com/rest ；预发 https://api-pre.joybuy.com/rest
 *     （2026-09-26 从官方文档页逐个核对 8 个订单履约接口，全部只写 api-eu / api-pre，
 *      旧的 api-cn.jd.com 属早期资料，已废弃）
 *   - 响应：{ success:true, data } | { success:false, errorList:[{code,message,details}] }
 *   - Token：到期前 N 秒自动刷新（refresh_token 接口），刷新后回写 joybuy_config.json
 *
 * 用法（CLI）：
 *   node joybuy_api.js selftest                      # 用文档示例校验签名实现
 *   node joybuy_api.js token --set <accessToken> [--refresh <refreshToken>] [--xid <xid>]
 *   node joybuy_api.js token --refresh-only          # 手动触发刷新
 *   node joybuy_api.js call GET  /sp-order/v0/orders --query '{"page":1,"pageSize":10}'
 *   node joybuy_api.js call POST /sp-order/v0/orders/123/remarks --body '{"product":"Widget"}'
 *
 * 作为模块：
 *   const jb = require('./joybuy_api');
 *   const r = await jb.call('GET', '/sp-order/v0/orders', { query: { page: 1 } });
 */
'use strict';
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.JOYBUY_CONFIG || path.join(__dirname, 'joybuy_config.json');

/* ------------------------------------------------------------------ *
 * 配置读写
 * ------------------------------------------------------------------ */
function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.signMethod = (cfg.signMethod || 'md5').toLowerCase();
  if (typeof cfg.signQuoteQueryValues !== 'boolean') cfg.signQuoteQueryValues = false;
  cfg.baseUrl = (cfg.baseUrl || 'https://api-eu.joybuy.com/rest').replace(/\/+$/, '');
  cfg.oauthBase = (cfg.oauthBase || 'https://jos-oauth.joybuy.com/oauth2').replace(/\/+$/, '');
  cfg.refreshAheadSeconds = cfg.refreshAheadSeconds || 86400;
  return cfg;
}
function saveConfig(cfg) {
  const clean = Object.assign({}, cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ *
 * 签名
 * ------------------------------------------------------------------ */
/** 紧凑 JSON（无空格换行）—— 文档要求 body 以紧凑 JSON 字符串参与签名 */
function compactJson(obj) {
  if (obj === undefined || obj === null) return '';
  if (typeof obj === 'string') {
    // 已是字符串：若看起来是 JSON 就压紧，否则原样用
    const s = obj.trim();
    if ((s.startsWith('{') || s.startsWith('['))) {
      try { return JSON.stringify(JSON.parse(s)); } catch (e) { return s; }
    }
    return s;
  }
  return JSON.stringify(obj);
}

/**
 * 构造参与签名的参数集并按 ASCII 排序（大写在小写前 —— JS 默认 code-unit 排序即此语义）
 * @returns {Array<[string,string]>} 排序后的 [名, 值] 列表
 */
function buildParamList(opts) {
  const { pathParams = {}, query = {}, body, appKey, accessToken, timestamp } = opts;
  const map = {};
  for (const k of Object.keys(pathParams)) map[k] = String(pathParams[k]);
  for (const k of Object.keys(query)) {
    if (query[k] === undefined || query[k] === null) continue;
    let v = query[k];
    if (typeof v !== 'string') v = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    map[k] = v;
  }
  const bodyStr = compactJson(body);
  if (bodyStr) map.body = bodyStr;
  map['X-JOS-App-Key'] = String(appKey || '');
  map['X-JOS-Access-Token'] = String(accessToken || '');
  map['X-JOS-Timestamp'] = String(timestamp);

  const keys = Object.keys(map).sort(); // ASCII/UTF-16 code-unit 升序：大写字母在小写字母之前
  return keys.map(k => [k, map[k]]);
}

/**
 * 拼接签名字符串。
 * 默认 query 参数值不加引号（与文档 HMAC 示例、以及「参数名+值依次拼接」的表述一致）；
 * 文档 MD5 示例里 query 值带引号，故提供 signQuoteQueryValues 开关 —— 若平台 Signature Tool 校验不通过就切换。
 */
function buildSignStr(opts) {
  const list = buildParamList(opts);
  const quoteQuery = !!opts.quoteQueryValues;
  const queryKeys = new Set(Object.keys(opts.query || {}));
  let s = '';
  for (const [k, v] of list) {
    if (k === 'body') { s += k + v; continue; }
    if (quoteQuery && queryKeys.has(k) && !k.startsWith('X-JOS-')) { s += k + '"' + v + '"'; continue; }
    s += k + v;
  }
  return s;
}

/** 计算签名（返回大写十六进制） */
function sign(opts) {
  const method = (opts.method || 'md5').toLowerCase();
  const secret = opts.appSecret || '';
  const signStr = buildSignStr(opts);
  let hex;
  if (method === 'md5') {
    hex = crypto.createHash('md5').update(secret + signStr + secret, 'utf8').digest('hex');
  } else if (method === 'hmacsha256') {
    hex = crypto.createHmac('sha256', secret).update(signStr, 'utf8').digest('hex');
  } else if (method === 'hmacmd5') {
    hex = crypto.createHmac('md5', secret).update(signStr, 'utf8').digest('hex');
  } else {
    throw new Error(`不支持的 signMethod: ${method}（可选 md5 / hmacsha256 / hmacmd5）`);
  }
  return { signature: hex.toUpperCase(), signStr, method, signStrNotQuoted: buildSignStr(Object.assign({}, opts, { quoteQueryValues: false })) };
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */
function request(urlStr, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body === undefined || body === null ? null : Buffer.from(body, 'utf8');
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method,
      headers: Object.assign({}, headers, payload ? { 'Content-Length': payload.length } : {})
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('请求超时(60s)')));
    if (payload) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ *
 * Token
 * ------------------------------------------------------------------ */
function tokenAlive(cfg) {
  return !!(cfg.accessToken && cfg.tokenExpiresAt && cfg.tokenExpiresAt - Date.now() > (cfg.refreshAheadSeconds || 86400) * 1000);
}
function normalizeTokenPayload(j) {
  if (!j || typeof j !== 'object') return null;
  const access = j.access_token || j.accessToken;
  const refresh = j.refresh_token || j.refreshToken;
  const expiresIn = Number(j.expires_in || j.expiresIn || 0);
  if (!access) return null;
  return {
    accessToken: access,
    refreshToken: refresh || '',
    xid: j.xid || j.uid || '',
    expiresIn,
    tokenExpiresAt: Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 3600 * 1000)
  };
}

/** 刷新 token（自研/ISV 通用） */
async function refreshToken(cfg, { persist = true } = {}) {
  cfg = cfg || loadConfig();
  if (!cfg.appKey || !cfg.appSecret) throw new Error('缺少 appKey / appSecret');
  if (!cfg.refreshToken) throw new Error('缺少 refreshToken（先完成一键授权或 ISV 授权码换 token）');
  const url = `${cfg.oauthBase}/refresh_token?appKey=${encodeURIComponent(cfg.appKey)}` +
    `&appSecret=${encodeURIComponent(cfg.appSecret)}` +
    `&grantType=refresh_token&refreshToken=${encodeURIComponent(cfg.refreshToken)}`;
  const { json, text, status } = await request(url, { method: 'GET' });
  const norm = normalizeTokenPayload(json);
  if (!norm) {
    const err = new Error(`刷新 token 失败 (HTTP ${status}): ${text.slice(0, 300)}`);
    err.raw = text;
    throw err;
  }
  Object.assign(cfg, norm);
  if (persist) saveConfig(cfg);
  return { ok: true, status, ...norm };
}

/** ISV：用授权码换 token */
async function exchangeCode(cfg, code, { persist = true } = {}) {
  cfg = cfg || loadConfig();
  if (!cfg.appKey || !cfg.appSecret) throw new Error('缺少 appKey / appSecret');
  const url = `${cfg.oauthBase}/access_token?appKey=${encodeURIComponent(cfg.appKey)}` +
    `&appSecret=${encodeURIComponent(cfg.appSecret)}` +
    `&grantType=authorization_code&code=${encodeURIComponent(code)}`;
  const { json, text, status } = await request(url, { method: 'GET' });
  const norm = normalizeTokenPayload(json);
  if (!norm) {
    const err = new Error(`换取 token 失败 (HTTP ${status}): ${text.slice(0, 300)}`);
    err.raw = text;
    throw err;
  }
  Object.assign(cfg, norm);
  if (persist) saveConfig(cfg);
  return { ok: true, status, ...norm };
}

/** 确保有可用 token（快过期则自动刷新） */
async function ensureToken(cfg) {
  cfg = cfg || loadConfig();
  if (tokenAlive(cfg)) return cfg;
  if (!cfg.refreshToken) {
    throw new Error('token 不可用且无 refreshToken。请先完成「一键授权」并把 access_token/refresh_token 写入 joybuy_config.json（见 node joybuy_api.js token --set ...）');
  }
  await refreshToken(cfg, { persist: true });
  return cfg;
}

/* ------------------------------------------------------------------ *
 * 调用 API
 * ------------------------------------------------------------------ */
/**
 * @param {string} method GET/POST/PUT/PATCH/DELETE
 * @param {string} apiPath 形如 '/sp-order/v0/orders'
 * @param {object} opts { query, body, pathParams, cfg, noToken }
 */
async function call(method, apiPath, opts = {}) {
  let cfg = opts.cfg;
  if (!opts.noToken) cfg = await ensureToken(cfg || loadConfig());
  else cfg = cfg || loadConfig();

  if (!cfg.appKey) {
    if (!opts.dry) throw new Error('缺少 appKey，请先填写 joybuy_config.json');
    // dry 模式允许空凭证，用占位值以便先核对请求头结构
    cfg = Object.assign({}, cfg, {
      appKey: cfg.appKey || 'PLACEHOLDER_APPKEY',
      appSecret: cfg.appSecret || 'PLACEHOLDER_APPSECRET'
    });
  }
  const query = opts.query || {};
  const bodyStr = compactJson(opts.body);
  const timestamp = Date.now(); // 毫秒级

  const { signature, method: sm, signStr } = sign({
    pathParams: opts.pathParams || {},
    query,
    body: opts.body,
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    accessToken: cfg.accessToken || (opts.noToken ? '' : cfg.accessToken),
    timestamp,
    method: cfg.signMethod,
    quoteQueryValues: cfg.signQuoteQueryValues
  });

  const headers = {
    'X-JOS-App-Key': cfg.appKey,
    'X-JOS-Access-Token': cfg.accessToken || '',
    'X-JOS-Timestamp': String(timestamp),
    'X-JOS-Sign': signature,
    'Content-Type': 'application/json'
  };
  if (sm !== 'md5') headers['X-JOS-Sign-Method'] = sm;

  // 业务维度头（不参与签名）。文档中对多业务聚合接口标了「API Data Dimension」多选项时，
  // X-JOS-Request-Identity 必填；POP 店铺数据固定传 vender。
  const extra = Object.assign({
    'X-JOS-Request-Identity': cfg.requestIdentity,
    'X-JOS-Request-BizId': cfg.venderId,
    'X-JOS-site': cfg.site,
    'X-JOS-timeZone': cfg.timeZone,
    'X-JOS-currency': cfg.currency,
    'X-JOS-language': cfg.language
  }, opts.headers || {});
  for (const k of Object.keys(extra)) {
    if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') headers[k] = String(extra[k]);
  }
  // 文档：POST/PATCH/PUT 必填，GET/DELETE 可省；固定值
  if (/^(POST|PATCH|PUT)$/.test(method.toUpperCase())) {
    headers['X-JOS-Content-Type'] = 'application/json; charset=utf-8';
  }

  const qs = Object.keys(query).length
    ? '?' + Object.keys(query).map(k => {
      let v = query[k];
      if (typeof v === 'object') v = JSON.stringify(v);
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }).join('&')
    : '';
  const url = cfg.baseUrl + apiPath + qs;

  // dry：只构造不发送，用于在拿到 appKey 之前核对请求头/签名串
  if (opts.dry) {
    return { ok: null, dry: true, method: method.toUpperCase(), url, headers, signStr, signMethod: sm };
  }

  const res = await request(url, { method: method.toUpperCase(), headers, body: bodyStr || undefined });
  const ok = !!(res.json && res.json.success);
  return {
    ok,
    status: res.status,
    url,
    signStr,
    signMethod: sm,
    data: res.json ? res.json.data : undefined,
    errors: res.json && res.json.errorList ? res.json.errorList : undefined,
    raw: res.json || res.text
  };
}

/** 便捷：直接拼查询串调用（GET） */
async function get(apiPath, query, opts = {}) {
  return call('GET', apiPath, Object.assign({}, opts, { query }));
}

/* ------------------------------------------------------------------ *
 * 自检：用文档示例校验签名实现
 * ------------------------------------------------------------------ */
function selftest() {
  const lines = [];
  let pass = 0, fail = 0;
  const chk = (name, ok, detail) => {
    (ok ? pass++ : fail++);
    lines.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
  };

  // 文档示例参数（SP-API Signature Algorithm Details）
  const base = {
    pathParams: { orderId: '123456' },
    query: { scopeSet: 'consigneeInfo,buyerRemark' },
    body: { product: 'Widget', quantity: 2 },
    appKey: '123456',
    appSecret: 'SECRET',
    accessToken: 'TOKEN',
    timestamp: 1751545370000
  };

  const noQuoteExpected =
    'X-JOS-Access-TokenTOKEN' +
    'X-JOS-App-Key123456' +
    'X-JOS-Timestamp1751545370000' +
    'body{"product":"Widget","quantity":2}' +
    'orderId123456' +
    'scopeSetconsigneeInfo,buyerRemark';
  const quotedExpected =
    'X-JOS-Access-TokenTOKEN' +
    'X-JOS-App-Key123456' +
    'X-JOS-Timestamp1751545370000' +
    'body{"product":"Widget","quantity":2}' +
    'orderId123456' +
    'scopeSet"consigneeInfo,buyerRemark"';

  const a = buildSignStr(Object.assign({}, base, { quoteQueryValues: false }));
  const b = buildSignStr(Object.assign({}, base, { quoteQueryValues: true }));

  chk('排序拼接串（默认/不带引号）与文档一致', a === noQuoteExpected, a);
  chk('排序拼接串（带引号开关）与文档 MD5 示例一致', b === quotedExpected, b);
  chk('开头不是 X-JOS-Access-Token 则排序错误', a.startsWith('X-JOS-Access-TokenTOKEN'), a.slice(0, 40));
  chk('body 用紧凑 JSON（无空格）', a.indexOf('body{"product":"Widget","quantity":2}') > 0, 'body 段命中');

  const m = sign(Object.assign({}, base, { method: 'md5' }));
  const expectedMd5 = crypto.createHash('md5').update('SECRET' + noQuoteExpected + 'SECRET', 'utf8').digest('hex').toUpperCase();
  chk('MD5 签名 = md5(secret+拼接串+secret) 且大写', m.signature === expectedMd5, m.signature);

  const h = sign(Object.assign({}, base, { method: 'hmacsha256' }));
  const expectedHmac = crypto.createHmac('sha256', 'SECRET').update(noQuoteExpected, 'utf8').digest('hex').toUpperCase();
  chk('HmacSHA256 以 secret 为 key 且大写', h.signature === expectedHmac, h.signature.slice(0, 32) + '…');

  const hm = sign(Object.assign({}, base, { method: 'hmacmd5' }));
  const expectedHmacMd5 = crypto.createHmac('md5', 'SECRET').update(noQuoteExpected, 'utf8').digest('hex').toUpperCase();
  chk('HmacMD5 以 secret 为 key 且大写', hm.signature === expectedHmacMd5, hm.signature);

  chk('签名长度为 32 位十六进制', /^[0-9A-F]{32}$/.test(m.signature), m.signature);

  // 参数缺失时的稳健性
  const onlyHdr = buildSignStr({ appKey: 'K', appSecret: 'S', accessToken: 'T', timestamp: 1, quoteQueryValues: false });
  chk('仅固定头时拼接串正确', onlyHdr === 'X-JOS-Access-TokenTX-JOS-App-KeyKX-JOS-Timestamp1', onlyHdr);

  console.log(lines.join('\n'));
  console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (fail) process.exitCode = 1;
  return fail === 0;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`JoyBuy SP-API SDK
  node joybuy_api.js selftest
  node joybuy_api.js token --set <accessToken> [--refresh <rt>] [--xid <xid>] [--expires-in <sec>]
  node joybuy_api.js token --refresh-only
  node joybuy_api.js exchange --code <authorizationCode>        # ISV 用授权码换 token
  node joybuy_api.js call <METHOD> <path> [--query '<json>'] [--body '<json>'] [--path-params '<json>'] [--no-token]
  node joybuy_api.js dryrun <METHOD> <path> [--query '<json>'] [--body '<json>']   # 只打印将发送的 URL/请求头/签名串`);
    return;
  }

  if (cmd === 'selftest') { selftest(); return; }

  if (cmd === 'token') {
    const cfg = loadConfig();
    if (argv.includes('--refresh-only')) {
      const r = await refreshToken(cfg);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    const set = opt('set');
    if (!set) throw new Error('缺少 --set <accessToken>');
    cfg.accessToken = set;
    if (opt('refresh')) cfg.refreshToken = opt('refresh');
    if (opt('xid')) cfg.xid = opt('xid');
    const expIn = Number(opt('expires-in') || 0);
    cfg.tokenExpiresAt = Date.now() + (expIn > 0 ? expIn * 1000 : 31536000 * 1000);
    saveConfig(cfg);
    console.log(JSON.stringify({ ok: true, saved: CONFIG_PATH, tokenExpiresAt: cfg.tokenExpiresAt }, null, 2));
    return;
  }

  if (cmd === 'exchange') {
    const code = opt('code');
    if (!code) throw new Error('缺少 --code <authorizationCode>');
    const r = await exchangeCode(loadConfig(), code);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'dryrun' || cmd === 'call') {
    const method = (argv[1] || 'GET').toUpperCase();
    const apiPath = argv[2];
    if (!apiPath) throw new Error('缺少 API 路径，如 /sp-order/v0/orders');
    const j = (s) => { if (!s) return undefined; try { return JSON.parse(s); } catch (e) { throw new Error(`JSON 解析失败: ${s}`); } };
    const r = await call(method, apiPath, {
      query: j(opt('query')) || {},
      body: j(opt('body')),
      pathParams: j(opt('path-params')) || {},
      noToken: cmd === 'dryrun' || argv.includes('--no-token'),
      dry: cmd === 'dryrun'
    });
    console.log(JSON.stringify(r, null, 2));
    if (cmd === 'call' && !r.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`未知命令: ${cmd}`);
}

if (require.main === module) {
  main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; });
}

module.exports = {
  loadConfig, saveConfig, sign, buildSignStr, buildParamList, compactJson,
  request, call, get, refreshToken, exchangeCode, ensureToken, tokenAlive, selftest, CONFIG_PATH
};
