// 临时探针: 读周报汇总统计表 W36 行(渲染后的列头与值) —— 不入回归
const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fetchJson(url){return new Promise((res,rej)=>{const r=https.get(url,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},timeout:15000},s=>{const b=[];s.on('data',c=>b.push(c));s.on('end',()=>{try{res(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(e){rej(e)}})});r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);});}
(async () => {
  const FILE = process.argv[2] || 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html';
  const cloud = (await fetchJson(SB_URL))[0].data;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 2600, height: 1200 } });
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token:'x', user:{email:'t@aliencell.com'} }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify([]));
  }, { catalog: cloud.catalog||[], asinMap: cloud.asinMap||[] });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/mapping*', r => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{catalog:cloud.catalog||[],asinMap:cloud.asinMap||[],woot:[],wootCfg:cloud.wootCfg||null}}])}));
  await page.goto(FILE, { waitUntil:'domcontentloaded', timeout:180000 });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(() => {
    // 找到汇总统计表所在 card
    const cards = [...document.querySelectorAll('.card')];
    const idx = cards.findIndex(c => /汇总统计表/.test(c.textContent));
    const card = cards[idx];
    const tbl = card.querySelector('table');
    const heads = [...tbl.querySelectorAll('thead tr')].map(tr => [...tr.children].map(th => th.textContent.trim()));
    const rows = [...tbl.querySelectorAll('tbody tr')];
    const pick = (re) => rows.find(tr => tr.children[0] && re.test(tr.children[0].textContent.trim()));
    const dump = (tr) => tr ? [...tr.children].map(td => td.textContent.trim()) : null;
    return { headerRows: heads, w35: dump(pick(/^W35/)), w36: dump(pick(/^W36/)), w37: dump(pick(/^W37/)),
             allWeeks: rows.map(tr => tr.children[0] ? tr.children[0].textContent.trim() : '') , colCount: heads.length };
  });
  console.log('表头行数:', out.headerRows.length, '| 列数:', out.colCount);
  out.headerRows.forEach((h,i)=>console.log('  hdr'+i+':', h.join(' | ')));
  console.log('\n周列:', out.allWeeks.join(','));
  const hdr = out.headerRows[out.headerRows.length-1];
  for (const [wk, vals] of [['W35', out.w35], ['W36', out.w36], ['W37', out.w37]]) {
    console.log('\n=== ' + wk + ' 行 ===');
    if (!vals) { console.log('  未找到'); continue; }
    vals.forEach((v, i) => { if (v !== '' && v !== '—') console.log('  ' + String(hdr[i]||('col'+i)).padEnd(30) + ' = ' + v); });
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
