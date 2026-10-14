// _cmp_render.js — 渲染三看板，读出各自屏幕上的 KPI 实际数字（诊断用，勿入回归）
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('./playwright-auth');

const BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38';
const DEPLOY = path.join(BASE, '_deploy');
const SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1';
const SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, timeout: 15000 }, res => {
      const b = []; res.on('data', c => b.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(b).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  const cloud = (await fetchJson(SB_URL))[0].data;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 1000 } });
  const norm = (c) => {
    const out = { price: c && c.price ? c.price : 1380 };
    const cost = {}; Object.keys((c && c.cost) || {}).sort().forEach(k => { cost[k] = c.cost[k]; });
    Object.keys(cost).sort().forEach(k => { });
    return JSON.stringify({ price: out.price, cost: Object.keys(cost).sort().reduce((a, k) => (a[k] = cost[k], a), {}) });
  };
  await ctx.addInitScript((arg) => {
    localStorage.setItem('wb_auth', JSON.stringify({ access_token: 'x', user: { email: 'test@aliencell.com' } }));
    localStorage.setItem('pc_catalog', JSON.stringify(arg.catalog));
    localStorage.setItem('pc_asinmap', JSON.stringify(arg.asinMap));
    localStorage.setItem('pc_woot', JSON.stringify(arg.woot || []));
    localStorage.setItem('pc_woot_cfg', JSON.stringify(arg.wootCfg || null));
  }, cloud);

  const stub = { catalog: cloud.catalog, asinMap: cloud.asinMap, woot: cloud.woot || [], wootCfg: cloud.wootCfg || null };

  for (const file of ['daily.html', 'monthly.html', 'product.html']) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    await page.route('**/rest/v1/mapping*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: stub }]) }));
    await page.goto('file:///' + path.join(DEPLOY, file), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() => {
      const txt = (sel) => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
      const out = { kpis: txt('.kpis') || txt('#kpis') || txt('.kpi-grid') };
      // 抓所有可能是 KPI 卡的块
      const cards = [];
      document.querySelectorAll('[class*=kpi],[class*=card]').forEach(e => {
        const s = e.innerText ? e.innerText.replace(/\s+/g, ' ').trim() : '';
        if (s && s.length < 260 && /\d/.test(s)) cards.push(s);
      });
      out.cards = cards.slice(0, 18);
      out.title = (document.querySelector('h1') || {}).innerText || '';
      return out;
    });
    console.log('################## ' + file + ' ##################');
    console.log('标题:', info.title);
    console.log('KPI 区:', info.kpis ? info.kpis.slice(0, 700) : '(未找到 .kpis)');
    console.log('卡片样本:');
    (info.cards || []).slice(0, 14).forEach(c => console.log('   -', c.slice(0, 220)));
    if (errs.length) console.log('页面错误:', errs.slice(0, 3));
    console.log();
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
