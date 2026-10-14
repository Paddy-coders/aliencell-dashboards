// 验证筛选逻辑 v2: 每个筛选器用独立页面(重新goto重置状态)分别测试
// 逻辑: 普通单击=单选替换; Ctrl+单击=多选追加/取消; 单击唯一已选项=取消回到全部
const { chromium } = require('./playwright-auth');

const URL = 'file:///C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard.html';
const PORT = process.env.CDP_PORT || '9223';

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });

  async function gotoFresh() { await page.goto(URL, { waitUntil: 'load' }); await page.waitForTimeout(2200); }
  async function openDD(id) { await page.click(`#${id} .dd-btn`); await page.waitForTimeout(300); }
  async function clickOpt(id, idx, ctrl) {
    const opts = page.locator(`#${id}List .dd-opt:not(.dim)`);
    await opts.nth(idx).click({ modifiers: ctrl ? ['Control'] : [] });
    await page.waitForTimeout(500);
  }
  async function optsCount(id) { return await page.locator(`#${id}List .dd-opt:not(.dim)`).count(); }
  async function st() {
    return await page.evaluate(() => ({
      camps: [...selCampaigns], countries: [...selCountry], weeks: [...selWeek],
      asins: [...selAsin], types: [...selType]
    }));
  }

  // ============ 场景1: 广告活动 ============
  await gotoFresh();
  await openDD('ddCampaign');
  const nCamp = await optsCount('ddCampaign');
  if (nCamp < 2) check('前置: 广告活动>=2', false, `只有${nCamp}个`);
  else {
    const s0 = await st();
    check('初始: 无活动选中(汇总视图)', s0.camps.length === 0, `camps=${JSON.stringify(s0.camps)}`);
    await clickOpt('ddCampaign', 0, false);
    const s1 = await st();
    check('单击活动#1 → 单选1个', s1.camps.length === 1, `camps=${JSON.stringify(s1.camps)}`);
    await clickOpt('ddCampaign', 1, false);
    const s2 = await st();
    check('单击活动#2 → 替换为只选2', s2.camps.length === 1 && s2.camps[0] !== s1.camps[0], `camps=${JSON.stringify(s2.camps)}`);
    await clickOpt('ddCampaign', 0, true);
    const s3 = await st();
    check('Ctrl+单击活动#1 → 多选(2个)', s3.camps.length === 2, `camps=${JSON.stringify(s3.camps)}`);
    await clickOpt('ddCampaign', 0, true);
    const s4 = await st();
    check('Ctrl+再次单击活动#1 → 取消,剩1个', s4.camps.length === 1, `camps=${JSON.stringify(s4.camps)}`);
    await clickOpt('ddCampaign', 1, false);
    const s5 = await st();
    check('单击唯一已选项#2 → 取消回到全部', s5.camps.length === 0, `camps=${JSON.stringify(s5.camps)}`);
  }

  // ============ 场景2: 国家(初始全选US+DE, 单击=单选替换; 受联动影响选DE后US置灰, 故只验证单选替换) ============
  await gotoFresh();
  await openDD('ddCountry');
  const nC = await optsCount('ddCountry');
  if (nC < 2) check('前置: 国家>=2(有数据)', false, `只有${nC}个`);
  else {
    const c0 = await st();
    check('国家: 初始全选', c0.countries.length === 2, `countries=${JSON.stringify(c0.countries)}`);
    await clickOpt('ddCountry', 0, false); // 单击DE(第1个非dim)
    const c1 = await st();
    check('国家: 单击DE → 单选替换为1个', c1.countries.length === 1 && c1.countries[0] === 'DE', `countries=${JSON.stringify(c1.countries)}`);
  }

  // ============ 场景3: 周数(5个选项, 完整验证单选/替换/Ctrl多选/取消) ============
  await gotoFresh();
  await openDD('ddWeek');
  const nW = await optsCount('ddWeek');
  if (nW < 3) check('前置: 周数>=3', false, `只有${nW}个`);
  else {
    await clickOpt('ddWeek', 0, false);
    const w1 = await st();
    check('周数: 单击#1 → 单选1个', w1.weeks.length === 1, `weeks=${JSON.stringify(w1.weeks)}`);
    await clickOpt('ddWeek', 1, true);
    const w2 = await st();
    check('周数: Ctrl+单击#2 → 多选2个', w2.weeks.length === 2, `weeks=${JSON.stringify(w2.weeks)}`);
    await clickOpt('ddWeek', 1, false);
    const w3 = await st();
    check('周数: 单击#2(非唯一已选) → 替换为只选2', w3.weeks.length === 1 && w3.weeks[0] === w2.weeks[1], `weeks=${JSON.stringify(w3.weeks)}`);
    await clickOpt('ddWeek', 1, false);
    const w4 = await st();
    check('周数: 单击唯一已选#2 → 回到全部', w4.weeks.length === 0, `weeks=${JSON.stringify(w4.weeks)}`);
  }

  // ============ 场景4: ASIN(仅2个且联动强, 验证单选替换即可) ============
  await gotoFresh();
  await openDD('ddAsin');
  const nA = await optsCount('ddAsin');
  if (nA < 2) check('前置: ASIN>=2', false, `只有${nA}个`);
  else {
    const a0 = await st();
    check('ASIN: 初始全选', a0.asins.length === 2, `asins=${JSON.stringify(a0.asins)}`);
    await clickOpt('ddAsin', 0, false);
    const a1 = await st();
    check('ASIN: 单击#1 → 单选替换为1个', a1.asins.length === 1, `asins=${JSON.stringify(a1.asins)}`);
  }

  // ============ 场景5: 广告形式 ============
  await gotoFresh();
  await openDD('ddType');
  const nT = await optsCount('ddType');
  if (nT < 2) check('前置: 广告形式>=2', false, `只有${nT}个`);
  else {
    await clickOpt('ddType', 0, false);
    const t1 = await st();
    check('广告形式: 单击#1 → 单选1个', t1.types.length === 1, `types=${JSON.stringify(t1.types)}`);
    await clickOpt('ddType', 1, true);
    const t2 = await st();
    check('广告形式: Ctrl+单击#2 → 多选2个', t2.types.length === 2, `types=${JSON.stringify(t2.types)}`);
  }

  // ============ 场景6: 联动仍正常(选US后活动候选收窄) ============
  await gotoFresh();
  const allCampsBefore = await page.evaluate(() => campaignCandidates().length);
  await page.evaluate(() => { selCountry.clear(); selCountry.add('US'); syncAndRender(); });
  await page.waitForTimeout(600);
  const allCampsAfter = await page.evaluate(() => campaignCandidates().length);
  check('联动: 选US后活动候选收窄', allCampsAfter <= allCampsBefore, `before=${allCampsBefore} after=${allCampsAfter}`);

  await page.screenshot({ path: 'filter_logic_check.png', fullPage: false }).catch(() => {});

  const pass = results.filter(r => r.ok).length;
  console.log(JSON.stringify({ total: results.length, pass, fail: results.length - pass, jsErrors: errors, results }, null, 2));

  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(results.every(r => r.ok) && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
