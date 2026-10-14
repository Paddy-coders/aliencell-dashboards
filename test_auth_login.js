// test_auth_login.js — 认证登录功能测试
const { chromium } = require('playwright');

const BASE = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co';
let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS:', msg); }
  else { fail++; console.log('  FAIL:', msg, extra || ''); }
}

(async () => {
  const browser = await chromium.launch();

  // ---- Test 1: 无 token → 自动跳转 login.html ----
  {
    console.log('\n[Test 1] 无 token 自动跳转 login.html');
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => localStorage.clear());
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const url = page.url();
    ok(url.includes('login.html'), '无 token 跳转 login.html', { url });
    await ctx.close();
  }

  // ---- Test 2: login.html 渲染正确 ----
  {
    console.log('\n[Test 2] login.html 页面渲染');
    const page = await (await browser.newContext()).newPage();
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const title = await page.textContent('.logo-text');
    ok(title && title.includes('Aliencell'), 'Logo 文字显示');
    const emailInput = await page.$('#email');
    ok(!!emailInput, '邮箱输入框存在');
    const pwInput = await page.$('#password');
    ok(!!pwInput, '密码输入框存在');
    const btn = await page.$('#btnLogin');
    ok(!!btn, '登录按钮存在');
    await page.close();
  }

  // ---- Test 3: login.html?reason=timeout 显示超时提示 ----
  {
    console.log('\n[Test 3] 超时提示 banner');
    const page = await (await browser.newContext()).newPage();
    await page.goto(BASE + '/login.html?reason=timeout', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const banner = await page.$eval('#infoBanner', el => ({
      visible: el.style.display !== 'none' && el.classList.contains('show'),
      text: el.textContent
    }));
    ok(banner.visible && banner.text.includes('长时间未操作'), '超时提示显示', banner);
    await page.close();
  }

  // ---- Test 4: 密码显示切换 ----
  {
    console.log('\n[Test 4] 密码显示/隐藏切换');
    const page = await (await browser.newContext()).newPage();
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await page.fill('#password', 'test123');
    const pwTypeBefore = await page.$eval('#password', el => el.type);
    await page.click('#pwToggle');
    const pwTypeAfter = await page.$eval('#password', el => el.type);
    ok(pwTypeBefore === 'password' && pwTypeAfter === 'text', '密码切换为明文', { pwTypeBefore, pwTypeAfter });
    await page.click('#pwToggle');
    const pwTypeBack = await page.$eval('#password', el => el.type);
    ok(pwTypeBack === 'password', '密码切回隐藏');
    await page.close();
  }

  // ---- Test 5: 登录失败（无此用户）显示错误 ----
  {
    console.log('\n[Test 5] 登录失败错误提示');
    const page = await (await browser.newContext()).newPage();
    // 拦截 Supabase API 返回 401
    await page.route('**/auth/v1/token*', route => {
      route.fulfill({ status: 401, body: JSON.stringify({ code: 'invalid_credentials', message: 'Invalid credentials' }) });
    });
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await page.fill('#email', 'nobody@test.com');
    await page.fill('#password', 'wrongpass');
    await page.click('#btnLogin');
    await page.waitForTimeout(500);
    const errVisible = await page.$eval('#errorMsg', el => el.classList.contains('show'));
    const errText = await page.$eval('#errorMsg', el => el.textContent);
    ok(errVisible && errText.length > 0, '错误消息显示', { errText });
    // 按钮恢复
    const btnDisabled = await page.$eval('#btnLogin', el => el.disabled);
    ok(!btnDisabled, '登录按钮恢复可点击');
    await page.close();
  }

  // ---- Test 6: 管理员登录 → index.html 显示用户信息 + 映射入口 ----
  {
    console.log('\n[Test 6] 管理员登录后 index.html 状态');
    const ctx = await browser.newContext();
    // 拦截 Supabase Auth API 模拟登录成功
    await ctx.route('**/auth/v1/token*', route => {
      const req = route.request();
      if (req.method() === 'POST') {
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            access_token: 'fake-admin-token',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
            user: { id: 'user-001', email: 'admin@aliencell.com' }
          })
        });
      } else { route.continue(); }
    });
    // 拦截 profiles 查询返回 admin 角色
    await ctx.route('**/rest/v1/profiles*', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify([{ role: 'admin', email: 'admin@aliencell.com' }])
      });
    });
    // 拦截 GET /auth/v1/user 返回 200（token 有效）
    await ctx.route('**/auth/v1/user', route => {
      route.fulfill({ status: 200, body: JSON.stringify({ id: 'user-001', email: 'admin@aliencell.com' }) });
    });

    const page = await ctx.newPage();
    // Step 1: 登录
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await page.fill('#email', 'admin@aliencell.com');
    await page.fill('#password', 'adminpass');
    await page.click('#btnLogin');
    await page.waitForTimeout(800);

    // Step 2: 应跳转到 index.html
    const url = page.url();
    ok(url.includes('index.html'), '登录后跳转 index.html', { url });

    // Step 3: 用户信息显示
    const emailShown = await page.$eval('#userEmail', el => el.textContent).catch(() => '');
    ok(emailShown === 'admin@aliencell.com', '侧栏显示用户邮箱', { emailShown });

    const roleShown = await page.$eval('#userRole', el => ({ text: el.textContent, cls: el.className }));
    ok(roleShown.text === '管理员' && roleShown.cls.includes('admin'), '角色标签=管理员', roleShown);

    // Step 4: 映射管理按钮可见（admin）
    const mapBtnVisible = await page.$eval('.nav-map', el => el.style.display !== 'none');
    ok(mapBtnVisible, '管理员可见产品映射管理入口');

    // Step 5: 退出按钮存在
    const logoutBtn = await page.$('.btn-logout');
    ok(!!logoutBtn, '退出按钮存在');

    await ctx.close();
  }

  // ---- Test 7: 访客角色 → 映射管理可见（全体登录用户可用）----
  {
    console.log('\n[Test 7] 访客角色映射管理可见');
    const ctx = await browser.newContext();
    // 预设 viewer token
    await ctx.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({
        access_token: 'fake-viewer-token',
        refresh_token: 'fake-refresh',
        expires_at: Date.now() + 3600000,
        user: { id: 'user-002', email: 'viewer@aliencell.com' },
        role: 'viewer'
      }));
    });
    // 拦截 /auth/v1/user 返回 200
    await ctx.route('**/auth/v1/user', route => {
      route.fulfill({ status: 200, body: JSON.stringify({ id: 'user-002', email: 'viewer@aliencell.com' }) });
    });

    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    const emailShown = await page.$eval('#userEmail', el => el.textContent).catch(() => '');
    ok(emailShown === 'viewer@aliencell.com', '访客邮箱显示');

    const roleShown = await page.$eval('#userRole', el => ({ text: el.textContent, cls: el.className }));
    ok(roleShown.text === '访客', '角色标签=访客', roleShown);

    const mapVisible = await page.$eval('.nav-map', el => el.style.display !== 'none');
    ok(mapVisible, '映射管理入口对访客可见（全体登录用户可用）');

    await ctx.close();
  }

  // ---- Test 8: 退出登录 → 清除 token + 跳转 login ----
  {
    console.log('\n[Test 8] 退出登录流程');
    const ctx = await browser.newContext();
    await ctx.route('**/auth/v1/user', route => {
      route.fulfill({ status: 200, body: JSON.stringify({ id: 'user-001', email: 'admin@aliencell.com' }) });
    });
    await ctx.route('**/auth/v1/logout', route => {
      route.fulfill({ status: 204 });
    });

    const page = await ctx.newPage();
    // 先到 login.html（无需认证）设置 localStorage
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('wb_auth', JSON.stringify({
        access_token: 'fake-token',
        refresh_token: 'fake-refresh',
        expires_at: Date.now() + 3600000,
        user: { id: 'user-001', email: 'admin@aliencell.com' },
        role: 'admin'
      }));
    });
    // 导航到 index.html（认证守卫应通过）
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.click('.btn-logout');
    await page.waitForTimeout(800);

    const url = page.url();
    ok(url.includes('login.html') && url.includes('reason=logout'), '退出后跳转 login?reason=logout', { url });

    const authCleared = await page.evaluate(() => !localStorage.getItem('wb_auth'));
    ok(authCleared, 'localStorage wb_auth 已清除');

    await ctx.close();
  }

  // ---- Test 9: token 过期 → 异步刷新失败 → 跳转 login ----
  {
    console.log('\n[Test 9] token 过期自动跳转');
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      localStorage.setItem('wb_auth', JSON.stringify({
        access_token: 'expired-token',
        refresh_token: 'expired-refresh',
        expires_at: Date.now() - 1000, // 已过期
        user: { id: 'user-003', email: 'expired@test.com' },
        role: 'admin'
      }));
    });
    // /auth/v1/user 返回 401
    await ctx.route('**/auth/v1/user', route => {
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'invalid token' }) });
    });
    // refresh 也失败
    await ctx.route('**/auth/v1/token*', route => {
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'invalid refresh' }) });
    });

    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const url = page.url();
    ok(url.includes('login.html') && url.includes('reason=invalid'), 'token 过期跳转 login?reason=invalid', { url });
    await ctx.close();
  }

  await browser.close();
  console.log('\n=================');
  console.log('Result: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail > 0) console.log(fail + ' FAILED');
})();
