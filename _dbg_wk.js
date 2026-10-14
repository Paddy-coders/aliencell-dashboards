const fs=require('fs'),https=require('https');
const {chromium}=require('./playwright-auth');
const BASE='C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const SB_URL='https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const KEY='sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
const fj=u=>new Promise((res,rej)=>{https.get(u,{headers:{apikey:KEY,Authorization:'Bearer '+KEY},timeout:15000},r=>{const b=[];r.on('data',c=>b.push(c));r.on('end',()=>res(JSON.parse(Buffer.concat(b).toString())))}).on('error',rej)});
(async()=>{
  const cloud=(await fj(SB_URL))[0].data;
  const b=await chromium.launch(); const ctx=await b.newContext();
  await ctx.addInitScript(a=>{localStorage.setItem('wb_auth',JSON.stringify({access_token:'x',user:{email:'t@a.com'}}));
    localStorage.setItem('pc_catalog',JSON.stringify(a.c));localStorage.setItem('pc_asinmap',JSON.stringify(a.m));}, {c:cloud.catalog,m:cloud.asinMap});
  const p=await ctx.newPage();
  const stub={catalog:cloud.catalog,asinMap:cloud.asinMap,woot:[],wootCfg:null};
  await p.route('**/rest/v1/mapping*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:stub}])}));
  await p.goto('file:///'+BASE+'/_deploy/product.html',{waitUntil:'load',timeout:90000});
  await p.waitForTimeout(5000);
  const out=await p.evaluate(()=>{
    const asin='B0H6QDJQR5', wk='W30';
    const pw=PROFIT[asin]&&PROFIT[asin].weeks[wk];
    selCountry.clear(); selCountry.add('US');
    const a=asinWeekData(asin,wk);
    return {hasProfit:!!pw, pwUS:pw&&pw.US, acc:a, vals:['costPct','fbaAbs','headAbs','headPct','otherPct','profit','margin'].map(k=>[k,weekVal(a,k)]),
      meta: (typeof __ASIN_META!=='undefined')?__ASIN_META[asin]:'no meta'};
  });
  console.log(JSON.stringify(out,null,1).slice(0,1500));
  await b.close();
})();
