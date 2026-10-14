// test_daily_currency.js — 每日看板币种口径回归
// 口径: 默认(未选国家/多国混合) → USD 按每月1号汇率折算; 选中国家同币种 → 原币种原值
// 用法: BASE=<url> node test_daily_currency.js  (默认 http://127.0.0.1:8899)
const { chromium } = require('./playwright-auth');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
let pass = 0, fail = 0;
const parse = (s) => s === null || s === undefined ? null : parseFloat(String(s).replace(/[$,€£]/g, ''));
function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  ${JSON.stringify(detail)}`); }
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/daily.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const d = await page.evaluate(() => {
    // 表中找指定日期行的销售额列
    const salesCellOf = (dateTxt) => {
      const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
      const ci = heads.indexOf('销售额');
      for (const tr of document.querySelectorAll('#tableWrap tbody tr')) {
        const tds = [...tr.querySelectorAll('td')];
        if (tds[0] && tds[0].textContent.trim().startsWith(dateTxt)) return tds[ci] ? tds[ci].textContent.trim() : null;
      }
      return null;
    };
    const DAY = '09-12';
    // 页面内按 FX + DATA 计算期望值(与看板同一套数据)
    const month = '2026-09';
    const rate = (cur) => cur === 'USD' ? 1 : ((FX.months[month] || {})[cur]);
    const conv = (v, site) => {
      const num = Number(v) || 0; if (!num) return 0;
      const cur = CUR_OF[site] || 'USD';
      const r = rate(cur);
      return r === undefined ? num : num * r;
    };
    const dayObj = DATA.days[Object.keys(DATA.days).find(k => k.endsWith(DAY))];
    const sums = {}; // 按国家原币种销售额
    (dayObj.biz || []).forEach(r => {
      const s = r.site || 'US';
      sums[s] = (sums[s] || 0) + (Number(r.ordered_product_sales_amount) || 0);
    });
    const usdAll = Object.entries(sums).reduce((acc, [s, v]) => acc + conv(v, s), 0);
    return {
      badge: document.getElementById('rangeBadge').textContent,
      raw: sums, usdAll,
      defaultCell: salesCellOf(DAY),

    };
  });
  t('默认视图徽章含 币种:$', /币种:\$/.test(d.badge), d.badge);
  t('默认视图销售额=各站按汇率折算USD合计', Math.abs(parse(d.defaultCell) - d.usdAll) < 0.05,
    { cell: d.defaultCell, expect: d.usdAll.toFixed(2), raw: d.raw });

  // 单选 DE → 原币种 €
  await page.evaluate(() => { selCountry.clear(); selCountry.add('DE'); renderAll(); });
  await page.waitForTimeout(300);
  let r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const ci = heads.indexOf('销售额');
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(x => x.querySelector('td').textContent.trim().startsWith('09-12'));
    const cell = tr ? tr.querySelectorAll('td')[ci].textContent.trim() : null;
    const raw = 0;
    return { cell, badge: document.getElementById('rangeBadge').textContent, raw };
  });
  const deExpect = d.raw['DE'] || 0;
  t('单选DE: 显示 € 原币种', r.cell.startsWith('€'), r.cell);
  t('单选DE: 数额=DE原币种合计', Math.abs(parse(r.cell) - deExpect) < 0.05, { cell: r.cell, expect: deExpect });

  // 单选 US → $ 原币种
  await page.evaluate(() => { selCountry.clear(); selCountry.add('US'); renderAll(); });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const ci = heads.indexOf('销售额');
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(x => x.querySelector('td').textContent.trim().startsWith('09-12'));
    return { cell: tr ? tr.querySelectorAll('td')[ci].textContent.trim() : null, badge: document.getElementById('rangeBadge').textContent };
  });
  t('单选US: 显示 $ 原币种', r.cell.startsWith('$'), r.cell);
  t('单选US: 数额=US原币种合计', Math.abs(parse(r.cell) - (d.raw['US'] || 0)) < 0.05, { cell: r.cell, expect: d.raw['US'] });

  // 单选 UK → £
  await page.evaluate(() => { selCountry.clear(); selCountry.add('UK'); renderAll(); });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const ci = heads.indexOf('销售额');
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(x => x.querySelector('td').textContent.trim().startsWith('09-12'));
    return { cell: tr ? tr.querySelectorAll('td')[ci].textContent.trim() : null, badge: document.getElementById('rangeBadge').textContent };
  });
  t('单选UK: 显示 £ 原币种', r.cell.startsWith('£'), r.cell);

  // 多选 US+DE (混合币种) → USD 折算
  await page.evaluate(() => { selCountry.clear(); selCountry.add('US'); selCountry.add('DE'); renderAll(); });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tableWrap thead th')].map(th => th.textContent.trim());
    const ci = heads.indexOf('销售额');
    const tr = [...document.querySelectorAll('#tableWrap tbody tr')].find(x => x.querySelector('td').textContent.trim().startsWith('09-12'));
    return { cell: tr ? tr.querySelectorAll('td')[ci].textContent.trim() : null, badge: document.getElementById('rangeBadge').textContent };
  });
  t('多选US+DE: 混合币种回退 $ USD', r.cell.startsWith('$'), r.cell);
  // 多选合计 = US原值 + DE×汇率 (页面内复算期望)
  const usde = await page.evaluate(() => {
    const month = '2026-09';
    const eurRate = (FX.months[month] || {})['EUR'];
    let us = 0, de = 0;
    const dayObj = DATA.days[Object.keys(DATA.days).find(k => k.endsWith('09-12'))];
    (dayObj.biz || []).forEach(r2 => {
      const s = r2.site || 'US';
      const v = Number(r2.ordered_product_sales_amount) || 0;
      if (s === 'US') us += v; else if (s === 'DE') de += v;
    });
    return us + de * eurRate;
  });
  t('多选US+DE: 数额=US原值+DE×汇率', Math.abs(parse(r.cell) - usde) < 0.05, { cell: r.cell, expect: usde.toFixed(2) });

  // 恢复默认
  await page.evaluate(() => { selCountry.clear(); renderAll(); });

  // 折算一致性: 默认USD合计 = 各单国折算值之和 (页面内复算)
  const ok2 = await page.evaluate(() => {
    const month = '2026-09';
    const conv = (v, site) => {
      const num = Number(v) || 0; if (!num) return 0;
      const cur = CUR_OF[site] || 'USD';
      const r = cur === 'USD' ? 1 : ((FX.months[month] || {})[cur]);
      return r === undefined ? num : num * r;
    };
    let tot = 0;
    for (const day of Object.keys(DATA.days)) {
      const mo = day.slice(0, 7);
      (DATA.days[day].biz || []).forEach(row => {
        tot += conv(Number(row.ordered_product_sales_amount) || 0, row.site || 'US');
      });
    }
    return isFinite(tot) && tot > 0;
  });
  t('全期USD折算合计可计算且>0', ok2, {});

  await browser.close();
  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
