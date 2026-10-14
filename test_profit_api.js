// 在利润系统页面上下文里直接调 productAsin/queryPage，验证可编程调用（单日 / ASIN 过滤 / 汇总）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = [];
  b.contexts().forEach(ctx => ctx.pages().forEach(p => pages.push(p)));
  const page = pages.find(p => p.url().includes('profit_system'));
  console.log('页面:', page.url().slice(0, 110));

  const body = (start, end, asins, pageSize) => JSON.stringify({
    selectOptionsConditionList: [
      { selectType: 'site', selectValue: [] },
      { selectType: 'userAccount', selectValue: [] },
      { selectType: 'transactionStatus', selectValue: [] },
      { selectType: 'category', selectValue: [] },
      { selectType: 'sellerStatus', selectValue: [] },
      { selectType: 'sellerUser', selectValue: [] },
      { selectType: 'isLowPrice', selectValue: [] },
      { selectType: 'tags', selectValue: [] }
    ],
    inputOptionsConditionList: [
      { inputType: 'asin', inputValue: asins || [] },
      { inputType: 'brand', inputValue: [] }
    ],
    timeCondition: { timeType: 'dateTime', startTime: start, endTime: end },
    dateType: 'd',
    currencyCode: 'ORIGINAL',
    pageNo: 1,
    pageSize: pageSize || 100,
    timeArea: 'SITE',
    profitFormulaType: 1,
    costType: '1',
    chargeType: 'ord',
    dimension: 'ctm',
    parentAsin: 0
  });

  const ctxReq = page.context().request;
  const TOKEN = await page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('pro__Access-Token') || '{}').value) || ''; } catch (e) { return ''; }
  });
  console.log('token 前缀:', TOKEN.slice(0, 24));
  const query = async (start, end, asins, pageSize) => {
    const r = await ctxReq.post('https://datacenter.eccang.com/ratel/api/productAsin/queryPage', {
      headers: {
        'Content-Type': 'application/json',
        'authorization': TOKEN,
        'x-access-token': TOKEN,
        'company': 'ntvb7tr',
        'referer': 'https://home.eccang.com/'
      },
      data: body(start, end, asins, pageSize),
      timeout: 60000
    });
    return await r.json();
  };

  const sum = (j) => {
    const rows = (j.data && j.data.records) || [];
    const pick = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      total: j.data && j.data.total,
      rows: rows.length,
      销售额: +pick('productSalesTotal').toFixed(2),
      促销折扣: +pick('promotionalRebatesTotal').toFixed(2),
      销售佣金: +pick('sellingFeesTotal').toFixed(2),
      配送费: +pick('fbaFeesTotal').toFixed(2),
      广告费: +pick('otherTransactionFeeTotal').toFixed(2),
      商品成本: +pick('productCostTotal').toFixed(2),
      FBA月仓储费: +pick('fbaMonthStorageFee').toFixed(2),
      推广服务费: +pick('couponAndLightningDealFeeTotal').toFixed(2),
      服务费: +pick('serviceFeeTotal').toFixed(2),
      ERP毛利: +pick('grossProfitTotal').toFixed(2)
    };
  };

  // 1) 单日（2026-10-05）
  let j = await query('2026-10-05 00:00:00', '2026-10-05 23:59:59', null, 200);
  console.log('\n== 单日 2026-10-05 ==');
  console.log(JSON.stringify(sum(j)));

  // 2) 两个核心 ASIN · 9月整月
  j = await query('2026-09-01 00:00:00', '2026-09-30 23:59:59', ['B0G25G961Y', 'B0FN3NPF7Y'], 200);
  console.log('\n== 9月 · 核心两 ASIN ==');
  console.log(JSON.stringify(sum(j)));
  const rows = (j.data && j.data.records) || [];
  rows.slice(0, 6).forEach(r => console.log(' ', r.date, r.site, r.userAccount, r.asin, r.sellerSku, '销售额', r.productSalesTotal, '成本', r.productCostTotal, '毛利', r.grossProfitTotal));

  // 3) 9月全量分页数
  j = await query('2026-09-01 00:00:00', '2026-09-30 23:59:59', null, 500);
  console.log('\n== 9月全量 ==');
  console.log(JSON.stringify(sum(j)));

  await b.close().catch(() => {});
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
