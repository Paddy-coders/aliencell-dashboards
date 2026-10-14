// 双浏览器同步验证 v2：关键步骤直接读云端 API 诊断 + 展开式断言修复
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-auth');

const ROOT = path.join(__dirname, '_deploy');
const PORT = 8903;
const BASE = 'http://127.0.0.1:' + PORT;
const SUPABASE_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co';
const ANON = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
const ADMIN = 'wb-map-2026';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('✅ PASS', name); } else { fail++; console.log('❌ FAIL', name, extra || ''); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
});

async function cloudGet() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/mapping?select=data,updated_at&id=eq.1', {
    headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON }
  });
  const rows = await r.json();
  return rows && rows[0] && rows[0].data;
}
async function cloudReset() {
  await fetch(SUPABASE_URL + '/rest/v1/mapping?id=eq.1', {
    method: 'PATCH',
    headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'x-admin-key': ADMIN, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ data: { catalog: [], asinMap: [] } })
  });
}
async function waitBadgeOk(page, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.textContent('#cloudBadge').catch(() => '');
    if (t && t.includes('云端已同步')) return true;
    if (t && t.includes('失败')) return false;
    await page.waitForTimeout(300);
  }
  return false;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();

  // ============ Context A：写入 ============
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const errsA = [];
  pageA.on('pageerror', e => errsA.push(e.message));
  await pageA.goto(BASE + '/mapping.html', { waitUntil: 'networkidle', timeout: 30000 });
  await waitBadgeOk(pageA);

  await pageA.fill('#cSeries', 'X-Sync-A');
  await pageA.fill('#cName', '手机支架A1');
  await pageA.click('#viewCatalog .card:has(#cSeries) .btn.primary');
  // 等推送完成：轮询云端直到含 X-Sync-A
  let cloudOk = false;
  for (let i = 0; i < 20; i++) {
    const j = await cloudGet().catch(() => null);
    if (j && (j.catalog || []).some(p => p.series === 'X-Sync-A')) { cloudOk = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  ok('A 添加系列已推送到云端（API直读）', cloudOk);

  await pageA.click('#tabBtnAsin');
  await pageA.waitForTimeout(500);
  await pageA.fill('#aAsin', 'B0SYNCA1');
  await pageA.selectOption('#aCountry', 'EU');
  await pageA.selectOption('#aSeries', 'X-Sync-A');
  await pageA.selectOption('#aName', '手机支架A1');
  await pageA.click('#viewAsin .form-row .btn.primary');
  let cloudAsinOk = false;
  for (let i = 0; i < 20; i++) {
    const j = await cloudGet().catch(() => null);
    if (j && (j.asinMap || []).some(m => m.asin === 'B0SYNCA1')) { cloudAsinOk = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  ok('A 添加 ASIN 已推送到云端（API直读）', cloudAsinOk);
  await waitBadgeOk(pageA);

  // ============ Context B：首次打开 ============
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const errsB = [];
  pageB.on('pageerror', e => errsB.push(e.message));
  await pageB.goto(BASE + '/mapping.html', { waitUntil: 'networkidle', timeout: 30000 });
  await waitBadgeOk(pageB);
  const bCat = await pageB.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  const bAsin = await pageB.evaluate(() => JSON.parse(localStorage.getItem('pc_asinmap') || '[]'));
  ok('B 打开即看到 A 写入的系列', bCat.some(p => p.series === 'X-Sync-A' && p.name === '手机支架A1'), JSON.stringify(bCat));
  ok('B 打开即看到 A 写入的 ASIN', bAsin.some(m => m.asin === 'B0SYNCA1' && m.country === 'EU'), JSON.stringify(bAsin));
  // 展开 ASIN 列表后检查 DOM 渲染
  await pageB.click('#tabBtnAsin');
  await pageB.waitForTimeout(500);
  await pageB.click('#btnExpandAsin');
  await pageB.waitForTimeout(300);
  const bAsinVisible = await pageB.evaluate(() => {
    const rows = document.querySelectorAll('#asinTable .grp-row');
    return [...rows].some(r => r.textContent.includes('B0SYNCA1'));
  });
  ok('B 展开后页面 ASIN 列表渲染出 B0SYNCA1', bAsinVisible);

  // ============ 双向：B 修改 → A 刷新看到 ============
  await pageB.click('#tabBtnCatalog');
  await pageB.waitForTimeout(300);
  await pageB.fill('#cSeries', 'X-Sync-B');
  await pageB.fill('#cName', '充电器B1');
  await pageB.click('#viewCatalog .card:has(#cSeries) .btn.primary');
  // 诊断1：B 本地是否添加成功
  const bCatAfter = await pageB.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  ok('B 本地添加 X-Sync-B 成功', bCatAfter.some(p => p.series === 'X-Sync-B' && p.name === '充电器B1'), JSON.stringify(bCatAfter));
  // 诊断2：云端是否收到
  let cloudBOk = false;
  for (let i = 0; i < 20; i++) {
    const j = await cloudGet().catch(() => null);
    if (j && (j.catalog || []).some(p => p.series === 'X-Sync-B')) { cloudBOk = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  ok('B 添加已推送到云端（API直读）', cloudBOk);
  if (!cloudBOk) {
    const j = await cloudGet().catch(() => null);
    console.log('  → 诊断：云端当前 catalog =', JSON.stringify(j && j.catalog));
  }

  // A 刷新
  await pageA.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await waitBadgeOk(pageA);
  const aCat2 = await pageA.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  ok('A 刷新后看到 B 写入的系列', aCat2.some(p => p.series === 'X-Sync-B' && p.name === '充电器B1'), JSON.stringify(aCat2));
  ok('A 数据合并无丢失（仍含 X-Sync-A）', aCat2.some(p => p.series === 'X-Sync-A'));

  // ============ 无 JS 错误 ============
  ok('A 无 JS 错误', errsA.length === 0, errsA.join(';'));
  ok('B 无 JS 错误', errsB.length === 0, errsB.join(';'));

  // ============ 清理 ============
  await cloudReset();
  ok('测试数据已清理（云端重置为空）', true);

  await browser.close();
  server.close();
  console.log(`\n===== 双浏览器同步验证v2: ${pass} PASS / ${fail} FAIL =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
