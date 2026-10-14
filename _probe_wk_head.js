const { chromium } = require('./playwright-auth');
const FILE = process.argv[2] || 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addInitScript(()=>{try{localStorage.setItem('pc_woot','[]')}catch(e){}});
  await ctx.route('**supabase.co/**', r=>r.abort());
  const page = await ctx.newPage();
  await page.goto(FILE,{waitUntil:'load',timeout:120000});
  await page.waitForTimeout(3000);
  const out = await page.evaluate(()=>{
    const c = calc();
    const meta = (typeof __ASIN_META !== 'undefined') ? __ASIN_META : null;
    const sample = meta ? Object.keys(meta).slice(0,3).map(a=>({a, name: meta[a] && meta[a].name})) : null;
    const hb = (typeof HEADRMB !== 'undefined') ? HEADRMB : null;
    const hbn = hb ? Object.keys(hb).length : -1;
    const hbKeys = hb ? Object.keys(hb).slice(0,4) : null;
    // 试算: 取一个有多渠道/有 qty 的 PROFIT 单元
    const probe = [];
    if (meta && hb) {
      for (const asin of Object.keys(PROFIT)) {
        const ws = PROFIT[asin].weeks;
        for (const wl of Object.keys(ws)) {
          for (const cc of Object.keys(ws[wl])) {
            const p = ws[wl][cc];
            if (p.qty) probe.push({asin, wl, cc, qty:p.qty, name: meta[asin] && meta[asin].name,
              hrmb: hb[meta[asin] && meta[asin].name], head: headRmbOf(asin, cc)});
          }
        }
      }
    }
    return { hasMeta: !!meta, metaCount: meta?Object.keys(meta).length:0, sample, hbn, hbKeys,
             pQtyTotal: c.totals.pQty, pHeadTotal: c.totals.pHead, probe: probe.slice(0,6), probeN: probe.length };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
