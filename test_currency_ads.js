// 测试: 周度汇总广告数据同步(Bug1) + 货币本地化换算(Bug2)
// 运行: NODE_PATH=<workspace>/node_modules node test_currency_ads.js
const { chromium } = require('./playwright-auth');

const PRODUCT = 'file:///C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33/filterable_dashboard.html';
const MONTHLY = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/monthly.html';

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ok  ' + name + (info !== undefined ? ' | ' + JSON.stringify(info) : '')); }
  else { fail++; console.log('  FAIL ' + name + ' | ' + JSON.stringify(info)); }
}

(async () => {
  const browser = await chromium.launch();

  // ==================== 1) 周度汇总 product.html ====================
  {
    console.log('== 周度汇总 product.html ==');
    const page = await browser.newPage();
    await page.goto(PRODUCT, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // --- Bug1: W34 广告数据 ---
    const w34 = await page.evaluate(() => {
      const d = asinWeekData('B0H69JJZ1M', 'W34');
      return d ? { adSpend: d.adSpend, adClicks: d.adClicks, adImpressions: d.adImpressions, sales: d.sales } : null;
    });
    t('W34 广告花费存在且>0 (B0H69JJZ1M)', w34 && w34.adSpend > 3000, w34);
    t('W34 广告点击>0', w34 && w34.adClicks > 500, w34 && w34.adClicks);

    // 全部 ASIN W34 广告花费合计 (US 3535.44 + DE 145.5 换算成 USD)
    const w34tot = await page.evaluate(() => {
      let spend = 0;
      DATA.asin_list.forEach(a => { const d = asinWeekData(a, 'W34'); if (d) spend += d.adSpend; });
      return spend;
    });
    const expectW34 = await page.evaluate(() => {
      let s = 0;
      Object.keys(ADS).forEach(a => {
        const w = ADS[a].weeks['W34']; if (!w) return;
        Object.keys(w).forEach(c => { s += fxv(w[c].spend || 0, c); });
      });
      return s;
    });
    t('W34 全ASIN广告花费(USD) 合计与逐国换算一致', Math.abs(w34tot - expectW34) < 0.01, { w34tot, expectW34 });
    t('W34 广告花费 > 3500 (含DE换算)', w34tot > 3500, w34tot);

    // 表格 W34 行的广告花费单元格
    const cell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sumBody tr')];
      const tr = rows.find(r => r.cells[0] && r.cells[0].textContent.includes('W34'));
      if (!tr) return null;
      const idx = METRICS.findIndex(m => m.key === 'ad_spend');
      return tr.cells[idx + 1] ? tr.cells[idx + 1].textContent : null;
    });
    t('表格 W34 行广告花费单元格非空非—', cell && !cell.includes('—') && cell.includes('$'), cell);

    // --- Bug2: 货币 ---
    const cur0 = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('默认(全部) → USD / $', cur0.tc === 'USD' && cur0.sym === '$', cur0);

    // 选 EU 地区
    await page.evaluate(() => { selRegion.clear(); selRegion.add('EU'); selCountry.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curEU = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('选 EU 地区 → EUR / €', curEU.tc === 'EUR' && curEU.sym === '€', curEU);

    const deAd = await page.evaluate(() => {
      const d = asinWeekData('B0HCXVRB21', 'W34');
      return d ? d.adSpend : null;
    });
    t('EU 下 DE 广告花费保持 EUR 原值(145.5)', Math.abs(deAd - 145.5) < 0.01, deAd);

    const kpiEU = await page.evaluate(() => document.getElementById('kpiRow').textContent);
    t('EU 下 KPI 金额显示 €', kpiEU.includes('€'), null);

    // 选单国 US
    await page.evaluate(() => { selRegion.clear(); selCountry.clear(); selCountry.add('US'); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curUS = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('选 US 单国 → USD / $', curUS.tc === 'USD' && curUS.sym === '$', curUS);

    // 选单国 DE
    await page.evaluate(() => { selCountry.clear(); selCountry.add('DE'); selRegion.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curDE = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('选 DE 单国 → EUR / €', curDE.tc === 'EUR' && curDE.sym === '€', curDE);

    // 跨地区多选 US+DE → USD
    await page.evaluate(() => { selCountry.clear(); selCountry.add('US'); selCountry.add('DE'); selRegion.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curMix = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('跨地区 US+DE → USD / $', curMix.tc === 'USD' && curMix.sym === '$', curMix);

    // 换算正确性: DE W34 广告花费 145.5 EUR → USD
    const deInUSD = await page.evaluate(() => asinWeekData('B0HCXVRB21', 'W34').adSpend);
    const expectDE = await page.evaluate(() => fxv(145.5, 'DE'));
    t('US+DE 下 DE 花费换算为 USD', Math.abs(deInUSD - expectDE) < 0.01 && deInUSD > 145.5, { deInUSD, expectDE });

    await page.close();
  }

  // ==================== 2) 月度 monthly.html ====================
  {
    console.log('== 月度 monthly.html ==');
    const page = await browser.newPage();
    await page.goto(MONTHLY, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const cur0 = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('默认(全部) → USD / $', cur0.tc === 'USD' && cur0.sym === '$', cur0);

    // fxv 换算正确性 (2026-08: EUR 7.7539 / USD 6.7513)
    const fxvTest = await page.evaluate(() => {
      const r = FX['2026-08'];
      return { raw: fxv(100, 'DE', '2026-08'), expect: 100 * r.EUR / r.USD, rates: r };
    });
    t('fxv: 100 EUR → USD 换算正确', Math.abs(fxvTest.raw - fxvTest.expect) < 0.01, fxvTest);

    // 默认(USD) vs 选EU(EUR) 的销售额对比: 应不相等且比例≈汇率
    const salesCmp = await page.evaluate(() => {
      const rows = filteredRows();
      const aug = aggMonth('2026-08', rows);
      return { usd: aug.sales };
    });
    await page.evaluate(() => { selRegion.clear(); selRegion.add('EU'); selCountry.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curEU = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('月度选 EU → EUR / €', curEU.tc === 'EUR' && curEU.sym === '€', curEU);
    const salesEU = await page.evaluate(() => {
      const rows = filteredRows();
      return aggMonth('2026-08', rows).sales;
    });
    t('月度 EU 销售额 ≠ USD 销售额 (发生换算)', Math.abs(salesEU - salesCmp.usd) > 1, { usd: salesCmp.usd, eur: salesEU });

    // 选单国 US → USD; 选单国 DE → EUR
    await page.evaluate(() => { selRegion.clear(); selCountry.clear(); selCountry.add('US'); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curUS = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('月度选 US → USD / $', curUS.tc === 'USD' && curUS.sym === '$', curUS);
    await page.evaluate(() => { selCountry.clear(); selCountry.add('DE'); selRegion.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const curDE = await page.evaluate(() => ({ tc: targetCur(), sym: curSym() }));
    t('月度选 DE → EUR / €', curDE.tc === 'EUR' && curDE.sym === '€', curDE);

    // 恢复默认, KPI 金额显示 $
    await page.evaluate(() => { selCountry.clear(); selRegion.clear(); ((typeof syncAndRender==='function')?syncAndRender():renderAll()); });
    const kpiTxt = await page.evaluate(() => document.getElementById('kpiRow').textContent);
    t('月度默认 KPI 金额显示 $', kpiTxt.includes('$'), null);

    await page.close();
  }

  await browser.close();
  console.log('===== Results: ' + pass + ' pass, ' + fail + ' fail =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
