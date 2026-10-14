// 临时探针: 验证 Woot 成本经「产品关系管理」解析后的毛利 —— 不入回归
const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fetchJson(url){return new Promise((res,rej)=>{const r=https.get(url,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},timeout:15000},s=>{const b=[];s.on('data',c=>b.push(c));s.on('end',()=>{try{res(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(e){rej(e)}})});r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);});}
(async () => {
  const cloud = (await fetchJson(SB_URL))[0].data;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 2400, height: 1200 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token:'x', user:{email:'t@aliencell.com'} }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || {price:1380, cost:{}}));
  }, { catalog: cloud.catalog||[], asinMap: cloud.asinMap||[], woot: cloud.woot||[], wootCfg: cloud.wootCfg||null });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0,220)));
  await page.route('**/rest/v1/mapping*', r => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{catalog:cloud.catalog||[],asinMap:cloud.asinMap||[],woot:cloud.woot||[],wootCfg:cloud.wootCfg||null}}])}));
  for (const f of ['monthly.html', 'daily.html']) {
    await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/' + f, { waitUntil:'domcontentloaded', timeout:180000 });
    await page.waitForTimeout(10000);
    const out = await page.evaluate(() => {
      const r = {};
      r.hasCostRmb = (typeof COSTRMB !== 'undefined') && COSTRMB ? Object.keys(COSTRMB).length : -1;
      try { r.unit = wootUnitCost('B0H69JJZ1M'); } catch (e) { r.unit = 'ERR ' + e.message; }
      try { r.metaOf = asinMetaOf('B0H69JJZ1M'); } catch (e) { r.metaOf = 'ERR'; }
      try { r.cfg = (typeof WOOT_CFG !== 'undefined') ? JSON.stringify(WOOT_CFG) : 'n/a'; } catch (e) { r.cfg = 'ERR'; }
      // Woot 行是否入毛利: 找带 channel==='woot' / woot 标记的行
      try {
        const rows = (typeof ROWS !== 'undefined') ? ROWS : (typeof filteredRows === 'function' ? filteredRows() : []);
        const w = rows.filter(x => x && (x.channel === 'woot' || x.woot));
        r.wootRowCount = w.length;
        r.wootSample = w.slice(0, 2).map(x => ({ ym: x.ym, cc: x.cc, asin: x.asin, pSales: x.pSales, pCost: x.pCost, pHead: x.pHead, pN: x.pN, sales: x.sales, orders: x.orders }));
        const agg = w.reduce((a, x) => { a.pSales += +x.pSales || 0; a.pCost += +x.pCost || 0; a.pHead += +x.pHead || 0; a.orders += +x.orders || 0; a.ad += +x.adCost || 0; return a; }, { pSales:0, pCost:0, pHead:0, orders:0, ad:0 });
        r.wootAgg = agg;
        r.wootProfit = agg.pSales + agg.pCost - agg.pHead - agg.ad;
      } catch (e) { r.wootErr = String(e).slice(0,200); }
      return r;
    });
    console.log('\n===== ' + f + ' =====');
    console.log(JSON.stringify(out, null, 1));
  }
  if (errs.length) console.log('\n页面错误:', errs.slice(0,4));
  await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
