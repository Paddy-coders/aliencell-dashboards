// JoyBuy 应用审核状态巡检
// 复用已运行的调试浏览器（CDP 9333）；若未运行则以独立 profile 启动一个。
// 用法: node joybuy_check_app_status.js [--headed] [--json]
// 输出 JSON: { ok, needLogin, appName, appStatus, appKey, approved, message }
// 退出码: 0=已通过(可继续)  3=需登录  4=仍在审核  2=异常
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = (process.env.CDP_PORT || '9333').replace('http://127.0.0.1:', '');
const PROFILE = process.env.PROFILE_DIR || 'C:/Users/paddy/.workbuddy/edge-joybuy';
const APP_LIST = 'https://console.joybuy.com/#/app/index';
const APP_NAME = 'iVANKY JoyBuy Data Sync';

const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[k];
  }
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};

function portOpen(port, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: timeoutMs }, res => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portOpen(port)) return true;
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}
function startEdge(headed) {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ];
  const exe = cands.find(p => fs.existsSync(p));
  if (!exe) throw new Error('未找到 Edge');
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--lang=zh-CN'
  ];
  if (!headed) args.push('--headless=new', '--disable-gpu');
  args.push('about:blank');
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
}

function out(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

async function main() {
  unsetProxies();
  const headed = process.argv.includes('--headed');
  const { chromium } = require('playwright');

  const needStart = !(await portOpen(PORT));
  if (needStart) {
    if (fs.existsSync(path.join(PROFILE, 'SingletonLock'))) {
      // 残留锁：尽力清理，避免复用 profile 失败
      try { fs.unlinkSync(path.join(PROFILE, 'SingletonLock')); } catch (e) {}
    }
    startEdge(headed);
    if (!(await waitPort(PORT, 45000))) {
      out({ ok: false, error: `CDP 端口 ${PORT} 未就绪`, needLogin: null }, 2);
    }
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  let page = ctx.pages().find(p => /console\.joybuy\.com/.test(p.url())) || ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  await page.goto(APP_LIST, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000);

  const info = await page.evaluate((appName) => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    const idx = text.indexOf(appName);
    const seg = idx >= 0 ? text.slice(idx, idx + 400) : '';
    const statusM = seg.match(/Pending Review|Approved|Review Passed|Rejected|Review Failed|Passed|已通过|审核中|审核通过|审核失败/i);
    const keyM = seg.match(/appKey\s*([A-Za-z0-9]{8,}|N\/A)/i);
    return {
      url: location.href,
      loggedIn: !/seller\/login|account\.joybuy\.com/i.test(location.href)
        && document.querySelectorAll('input[type=password]').length === 0,
      appFound: idx >= 0,
      status: statusM ? statusM[0] : null,
      appKey: keyM ? keyM[1] : null,
      snippet: seg.slice(0, 260)
    };
  }, APP_NAME);

  // 注意：不要在这个页面做截图。实测 console.joybuy.com 会让 Playwright 的 screenshot 卡在
  // "waiting for fonts to load"，连 CDP 的 Page.captureScreenshot 也会挂住，把整个巡检拖到超时。
  // 巡检只做只读取值，不截图。
  //
  // 只有「本次自己启动的」浏览器才关掉；复用到用户正开着的调试窗口时只断开连接，
  // 否则会把用户正在用的窗口一起关掉。
  if (needStart) { try { await browser.close(); } catch (e) {} }

  if (!info.loggedIn) {
    out({ ok: false, needLogin: true, message: '调试浏览器登录态已失效，需要重新登录 JoyBuy 商家账号', ...info }, 3);
  }
  if (!info.appFound) {
    out({ ok: false, needLogin: false, message: '未在应用列表找到目标应用（可能页面未加载完）', ...info }, 2);
  }

  const approved = !!info.status && !/Pending Review|审核中/i.test(info.status)
    && !!info.appKey && info.appKey !== 'N/A';

  out({
    ok: approved,
    needLogin: false,
    approved,
    appName: APP_NAME,
    appStatus: info.status,
    appKey: info.appKey,
    message: approved
      ? `应用已通过审核，appKey = ${info.appKey}。下一步：进应用详情取 appSecret → 申请权限包 → 添加服务对象 + 一键授权。`
      : `应用仍在审核中（状态 ${info.status || '未知'}），appKey 尚未发放。`,
    snippet: info.snippet
  }, approved ? 0 : 4);
}

main().catch(e => {
  console.error('[check] FATAL:', e && e.message);
  out({ ok: false, error: e && e.message }, 2);
});
