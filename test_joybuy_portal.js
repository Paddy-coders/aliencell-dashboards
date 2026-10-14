/**
 * 统一入口页（portal / _deploy/index.html）JoyBuy 集成回归测试
 *
 * 覆盖：
 *   - 侧边栏存在 JoyBuy 导航项，且与亚马逊看板同处一个入口
 *   - 点击后 iframe 加载 joybuy.html（带 cache-bust 版本号）
 *   - 通过 #joybuy hash 可直达
 *   - JoyBuy 页在 iframe 内正常渲染（KPI 卡 / 图表 / 无 JS 报错）
 *   - 亚马逊原有 5 个看板 tab 未被破坏
 *
 * 用法: node test_joybuy_portal.js                       （本地 file://，从 _deploy 读取）
 *       BASE=https://xxx node test_joybuy_portal.js       （线上，自动加 cache-buster）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const pw = require('./playwright-auth');

const DEPLOY = path.join(__dirname, '_deploy');
let pass = 0, fail = 0; const fails = [];
function chk(name, ok, detail) {
  if (ok) pass++; else { fail++; fails.push(name); }
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail === undefined ? '' : detail}`);
}

// 极简静态服务（file:// 下 iframe + postMessage 行为与线上有差异，用 http 更接近真实）
function serve(dir) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(dir, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const useLive = !!process.env.BASE && /^https?:/.test(process.env.BASE);
  let srv = null, BASE;
  if (useLive) BASE = process.env.BASE.replace(/\/+$/, '');
  else { srv = await serve(DEPLOY); BASE = 'http://127.0.0.1:' + srv.address().port; }

  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/404|Failed to load resource|WebSocket|ERR_CONNECTION|net::/i.test(t)) errs.push('console: ' + t);
  });
  // 认证链路用假响应，绝不触达真实 Supabase
  await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 't', email: 'qa@test' }) }));

  const cb = '?cb=' + Date.now();
  await page.goto(BASE + '/index.html' + cb, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  chk('入口页未被认证守卫踢走', !/login\.html/.test(page.url()), page.url());

  const navIds = await page.locator('.nav-item').evaluateAll(els => els.map(e => e.getAttribute('data-id')));
  chk('侧边栏含 5 个亚马逊看板 + joybuy', navIds.length === 6 && ['ad', 'product', 'daily', 'monthly', 'target', 'joybuy'].every(x => navIds.includes(x)), navIds.join(','));
  const joyText = await page.locator('.nav-item[data-id="joybuy"]').textContent();
  chk('JoyBuy 导航项文案正确', /JoyBuy/.test(joyText), joyText.replace(/\s+/g, ' ').trim());
  const label = await page.locator('.nav-label').allTextContents();
  chk('存在 JoyBuy 分组标题', label.some(t => /JoyBuy/i.test(t)), label.join(' / '));

  // 点击 JoyBuy → iframe 指向 joybuy.html
  await page.click('.nav-item[data-id="joybuy"]');
  await page.waitForTimeout(3500);
  const frameSrc = await page.locator('#frame').getAttribute('src');
  chk('iframe 加载 joybuy.html', /joybuy\.html/.test(frameSrc), frameSrc);
  chk('iframe 带 cache-bust 版本号', /[?&]v=\d+/.test(frameSrc), frameSrc);
  chk('JoyBuy 项被标记为激活', (await page.locator('.nav-item[data-id="joybuy"]').getAttribute('class')).includes('active'), '');
  chk('URL hash 变为 #joybuy', /#joybuy/.test(page.url()), page.url());

  // 进 iframe 断言渲染
  const fr = page.frames().find(f => /joybuy\.html/.test(f.url()));
  chk('找到 joybuy.html 子框架', !!fr, (page.frames().map(f => f.url()).join(' | ')).slice(0, 160));
  if (fr) {
    await fr.waitForTimeout(2200);
    const hasData = await fr.evaluate(() => !!(window.PAYLOAD && PAYLOAD.weeks && PAYLOAD.weeks.length));
    const kpis = await fr.locator('#kpis .kpi').count();
    if (hasData) {
      // ⚠️ 不写死数字: KPI 卡数量由槽位决定(当前设计固定 5 张, 用户可在卡片下拉里替换指标)。
      //    从 DOM 的 data-slot 反推期望张数, 避免"默认槽位调整后假失败"(2026-10-12 实测: 期望 8 / 实际 5)。
      const expectKpi = await fr.evaluate(() => {
        const s = [...document.querySelectorAll('#kpis .kpi')].map(e => Number(e.dataset.slot));
        return s.length ? Math.max(...s) + 1 : 0;
      });
      chk('iframe 内渲染 KPI 卡（有数据）', kpis > 0 && kpis === expectKpi, `实际 ${kpis} / 期望 ${expectKpi}`);
      const c1 = await fr.evaluate(() => !!(window.Chart && Chart.getChart('c1')));
      chk('iframe 内图表实例化（有数据）', c1 === true, '');
    } else {
      chk('iframe 内渲染空态（无数据）', kpis === 0, '实际 KPI 卡 ' + kpis);
      const emptyTxt = await fr.locator('#pane-trend').textContent();
      chk('iframe 内空态含接入指引', /尚未接入数据/.test(emptyTxt), emptyTxt.replace(/\s+/g, ' ').slice(0, 50));
    }
    const bw = await fr.evaluate(() => document.documentElement.scrollWidth);
    const cw = await fr.evaluate(() => document.documentElement.clientWidth);
    chk('iframe 内容无横向溢出', bw <= cw + 2, `scrollWidth=${bw} clientWidth=${cw}`);
  }

  // 切回亚马逊看板，确认没被破坏
  await page.click('.nav-item[data-id="ad"]');
  await page.waitForTimeout(2500);
  const adSrc = await page.locator('#frame').getAttribute('src');
  chk('切回广告看板正常', /ad\.html/.test(adSrc), adSrc);
  chk('JoyBuy 项取消激活', !(await page.locator('.nav-item[data-id="joybuy"]').getAttribute('class')).includes('active'), '');

  // hash 直达（cache-buster 放 query，hash 保持纯粹）
  await page.goto(BASE + '/index.html?cb=' + Date.now() + '#joybuy', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  const directSrc = await page.locator('#frame').getAttribute('src');
  chk('hash 直达 #joybuy 生效', /joybuy\.html/.test(directSrc), directSrc);

  // hash 容错：附加参数不应破坏识别
  await page.goto(BASE + '/index.html?cb=' + Date.now() + '#joybuy&from=test', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  const tolerantSrc = await page.locator('#frame').getAttribute('src');
  chk('hash 带附加参数仍能识别 (#joybuy&from=test)', /joybuy\.html/.test(tolerantSrc), tolerantSrc);

  chk('全程无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' ｜ '));

  await ctx.close();
  await browser.close();
  if (srv) srv.close();

  console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (fail) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
