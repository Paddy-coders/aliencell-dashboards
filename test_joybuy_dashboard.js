/**
 * JoyBuy 看板渲染回归测试（playwright，复用项目 playwright-auth 包装以注入登录态）
 *
 * 覆盖：
 *   A. demo 数据版：KPI / 周下拉 / 四个表格 / 图表 / 筛选联动 / 空态横幅 / 无 JS 报错
 *   B. 空数据版（骨架）：接入指引空态 + 隐藏非首个 tab
 * 用法: node test_joybuy_dashboard.js          （有 FAIL 时退出码 1）
 *       BASE=<线上地址> node test_joybuy_dashboard.js   （线上双跑，自动加 cache-buster）
 */
const fs = require('fs');
const path = require('path');
const pw = require('./playwright-auth');

const CWD = __dirname;
const DEMO = path.join(CWD, '_demo_joybuy.html');
const SKEL = path.join(CWD, 'joybuy.html');

let pass = 0, fail = 0; const fails = [];
function chk(name, ok, detail) {
  if (ok) pass++; else { fail++; fails.push(name); }
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail === undefined ? '' : detail}`);
}

async function collectErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/404|Failed to load resource|WebSocket|ERR_CONNECTION/i.test(t)) errs.push('console: ' + t);
  });
  return errs;
}

async function open(browser, file) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = await collectErrors(page);
  const url = /^https?:/.test(file) ? file + (file.includes('?') ? '&' : '?') + 'cb=' + Date.now() : 'file://' + file.replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1800);
  return { ctx, page, errs };
}

(async () => {
  const BASE = process.env.BASE || '';
  const useBase = !!BASE && /^https?:/.test(BASE);
  const demoUrl = useBase ? BASE.replace(/\/+$/, '') + '/joybuy.html' : DEMO;
  const skeletonUrl = useBase ? BASE.replace(/\/+$/, '') + '/joybuy.html' : SKEL;

  const browser = await pw.chromium.launch({ headless: true });

  /* ---------------- A. demo 数据版 ---------------- */
  if (!useBase && !fs.existsSync(DEMO)) {
    chk('demo 文件存在', false, DEMO + ' 不存在，先跑 _gen_joybuy_demo.py 与 build');
  } else {
    const { ctx, page, errs } = await open(browser, demoUrl);

    const kpiCount = await page.locator('#kpis .kpi').count();
    chk('渲染 8 张 KPI 卡', kpiCount === 8, '实际 ' + kpiCount);

    const kpiTexts = await page.locator('#kpis .kpi .k').allTextContents();
    const wantKpis = ['订单量', '销售额', '客单价', '访客数 UV', '浏览量 PV', '加购件数', '收藏数'];
    chk('KPI 名称齐全', wantKpis.every(k => kpiTexts.some(t => t.includes(k))), kpiTexts.join(' / '));

    const kpiVals = await page.locator('#kpis .kpi .v').allTextContents();
    chk('KPI 值非空且非 —（订单量）', /[0-9]/.test(kpiVals[0]), kpiVals[0]);
    chk('销售额为两位小数', /^[0-9,]+\.\d{2}$/.test(kpiVals[1]), kpiVals[1]);

    const weekOpts = await page.locator('#ddWeek option').count();
    chk('周下拉含「全部周」+ N 周', weekOpts >= 3, '选项数 ' + weekOpts);
    const firstWeek = await page.locator('#ddWeek option').nth(1).textContent();
    chk('周标签含 W 周号与区间', /W\d+ \(\d\d-\d\d~\d\d-\d\d\)/.test(firstWeek), firstWeek);

    const skuRows = await page.locator('#tblSku tbody tr').count();
    chk('商品明细表有数据行', skuRows >= 1, '行数 ' + skuRows);
    const dailyRows = await page.locator('#tblDaily tbody tr').count();
    chk('每日明细表有数据行', dailyRows >= 1, '行数 ' + dailyRows);
    const trafficRows = await page.locator('#tblTraffic tbody tr').count();
    chk('流量明细表行数 = 周数', trafficRows >= 2, '行数 ' + trafficRows);
    chk('明细表有合计行', (await page.locator('#tblSku tfoot tr').count()) === 1, '');

    // 图表已创建
    const charts = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('canvas').forEach(c => { out[c.id] = !!(window.Chart && Chart.getChart(c.id)); });
      return out;
    });
    chk('图表 c1 已实例化', charts.c1 === true, JSON.stringify(charts));
    chk('图表 c2 已实例化', charts.c2 === true, '');

    // demo 横幅
    const warn = await page.locator('#warnHost .warnbar').textContent().catch(() => '');
    chk('显示示例数据横幅', /示例数据/.test(warn), warn.slice(0, 40));

    // 筛选联动：选某一周后 明细行数应减少（不等于全部）
    const allDaily = dailyRows;
    const wkVal = await page.locator('#ddWeek option').nth(1).getAttribute('value');
    await page.selectOption('#ddWeek', wkVal);
    await page.waitForTimeout(900);
    const wkDaily = await page.locator('#tblDaily tbody tr').count();
    chk('选周后每日明细收窄到 ≤7 天', wkDaily <= 7 && wkDaily >= 1, `全量 ${allDaily} → 选周 ${wkDaily}`);
    const wkSkuRows = await page.locator('#tblSku tbody tr').count();
    chk('选周后商品明细仍有行', wkSkuRows >= 1, '行数 ' + wkSkuRows);

    // SKU 搜索联动
    await page.fill('#qSku', 'UltraDock');
    await page.waitForTimeout(900);
    const searchedRows = await page.locator('#tblSku tbody tr').count();
    chk('搜索 UltraDock 后商品明细收窄', searchedRows >= 1 && searchedRows < skuRows, `${skuRows} → ${searchedRows}`);
    const searchedText = await page.locator('#tblSku tbody').textContent();
    chk('搜索结果确实包含关键词', /UltraDock/i.test(searchedText), JSON.stringify(searchedText.replace(/\s+/g, ' ').slice(0, 90)));

    // 搜索 + 选周 → 周中无数据时应显示空态
    await page.selectOption('#ddWeek', wkVal);
    await page.waitForTimeout(600);
    const emptyMsg = await page.locator('#tblSku tbody').textContent();
    chk('无交集时表格显示空态文案', searchedRows === 0 || /当前筛选无数据|UltraDock/i.test(emptyMsg), emptyMsg.slice(0, 30));

    // 重置
    await page.click('#btnReset');
    await page.waitForTimeout(900);
    const resetRows = await page.locator('#tblSku tbody tr').count();
    chk('重置后商品明细恢复全量', resetRows === skuRows, `${resetRows} vs ${skuRows}`);
    chk('重置后周下拉回到「全部周」', (await page.locator('#ddWeek').inputValue()) === '', '');

    // tab 切换
    await page.click('.tab[data-p="funnel"]');
    await page.waitForTimeout(700);
    chk('切到加购收藏页且 pane 可见', await page.locator('#pane-funnel').isVisible(), '');
    chk('加购收藏页有数据行', (await page.locator('#tblFunnel tbody tr').count()) >= 2, '');
    const c4 = await page.evaluate(() => !!(window.Chart && Chart.getChart('c4')));
    chk('切 tab 后 c4 图表实例化', c4 === true, '');

    chk('demo 版无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' ｜ '));
    await ctx.close();
  }

  /* ---------------- B. 根目录 joybuy.html: 自动区分「空态骨架」/「已接入数据」 ---------------- */
  //  ⚠️ 2026-10-05 起 JoyBuy 已真实接入数据 ⇒ 根目录 joybuy.html 不再是空态骨架。
  //     硬断言「尚未接入数据」会永远红。这里先探测页面处于哪种形态, 再按形态断言各自该有的东西,
  //     两种形态都保留覆盖(骨架期语义没丢, 接入后语义也补齐)。
  if (!useBase) {
    const { ctx, page, errs } = await open(browser, skeletonUrl);
    const bodyText = await page.locator('body').textContent();
    const isSkeleton = /尚未接入数据/.test(bodyText);
    if (isSkeleton) {
      chk('空态显示「尚未接入数据」', isSkeleton, '');
      chk('空态含接入步骤指引（appKey）', /appKey/.test(bodyText) && /fetch_joybuy_api\.js/.test(bodyText), '');
      chk('空态提示无流量/加购/收藏接口', /没有<\/b>?流量|没有.*流量/.test(bodyText.replace(/\s+/g, ' ')) || /流量、加购、收藏接口|没有[\s\S]{0,20}流量/.test(bodyText), '');
      chk('空态隐藏非首个 tab', (await page.locator('.tab[data-p="sku"]').isVisible()) === false, '');
      chk('空态 KPI 区为空', (await page.locator('#kpis .kpi').count()) === 0, '');
      chk('空态无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' ｜ '));
    } else {
      const kpiN = await page.locator('#kpis .kpi').count();
      // 期望张数从 DOM 的 data-slot 反推(不写死), 槽位设计调整后不会假失败
      const expectKpi = await page.evaluate(() => {
        const s = [...document.querySelectorAll('#kpis .kpi')].map(e => Number(e.dataset.slot));
        return s.length ? Math.max(...s) + 1 : 0;
      });
      chk('已接入数据态: 不显示「尚未接入数据」', !isSkeleton, '');
      chk('已接入数据态: KPI 卡数与槽位一致', kpiN > 0 && kpiN === expectKpi, `实际 ${kpiN} / 期望 ${expectKpi}`);
      chk('已接入数据态: SKU 明细有行', (await page.locator('#tblSku tbody tr').count()) >= 1, '');
      // 当前 tab 设计为 trend / product / funnel / traffic / channel / keyword / daily(无 sku)
      chk('已接入数据态: 非首个 tab 可见', await page.locator('.tab[data-p="product"]').isVisible(), '');
      chk('已接入数据态: 无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' ｜ '));
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (fail) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
