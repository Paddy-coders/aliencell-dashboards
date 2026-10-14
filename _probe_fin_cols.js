// 临时探针: 读三看板新列(入境费/多渠道/剔除/测评费) —— 不入回归
const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fetchJson(url){ return new Promise((res,rej)=>{ const r=https.get(url,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},timeout:15000},s=>{const b=[];s.on('data',c=>b.push(c));s.on('end',()=>{try{res(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(e){rej(e)}})}); r.on('timeout',()=>r.destroy(new Error('timeout'))); r.on('error',rej); }); }
const g = (o,k) => (o && typeof o[k]==='number') ? o[k] : 0;
(async () => {
  const FILE = process.argv[2];
  const cloud = (await fetchJson(SB_URL))[0].data;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:2200,height:1200} });
  await ctx.addInitScript((arg)=>{
    localStorage.setItem('wb_auth', JSON.stringify({access_token:'x',user:{email:'t@a.com'}}));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  }, {catalog: cloud.catalog||[], asinMap: cloud.asinMap||[]});
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
  await page.route('**/rest/v1/mapping*', r=>r.fulfill({status:200,contentType:'application/json',
    body: JSON.stringify([{data:{catalog:cloud.catalog||[],asinMap:cloud.asinMap||[],woot:[],wootCfg:cloud.wootCfg||null}}])}));
  await page.goto('file:///'+FILE, {waitUntil:'domcontentloaded', timeout:180000});
  await page.waitForTimeout(12000);
  const out = await page.evaluate(()=>{
    const r = {};
    const KEYS = ['pInb','pInvx','pMcost','pMhead','pMship','pMcAdj','pReview','pMqty','pHead','pVat','pSales','pProfit','pPromo','pComm','pFba','pCost','pStorage','pOther','adCost'];
    const all = (typeof DAYS !== 'undefined') ? DAYS : ((DATA && DATA.days) ? Object.keys(DATA.days).sort() : []);
    function collect(){
      const t = {}; KEYS.forEach(k => t[k] = 0);
      for (const d of all) {
        const a = aggRows(d, selCountry, selAsin);
        KEYS.forEach(k => { if (typeof a[k] === 'number') t[k] += a[k]; });
      }
      return t;
    }
    r.all = collect();
    r.perCountry = {};
    for (const cc of ['US','DE','UK']) {
      selCountry.clear(); selCountry.add(cc);
      r.perCountry[cc] = collect();
    }
    selCountry.clear();
    r.newCols = (typeof METRICS !== 'undefined') ? METRICS.filter(m=>['inbAbs','inbPct','mcfQty','mcfLoss','mcfCost','mcfHead','mcfShip','mcfAdj','reviewAbs','reviewPct'].indexOf(m.key)>=0).map(m=>m.key) : null;
    // ---------- 月看板 ----------
    if (typeof calcKpis === 'function' && typeof aggMonth === 'function') {
      const k = calcKpis();
      r.monthTot = k.tot;
      r.monthProfit = profitOf(k.tot);
      r.monthCols = monthVal(k.tot, 'inbAbs');
      r.monthCols2 = monthVal(k.tot, 'mcfLoss');
      r.monthCols3 = monthVal(k.tot, 'reviewAbs');
      r.monthCols4 = monthVal(k.tot, 'mcfAdj');
      r.monthCols5 = monthVal(k.tot, 'mcfQty');
      r.months = k.monthsSel.map(m=>m.ym);
    }
    return r;
  });
  console.log(JSON.stringify(out,null,1));
  if (errs.length) console.log('PAGEERR', errs.slice(0,3));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
