// _probe_update_bar.js — 复现「云端数据已更新」提示条常驻
// 用法: node _probe_update_bar.js [page.html]
// 前置: python -m http.server 8899 -d _deploy
const { chromium } = require('./playwright-auth');

const PAGE = process.argv[2] || 'monthly.html';
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

(async () => {
  // 1) 拉真实云端
  const r = await fetch(SB_URL, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  const cloud = (await r.json())[0].data;
  console.log('云端 keys =', Object.keys(cloud).join(','));
  console.log('云端 wootCfg 原始 JSON =', JSON.stringify(cloud.wootCfg));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 2) 种入「页面自己规范化后」的本机缓存（等价于用户先打开过一次看板）
  await page.goto(`${BASE}/${PAGE}`);
  await page.evaluate(([d]) => {
    localStorage.setItem('pc_woot', JSON.stringify(d.woot || []));
    localStorage.setItem('pc_catalog', JSON.stringify(d.catalog || []));
    localStorage.setItem('pc_asinmap', JSON.stringify(d.asinMap || []));
    // 复刻看板 load 同步的规范化写法（键顺序 price, cost）
    const c = d.wootCfg || {};
    localStorage.setItem('pc_woot_cfg', JSON.stringify({
      price: Number(c.price) > 0 ? Number(c.price) : 1380,
      cost: (c.cost && typeof c.cost === 'object') ? c.cost : {},
    }));
  }, [cloud]);

  // 3) 重新加载，等首检(5s)＋余量
  await page.goto(`${BASE}/${PAGE}?probe=${Date.now()}`);
  await page.waitForTimeout(9000);

  // 4) 取三路签名与逐段比对
  const info = await page.evaluate(() => {
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? d : v; } catch (e) { return d; } };
    const stable = v => Array.isArray(v)
      ? '[' + v.map(stable).join(',') + ']'
      : (v && typeof v === 'object'
        ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
        : JSON.stringify(v === undefined ? null : v));
    const normCfg = c => (!c || typeof c !== 'object') ? null
      : { price: Number(c.price) > 0 ? Number(c.price) : 1380, cost: (c.cost && typeof c.cost === 'object') ? c.cost : {} };
    const localSig = () => {
      const lc = normCfg(lsGet('pc_woot_cfg', null));
      return stable(lsGet('pc_woot', [])) + '\u0001' + stable(lsGet('pc_catalog', [])) + '\u0001'
        + stable(lsGet('pc_asinmap', [])) + '\u0001' + (lc === null ? '' : stable(lc));
    };
    const bar = document.getElementById('wbUpdateBar');
    const kpis = [...document.querySelectorAll('#kpiRow .kpi, .kpi')].map(c => ((c.querySelector('.kpi-label') || {}).innerText || '').trim() + '=' + ((c.querySelector('.kpi-value') || {}).innerText || '').trim());
    return {
      barVisible: !!(bar && getComputedStyle(bar).display !== 'none'),
      localSig: localSig(),
      localKeys: {
        pc_woot: (localStorage.getItem('pc_woot') || '').slice(0, 40),
        pc_catalog_len: (localStorage.getItem('pc_catalog') || '').length,
        pc_asinmap_len: (localStorage.getItem('pc_asinmap') || '').length,
        pc_woot_cfg: localStorage.getItem('pc_woot_cfg'),
      },
      kpis: kpis.slice(0, 24),
    };
  });

  // 独立算 cloudSig（按页面同款稳定序列化 + wootCfg 规范化）
  const stable = v => Array.isArray(v)
    ? '[' + v.map(stable).join(',') + ']'
    : (v && typeof v === 'object'
      ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
      : JSON.stringify(v === undefined ? null : v));
  const normCfg = c => (!c || typeof c !== 'object') ? null
    : { price: Number(c.price) > 0 ? Number(c.price) : 1380, cost: (c.cost && typeof c.cost === 'object') ? c.cost : {} };
  const lc = normCfg(JSON.parse(info.localKeys.pc_woot_cfg || 'null'));
  const cc = normCfg(cloud.wootCfg);
  const cloudSig = stable(cloud.woot) + '\u0001'
    + stable(Array.isArray(cloud.catalog) ? cloud.catalog : []) + '\u0001'
    + stable(Array.isArray(cloud.asinMap) ? cloud.asinMap : []) + '\u0001'
    + (lc === null ? '' : stable(cc === null ? lc : cc));

  const L = info.localSig.split('\u0001'), C = cloudSig.split('\u0001');
  const names = ['pc_woot ↔ woot', 'pc_catalog ↔ catalog', 'pc_asinmap ↔ asinMap', 'pc_woot_cfg ↔ wootCfg'];
  console.log('\n=== 页面:', PAGE, '| 提示条可见 =', info.barVisible, '===');
  console.log('本机 pc_woot_cfg =', info.localKeys.pc_woot_cfg);
  console.log('云端 wootCfg      =', JSON.stringify(cloud.wootCfg));
  console.log('\n--- 四段签名逐段比对（相等=✅ 不等=❌）---');
  names.forEach((n, i) => {
    const a = L[i] || '', b = C[i] || '';
    console.log((a === b ? '  ✅ ' : '  ❌ ') + n.padEnd(24) + (a === b ? '' : '\n       本机: ' + a.slice(0, 120) + '\n       云端: ' + b.slice(0, 120)));
  });
  console.log('\n整体 localSig === cloudSig :', info.localSig === cloudSig);

  console.log('\n--- KPI（找 83,701.90）---');
  info.kpis.forEach(k => console.log('  ' + k));

  await browser.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
