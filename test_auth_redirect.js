/* 邮件回跳地址测试: 注册请求自带 redirect_to = 本页地址
 *
 * 背景: 同一个 Supabase 项目下可能有多个前端(本站点、电商活动日历等)。
 * Site URL 是【项目级】配置、只有一个值, 靠它决定邮件回跳会让多个应用互相抢 ——
 * 填谁, 另一个应用的注册者就落错页面(令牌还会在对方页面把会话建起来)。
 * 所以每个前端在注册请求里自带自己的地址, Site URL 退化为兜底。
 *
 * 为什么起本地 http 服务: 实际部署是 http(s), 而 selfUrl() 在 file:// 下刻意返回空串
 * (让 file:// 打开的本地回归测试不依赖线上 URL Configuration) —— 用 file:// 测不到这个参数。
 *
 * 全程拦截认证请求, 不触达真实 Supabase(不会真建账号)。
 */
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const DIR = path.resolve(__dirname, '_deploy');
const FILE_BASE = 'file:///' + DIR.replace(/\\/g, '/');
const EXPECT_PATH = '/login.html';   // 回跳目标: 接住邮件令牌的 hash 处理逻辑就在 login.html 里

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json' };
function serve() {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rq) => {
      const p = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p, (e, buf) => {
        if (e) { rq.writeHead(404); return rq.end('not found'); }
        rq.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        rq.end(buf);
      });
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

/* 注册表单字段是 #regEmail/#regPassword/#regPassword2;
   登录表单才是 #email/#password —— 两者在各自模式下 display:none, 填错会静默超时 */
async function doSignup(page) {
  await page.click('#linkToSignup');
  await page.waitForTimeout(200);
  await page.fill('#regEmail', 'someone@aliencell.com');
  await page.fill('#regPassword', 'abc12345');
  await page.fill('#regPassword2', 'abc12345');
  await page.click('#btnSignup');
  await page.waitForTimeout(600);
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  // ---- A. 真实部署形态(http): 注册请求自带 redirect_to, 精确等于本页地址 ----
  console.log('\n[A] http 部署形态下的注册回跳地址');
  {
    const page = await browser.newPage();
    const seen = { signup: [], token: [], rest: 0 };
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));

    await page.route('**/auth/v1/**', route => {
      const u = route.request().url();
      if (/\/signup/.test(u)) seen.signup.push(u);
      else if (/\/token/.test(u)) seen.token.push(u);
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.route('**/rest/v1/**', route => { seen.rest++; return route.fulfill({ status: 200, body: '[]' }); });

    await page.goto(origin + '/login.html');
    await doSignup(page);

    t('注册请求只发出一次', seen.signup.length === 1, seen.signup);

    let rt = null;
    try { rt = new URL(seen.signup[0]).searchParams.get('redirect_to'); } catch (e) {}
    t('注册请求带上了 redirect_to 参数', rt !== null, { url: seen.signup[0] });
    t('redirect_to 精确等于本站注册入口', rt === origin + EXPECT_PATH, { got: rt, want: origin + EXPECT_PATH });
    t('redirect_to 是绝对 http(s) 地址', /^https?:\/\//.test(rt || ''), { rt });
    t('redirect_to 不含 query / hash 残留', !!rt && !/[?#]/.test(rt), { rt });
    t('redirect_to 结尾无多余斜杠', !!rt && !/\/$/.test(rt.replace(/^https?:\/\//, '')), { rt });
    t('未登录注册流程不触发数据请求', seen.rest === 0, { rest: seen.rest });
    t('无页面脚本报错', errs.length === 0, errs.slice(0, 2));
    await page.close();
  }

  // ---- B. 参数只加在注册上, 登录请求不受影响 ----
  console.log('\n[B] 登录请求不受影响（参数只加在 signup 上）');
  {
    const page = await browser.newPage();
    const seen = { signup: [], token: [] };
    await page.route('**/auth/v1/**', route => {
      const u = route.request().url();
      if (/\/signup/.test(u)) seen.signup.push(u);
      else if (/\/token/.test(u)) seen.token.push(u);
      return route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(origin + '/login.html');
    await page.fill('#email', 'someone@aliencell.com');
    await page.fill('#password', 'abc12345');
    await page.click('#btnLogin');
    await page.waitForTimeout(600);

    t('登录请求已发出', seen.token.length >= 1, seen.token);
    t('登录请求不带 redirect_to', seen.token.every(u => !/redirect_to=/.test(u)), seen.token);
    t('登录时未误发注册请求', seen.signup.length === 0, seen.signup);
    await page.close();
  }

  // ---- C. file:// 下不带参数, 保证本地其它回归测试不依赖线上配置 ----
  console.log('\n[C] file:// 下不带该参数');
  {
    const page = await browser.newPage();
    let count = 0, url = '';
    await page.route('**/auth/v1/**', route => {
      const u = route.request().url();
      if (/\/signup/.test(u)) { count++; url = u; }
      return route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(FILE_BASE + '/login.html');
    await doSignup(page);

    t('file:// 下注册请求仍发出', count === 1, { count, url });
    t('file:// 下不带 redirect_to（不依赖线上 URL Configuration）', count === 1 && !/redirect_to=/.test(url), { url });
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
