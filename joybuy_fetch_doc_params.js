// 批量抓取接口文档的 Request Parameters 明细（展开折叠表格后取文本）
// 用法: node joybuy_fetch_doc_params.js
// 产出: joybuy_doc/params_<apiName>.txt
//
// 关键发现：文档详情页可用 URL 直连 ——
//   https://open-portal.joybuy.com/#/doc/api?apiName=<接口名>&gwType=1&businessModel=1
//   会自动重定向到带 apiId 的完整地址，无需从左侧菜单逐级点开。
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const APIS = ['listVenderShops', 'listProducts', 'listSkus', 'listSkuStocks', 'listAfsOrders', 'getOrder'];
const OUT = path.join(__dirname, 'joybuy_doc');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];

  for (const name of APIS) {
    const page = await ctx.newPage();
    const url = `https://open-portal.joybuy.com/#/doc/api?apiName=${name}&gwType=1&businessModel=1`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('  goto warn', e.message));
    await sleep(7000);

    const info = await page.evaluate(() => ({
      url: location.href,
      ok: new RegExp('Request Parameters').test(document.body.innerText || '')
    }));

    // 展开所有折叠图标
    await page.evaluate(() => {
      document.querySelectorAll('.jd-table__expand-icon').forEach(el => el.click());
    });
    await sleep(3500);

    const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\r/g, ''));
    fs.writeFileSync(path.join(OUT, `params_${name}.txt`), `URL: ${info.url}\n\n${txt}`, 'utf8');

    const i = txt.indexOf('Request Parameters');
    const seg = i >= 0 ? txt.slice(i + 18, i + 1500) : '(无 Request Parameters 段)';
    console.log('========', name, '========');
    console.log(seg.replace(/\n{2,}/g, '\n').slice(0, 1400));
    console.log('');
    await page.close().catch(() => { });
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
