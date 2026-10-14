// 生成「全部平台默认视图」截图（用真实云端映射，避免显示成"映射中未找到"）
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = __dirname;
const AUTH = { access_token: 't', refresh_token: 't', user: { email: 'shot@aliencell.com' } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript((a) => {
    try {
      localStorage.setItem('wb_auth', JSON.stringify(a));
      localStorage.setItem('pc_woot', JSON.stringify([]));
    } catch (e) {}
  }, AUTH);
  const p = await ctx.newPage();
  await p.goto('file:///' + path.resolve(BASE, 'target.html').split(path.sep).join('/'), { waitUntil: 'load', timeout: 90000 });
  // 页面会先拉云端映射；拉完可能 reload 一次，等它稳定
  await p.waitForTimeout(6000);
  const mapped = await p.evaluate(() => (document.querySelector('#mapStat') || {}).textContent || '(无 mapStat)');
  console.log('映射统计: ' + mapped);
  await p.evaluate(() => {
    const d = document.querySelector('details.noteFold');
    if (d) d.scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(BASE, 'shot_2_target_allplatform.png') });
  console.log('已保存 shot_2_target_allplatform.png');
  await b.close();
})();
