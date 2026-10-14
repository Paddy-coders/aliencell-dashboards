// 易仓ERP 自动登录脚本（供每周一自动化任务使用）
// 功能: 自动启动Edge调试实例(独立profile, 不依赖手动开浏览器) -> 导航易仓入口 -> 若未登录则自动填表登录(默认登录模式, 不切ERP1.0、不填客户代码) -> 验证会话 -> 输出JSON状态
// 用法: node auto_login_eccang.js            (使用 eccang_creds.json 中的 port)
//       CDP_PORT=9223 node auto_login_eccang.js (覆盖端口)
// 退出码: 0=就绪(已登录或自动登录成功), 2=登录失败/异常
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'eccang_creds.json'), 'utf8'));
const PORT = (process.env.CDP_PORT || String(CONFIG.port || '9223')).replace('http://127.0.0.1:', '');
const PROFILE = CONFIG.profileDir;

// ---------- 端口探测 ----------
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

// ---------- 启动Edge调试实例 ----------
function startEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ];
  const exe = candidates.find(p => fs.existsSync(p));
  if (!exe) throw new Error('Edge 未找到，请检查安装路径');
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSyncService',
    '--disable-sync',
    'about:blank'
  ];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`[auto-login] Edge 启动中... port=${PORT} profile=${PROFILE}`);
}

// ---------- 判断当前是否登录页 ----------
async function isLoginPage(page) {
  return await page.locator('#userName').count().then(c => c > 0).catch(() => false);
}

// ---------- 关闭 Edge 首次启动"正在同步浏览数据"提示 ----------
// 提示文案(中/英): "我们现在正在你的所有设备上同步你的浏览数据" / "We're now syncing your browsing data"
// 按钮: "明白" / "Got it"
async function dismissSyncBanner(page) {
  const selectors = [
    'button:has-text("明白")',
    'button:has-text("Got it")',
    '[role="button"]:has-text("明白")',
    '[role="button"]:has-text("Got it")',
    'text=明白 >> xpath=..',
    'text=Got it >> xpath=..'
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 2000 }).catch(() => {});
        console.log(`[auto-login] 已点击同步提示按钮: ${sel}`);
        return true;
      }
    } catch (e) { /* 忽略单条失败 */ }
  }
  return false;
}

async function main() {
  // 1. 确保调试实例就绪
  let started = false;
  if (!(await portOpen(PORT))) { startEdge(); started = true; }
  if (!(await waitPort(PORT, 40000))) {
    console.log(JSON.stringify({ ok: false, mode: 'edge_start_failed', error: `端口 ${PORT} 未就绪，Edge 启动失败` }));
    process.exit(2);
  }

  // 2. 连接并打开入口页（使用默认会话，登录 cookie 持久化到 profile）
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.error('[auto-login] goto 警告:', e.message));
  await page.waitForTimeout(6000); // 等待可能的跳转/加载
  await dismissSyncBanner(page);   // 关闭 Edge 同步提示（若有）

  // 3. 判断登录状态
  let mode = 'logged_in';
  if (await isLoginPage(page)) {
    // 密码基础校验（按用户提供的字面密码使用，允许含"..."等特殊字符）
    if (!CONFIG.password || CONFIG.password.length < 6) {
      console.log(JSON.stringify({ ok: false, mode: 'config_error', error: '需要自动登录但密码为空或过短，请在 eccang_creds.json 中补全 password 字段' }));
      process.exit(2);
    }
    mode = 'auto_login';
    await page.fill('#userName', CONFIG.username);
    await page.fill('#password', CONFIG.password);
    // 触发 blur，确保前端表单状态同步
    await page.locator('#userName').evaluate(el => el.blur());
    await page.locator('#password').evaluate(el => el.blur());
    await page.waitForTimeout(1000);
    // 勾选"5天内自动登录"，延长会话持久
    const chk = page.locator('.home-ant-checkbox-input');
    if (await chk.count()) {
      try { if (!(await chk.isChecked())) await chk.check({ force: true }); } catch (e) { console.error('[auto-login] 勾选自动登录失败(可忽略):', e.message); }
    }
    // 点击主登录按钮（默认登录模式）。新版登录页主按钮是 a.ec-login-submit；
    // 兜底保留旧版 .home-ant-btn-primary 精确匹配"登录"，避免点到"ERP1.0客户登录"。
    const submitBtnNew = page.locator('a.ec-login-submit').first();
    const submitBtnOld = page.locator('.home-ant-btn-primary').filter({ hasText: /^登录$/ }).first();
    if (await submitBtnNew.count()) {
      await submitBtnNew.click();
    } else if (await submitBtnOld.count()) {
      await submitBtnOld.click();
    } else {
      await page.click('.home-ant-btn-primary'); // 兜底（有风险，尽量避免）
    }
    // 双保险：回车键提交
    await page.locator('#password').press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'login_click.png', fullPage: false }).catch(() => {});
    // 等待离开登录页（URL 不再含 /login，或 token 已写入）
    try {
      await page.waitForURL(u => !String(u.href).includes('/login'), { timeout: 30000 });
    } catch (e) {
      console.error('[auto-login] 等待跳转超时:', e.message);
      // 兜底：再等几秒看 token 是否已就绪（某些场景下登录成功但 URL 变化慢）
      await page.waitForTimeout(8000);
    }
    await page.waitForTimeout(8000);
  }

  // 4. 验证：URL 不在 /login 且 token 存在 → 就绪
  const url = page.url();
  const tokenPrefix = await page.evaluate(() => {
    try { return (localStorage.getItem('pro__Access-Token') || '').slice(0, 16); } catch { return ''; }
  }).catch(() => '');
  const title = await page.title().catch(() => '');
  const ok = !String(url).includes('/login') && !!tokenPrefix;
  const finalMode = (ok ? (mode === 'auto_login' ? 'auto_login' : 'logged_in') : (await isLoginPage(page) ? 'login_failed' : mode));

  await page.screenshot({ path: 'login_check.png', fullPage: false }).catch(() => {});
  console.log(JSON.stringify({ ok, mode: finalMode, started, url, title, tokenPrefix, hint: ok ? 'ready' : 'login_failed' }));

  // 保持登录页打开，供后续 fetch_daily_data.js 等脚本复用同一 CDP 会话；
  // 仅断开 Playwright 与 CDP 的连接，不关闭浏览器标签/上下文。
  await browser.close().catch(() => {});
  process.exit(ok ? 0 : 2);
}

main().catch(e => {
  console.error('[auto-login] FATAL:', e);
  console.log(JSON.stringify({ ok: false, mode: 'exception', error: e.message }));
  process.exit(2);
});
