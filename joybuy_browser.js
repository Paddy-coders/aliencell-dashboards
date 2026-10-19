// JoyBuy 调试浏览器：启动独立 Edge 调试实例 -> 打开开放平台 -> 输出当前登录状态
// 用法: node joybuy_browser.js            仅启动并打开首页（默认无窗口 headless）
//       node joybuy_browser.js <url>      打开指定 URL
//       node joybuy_browser.js --state    仅输出当前状态（不导航）
//       node joybuy_browser.js --keep     保持浏览器运行（登录态落在 profile 目录）
//       node joybuy_browser.js --headful  有界面模式（仅首次人工登录时用）
//       node joybuy_browser.js --stop     停止当前调试实例（含自愈进程）并释放端口
// 退出码: 0=已登录/正常  3=需登录  2=异常
//
// 坑位备忘：
//  1) 本机环境变量 HTTP_PROXY/HTTPS_PROXY 会让 Playwright 的 connectOverCDP 走代理，
//     访问 127.0.0.1:9333 时被代理解析成 502。必须在 require 前清掉（见下方 unsetProxies）。
//  2) 调试实例必须 detached 启动且父进程常驻；命令一结束，子进程会被一并回收 → 端口变 ECONNREFUSED。
//     若要跨命令复用同一个已登录浏览器，用 `... --keep` 放在后台任务里跑。
//  3) 【2026-09-28 修复】--keep 模式原先仍会 process.exit()，父进程一退，宿主回收进程树把调试 Edge
//     一并杀掉（现象：ok=true 后几十秒端口失联）。现已改为「父进程常驻 + 30s 心跳自愈」。
//  4) 【2026-10-19 修复】--keep 原用有界面 Edge，且心跳自愈会在用户关窗后 20s 把窗口重新弹出来，
//     表现为「每次跑测试都自动弹出商家后台、关掉又弹」。现改为**默认 headless（零窗口）**：
//     profile 与登录态完全复用，实测回归 86/86 全绿、后台登录态正常。只有真正需要人工登录时才
//     自动切换为有界面（或显式 --headful）。
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
const PIDFILE = path.join(__dirname, '.joybuy_browser.pid');

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

// ── 单实例锁：避免两个会话各起一个保活、互相抢同一 profile/端口（2026-09-28 的事故根因之一）──
function readPid() {
  try { return parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10) || null; } catch (e) { return null; }
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}
function writePid() { try { fs.writeFileSync(PIDFILE, String(process.pid), 'utf8'); } catch (e) {} }
function clearPid() { try { fs.unlinkSync(PIDFILE); } catch (e) {} }

function startEdge({ headless = true } = {}) {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ];
  const exe = candidates.find(p => fs.existsSync(p));
  if (!exe) throw new Error('Edge 未找到');
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSyncService',
    '--disable-sync', '--lang=zh-CN', 'about:blank'
  ];
  // 无窗口模式：只影响「看得见」，profile / 登录态 / DOM / 截图全部照旧
  if (headless) args.unshift('--headless=new');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`[joybuy] Edge 启动中... port=${PORT} mode=${headless ? 'headless(无窗口)' : 'headful(有界面)'} profile=${PROFILE}`);
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

/** 显式停止：先停心跳保活进程（否则 30s 后它会把浏览器重新拉起来），再关浏览器 */
async function stopBrowser() {
  // 顺序很关键：必须先杀 --keep 的 node 进程，否则关掉浏览器后心跳自愈会立刻重开
  const keepPid = readPid();
  if (keepPid && keepPid !== process.pid && pidAlive(keepPid)) {
    try { process.kill(keepPid); } catch (e) {
      console.error('[joybuy] 结束保活进程失败:', e.message);
    }
    for (let i = 0; i < 20; i++) {
      if (!pidAlive(keepPid)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (pidAlive(keepPid)) console.error(`[joybuy] 保活进程 ${keepPid} 仍未退出（心跳可能仍在）`);
  }
  clearPid();

  if (!(await portOpen(PORT))) {
    console.log(JSON.stringify({ ok: true, mode: 'already_stopped', port: PORT }));
    return 0;
  }
  // 注意：connectOverCDP 下的 browser.close() 只是「断开连接」，不会关掉浏览器进程。
  // 真正关闭要走 DevTools 的 Browser.close（实测有效）。
  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const bs = await b.newBrowserCDPSession();
    await bs.send('Browser.close');
  } catch (e) {
    console.error('[joybuy] 关闭失败:', e.message);
  }
  for (let i = 0; i < 20; i++) {           // 最多等 10s
    if (!(await portOpen(PORT, 1000))) {
      clearPid();
      console.log(JSON.stringify({ ok: true, mode: 'stopped', port: PORT }));
      return 0;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.error(`[joybuy] 端口 ${PORT} 仍未释放；如需强制关闭，请手动结束该调试 Edge 主进程（勿关日常 Edge）`);
  console.log(JSON.stringify({ ok: false, mode: 'stop_failed', port: PORT }));
  return 2;
}

async function main() {
  const args = process.argv.slice(2);
  const stateOnly = args.includes('--state');
  const headful = args.includes('--headful');        // 显式有界面（首次人工登录）
  // --headful 隐含常驻：人工登录后还要能 --save-session 导出（浏览器一关就连不上 9333 了）
  const keep = args.includes('--keep') || headful;
  const headlessFlag = args.includes('--headless');  // 显式无窗口（默认）
  const stop = args.includes('--stop');
  const url = args.find(a => !a.startsWith('--')) || PORTAL;

  if (stop) return await stopBrowser();

  // 只允许一个保活实例：已有存活实例时直接复用，不再起第二个（避免互抢 profile/端口）
  const prev = readPid();
  if (keep && pidAlive(prev) && prev !== process.pid && (await portOpen(PORT))) {
    console.log(JSON.stringify({ ok: true, mode: 'already_running', pid: prev, port: PORT, reuse: true }));
    return 0;
  }

  let wantHeadless = !headful;

  let started = false;
  if (!(await portOpen(PORT))) { startEdge({ headless: wantHeadless }); started = true; }
  if (!(await waitPort(PORT, 40000))) {
    console.log(JSON.stringify({ ok: false, mode: 'edge_start_failed', error: `端口 ${PORT} 未就绪` }));
    process.exit(2);
  }

  let browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let ctx = browser.contexts()[0] || await browser.newContext();
  let page = ctx.pages().find(p => !/^about:blank/.test(p.url())) || ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  if (!stateOnly) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(e => console.error('[joybuy] goto 警告:', e.message));
    await page.waitForTimeout(6000);
  }

  let state = await readState(page);
  let needLogin = !!state.hasLoginWord && !/open-portal\.joybuy\.com\/#\/doc/.test(state.url);

  // 登录态失效时需要人看得到界面：headless 下自动切一次有界面，别让用户对着空气排查
  if (needLogin && wantHeadless && !headlessFlag) {
    console.error('[joybuy] 检测到需要登录 → 自动切换为有界面模式，请在弹出的窗口中完成登录');
    try { await browser.close(); } catch (e) {}
    await new Promise(r => setTimeout(r, 1500));
    startEdge({ headless: false });
    await waitPort(PORT, 40000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    ctx = browser.contexts()[0] || await browser.newContext();
    page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    state = await readState(page);
    needLogin = !!state.hasLoginWord && !/open-portal\.joybuy\.com\/#\/doc/.test(state.url);
    wantHeadless = false;
  }

  await page.screenshot({ path: path.join(__dirname, 'joybuy_state.png') }).catch(() => {});

  console.log(JSON.stringify({
    ok: !needLogin,
    mode: needLogin ? 'need_login' : 'ok',
    headless: wantHeadless,
    started,
    pid: process.pid,
    ...state
  }, null, 2));

  // --keep: 保持浏览器运行（登录态落在 PROFILE 目录）。
  // 关键坑（2026-09-28 实测）：必须让本 node 进程常驻，否则宿主在命令结束时回收其进程树，
  // 调试 Edge 会被一并杀掉 → 端口 9333 变 ECONNREFUSED（表现为「ok=true 之后几十秒就失联」）。
  // 因此 --keep 模式下不调用 browser.close()、不 process.exit()，改为心跳常驻。
  if (keep) {
    writePid();
    console.log(`[joybuy] --keep 常驻保活中（port=${PORT}, ${wantHeadless ? '无窗口' : '有界面'}）—— 请勿结束本进程；停止用 --stop`);
    let miss = 0, revive = 0;
    const tick = async () => {
      if (await portOpen(PORT)) { miss = 0; return; }
      miss++;
      // 自愈上限：连续 5 次拉不起来就退出，避免无限重试空转
      if (revive >= 5) {
        console.error(`[joybuy] 已连续自愈 ${revive} 次仍失联，停止保活（请检查 Edge 是否被安全软件拦截）`);
        clearPid();
        process.exit(2);
      }
      console.error(`[joybuy] 警告: 端口 ${PORT} 失联（第 ${miss} 次），自动拉起调试浏览器...`);
      try {
        startEdge({ headless: wantHeadless });
        if (!(await waitPort(PORT, 40000))) {
          console.error('[joybuy] 自动拉起失败: 端口仍未就绪');
          return;
        }
        revive++;
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
    setInterval(tick, 30000);
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
