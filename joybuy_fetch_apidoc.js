// 抓取指定 API 的详细文档：先展开父级菜单，再点击叶子项，捕获详情接口 JSON + 正文
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WANT = (process.env.WANT || 'listOrders').split(',');
const PARENTS = (process.env.PARENTS || 'Supply Chain,Order,Product,Vender').split(',');
const OUTDIR = path.join(__dirname, 'joybuy_apidocs');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

// 在页面内点击侧边栏文本等于 label 的节点（只点叶子节点，避免点到容器）
function clickInPage(label, last) {
  return function (lbl) {
    const els = [...document.querySelectorAll('div,span,li,a')];
    const hit = els.filter(e => (e.innerText || '').trim() === lbl && e.children.length === 0);
    if (!hit.length) return 0;
    hit[last ? hit.length - 1 : 0].click();
    return hit.length;
  };
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
  });
  const p = await ctx.newPage();
  let captured = [];
  p.on('response', async r => {
    if (!/sff\.joybuy\.com\/api/.test(r.url())) return;
    try {
      const t = await r.text();
      if (!/listApi4Overview|common\.config/.test(r.url()) && t.length > 300) {
        captured.push({ api: (r.url().match(/api=([^&]+)/) || [])[1], body: t.slice(0, 400000) });
      }
    } catch (e) { }
  });

  await p.goto('https://open-portal.joybuy.com/#/doc/api', { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(7000);

  for (const par of PARENTS) {
    const n = await p.evaluate(clickInPage(par, false), par);
    await p.waitForTimeout(1500);
    if (par === 'Supply Chain') await p.waitForTimeout(800);
  }
  await p.waitForTimeout(1500);

  for (const name of WANT) {
    captured = [];
    const n = await p.evaluate(clickInPage(name, true), name);
    await p.waitForTimeout(6000);
    const text = await p.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(OUTDIR, `${name}.txt`), text, 'utf-8');
    if (captured.length) fs.writeFileSync(path.join(OUTDIR, `${name}.json`), JSON.stringify(captured, null, 2).slice(0, 900000), 'utf-8');
    console.log(`[${name}] clicked=${n} textLen=${text.length} captured=${captured.length} apis=${captured.map(c => c.api).join(',')}`);
  }
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
