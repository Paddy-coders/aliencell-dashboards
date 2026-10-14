// 抓取 JoyBuy 开放平台「权限包」下各 API 的文档正文（用已登录的调试浏览器）
// 用法: node joybuy_fetch_doc2.js
// 产出: joybuy_doc/<apiName>.txt
const unsetProxies = () => {
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[k];
  }
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
};
unsetProxies();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APIS = [
  'listProducts', 'putOrderShipments', 'postOrderShipment', 'getWayBillTraces',
  'listCarriers', 'listOrders', 'getOrder', 'listOrderOaidAddresses'
];
const OUT = path.join(__dirname, 'joybuy_doc');

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /apiAuthPackage|doc\/api/.test(p.url()));
  if (!page) { console.log('没有已打开的文档标签页，先打开一个'); process.exit(2); }

  const saved = [];
  for (const name of APIS) {
    const item = page.locator('a,div,span,li').filter({ hasText: new RegExp(`^${esc(name)}$`) }).first();
    const clicked = await item.click({ timeout: 12000 }).then(() => true).catch(() => false);
    if (!clicked) { console.log(name, '— 定位失败'); continue; }
    await page.waitForTimeout(3500);
    const doc = await page.evaluate(() => ({
      url: location.href,
      text: (document.body.innerText || '').replace(/\r/g, '')
    }));
    const file = path.join(OUT, `${name}.txt`);
    fs.writeFileSync(file, `URL: ${doc.url}\n\n${doc.text}`, 'utf8');
    const hitProd = /api-eu\.joybuy\.com/.test(doc.text);
    const hitCn = /api-cn\.jd\.com/.test(doc.text);
    console.log(name.padEnd(24), doc.text.length, 'chars | api-eu:', hitProd, '| api-cn:', hitCn);
    saved.push(name);
  }
  console.log('\n保存', saved.length, '个文档到', OUT);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e && e.message); process.exit(2); });
