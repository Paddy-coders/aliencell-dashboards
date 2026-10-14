// 临时探针: 月看板 合并/官方/Woot 三视图毛利(每文件独立 context + 重试, 规避 cloudSync 的 reload) —— 不入回归
const https = require('https');
const { chromium } = require('./playwright-auth');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
function fetchJson(url){return new Promise((res,rej)=>{const r=https.get(url,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},timeout:15000},s=>{const b=[];s.on('data',c=>b.push(c));s.on('end',()=>{try{res(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(e){rej(e)}})});r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);});}

async function evalWithRetry(page, fn, arg) {
  for (let i = 0; i < 4; i++) {
    try { return await page.evaluate(fn, arg); }
    catch (e) {
      if (/Execution context was destroyed/.test(String(e))) { await page.waitForTimeout(6000); continue; }
      throw e;
    }
  }
  throw new Error('evaluate 重试 4 次仍失败');
}

(async () => {
  const cloud = (await fetchJson(SB_URL))[0].data;
  const files = process.argv[2] ? [process.argv[2]] : ['monthly.html'];
  const b = await chromium.launch();
  for (const f of files) {
    const ctx = await b.newContext({ viewport: { width: 2400, height: 1200 } });
    await ctx.addInitScript((arg) => {
      localStorage.setItem('wb_auth', JSON.stringify({ access_token:'x', user:{email:'t@aliencell.com'} }));
      localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
      localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
      localStorage.setItem('pc_woot', JSON.stringify(arg.woot));
      localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || { price: 1380, cost: {} }));
    }, { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [], woot: cloud.woot || [], wootCfg: cloud.wootCfg || null });
    const page = await ctx.newPage();
    await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ data: { catalog: cloud.catalog || [], asinMap: cloud.asinMap || [], woot: cloud.woot || [], wootCfg: cloud.wootCfg || null } }]) }));
    await page.goto('file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/' + f, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForTimeout(10000);
    const out = await evalWithRetry(page, () => {
      const R = {};
      const months = ['2026-09', '2026-10'];
      R.unit = (typeof wootUnitCost === 'function') ? wootUnitCost('B0H69JJZ1M') : 'no fn';
      const setCh = (ids) => {
        if (typeof selChannel === 'undefined') return 'no selChannel';
        selChannel.clear(); ids.forEach(i => selChannel.add(i));
        if (typeof renderAll === 'function') renderAll();
        return 'ok';
      };
      R.views = {};
      for (const [label, ids] of [['合并', ['amazon', 'woot']], ['官方店铺', ['amazon']], ['Woot店铺', ['woot']]]) {
        setCh(ids);
        const rows = (typeof filteredRows === 'function') ? filteredRows() : [];
        const agg = rows.reduce((a, x) => {
          const po = (typeof profitOf === 'function') ? profitOf(x) : null;
          a.profit += (po === null || po === undefined) ? 0 : po;
          a.anyP += po ? 1 : 0;
          a.sales += +(x.sales || 0); a.orders += +(x.orders || 0); a.ad += +(x.adCost || 0);
          a.pSales += +(x.pSales || 0); a.pCost += +(x.pCost || 0); a.pHead += +(x.pHead || 0);
          return a;
        }, { profit: 0, sales: 0, orders: 0, ad: 0, pSales: 0, pCost: 0, pHead: 0, anyP: 0 });
        R.views[label] = agg;
      }
      // 月份维度: 只看 2026-09
      setCh(['amazon', 'woot']);
      const all = (typeof filteredRows === 'function') ? filteredRows() : [];
      R.byMonth = {};
      for (const m of months) {
        const rr = all.filter(x => x.ym === m);
        R.byMonth[m] = {
          profit: rr.reduce((s, x) => s + ((typeof profitOf === 'function' && profitOf(x)) || 0), 0),
          sales: rr.reduce((s, x) => s + (+x.sales || 0), 0),
          ad: rr.reduce((s, x) => s + (+x.adCost || 0), 0),
          n: rr.length,
        };
      }
      return R;
    });
    console.log('\n===== ' + f + ' =====');
    console.log(JSON.stringify(out, null, 1));
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
