// shot_data_note.js — 截图核验「数据完整性 + 重新校准」提示条（本地 8899）
// 用法: BASE=http://127.0.0.1:8899 node shot_data_note.js
const { chromium } = require('./playwright-auth');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const U = f => `${BASE}/${f}?cb=shot${Date.now()}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 420 }, deviceScaleFactor: 1.4 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for (const f of ['daily.html', 'monthly.html', 'target.html']) {
    await page.goto(U(f), { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    const el = await page.$('#dataNote');
    if (el) {
      const box = await el.boundingBox();
      await page.screenshot({ path: `_note_${f.replace('.html', '')}.png`, clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 34), width: Math.min(1480, box.width + 40), height: Math.max(70, box.height + 46) } });
      const txt = await el.evaluate(n => n.textContent.trim());
      const cal = await page.$eval('#dataNote .note-calib', n => ({ text: n.textContent.trim(), tip: (n.getAttribute('title') || '').slice(0, 200) })).catch(() => null);
      console.log(`\n=== ${f} ===`);
      console.log('  完整性:', txt.split('🔁')[0].trim());
      console.log('  校准  :', cal ? cal.text : '(无)');
      console.log('  悬停明细:', cal ? cal.tip + ' ...' : '');
      console.log('  提示条宽度:', Math.round(box.width), 'px (视口 1500)');
    } else {
      console.log(`=== ${f} === 未找到 #dataNote`);
    }
  }
  console.log('\nJS 错误:', errs.length ? errs : '无');
  await browser.close();
})();
