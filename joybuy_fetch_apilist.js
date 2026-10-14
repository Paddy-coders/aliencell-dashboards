// 抓取 JoyBuy 开放平台各模块的 API 清单（点击侧边栏 -> dump 正文接口表）
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SECTIONS = ['Aftersales\u200cOverview\u200c', 'Vender', 'Product', 'Order'];
const OUT = path.join(__dirname, 'joybuy_apilist.txt');

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
  });
  const p = await ctx.newPage();
  await p.goto('https://open-portal.joybuy.com/#/doc/api', { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(7000);

  const buf = [];
  for (const label of SECTIONS) {
    // 展开 Supply Chain（若尚未展开）
    await p.evaluate(() => {
      const els = [...document.querySelectorAll('div,span,li,a')];
      const sc = els.find(e => (e.innerText || '').trim() === 'Supply Chain' && e.children.length === 0);
      if (sc) sc.click();
    }).catch(() => {});
    await p.waitForTimeout(1200);

    const clicked = await p.evaluate((lbl) => {
      const els = [...document.querySelectorAll('div,span,li,a')];
      const hit = els.filter(e => (e.innerText || '').trim() === lbl && e.children.length === 0);
      if (hit.length) { hit[hit.length - 1].click(); return hit.length; }
      return 0;
    }, label);
    await p.waitForTimeout(4000);
    const text = await p.evaluate(() => document.body.innerText);
    const url = p.url();
    buf.push(`\n\n########## ${label}  (clicked=${clicked}) ##########\nURL: ${url}\n${text}`);
    console.log(`[${label}] clicked=${clicked} len=${text.length}`);
  }

  fs.writeFileSync(OUT, buf.join('\n'), 'utf-8');

  // 抽取 API 路径
  const all = buf.join('\n');
  const paths = [...new Set((all.match(/(?:sp|jos)-[a-z0-9-]+\/v[0-9]+\/[A-Za-z0-9/_{}.-]+/g) || []))].sort();
  fs.writeFileSync(path.join(__dirname, 'joybuy_apipaths.json'), JSON.stringify(paths, null, 2), 'utf-8');
  console.log('\n=== API 路径 (' + paths.length + ') ===');
  paths.forEach(x => console.log(x));
  console.log('-> ' + OUT);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
