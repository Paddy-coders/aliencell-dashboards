const { chromium } = require('./playwright-auth');
const BASE = 'http://127.0.0.1:8896';
(async()=>{
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(()=>localStorage.setItem('wb_auth', JSON.stringify({access_token:'x',user:{email:'t@a.com'}})));
  const p = await ctx.newPage();
  p.on('pageerror', e=>console.log('PAGEERR', String(e).slice(0,200)));
  await p.route('**/rest/v1/mapping*', r => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{catalog:[],asinMap:[],woot:[]},updated_at:'x'}])}));
  await p.goto(BASE+'/finance_inputs.html',{waitUntil:'load'});
  await p.waitForTimeout(1200);
  const out = await p.evaluate(()=>{
    const txt = JSON.stringify({otherOrders:[{ym:'2026/10',asin:'B0HCZ6CPT1',qty:2,note:'10月'}]});
    const rows = parseTextToRows(txt);
    const r = { txt: txt, rows: rows, normYm_test: normYm('2026/10') };
    document.getElementById('ooText').value = txt;
    r.before = JSON.parse(JSON.stringify(fin.otherOrders));
    importOOFromText();
    r.after = JSON.parse(JSON.stringify(fin.otherOrders));
    return r;
  });
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
