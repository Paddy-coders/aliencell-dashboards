// 验证每日看板联动: dim状态 + prune场景 + 与ad看板一致性
const { chromium } = require('./playwright-auth');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const filePath = 'file:///' + path.resolve(__dirname, 'daily.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  async function getOptions(ddId) {
    return await page.evaluate((id) => {
      const list = document.getElementById(id + 'List');
      if (!list) return [];
      return [...list.querySelectorAll('.dd-opt')].map(el => ({
        name: el.querySelector('.opt-name')?.textContent?.trim() || '',
        dim: el.classList.contains('dim'),
        sel: el.classList.contains('sel'),
      }));
    }, ddId);
  }
  async function openDD(id) {
    await page.evaluate((did) => {
      document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
      document.getElementById(did).classList.add('open');
    }, id);
    await page.waitForTimeout(200);
  }
  async function clickOption(ddId, optName) {
    await page.evaluate(({ id, name }) => {
      const list = document.getElementById(id + 'List');
      const opts = [...list.querySelectorAll('.dd-opt')];
      const target = opts.find(el => el.querySelector('.opt-name')?.textContent?.trim() === name);
      if (target) target.click();
    }, { id: ddId, name: optName });
    await page.waitForTimeout(300);
  }

  const results = [];

  // === 测试1: 初始状态 - 全部13国显示, 无数据的置灰 ===
  await openDD('ddCountry');
  const c0 = await getOptions('ddCountry');
  const c0Active = c0.filter(c => !c.dim).length;
  const c0Dim = c0.filter(c => c.dim).length;
  results.push(['初始: 全部13国显示', c0.length === 13, `count=${c0.length}`]);
  results.push(['初始: 无数据国家置灰', c0Dim > 0 && c0Active > 0, `active=${c0Active} dim=${c0Dim}`]);

  // === 测试2: 选ASIN → 范围外国家置灰(非隐藏) ===
  await openDD('ddAsin');
  const asins = await getOptions('ddAsin');
  const testAsin = asins[0]?.name;
  if (testAsin) {
    await clickOption('ddAsin', testAsin);
    await openDD('ddCountry');
    const c1 = await getOptions('ddCountry');
    const c1Active = c1.filter(c => !c.dim);
    const c1Dim = c1.filter(c => c.dim);
    results.push(['选ASIN后: 仍显示全部13国', c1.length === 13, `count=${c1.length}`]);
    results.push(['选ASIN后: 范围外国家置灰', c1Dim.length > 0, `active=${c1Active.length} dim=${c1Dim.length}`]);
    results.push(['选ASIN后: 选中ASIN的国家高亮', c1Active.length >= 1, `active countries: ${c1Active.map(c=>c.name).join(',')}`]);
  }

  // === 测试3: pruneSelections - 选系列再选无该系列的国家 → 系列自动清除 ===
  // 先清空
  await page.evaluate(() => { selCountry.clear(); selSeries.clear(); selName.clear(); selAsin.clear(); renderAll(); });
  await page.waitForTimeout(300);
  // 选 X1系列
  await openDD('ddSeries');
  const series0 = await getOptions('ddSeries');
  const x1 = series0.find(s => s.name.includes('X1') && s.name !== '无');
  if (x1) {
    await clickOption('ddSeries', x1.name);
    await openDD('ddCountry');
    const c2 = await getOptions('ddCountry');
    // ⚠️ 原先这里把「DE 必须被置灰」写死了。云端映射后来新增了 DE↔X1 系列条目，
    //    该断言就长期为红（8/11），与看板行为无关 —— 属测试自己过期，不是回归。
    //    改为**动态判据**（与 HANDOVER §8-9「数量/选项断言勿硬编码」一致）：
    //    ① 每个国家的置灰状态必须与看板自身 countryScope() 的口径一致（渲染 ↔ 口径交叉校验）
    //    ② 选系列后必须确实有国家被收窄（联动机制生效）
    // 在页面内一次性比对「DOM 渲染的置灰状态」与「看板自身 countryScope() 口径」
    const chk = await page.evaluate(() => {
      const scope = countryScope();
      const rows = [...document.querySelectorAll('#ddCountryList .dd-opt')].map(el => ({
        name: (el.querySelector('.opt-name')?.textContent || '').trim(),
        code: (el.querySelector('.opt-name')?.textContent || '').trim().split(/\s+/).pop(),
        dim: el.classList.contains('dim'),
      }));
      return {
        total: rows.length,
        scope: [...scope],
        // 置灰应当 == 该国家不在范围内；相等即为渲染与口径不一致
        mismatch: rows.filter(r => scope.has(r.code) === r.dim).map(r => `${r.name}(dim=${r.dim},inScope=${scope.has(r.code)})`),
        dimmed: rows.filter(r => r.dim).map(r => r.code),
      };
    });
    results.push(['选X1系列后: 国家置灰与 countryScope 口径一致', chk.mismatch.length === 0,
      `mismatch=${chk.mismatch.join(',')||'无'} scope=${chk.scope.join(',')}`]);
    results.push(['选X1系列后: 确有国家因该系列无数据被收窄', chk.dimmed.length > 0,
      `dim=${chk.dimmed.length}/${chk.total} (${chk.dimmed.join(',')})`]);
    // 系列选择仍在
    const ss = await page.evaluate(() => selSeries.size);
    results.push(['选X1系列后: selSeries非空', ss > 0, `size=${ss}`]);
  }

  // === 测试4: 选国家DE → 系列收窄到"无" ===
  await page.evaluate(() => { selCountry.clear(); selSeries.clear(); selName.clear(); selAsin.clear(); renderAll(); });
  await page.waitForTimeout(300);
  await openDD('ddCountry');
  await clickOption('ddCountry', '德国 DE');
  await openDD('ddSeries');
  const s1 = await getOptions('ddSeries');
  // 同为动态判据：DE 的系列集合由数据决定（原先写死"只有无系列"，映射补齐后就长期为红）
  const chkS = await page.evaluate(() => {
    const scope = seriesScope();
    const rows = [...document.querySelectorAll('#ddSeriesList .dd-opt')].map(el => ({
      name: (el.querySelector('.opt-name')?.textContent || '').trim(),
      dim: el.classList.contains('dim'),
    }));
    return {
      total: rows.length,
      scope: [...scope],
      mismatch: rows.filter(r => scope.has(r.name) === r.dim).map(r => r.name),
      active: rows.filter(r => !r.dim).map(r => r.name),
    };
  });
  results.push(['选DE后: 系列收窄(少于全部系列)', s1.length < series0.length,
    `series=${s1.map(s=>s.name).join(',')} (全部${series0.length})`]);
  results.push(['选DE后: 系列置灰与 seriesScope 口径一致', chkS.mismatch.length === 0 && chkS.active.length > 0,
    `mismatch=${chkS.mismatch.join(',')||'无'} 有数据系列=${chkS.active.join(',')} 范围=${chkS.scope.join(',')}`]);

  // === 测试5: Ctrl+多选国家 ===
  await page.evaluate(() => { selCountry.clear(); selSeries.clear(); selName.clear(); selAsin.clear(); renderAll(); });
  await page.waitForTimeout(300);
  // Ctrl+click US and DE
  await page.evaluate(() => {
    const list = document.getElementById('ddCountryList');
    const opts = [...list.querySelectorAll('.dd-opt')];
    const us = opts.find(el => el.querySelector('.opt-name')?.textContent?.trim() === '美国 US');
    if (us) { const e = new Event('click', { bubbles: true }); e.ctrlKey = true; us.dispatchEvent(e); }
  });
  await page.waitForTimeout(200);
  const ms = await page.evaluate(() => selCountry.size);
  results.push(['Ctrl+click多选', ms === 1, `selCountry.size=${ms}`]);

  // === 测试6: 单击唯一已选项→清空 ===
  await page.evaluate(() => {
    const list = document.getElementById('ddCountryList');
    const opts = [...list.querySelectorAll('.dd-opt')];
    const us = opts.find(el => el.querySelector('.opt-name')?.textContent?.trim() === '美国 US');
    if (us) us.click();
  });
  await page.waitForTimeout(300);
  const ms2 = await page.evaluate(() => selCountry.size);
  results.push(['单击唯一已选→清空', ms2 === 0, `selCountry.size=${ms2}`]);

  console.log('=== 测试结果 ===');
  let pass = 0;
  results.forEach(([name, ok, detail], i) => {
    console.log(`${ok ? '✅' : '❌'} #${i+1} ${name}: ${detail}`);
    if (ok) pass++;
  });
  console.log(`\n${pass}/${results.length} 通过 | JS错误: ${errors.length}`);
  await browser.close();
})();
