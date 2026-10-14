// 诊断每日看板筛选联动是否工作
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

  // 工具：读取某下拉面板的选项列表
  async function getOptions(ddId) {
    return await page.evaluate((id) => {
      const list = document.getElementById(id + 'List');
      if (!list) return [];
      return [...list.querySelectorAll('.dd-opt')].map(el => {
        const name = el.querySelector('.opt-name')?.textContent?.trim() || '';
        const sub = el.querySelector('.opt-sub')?.textContent?.trim() || '';
        const dim = el.classList.contains('dim');
        const sel = el.classList.contains('sel');
        return { name, sub, dim, sel };
      });
    }, ddId);
  }

  // 工具：打开下拉面板
  async function openDD(id) {
    await page.evaluate((did) => {
      document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
      document.getElementById(did).classList.add('open');
    }, id);
    await page.waitForTimeout(200);
  }

  // 工具：点击某选项
  async function clickOption(ddId, optName) {
    await page.evaluate(({ id, name }) => {
      const list = document.getElementById(id + 'List');
      const opts = [...list.querySelectorAll('.dd-opt')];
      const target = opts.find(el => el.querySelector('.opt-name')?.textContent?.trim() === name);
      if (target) target.click();
    }, { id: ddId, name: optName });
    await page.waitForTimeout(300);
  }

  console.log('=== 初始状态 ===');
  await openDD('ddCountry');
  const countries0 = await getOptions('ddCountry');
  console.log('国家数:', countries0.length, '| 有数据:', countries0.filter(c => !c.dim).length);

  await openDD('ddSeries');
  const series0 = await getOptions('ddSeries');
  console.log('系列数:', series0.length, '| 列表:', series0.map(s => s.name).join(', '));

  await openDD('ddName');
  const names0 = await getOptions('ddName');
  console.log('产品名数:', names0.length);

  await openDD('ddAsin');
  const asins0 = await getOptions('ddAsin');
  console.log('ASIN数:', asins0.length);

  // 测试1：选国家 → 系列是否收窄
  console.log('\n=== 测试1: 选国家 DE → 系列是否收窄 ===');
  await openDD('ddCountry');
  await clickOption('ddCountry', '德国 DE');
  await openDD('ddSeries');
  const series1 = await getOptions('ddSeries');
  console.log('选DE后系列数:', series1.length, '| 列表:', series1.map(s => s.name).join(', '));

  await openDD('ddName');
  const names1 = await getOptions('ddName');
  console.log('选DE后产品名数:', names1.length);

  await openDD('ddAsin');
  const asins1 = await getOptions('ddAsin');
  console.log('选DE后ASIN数:', asins1.length);

  // 测试2：选系列 → 产品名是否收窄
  console.log('\n=== 测试2: 选系列 → 产品名是否收窄 ===');
  // 先找一个非"无"系列
  const nonNoneSeries = series1.find(s => s.name !== '无');
  if (nonNoneSeries) {
    console.log('选择系列:', nonNoneSeries.name);
    await openDD('ddSeries');
    await clickOption('ddSeries', nonNoneSeries.name);
    await openDD('ddName');
    const names2 = await getOptions('ddName');
    console.log('选系列后产品名数:', names2.length, '| 列表:', names2.map(n => n.name).join(', '));

    await openDD('ddCountry');
    const countries2 = await getOptions('ddCountry');
    console.log('选系列后国家数:', countries2.length);
  } else {
    console.log('没有非"无"系列可选');
  }

  // 测试3：选ASIN → 国家是否收窄
  console.log('\n=== 测试3: 选ASIN → 国家是否收窄 ===');
  // 清空所有筛选
  await page.evaluate(() => { selCountry.clear(); selSeries.clear(); selName.clear(); selAsin.clear(); renderAll(); });
  await page.waitForTimeout(300);

  await openDD('ddAsin');
  const asinsAll = await getOptions('ddAsin');
  if (asinsAll.length > 0) {
    const testAsin = asinsAll[0].name;
    console.log('选择ASIN:', testAsin);
    await clickOption('ddAsin', testAsin);
    await openDD('ddCountry');
    const countries3 = await getOptions('ddCountry');
    console.log('选ASIN后国家数:', countries3.length, '| 列表:', countries3.map(c => c.name).join(', '));

    await openDD('ddSeries');
    const series3 = await getOptions('ddSeries');
    console.log('选ASIN后系列数:', series3.length, '| 列表:', series3.map(s => s.name).join(', '));
  }

  console.log('\nJS错误:', errors.length, errors.slice(0, 3));
  await browser.close();
})();
