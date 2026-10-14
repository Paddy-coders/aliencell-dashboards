/* 注册功能测试: 白名单域名校验 + Supabase signup 流程 + 邮箱验证提示 + 自动登录 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'file:///' + path.resolve(__dirname, '_deploy').replace(/\\/g, '/');
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch();

  // ---- Test 1: 页面加载后可见注册入口, 点击切换到注册表单 ----
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/login.html');
    await page.waitForTimeout(300);
    const linkVisible = await page.$eval('#linkToSignup', el => el.offsetParent !== null);
    t('登录页显示"注册账号"入口', linkVisible);
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    const signupVisible = await page.$eval('#signupForm', el => el.style.display !== 'none');
    const loginHidden = await page.$eval('#loginForm', el => el.style.display === 'none');
    const hint = await page.$eval('#domainHint', el => el.textContent);
    t('切换到注册表单(登录隐藏)', signupVisible && loginHidden, { signupVisible, loginHidden });
    t('注册页显示域名白名单提示', hint.includes('aliencell.com'), { hint });
    await page.close();
  }

  // ---- Test 2: 非白名单邮箱被前端拦截, 不调用 signup 接口 ----
  {
    const page = await browser.newPage();
    let signupCalled = false;
    await page.route('**/auth/v1/signup', route => { signupCalled = true; return route.fulfill({ status: 200, body: '{}' }); });
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'someone@gmail.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc12345');
    await page.click('#btnSignup');
    await page.waitForTimeout(300);
    const err = await page.$eval('#errorMsg', el => ({ show: el.classList.contains('show'), text: el.textContent }));
    t('非白名单邮箱显示拒绝提示', err.show && err.text.includes('不在允许注册范围内'), err);
    t('非白名单邮箱未调用 signup 接口', !signupCalled);
    await page.close();
  }

  // ---- Test 3: 弱密码(<6位)前端拦截 ----
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'paddy@aliencell.com');
    await page.fill('#regPassword', '123');
    await page.fill('#regPassword2', '123');
    await page.click('#btnSignup');
    await page.waitForTimeout(200);
    const err = await page.$eval('#errorMsg', el => el.textContent);
    t('弱密码提示"至少 6 位"', err.includes('至少 6 位'), { err });
    await page.close();
  }

  // ---- Test 4: 两次密码不一致前端拦截 ----
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'paddy@aliencell.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc54321');
    await page.click('#btnSignup');
    await page.waitForTimeout(200);
    const err = await page.$eval('#errorMsg', el => el.textContent);
    t('密码不一致提示', err.includes('不一致'), { err });
    await page.close();
  }

  // ---- Test 5: 白名单邮箱注册成功(需邮箱验证, 无 token 响应) ----
  {
    const page = await browser.newPage();
    await page.route('**/auth/v1/signup', route => {
      return route.fulfill({ status: 200, body: JSON.stringify({ id: 'user-abc', aud: 'authenticated', role: 'authenticated', email: 'paddy@aliencell.com' }) });
    });
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'paddy@aliencell.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc12345');
    await page.click('#btnSignup');
    await page.waitForTimeout(400);
    const banner = await page.$eval('#infoBanner', el => ({ show: el.classList.contains('show'), text: el.textContent }));
    t('注册成功显示"验证邮件已发送"提示', banner.show && banner.text.includes('验证邮件已发送至 paddy@aliencell.com'), banner);
    const loginVisible = await page.$eval('#loginForm', el => el.style.display !== 'none');
    const emailPrefill = await page.$eval('#email', el => el.value);
    t('注册成功后切回登录表单', loginVisible);
    t('登录表单邮箱已预填', emailPrefill === 'paddy@aliencell.com', { emailPrefill });
    await page.close();
  }

  // ---- Test 6: 邮箱已占用(email_taken) ----
  {
    const page = await browser.newPage();
    await page.route('**/auth/v1/signup', route => {
      return route.fulfill({ status: 400, body: JSON.stringify({ code: 'email_taken', message: 'User already registered', error_code: 'email_taken' }) });
    });
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'paddy@aliencell.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc12345');
    await page.click('#btnSignup');
    await page.waitForTimeout(400);
    const err = await page.$eval('#errorMsg', el => ({ show: el.classList.contains('show'), text: el.textContent }));
    t('email_taken 提示"该邮箱已注册"', err.show && err.text.includes('该邮箱已注册，请直接登录'), err);
    await page.close();
  }

  // ---- Test 7: Confirm email 未开启时注册即登录(带 access_token) ----
  {
    const page = await browser.newPage();
    const session = {
      access_token: 'tok-signup', token_type: 'bearer', expires_in: 3600, refresh_token: 'ref-signup',
      user: { id: 'user-xyz', email: 'new@aliencell.com' }
    };
    await page.route('**/auth/v1/signup', route => route.fulfill({ status: 200, body: JSON.stringify(session) }));
    await page.route('**/rest/v1/profiles**', route => route.fulfill({ status: 200, body: JSON.stringify([{ role: 'viewer', email: 'new@aliencell.com' }]) }));
    // 拦截跳转目标: 返回最小页面, 避免 index.html 守卫脚本干扰 localStorage 读取
    await page.route('**/index.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body>ok</body></html>' }));
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'new@aliencell.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc12345');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('#btnSignup')
    ]);
    await page.waitForTimeout(300);
    const auth = await page.evaluate(() => JSON.parse(localStorage.getItem('wb_auth') || 'null'));
    t('注册即登录: wb_auth 已写入', auth !== null && auth.access_token === 'tok-signup' && auth.role === 'viewer', auth);
    t('注册即登录: 页面跳转到 index.html', page.url().includes('index.html'), { url: page.url() });
    await page.close();
  }

  // ---- Test 8: 弱密码服务端错误(weak_password)提示映射 ----
  {
    const page = await browser.newPage();
    await page.route('**/auth/v1/signup', route => {
      return route.fulfill({ status: 422, body: JSON.stringify({ code: 'weak_password', msg: 'Password should be at least 6 characters.', error_code: 'weak_password' }) });
    });
    await page.goto(BASE + '/login.html');
    await page.click('#linkToSignup');
    await page.waitForTimeout(200);
    await page.fill('#regEmail', 'paddy@aliencell.com');
    await page.fill('#regPassword', 'abc12345');
    await page.fill('#regPassword2', 'abc12345');
    await page.click('#btnSignup');
    await page.waitForTimeout(400);
    const err = await page.$eval('#errorMsg', el => el.textContent);
    t('服务端 weak_password 映射为中文提示', err.includes('密码强度不足'), { err });
    await page.close();
  }

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
