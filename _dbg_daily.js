const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL='https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY='sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fj(u){return new Promise((res,rej)=>{const r=https.get(u,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},timeout:15000},s=>{const b=[];s.on('data',c=>b.push(c));s.on('end',()=>{try{res(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(e){rej(e)}})});r.on('timeout',()=>r.destroy(new Error('t')));r.on('error',rej);});}
(async()=>{
  const cloud=(await fj(SB_URL))[0].data;
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:2200,height:1200}});
  await ctx.addInitScript((a)=>{localStorage.setItem('wb_auth',JSON.stringify({access_token:'x',user:{email:'t@a.com'}}));
    localStorage.setItem('pc_catalog',JSON.stringify(a.catalog));localStorage.setItem('pc_asinmap',JSON.stringify(a.asinMap));localStorage.setItem('pc_woot','[]');},
    {catalog:cloud.catalog||[],asinMap:cloud.asinMap||[]});
  const p=await ctx.newPage();
  await p.route('**/rest/v1/mapping*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{catalog:cloud.catalog||[],asinMap:cloud.asinMap||[],woot:[],wootCfg:cloud.wootCfg||null}}])}));
  await p.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/daily.html',{waitUntil:'domcontentloaded',timeout:180000});
  await p.waitForTimeout(12000);
  const out=await p.evaluate(()=>{
    const t=document.querySelector('table');
    const rows=[...t.querySelectorAll('tr')];
    const hdr=[...rows[0].querySelectorAll('th,td')].map(x=>x.innerText.trim());
    const ti=rows.findIndex(r=>/合计/.test(r.innerText));
    const tot=[...rows[ti].querySelectorAll('th,td')].map(x=>x.innerText.trim());
    const map={}; hdr.forEach((h,i)=>map[h]=tot[i]);
    // 页面自身: 逐日聚合
    const sum={adCost:0,adSales:0,sessions:0,pInb:0,pReview:0,pMcAdj:0,pMcost:0,pMhead:0,pMship:0,pMqty:0,pHead:0,pVat:0,pSales:0};
    for(const d of DAYS){ const a=aggRows(d, selCountry, selAsin);
      ['adCost','adSales','sessions','pInb','pReview','pMcAdj','pMcost','pMhead','pMship','pMqty','pHead','pVat','pSales'].forEach(k=>sum[k]+=(typeof a[k]==='number'?a[k]:0)); }
    return { nDays: DAYS.length, dateFrom: (typeof dateFrom!=='undefined'?dateFrom:null), dateTo:(typeof dateTo!=='undefined'?dateTo:null),
      dispCur: DISP_CUR, hdr: hdr, totRow: tot, tableMap: {adCost:map['广告花费'], sales:map['销售额'], profit:map['毛利'], inb:map['入境货运费'], mcfLoss:map['多渠道损失'], review:map['测评费'], head:map['头程'], vat:map['VAT'], storage:map['仓储']},
      aggSum: sum, rangeBadge: (document.getElementById('rangeBadge')||{}).textContent };
  });
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
