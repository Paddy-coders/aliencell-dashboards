// 生成「折叠前/后」与「全部平台默认视图」截图，供汇报查看
const path = require('path');
const { chromium } = require('./playwright-auth');

const BASE = __dirname;
const AUTH = { access_token: 't', refresh_token: 't', user: { email: 'shot@aliencell.com' } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
  // 云端只读接口拦成本地空响应，避免截图时被 reload 打断
  await ctx.route('**://oovvqvgrjqwogjwswaxx.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.addInitScript((a) => {
    try {
      localStorage.setItem('wb_auth', JSON.stringify(a));
      localStorage.setItem('pc_woot', JSON.stringify([]));
    } catch (e) {}
  }, AUTH);

  const shoot = async (file, out, action) => {
    const p = await ctx.newPage();
    await p.goto('file:///' + path.resolve(BASE, file).split(path.sep).join('/'), { waitUntil: 'load', timeout: 90000 });
    await p.waitForTimeout(2200);
    if (action) await p.evaluate(action);
    await p.waitForTimeout(400);
    // 滚到说明块位置并截取「筛选栏 + 说明块」区域
    await p.evaluate(() => {
      const d = document.querySelector('details.noteFold');
      if (d) d.scrollIntoView({ block: 'center' });
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(BASE, out) });
    console.log('已保存 ' + out);
    await p.close();
  };

  await shoot('monthly.html', 'shot_1_monthly_folded.png');
  await shoot('target.html', 'shot_2_target_allplatform.png');
  await shoot('joybuy.html', 'shot_3_joybuy_folded.png');
  await b.close();
  console.log('done');
})();
