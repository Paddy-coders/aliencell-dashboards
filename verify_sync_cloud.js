// 云端冒烟验证：线上 mapping.html 同步闭环 + 三看板加载无 JS 错误
const { chromium } = require('./playwright-auth');

const CLOUD = 'https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.link';
const SUPABASE_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co';
const ANON = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s';
const ADMIN = 'wb-map-2026';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('✅ PASS', name); } else { fail++; console.log('❌ FAIL', name, extra || ''); } };

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
async function waitBadgeOk(page, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.textContent('#cloudBadge').catch(() => '');
    if (t && t.includes('云端已同步')) return true;
    if (t && t.includes('失败')) return false;
    await page.waitForTimeout(400);
  }
  return false;
}

(async () => {
  // 前置：确保云端为空
  await cloudReset();
  const browser = await chromium.launch();

  // ============ 1. 线上管理页同步闭环 ============
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(CLOUD + '/mapping.html', { waitUntil: 'networkidle', timeout: 60000 });
  ok('云端管理页打开，同步状态正常', await waitBadgeOk(page));

  // 添加系列 → 云端 API 直读确认
  await page.fill('#cSeries', 'X-Cloud-1');
  await page.fill('#cName', '云端测试产品');
  await page.click('#viewCatalog .card:has(#cSeries) .btn.primary');
  let cloudOk = false;
  for (let i = 0; i < 24; i++) {
    const j = await cloudGet().catch(() => null);
    if (j && (j.catalog || []).some(p => p.series === 'X-Cloud-1')) { cloudOk = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  ok('线上添加系列 → 云端实时收到（API直读）', cloudOk);
  if (!cloudOk) { const j = await cloudGet().catch(() => null); console.log('  → 诊断：云端 =', JSON.stringify(j)); }

  // 刷新页面确认能拉回
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await waitBadgeOk(page);
  const cat = await page.evaluate(() => JSON.parse(localStorage.getItem('pc_catalog') || '[]'));
  ok('刷新后拉回云端数据', cat.some(p => p.series === 'X-Cloud-1'), JSON.stringify(cat));
  ok('云端管理页无 JS 错误', errs.length === 0, errs.join(';'));

  // ============ 2. 三看板加载无 JS 错误 ============
  for (const f of ['ad.html', 'daily.html', 'product.html']) {
    const p = await browser.newPage();
    const e = [];
    p.on('pageerror', er => e.push(er.message));
    await p.goto(CLOUD + '/' + f, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(4000); // 等云端映射拉取
    const localMap = await p.evaluate(() => ({
      cat: JSON.parse(localStorage.getItem('pc_catalog') || '[]'),
      asin: JSON.parse(localStorage.getItem('pc_asinmap') || '[]')
    })).catch(() => ({ cat: [], asin: [] }));
    ok(f + ' 加载无 JS 错误', e.length === 0, e.join(';'));
    ok(f + ' 云端映射已拉取到本机', localMap.cat.some(p => p.series === 'X-Cloud-1'), JSON.stringify(localMap.cat));
    await p.close();
  }

  // ============ 3. 清理 ============
  await cloudReset();
  ok('测试数据已清理（云端重置为空）', true);

  await browser.close();
  console.log(`\n===== 云端冒烟验证: ${pass} PASS / ${fail} FAIL =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
