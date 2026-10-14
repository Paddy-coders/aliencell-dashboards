// JoyBuy 开放平台调试浏览器：启动独立 Edge 调试实例 -> 打开开放平台 -> 输出当前登录状态
// 用法: node joybuy_browser.js            仅启动并打开首页
//       node joybuy_browser.js <url>      打开指定 URL
//       node joybuy_browser.js --state    仅输出当前状态（不导航）
//       node joybuy_browser.js --keep     保持浏览器运行（登录态落在 profile 目录）
// 退出码: 0=已登录  3=需登录  2=异常
//
// 坑位备忘：
//  1) 本机环境变量 HTTP_PROXY/HTTPS_PROXY 会让 Playwright 的 connectOverCDP 走代理，
//     访问 127.0.0.1:9333 时被代理解析成 502。必须在 require 前清掉（见下方 unsetProxies）。
//  2) 调试实例必须 detached 启动且父进程常驻；命令一结束，子进程会被一并回收 → 端口变 ECONNREFUSED。
//     若要跨命令复用同一个已登录浏览器，用 `... --keep; sleep 3600` 放在后台任务里跑。
//  3) 【2026-09-28 修复】--keep 模式原先仍会 process.exit()，父进程一退，宿主回收进程树把调试 Edge
//     一并杀掉（现象：ok=true 后几十秒端口失联）。现已改为「父进程常驻 + 20s 心跳自愈」：
//     端口失联即自动重新拉起 Edge 并导航回开放平台，登录态来自 PROFILE 目录不会丢。
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[k];
  }
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = (process.env.CDP_PORT || '9333').replace('http://127.0.0.1:', '');
const PROFILE = process.env.PROFILE_DIR || 'C:/Users/paddy/.workbuddy/edge-joybuy';
const PORTAL = 'https://open-portal.joybuy.com/';

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
function startEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ];
  const exe = candidates.find(p => fs.existsSync(p));
  if (!exe) throw new Error('Edge 未找到');
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSyncService',
    '--disable-sync', '--lang=zh-CN', 'about:blank'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`[joybuy] Edge 启动中... port=${PORT} profile=${PROFILE}`);
}

async function readState(page) {
  return await page.evaluate(() => {
    const txt = (document.body && document.body.innerText || '').slice(0, 4000);
    const loginish = /登录|Sign in|Log in|Login/i.test(txt);
    const loggedish = /退出|Log out|Sign out|Console|控制台|应用|Application/i.test(txt);
    return {
      url: location.href,
      title: document.title,
      hasLoginWord: loginish,
      hasLoggedWord: loggedish,
      excerpt: txt.replace(/\s+/g, ' ').slice(0, 600),
      lsKeys: Object.keys(localStorage || {}).slice(0, 40)
    };
  }).catch(e => ({ error: e.message }));
}

async function main() {
  const args = process.argv.slice(2);
  const stateOnly = args.includes('--state');
  const keep = args.includes('--keep');
  const url = args.find(a => !a.startsWith('--')) || PORTAL;

  let started = false;
  if (!(await portOpen(PORT))) { startEdge(); started = true; }
  if (!(await waitPort(PORT, 40000))) {
    console.log(JSON.stringify({ ok: false, mode: 'edge_start_failed', error: `端口 ${PORT} 未就绪` }));
    process.exit(2);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  let page = ctx.pages().find(p => !/^about:blank/.test(p.url())) || ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  if (!stateOnly) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(e => console.error('[joybuy] goto 警告:', e.message));
    await page.waitForTimeout(6000);
  }

  const state = await readState(page);
  await page.screenshot({ path: path.join(__dirname, 'joybuy_state.png') }).catch(() => {});

  const needLogin = !!state.hasLoginWord && !/open-portal\.joybuy\.com\/#\/doc/.test(state.url);
  console.log(JSON.stringify({ ok: !needLogin, mode: needLogin ? 'need_login' : 'ok', started, ...state }, null, 2));

  // --keep: 保持浏览器运行（登录态落在 PROFILE 目录）。
  // 关键坑（2026-09-28 实测）：必须让本 node 进程常驻，否则宿主在命令结束时回收其进程树，
  // 调试 Edge 会被一并杀掉 → 端口 9333 变 ECONNREFUSED（表现为「ok=true 之后几十秒就失联」）。
  // 因此 --keep 模式下不调用 browser.close()、不 process.exit()，改为心跳常驻。
  if (keep) {
    console.log(`[joybuy] --keep 常驻保活中（port=${PORT}）—— 请勿结束本进程`);
    let miss = 0;
    const tick = async () => {
      if (await portOpen(PORT)) { miss = 0; return; }
      miss++;
      console.error(`[joybuy] 警告: 端口 ${PORT} 失联（第 ${miss} 次），自动拉起调试浏览器...`);
      try {
        startEdge();
        if (!(await waitPort(PORT, 40000))) {
          console.error('[joybuy] 自动拉起失败: 端口仍未就绪');
          return;
        }
        const b2 = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
        const c2 = b2.contexts()[0] || await b2.newContext();
        const p2 = c2.pages().find(p => !/^about:blank/.test(p.url())) || c2.pages()[0] || await c2.newPage();
        await p2.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        const st2 = await readState(p2);
        console.error(`[joybuy] 已重新拉起: ok=${!st2.hasLoginWord} url=${st2.url}`);
        miss = 0;
      } catch (e) {
        console.error('[joybuy] 自动拉起异常:', e.message);
      }
    };
    setInterval(tick, 20000);
    return;
  }
  try { await browser.close(); } catch (e) {}
  process.exit(needLogin ? 3 : 0);
}

main().catch(e => {
  console.error('[joybuy] FATAL:', e);
  console.log(JSON.stringify({ ok: false, mode: 'exception', error: e.message }));
  process.exit(2);
});
