#!/usr/bin/env node
/**
 * joybuy_compass_fetch.js —— JoyBuy 商家后台 Data Compass 数据采集
 *
 * 背景：JoyBuy 开放平台 SP-API 没有任何流量 / 加购 / 收藏接口，
 *       这三类数据只能从商家后台 partner.joybuy.com 的 Data Compass 拿。
 *
 * 原理：借道已登录的调试浏览器（CDP 9333），在页面上下文里直接 fetch
 *       Data Compass 的 DSM 网关接口 sff.joybuy.com/api。
 *       无需逆向签名，复用浏览器 Cookie 与设备指纹。
 *
 * 用法：
 *   node joybuy_compass_fetch.js                  # 默认采集 UK+DE+NL+FR，近 120 天
 *   node joybuy_compass_fetch.js --days 60
 *   node joybuy_compass_fetch.js --shops UK
 *   node joybuy_compass_fetch.js --probe          # 只探测一个接口，验证会话有效
 *   node joybuy_compass_fetch.js --save-session   # 【一次性】从调试浏览器导出会话文件
 *   node joybuy_compass_fetch.js --cdp            # 强制走浏览器模式（忽略会话文件）
 *
 * ── 会话策略（2026-10-02 新增）：能不用浏览器就不用 ────────────────
 * 实测结论：本脚本对浏览器的依赖**只剩「把 Cookie 带过去」这一层**。那两个
 * 「抓包看不到、要钩 XHR 才能挖出」的自定义头（dsm-platform / dsm-site）早已硬编码，
 * 不再需要浏览器探测。因此把 Cookie 导出成会话文件后，用 Node 原生 https 直连
 * 网关即可拿到完全一样的数据（实测 code=200 success=true）。
 *
 *   优先顺序：joybuy_compass_session.json 存在且探活通过 → 纯 HTTP（零浏览器、零登录）
 *             否则 → 回退浏览器模式（需先 node joybuy_browser.js --keep）
 *
 * 会话续期：Cookie 里的登录票据 pin 有效期至 2027-10，__jda 至 2027-03，通常很久才失效。
 *          真失效时会明确提示「请重新登录后执行 --save-session」，不会静默跑出空数据。
 * 首次准备：node joybuy_browser.js --keep   # 人工登录一次
 *          node joybuy_compass_fetch.js --save-session
 *          之后每周自动化就再也不需要浏览器了。
 *
 * 前置（仅浏览器模式）：调试浏览器已启动并登录 partner.joybuy.com
 *   node joybuy_browser.js --keep
 *
 * 输出：joybuy_compass_data.json
 *
 * ── 踩坑备忘（勿删）────────────────────────────────────────────
 * 1. 网关强制要求 dsm-platform: intl-pc 与 dsm-server 同级的 dsm-site 头，
 *    缺失返回 {"code":312,"msg":"Request exception, please try again later"}。
 *    这两个头抓包看不到（非标准 CORS 头），需钩 XMLHttpRequest.setRequestHeader 才能挖出。
 *    → 现已硬编码在两种模式里，无需再挖。
 * 2. trend / detail 类接口单次查询跨度上限 30 天，超过返回
 *    {"code":-1002,"msg":"Parameter Error"}。必须分段拉取再合并。
 * 3. 切换店铺：GET //museaccount.joybuy.com/account/live/change?shopId=&belongBizId=
 *    之后 Data Compass 的 allShops:"0"(Current Shop) 才会指向目标店铺。
 * 4. 沙箱注入的 HTTP_PROXY 会劫持 localhost:9333 CDP，必须在 require('playwright') 前清掉。
 *    注意：清代理只影响 CDP 连接，Node 原生 https 直连网关不受影响（实测可通）。
 * ────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---- 坑 4：沙箱代理会劫持 localhost CDP，必须在 require('playwright') 之前清掉 ----
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const { chromium } = require('playwright');

const CDP = process.env.JB_CDP || 'http://127.0.0.1:9333';
const OUT = path.join(__dirname, 'joybuy_compass_data.json');

const TREND_MAX_DAYS = 30;                       // 坑 2
const DSM_BASE = '//sff.joybuy.com/api';
const DSM_APPID = '1SBIFSJH9OSWNCNUSKG5';        // Data Compass 微应用
const LANG = 'en_GB';
const BELONG_BIZ = '1500002329';

const SHOPS = {
  UK: { siteCode: 'UK-Site', shopId: '1500005160', currency: 'GBP' },
  DE: { siteCode: 'DE-Site', shopId: '1500006728', currency: 'EUR' },
  NL: { siteCode: 'NL-Site', shopId: '1500001848', currency: 'EUR' },
  FR: { siteCode: 'FR-Site', shopId: '1500009866', currency: 'EUR' },
};

// 指标 key 全部来自 dsm.compass.pop.base.indicator
const TRAFFIC_IND = ['popStoreUv', 'popStorePv', 'popPdpUv', 'popPdpPv',
  'popAtcUv', 'popAtcUnits', 'popAverageSessionDuration',
  'popPdpUvToPaidUserConversionRate', 'popPdpPvToOrdersConversionRate',
  'popAverageRevenuePerPaidUser', 'popAverageVisitDepth', 'popPaidUsers'];
const PRODUCT_IND = ['popOnSaleProducts', 'popVisitedProducts', 'popCollectedProducts',
  'popAtcProducts', 'popActiveProducts', 'popOutOfStockProducts', 'popInactiveProducts'];
const TRANSACTION_IND = ['popGmv', 'popOrders', 'popSoldUnits', 'popRevenuePerOrder',
  'popOrderCancelRate', 'popPaidUsers', 'popPdpUv', 'popPdpUvToPaidUserConversionRate'];
const SKU_IND = ['popPdpUv', 'popPdpPv', 'popAtcUv', 'popAtcUnits',
  'popPdpUvToAtcUvConversionRate', 'popAverageSessionDuration',
  'popPdpUvToPaidUserConversionRate', 'popAverageRevenuePerPaidUser',
  'popGmv', 'popOrders', 'popSoldUnits', 'popPaidUsers', 'popStockUnits'];

const SESSION = path.join(__dirname, 'joybuy_compass_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
  return v.toString(16);
});

/** 极简 https 客户端（原生模块，不引第三方依赖） */
function httpRequest(urlStr, { method = 'POST', headers = {}, body, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method, timeout: timeoutMs,
      headers: Object.assign({ 'User-Agent': UA }, headers, payload ? { 'Content-Length': payload.length } : {}),
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, text: d, headers: res.headers }));
    });
    r.on('timeout', () => r.destroy(new Error('请求超时 ' + timeoutMs + 'ms')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── Cookie jar ──────────────────────────────────────────────────────────────
// 【2026-10-02 关键坑】切店铺（museaccount /account/live/change）是靠**服务端会话**生效的，
// 它通过 Set-Cookie 下发"当前店铺"。若纯 HTTP 模式把响应头丢掉，后续所有请求仍按
// 会话里原有的当前店铺取数 —— 实测表现为「4 个站都返回同一个站的数据」（UK 请求拿到 19 个
// FR 的 SKU），而 summary 接口看起来正常，**极难发现**。所以必须维护 cookie jar。
function parseCookieJar(str) {
  const m = new Map();
  String(str || '').split('; ').filter(Boolean).forEach(kv => {
    const i = kv.indexOf('=');
    if (i > 0) m.set(kv.slice(0, i), kv.slice(i + 1));
  });
  return m;
}
const jarToString = m => [...m.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorbSetCookies(map, setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  const changed = [];
  list.forEach(sc => {
    const first = String(sc).split(';')[0];
    const i = first.indexOf('=');
    if (i <= 0) return;
    const k = first.slice(0, i).trim(), v = first.slice(i + 1);
    if (map.get(k) !== v) { map.set(k, v); changed.push(k); }
  });
  return changed;
}

/** 读会话文件（含 Cookie 头） */
function loadSession() {
  if (!fs.existsSync(SESSION)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
    if (!s || !s.cookie) return null;
    return s;
  } catch (e) { return null; }
}

/** 从调试浏览器导出 Cookie 到会话文件（--save-session） */
async function saveSession() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const all = await ctx.cookies();
  // 只取 .joybuy.com 域的 cookie：sff(网关)/museaccount(切店铺)/partner(后台) 都匹配它。
  // 实测仅凭这组 cookie 即可直连成功；带上 .jd.com 等会让同名 cookie 重复，反而有风险。
  const picked = all.filter(c => c.domain === '.joybuy.com');
  const jar = picked.map(c => c.name + '=' + c.value).join('; ');
  if (!picked.length) throw new Error('未在浏览器中读到 .joybuy.com 的 cookie —— 请先确认已登录 partner.joybuy.com');
  const s = {
    savedAt: new Date().toISOString(),
    note: '由 joybuy_compass_fetch.js --save-session 从调试浏览器导出；Cookie 有效期见 pin/__jda，通常数月。',
    domains: [...new Set(all.map(c => c.domain))],
    count: picked.length,
    cookie: jar,
  };
  fs.writeFileSync(SESSION, JSON.stringify(s, null, 2), 'utf8');
  log('✓ 会话已导出 → ' + path.basename(SESSION));
  log('  cookie 条数: ' + picked.length + '，头部长度: ' + jar.length + ' 字符');
  log('  之后直接跑 `node joybuy_compass_fetch.js` 即可（不再需要浏览器与登录）。');
  return s;
}

/** 纯 HTTP 调 DSM 网关（jar 存在时用它，并吸收响应的 Set-Cookie） */
async function httpDsm(api, body, sess, jar) {
  const url = 'https://sff.joybuy.com/api?api=' + encodeURIComponent(api)
    + '&appId=' + DSM_APPID + '&timestamp=' + Date.now() + '&v=1.0';
  const r = await httpRequest(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'dsm-platform': 'intl-pc',      // 坑 1：这两个头缺一不可，现已硬编码
      'dsm-site': '',
      'dsm-language': LANG,
      'dsm-trace-id': uuid(),
      'Cookie': jar ? jarToString(jar) : sess.cookie,
      'Referer': 'https://partner.joybuy.com/',
      'Origin': 'https://partner.joybuy.com',
    }, body,
  });
  if (jar && r.headers) absorbSetCookies(jar, r.headers['set-cookie']);
  let j = null;
  try { j = JSON.parse(r.text); } catch (e) {}
  return j ? { status: r.status, json: j } : { status: r.status, raw: r.text.slice(0, 300) };
}

/** 纯 HTTP 切换店铺（必须吸收 Set-Cookie，否则切换不生效，见上方 Cookie jar 注释） */
async function httpSwitch(shopId, bizId, sess, jar) {
  const r = await httpRequest(
    'https://museaccount.joybuy.com/account/live/change?shopId=' + shopId + '&belongBizId=' + bizId,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': jar ? jarToString(jar) : sess.cookie,
        'Referer': 'https://partner.joybuy.com/',
      },
    });
  const changed = (jar && r.headers) ? absorbSetCookies(jar, r.headers['set-cookie']) : [];
  let j = null;
  try { j = JSON.parse(r.text); } catch (e) {}
  const out = j || { raw: r.text.slice(0, 200) };
  out.__setCookieChanged = changed;   // 供调用方打印，便于确认切换是否真的改变了会话
  return out;
}
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

/** 把 [start,end] 切成若干 ≤TREND_MAX_DAYS 天的段 */
function chunkRange(start, end, maxDays) {
  const out = [];
  let cur = parseYmd(start);
  const last = parseYmd(end);
  while (cur <= last) {
    const segEnd = addDays(cur, maxDays - 1);
    const use = segEnd > last ? last : segEnd;
    out.push({ startDate: ymd(cur), endDate: ymd(use) });
    cur = addDays(use, 1);
  }
  return out;
}

(async () => {
  const days = Number(arg('days', 120)) || 120;
  const only = arg('shops', null);
  const probe = !!arg('probe', false);
  const skipWeekly = !!arg('no-weekly', false);       // 只刷新站点级数据时跳过 SKU×周（省 ~2 分钟）
  const showWeeks = !!arg('weeks', false);            // 只打印周区间划分后退出（校验口径，不联网）
  const forceCdp = !!arg('cdp', false);               // 强制走浏览器模式（忽略会话文件）
  const wantSave = !!arg('save-session', false);      // 【一次性】从调试浏览器导出会话文件
  const outArg = arg('out', null);                    // 自定义输出路径（验证/对比用，不动正式数据）
  const shopKeys = only && typeof only === 'string'
    ? only.split(',').map(s => s.trim().toUpperCase()).filter(k => SHOPS[k])
    : Object.keys(SHOPS);

  const end = new Date(); end.setDate(end.getDate() - 1);            // 数据 T+1，取到昨天
  const start = new Date(end); start.setDate(start.getDate() - (days - 1));
  const range = { startDate: ymd(start), endDate: ymd(end) };
  const cmpEnd = new Date(start); cmpEnd.setDate(cmpEnd.getDate() - 1);
  const cmpStart = new Date(cmpEnd); cmpStart.setDate(cmpStart.getDate() - (days - 1));
  const cmp = { comparisonStartDate: ymd(cmpStart), comparisonEndDate: ymd(cmpEnd) };

  log('=== JoyBuy Data Compass 采集 ===');
  log('范围:', range.startDate, '~', range.endDate, '(' + days + ' 天)');
  log('对比:', cmp.comparisonStartDate, '~', cmp.comparisonEndDate);
  log('分段:', chunkRange(range.startDate, range.endDate, TREND_MAX_DAYS).length, '段 (每段 ≤' + TREND_MAX_DAYS + ' 天)');
  log('店铺:', shopKeys.join(', '));

  if (showWeeks) {
    const wk = weekRanges(range.startDate, range.endDate);
    log('\n周区间划分（周六~周五，周号取该周周五所在 ISO 周）共 ' + wk.length + ' 周：');
    for (const w of wk) log('  ' + w.key.padEnd(5) + ' ' + w.startDate + ' ~ ' + w.endDate + '  (' + w.days + ' 天)  ' + w.label);
    log('\n合计天数 = ' + wk.reduce((a, w) => a + w.days, 0) + '（应等于窗口天数 ' + days + '）');
    process.exit(0);
  }

  if (wantSave) {
    await saveSession();
    process.exit(0);
  }

  const isOk = r => r && r.json && (r.json.success === true || r.json.code === 200 || r.json.code === '200');

  // ── 会话策略：会话文件有效 → 纯 HTTP（零浏览器、零登录）；否则回退浏览器模式 ──
  let page = null, sess = null, httpMode = false, jar = null;
  if (forceCdp) {
    log('模式: 浏览器（--cdp 强制）');
  } else {
    sess = loadSession();
    if (!sess) {
      log('模式: 浏览器（未找到会话文件 ' + path.basename(SESSION) + '）');
      log('      一次性导出会话后即可改用纯 HTTP（不再需要浏览器与登录）：');
      log('      node joybuy_browser.js --keep  &&  node joybuy_compass_fetch.js --save-session');
    } else {
      log('模式: 校验会话文件（保存于 ' + sess.savedAt + '，' + sess.count + ' 条 cookie）...');
      const pr = await httpDsm('dsm.compass.pop.traffic.querySummary', {
        platforms: [], userRegionIds: [], userCountryIds: [], allShops: '0',
        currency: 'GBP', startDate: range.endDate, endDate: range.endDate,
        indicators: TRAFFIC_IND, report: 'POP_TRAFFIC', chart: 'POP_TRAFFIC_SUMMARY', languageCode: LANG,
      }, sess).catch(e => ({ err: e.message }));
      httpMode = isOk(pr);
      if (httpMode) {
        log('      ✓ 会话有效 → 纯 HTTP 模式（不启动浏览器、不需要登录）');
      } else {
        // 注意：会话失效时服务端**仍返回 HTTP 200**，错误只在 body 的 code/msg 里，
        // 所以这里必须优先展示业务错误码，别把 HTTP 状态码当成原因（会误导排查）。
        const why = (pr && (pr.err
          || (pr.json && (pr.json.msg || (pr.json.code !== undefined ? 'code=' + pr.json.code : '')))
          || (pr.raw ? String(pr.raw).slice(0, 60)
            : (pr.status !== undefined ? 'HTTP ' + pr.status : '')))) || '未知';
        log('      ✗ 会话已失效（' + why + '）→ 回退浏览器模式');
        log('        重新登录后执行 `node joybuy_compass_fetch.js --save-session` 即可恢复纯 HTTP');
      }
    }
  }

  let switchShop;
  if (httpMode) {
    jar = parseCookieJar(sess.cookie);
    switchShop = (shopId, bizId) => httpSwitch(shopId, bizId, sess, jar);
  } else {
    const browser = await chromium.connectOverCDP(CDP);
    const ctx = browser.contexts()[0];
    page = ctx.pages().filter(p => /partner\.joybuy\.com/.test(p.url())).pop();
    if (!page) page = await ctx.newPage();
    await page.goto('https://partner.joybuy.com/compass/seller-intelligence/traffic',
      { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(e => log('  goto warn:', e.message.slice(0, 60)));
    await sleep(8000);
    log('页面就绪:', page.url());

    // 在页面上下文里注入 DSM 调用器（含坑 1 必需头）
    await page.evaluate((cfg) => {
      const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      window.__dsm = async (api, body) => {
        const url = cfg.base + '?api=' + encodeURIComponent(api)
          + '&appId=' + cfg.appId + '&timestamp=' + Date.now() + '&v=1.0';
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'dsm-platform': 'intl-pc',
            'dsm-site': '',
            'dsm-language': cfg.lang,
            'dsm-trace-id': uuid(),
          },
          body: JSON.stringify(body || {}),
          credentials: 'include',
        });
        const t = await r.text();
        try { return { status: r.status, json: JSON.parse(t) }; }
        catch (e) { return { status: r.status, raw: t.slice(0, 300) }; }
      };
      window.__switchShop = async (shopId, bizId) => {
        const r = await fetch('//museaccount.joybuy.com/account/live/change?shopId=' + shopId + '&belongBizId=' + bizId,
          { credentials: 'include' });
        let j = null; try { j = await r.json(); } catch (e) {}
        return j;
      };
    }, { base: DSM_BASE, appId: DSM_APPID, lang: LANG });

    switchShop = (shopId, bizId) => page.evaluate(({ shopId, bizId }) => window.__switchShop(shopId, bizId), { shopId, bizId });
  }

  const raw = httpMode
    ? (api, body) => httpDsm(api, body, sess, jar)
    : (api, body) => page.evaluate(({ api, body }) => window.__dsm(api, body), { api, body });

  if (probe) {
    log('\n[probe] 会话校验中...');
    const r = await raw('dsm.compass.pop.traffic.querySummary', {
      platforms: [], userRegionIds: [], userCountryIds: [], allShops: '0',
      currency: 'GBP', startDate: range.endDate, endDate: range.endDate,
      indicators: TRAFFIC_IND, report: 'POP_TRAFFIC', chart: 'POP_TRAFFIC_SUMMARY', languageCode: LANG,
    });
    log('  status=' + r.status, JSON.stringify(r.json && r.json.data));
    process.exit(isOk(r) ? 0 : 2);
  }

  /** 分段拉趋势并合并 currentData */
  async function trendChunked(api, base, extra) {
    const segs = chunkRange(range.startDate, range.endDate, TREND_MAX_DAYS);
    const rows = [];
    let currencyUnit = null, lastErr = null;
    for (const s of segs) {
      const body = Object.assign({}, base, {
        startDate: s.startDate, endDate: s.endDate,
        comparisonStartDate: s.endDate, comparisonEndDate: s.endDate,
      }, extra);
      const r = await raw(api, body);
      if (!isOk(r)) { lastErr = (r.json && (r.json.msg || r.json.code)) || r.status; await sleep(300); continue; }
      const d = r.json.data || {};
      if (d.currencyUnit) currencyUnit = d.currencyUnit;
      for (const row of (d.currentData || [])) rows.push(row);
      await sleep(300);
    }
    // 按日期去重排序
    const byDt = new Map();
    for (const r of rows) { if (r && r.dt) byDt.set(r.dt, r); }
    const merged = [...byDt.values()].sort((a, b) => {
      const pa = a.dt.split('/'), pb = b.dt.split('/');
      return new Date(+pa[2], +pa[1] - 1, +pa[0]) - new Date(+pb[2], +pb[1] - 1, +pb[0]);
    });
    return { currencyUnit, currentData: merged, segs: segs.length, err: merged.length ? null : lastErr };
  }

  /**
   * 分段拉明细
   *
   * ⚠️ 重要语义（实测确认，两套口径混在同一个响应里，务必分清）：
   *
   *  A) **流量类指标 = 每日均值**，区间合计需 × 天数
   *     popPdpUv / popPdpPv / popAtcUv / popAtcUnits
   *     证据：DE 站某 SKU 查 1 天 pdp=4，查 30 天 pdp=2（≈4×30/30 的日均）
   *
   *  B) **交易类指标 = 区间合计**，直接累加，**不能** × 天数
   *     popOrders / popSoldUnits / popGmv
   *     证据：DE 站 30 天交易汇总 popOrders=3 / popGmv=1803.89，
   *           同一区间某 SKU 明细 popOrders=1 / popGmv=1599.99（量级一致）；
   *           若误按日均×30 会把 1 单算成 30 单。
   *
   *  C) **比率 / 存量指标**：按段天数做加权平均
   *     popAverageSessionDuration / popPdpUvToAtcUvConversionRate /
   *     popPdpUvToPaidUserConversionRate / popAverageRevenuePerPaidUser / popStockUnits
   *
   *  同理 trafficAnalytics.detail（渠道）也走 A 口径。
   */
  // ⚠️ popKeywordPdpUv 也是「每日均值」：实测 UK Σ(关键词日均)=2.77 vs 站点日均 4.62
  //    （差额来自只取 Top100 的长尾截断），量级一致 → 同样要 × 天数才是区间合计。
  const PERDAY_METRICS = new Set(['popPdpUv', 'popPdpPv', 'popAtcUv', 'popAtcUnits', 'popKeywordPdpUv', 'popKeywordPdpPv']);
  const TOTAL_METRICS = new Set(['popOrders', 'popSoldUnits', 'popGmv']);

  /**
   * 周区间切分（与 build_joybuy_dashboard.py 的 week_of 完全同口径）
   * 周六 ~ 周五 为一周，周号取该周**周五**所在 ISO 周。
   * 注意首周会被窗口起点裁掉（窗口 05-29 起 → W22 只有 1 天），
   * 所以 days 必须按实际裁剪后的天数算，不能一律 7 —— 流量类是日均，乘错就偏。
   */
  function weekRanges(startDate, endDate) {
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const s0 = parse(startDate), e0 = parse(endDate);
    // 回退到所在周的周六
    const dow = s0.getDay();                 // 周日=0 … 周六=6
    const back = (dow - 6 + 7) % 7;
    let cur = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() - back);
    const out = [];
    while (cur <= e0) {
      const wEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 6);   // 周五
      const a = cur < s0 ? s0 : cur;
      const b = wEnd > e0 ? e0 : wEnd;
      if (a <= b) {
        // ISO 周号取该周周五所在周
        const thu = new Date(wEnd.getFullYear(), wEnd.getMonth(), wEnd.getDate() - 1);
        const jan1 = new Date(thu.getFullYear(), 0, 1);
        const iso = Math.floor((thu - jan1) / 86400000 / 7) + 1;
        out.push({
          key: 'W' + String(iso).padStart(2, '0'),
          label: 'W' + iso + ' (' + fmt(cur).slice(5) + '~' + fmt(wEnd).slice(5) + ')',
          weekStart: fmt(cur), weekEnd: fmt(wEnd),
          startDate: fmt(a), endDate: fmt(b),
          days: Math.round((b - a) / 86400000) + 1,
        });
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    }
    return out;
  }

  /** 把一批 detail 行按 __wsum/__days 收敛成最终值（与 detailChunked 同一套口径） */
  function finalizeDetail(byKey, groupKey) {
    return [...byKey.values()].map(row => {
      const o = {};
      for (const [kk, vv] of Object.entries(row)) {
        if (kk === '__wsum' || kk === '__days') continue;
        if (vv === null && row.__wsum && kk in row.__wsum) {
          o[kk] = row.__days ? +(row.__wsum[kk] / row.__days).toFixed(4) : null;
        } else o[kk] = vv;
      }
      return o;
    });
  }

  /**
   * 把一行 detail 累加进 byKey。
   *
   * ⚠️ 坑（曾导致整整一期数据错到 2 倍，务必看懂再改）：
   * 累加器**不能**用 `Object.assign({}, row, ...)` 播种 —— 那样会把 row 自己的数值先填进去，
   * 紧接着的循环又加一遍，于是「第一次遇到某 key」就多算一份：
   *   · 交易类 popOrders/popGmv/popSoldUnits → vv + vv = **2vv**（订单 3 变 6）
   *   · 流量类 popPdpUv 等（日均×天数）    → vv + vv×days = **vv×(days+1)**
   *     周查 = 8/7 = +14.3%，30 天段 = 31/30 = +3.3% → 整段与按周求和差 +12.9%
   *     （这个偏差看起来「只是个零头」，很容易被当成四舍五入放过去）
   *   · 比率类走 __wsum 分支，播种值被 null 覆盖，所以**唯独它没错** —— 更迷惑人。
   * 正确做法：播种时**只带非数值字段**（skuName/color 这些展示用字段），数值一律交给循环累加。
   */
  function accDetailRow(byKey, row, groupKey, days) {
    const k = row[groupKey] != null ? String(row[groupKey]) : JSON.stringify(row).slice(0, 60);
    let acc = byKey.get(k);
    if (!acc) {
      acc = { __wsum: {}, __days: 0 };
      for (const [kk, vv] of Object.entries(row)) if (typeof vv !== 'number') acc[kk] = vv;
      byKey.set(k, acc);
    }
    for (const [kk, vv] of Object.entries(row)) {
      if (typeof vv !== 'number') continue;
      if (TOTAL_METRICS.has(kk)) acc[kk] = +((acc[kk] || 0) + vv).toFixed(4);
      else if (PERDAY_METRICS.has(kk)) acc[kk] = +((acc[kk] || 0) + vv * days).toFixed(4);
      else { acc.__wsum[kk] = (acc.__wsum[kk] || 0) + vv * days; acc[kk] = null; }
    }
    acc.__days += days;
    return acc;
  }

  /**
   * SKU × 周 明细（看板所有「按产品维度筛选」的数据基础）
   *
   * 为什么必须单独拉：productsAnalytics.detail 整段查询只给**区间聚合值**，没有时间维度，
   * 所以「产品系列 / 产品名 / SKU」筛选根本无法作用到周趋势上。
   * 改为按周逐次查询（每周 ≤7 天，天然满足 30 天上限），即可得到 SKU × 周 × 站点 矩阵。
   *
   * 成本：站点数 × 周数 次调用（4×18=72 次，约 2 分钟）。
   */
  async function skuWeeklyChunked(cfg, D1) {
    const weeks = weekRanges(range.startDate, range.endDate);
    const cells = [];
    const seen = new Map();       // skuId -> skuName/color（跨周补齐，某周无数据也要有名称）
    let okWeeks = 0, lastErr = null;
    for (const w of weeks) {
      const r = await raw('dsm.compass.pop.productsAnalytics.detail', Object.assign({}, D1, {
        startDate: w.startDate, endDate: w.endDate,
        comparisonStartDate: w.endDate, comparisonEndDate: w.endDate,
        sortBy: 'popPdpUv', sortOrder: 0, currentPage: 1, pageSize: 200,
        groupBy: 'skuIds', skuIds: [], ifTotalData: true,
        indicators: SKU_IND, report: 'POP_PRODUCTS_ANALYTICS', chart: 'POP_PRODUCT_ANALYTICS_DETAIL',
      }));
      if (!isOk(r)) { lastErr = (r.json && (r.json.msg || r.json.code)) || r.status; await sleep(200); continue; }
      okWeeks++;
      for (const row of ((r.json.data || {}).data || [])) {
        if (!row || row.skuId == null) continue;
        const byKey = new Map();
        const acc = accDetailRow(byKey, row, 'skuId', w.days);
        const fin = finalizeDetail(byKey, 'skuId')[0];
        const id = String(row.skuId);
        if (!seen.has(id)) seen.set(id, { skuId: id, skuName: row.skuName || '', color: row.color || '', upc: row.upc || '', image: row.skuIdImage || '' });
        cells.push(Object.assign({ skuId: id, week: w.key }, fin));
      }
      await sleep(250);
    }
    return { weeks, cells, skusMeta: [...seen.values()], okWeeks, totalWeeks: weeks.length, err: okWeeks ? null : lastErr };
  }

  async function detailChunked(api, base, extra, groupKey) {
    const segs = chunkRange(range.startDate, range.endDate, TREND_MAX_DAYS);
    const byKey = new Map();
    let currencyUnit = null, lastErr = null, usedSegs = 0, totalDays = 0;
    for (const s of segs) {
      const body = Object.assign({}, base, {
        startDate: s.startDate, endDate: s.endDate,
        comparisonStartDate: s.endDate, comparisonEndDate: s.endDate,
      }, extra);
      const r = await raw(api, body);
      if (!isOk(r)) { lastErr = (r.json && (r.json.msg || r.json.code)) || r.status; await sleep(300); continue; }
      const d = r.json.data || {};
      if (d.currencyUnit) currencyUnit = d.currencyUnit;
      const days = diffDays(s.startDate, s.endDate) + 1;
      usedSegs++; totalDays += days;
      for (const row of (d.data || [])) accDetailRow(byKey, row, groupKey, days);
      await sleep(300);
    }
    const data = finalizeDetail(byKey, groupKey);
    return {
      totalCount: data.length, currentPage: 1, data, currencyUnit,
      segs: usedSegs, days: totalDays, agg: 'mixed(perday×days / total / weighted-rate)',
      err: data.length ? null : lastErr,
    };
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: 'partner.joybuy.com / Data Compass (DSM gateway)',
    // 'http-session' = 纯 HTTP（会话文件，零浏览器）／ 'cdp-browser' = 借道已登录调试浏览器
    mode: httpMode ? 'http-session' : 'cdp-browser',
    sessionSavedAt: httpMode && sess ? sess.savedAt : null,
    shop: 'Aliencell',
    belongBizId: BELONG_BIZ,
    range,
    trendMaxDays: TREND_MAX_DAYS,
    shops: {},
  };

  for (const key of shopKeys) {
    const cfg = SHOPS[key];
    log('\n──── ' + key + ' (' + cfg.siteCode + ' / ' + cfg.shopId + ') ────');

    const sw = await switchShop(cfg.shopId, BELONG_BIZ).catch(e => ({ err: e.message }));
    const cur = (sw && sw.data && sw.data.shopId) || '?';
    const sc = sw && sw.__setCookieChanged;
    log('  切换店铺 ->', cur, cur === cfg.shopId ? '✓' : '✗',
      (sc && sc.length) ? '（会话已更新: ' + sc.join(',') + '）' : '');
    await sleep(1000);

    const entry = { siteCode: cfg.siteCode, shopId: cfg.shopId, currency: cfg.currency };
    const T = { platforms: [], userRegionIds: [], userCountryIds: [], allShops: '0', currency: cfg.currency, languageCode: LANG };
    const D1 = { currency: cfg.currency, languageCode: LANG, allShops: '0' };

    const report = (name, val) => {
      if (val && (Array.isArray(val.currentData) || Array.isArray(val.data))) {
        entry[name] = val;
        const n = val.currentData ? val.currentData.length + ' 天' : val.data.length + ' 条';
        log('  ✓ ' + name.padEnd(18) + n + (val.err ? '  (部分段失败: ' + val.err + ')' : ''));
      } else {
        entry[name] = null;
        entry[name + '_error'] = (val && val.err) || 'empty';
        log('  ✗ ' + name.padEnd(18) + (val && val.err ? val.err : 'empty'));
      }
    };

    report('trafficTrend', await trendChunked('dsm.compass.pop.traffic.queryTrend', T,
      { datePickerType: 'daterange', groupType: 0, indicators: TRAFFIC_IND, report: 'POP_TRAFFIC', chart: 'POP_TRAFFIC_SUMMARY' }));

    report('productTrend', await trendChunked('dsm.compass.pop.products.queryTrend',
      { userRegionIds: [], userCountryIds: [], allShops: '0', currency: cfg.currency, languageCode: LANG },
      { indicators: PRODUCT_IND, report: 'POP_PRODUCTS', chart: 'POP_PRODUCT_SUMMARY' }));

    report('transactionTrend', await trendChunked('dsm.compass.pop.transactions.queryTrend', T,
      { groupType: 0, indicators: TRANSACTION_IND, report: 'POP_TRANSACTIONS', chart: 'POP_TRANSACTION_SUMMARY' }));

    report('channels', await detailChunked('dsm.compass.pop.trafficAnalytics.detail', T,
      { indicators: ['popPdpUv', 'popPdpPvToOrdersConversionRate'], groupBy: 'searchChannels', sortBy: 'popPdpUv', sortOrder: 0, pageSize: 50, report: 'POP_TRAFFIC', chart: 'POP_TRAFFIC_ANALYTICS_CHANNEL_DETAIL' },
      'searchChannel'));

    // ⚠️ 坑：搜索词的分组键是 groupBy:"keywords"（**不是** searchKeywords，后者返回 -1 System Error），
    //    指标键也要换成 popKeywordPdpUv / popKeywordPdpPvToOrdersConversionRate，
    //    返回行里的词字段叫 keyword。
    report('searchTerms', await detailChunked('dsm.compass.pop.trafficAnalytics.detail', T,
      { indicators: ['popKeywordPdpUv', 'popKeywordPdpPvToOrdersConversionRate'], groupBy: 'keywords', sortBy: 'popKeywordPdpUv', sortOrder: 0, pageSize: 100, report: 'POP_TRAFFIC', chart: 'POP_TRAFFIC_ANALYTICS_KEYWORD_DETAIL' },
      'keyword'));

    report('skuDetail', await detailChunked('dsm.compass.pop.productsAnalytics.detail', D1,
      { sortBy: 'popPdpUv', sortOrder: 0, currentPage: 1, pageSize: 50, groupBy: 'skuIds', skuIds: [], ifTotalData: true, indicators: SKU_IND, report: 'POP_PRODUCTS_ANALYTICS', chart: 'POP_PRODUCT_ANALYTICS_DETAIL' },
      'skuId'));

    // SKU × 周 明细 —— 看板「产品系列 / 产品名 / SKU / 周数」筛选的数据基础
    const wkN = weekRanges(range.startDate, range.endDate).length;
    if (!skipWeekly) {
      const sw = await skuWeeklyChunked(cfg, D1);
      if (sw.cells.length) {
        entry.skuWeekly = sw;
        log('  ✓ ' + 'skuWeekly'.padEnd(18) + sw.cells.length + ' 格 (' + sw.okWeeks + '/' + sw.totalWeeks + ' 周 × ' + sw.skusMeta.length + ' SKU)');
        // 收尾自检：按周求和必须回到整段聚合值，否则说明周区间切分或口径还原有偏差
        const sum = (arr, k) => +arr.reduce((a, r) => a + (Number(r[k]) || 0), 0).toFixed(2);
        const whole = (entry.skuDetail && entry.skuDetail.data) || [];
        const chk = ['popGmv', 'popOrders', 'popPdpUv'];
        const cmpOut = chk.map(k => {
          const a = sum(sw.cells, k), b = sum(whole, k);
          const dev = b ? Math.abs(a - b) / b * 100 : (a ? 100 : 0);
          return k + ' 周合计=' + a + ' 整段=' + b + (dev < 1 ? ' ✓' : ' ⚠偏差' + dev.toFixed(1) + '%');
        });
        log('    自检 ' + cmpOut.join(' ｜ '));
      } else {
        entry.skuWeekly = null; entry.skuWeekly_error = sw.err || 'empty';
        log('  ✗ ' + 'skuWeekly'.padEnd(18) + (sw.err || 'empty'));
      }
    } else {
      entry.skuWeekly = null; entry.skuWeekly_error = 'skipped(--no-weekly)';
      log('  – ' + 'skuWeekly'.padEnd(18) + '已跳过 (--no-weekly，共 ' + wkN + ' 周)');
    }

    // 汇总接口：单日查询即可，用于「最新一天」卡片
    for (const [name, api, body, rep] of [
      ['trafficSummary', 'dsm.compass.pop.traffic.querySummary', { platforms: [], userRegionIds: [], userCountryIds: [] }, 'POP_TRAFFIC'],
      ['productSummary', 'dsm.compass.pop.products.querySummary', { userRegionIds: [], userCountryIds: [] }, 'POP_PRODUCTS'],
      ['transactionSummary', 'dsm.compass.pop.transactions.querySummary', { platforms: [], groupType: 0 }, 'POP_TRANSACTIONS'],
    ]) {
      const chart = rep === 'POP_TRAFFIC' ? 'POP_TRAFFIC_SUMMARY' : rep === 'POP_PRODUCTS' ? 'POP_PRODUCT_SUMMARY' : 'POP_TRANSACTION_SUMMARY';
      const r = await raw(api, Object.assign({}, body, {
        allShops: '0', currency: cfg.currency, languageCode: LANG,
        startDate: range.endDate, endDate: range.endDate,
        indicators: rep === 'POP_TRAFFIC' ? TRAFFIC_IND : rep === 'POP_PRODUCTS' ? PRODUCT_IND : TRANSACTION_IND,
        report: rep, chart,
      }));
      if (isOk(r)) { entry[name] = r.json.data; log('  ✓ ' + name.padEnd(18) + Object.keys(r.json.data || {}).length + ' 字段'); }
      else { entry[name] = null; entry[name + '_error'] = (r.json && r.json.msg) || r.status; log('  ✗ ' + name.padEnd(18) + ((r.json && r.json.msg) || r.status)); }
      await sleep(300);
    }

    out.shops[key] = entry;
  }

  // ── 防串站自检（2026-10-02 新增，先算后写盘）─────────────────────
  // 背景：切店铺靠**服务端会话**生效（Set-Cookie 里的 b_belong）。会话没更新时，
  // 所有站点会**静默返回同一个站的数据** —— 每个接口都 200、每站都"有数据"、
  // summary 也看不出问题，只有 SKU 集合能暴露它（实测 UK 请求拿到了 19 个 FR 的 SKU）。
  const skuSetOf = k => new Set(
    (((out.shops[k] || {}).skuDetail || {}).data || []).map(r => String(r.skuId || r.sku || r.itemId)));
  const ks = Object.keys(out.shops);
  const skuCounts = {};
  ks.forEach(k => { skuCounts[k] = skuSetOf(k).size; });
  const dupPairs = [];
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = skuSetOf(ks[i]), b = skuSetOf(ks[j]);
      if (a.size > 2 && a.size === b.size && [...a].every(x => b.has(x))) dupPairs.push(ks[i] + '/' + ks[j]);
    }
  }
  out.selfCheck = { mode: out.mode, skuCounts, crossSiteDuplicateSkuSets: dupPairs };

  const outPath = (outArg && typeof outArg === 'string') ? path.resolve(outArg) : OUT;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  log('\n✅ 已写入 ' + outPath + '  (' + size + ' KB)');
  const okc = Object.values(out.shops).filter(s => s.trafficTrend && s.trafficTrend.currentData.length).length;
  log('   趋势数据可用站点 ' + okc + '/' + shopKeys.length);
  log('   各站 SKU 数自检 ' + ks.map(k => k + ':' + skuCounts[k]).join(' ｜ '));
  if (dupPairs.length) {
    log('  ⚠️ 防串站自检**失败**：以下站点 SKU 集合完全相同 → 店铺切换很可能没生效：' + dupPairs.join(', '));
    log('     排查：① 纯 HTTP 模式确认 httpSwitch 收到了 Set-Cookie（b_belong）；② 浏览器模式确认 --keep 实例存活未被并发会话杀掉。');
    log('     本次数据可能多站同源，**不要用于构建看板**。');
    process.exit(4);
  }
  log('   防串站自检 ✓ 各站 SKU 集合互不相同');
  process.exit(0);
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(2); });
