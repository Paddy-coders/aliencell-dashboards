# -*- coding: utf-8 -*-
"""同步回归脚本：KPI 现在固定 5 张可替换，测试要按需把指标装上再读；
   并补上三条新需求的断言（KPI 5 槽位 / 中文指标 / 隐藏无数据项）。
"""
import io
P = 'test_joybuy_filter.js'
s = io.open(P, encoding='utf-8').read()
n = 0


def rep(old, new, tag):
    global s, n
    c = s.count(old)
    assert c == 1, '[%s] 锚点出现 %d 次' % (tag, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) kpi() 改成「按需装指标再读」 ----------
rep(
    """  const kpi = () => page.evaluate(() => {
    const o = {};
    document.querySelectorAll('.kpi').forEach((k) => { o[k.querySelector('.k').innerText] = k.querySelector('.v').innerText; });
    return o;
  });""",
    """  // KPI 现在固定只显示 5 张（可下拉替换）。测试要读的指标不一定在默认 5 张上，
  // 所以在一次 evaluate 里把它们依次装到第 5 张卡片读回来 ——
  // pickKpi → renderKpis 是同步的，不用等 sleep；顺带也覆盖了「卡片可替换」这个功能。
  const kpi = () => page.evaluate(() => {
    const CAT = ['订单量', '销售额', '销售件数', '商品访客数', '商品浏览量', '加购访客数',
      '加购件数', '加购率', '转化率', 'SKU 数', '产品名数', '收藏商品数', '店铺访客数'];
    const o = {};
    const snap = () => [].forEach.call(document.querySelectorAll('.kpi'), (k) => {
      const nm = (k.querySelector('.k') || {}).innerText;
      if (!nm || o[nm] !== undefined) return;
      o[nm] = (k.querySelector('.v') || {}).innerText;
    });
    snap();
    const SLOT = 4;
    CAT.forEach((name) => {
      if (o[name] !== undefined) return;
      const card = document.querySelector('.kpi[data-slot="' + SLOT + '"]');
      if (!card) return;
      const head = card.querySelector('.kpi-head');
      if (head) head.click();                       // 展开面板（只切 class，不重渲染）
      const host = document.querySelector('.kpi[data-slot="' + SLOT + '"]');
      const opt = [...host.querySelectorAll('.dd-opt')]
        .find((x) => ((x.querySelector('.opt-name') || {}).innerText) === name && !x.classList.contains('dim'));
      if (opt) opt.click();                         // 触发 pickKpi → renderKpis（同步）
      snap();
    });
    return o;
  });""",
    'kpi()')

# ---------- 2) 指标名同步 ----------
rep("ck('DE 店铺 UV = 219（站点级）', k['店铺 UV'] === '219', k['店铺 UV']);",
    "ck('DE 店铺访客数 = 219（站点级）', k['店铺访客数'] === '219', k['店铺访客数']);",
    '店铺 UV→店铺访客数')

# ---------- 3) 新增 8d / 8e 两段 ----------
rep(
    """  console.log('\\n=== 9. 多选 ===');""",
    """  console.log('\\n=== 8d. KPI 固定 5 张 · 可下拉替换 · 指标全中文 ===');
  await reset();
  const kpiInfo = await page.evaluate(() => ({
    n: document.querySelectorAll('.kpi').length,
    heads: [...document.querySelectorAll('.kpi .kpi-head .k')].map((x) => x.innerText.trim()),
    heads2: document.querySelectorAll('.kpi .kpi-head').length,
    panels: document.querySelectorAll('.kpi .dd-panel').length
  }));
  ck('KPI 恰好 5 张（不再平铺全部指标）', kpiInfo.n === 5, '实际 ' + kpiInfo.n);
  ck('5 张卡片都有指标下拉', kpiInfo.heads2 === 5 && kpiInfo.panels === 5,
    kpiInfo.heads2 + ' 按钮 / ' + kpiInfo.panels + ' 面板');
  ck('默认 5 项 = 订单量/销售额/销售件数/商品访客数/商品浏览量',
    kpiInfo.heads.join(',') === '订单量,销售额,销售件数,商品访客数,商品浏览量', kpiInfo.heads.join(','));
  ck('卡片标题不含 UV/PV/PDP 缩写',
    kpiInfo.heads.every((h) => !/UV|PV|PDP/.test(h)), kpiInfo.heads.join(','));

  const swap = await page.evaluate(() => {
    const card = document.querySelector('.kpi[data-slot="0"]');
    card.querySelector('.kpi-head').click();
    const opened = card.classList.contains('open');
    const busy = [...card.querySelectorAll('.dd-opt')].filter((x) => x.classList.contains('dim')).length;
    const opt = [...card.querySelectorAll('.dd-opt')]
      .find((x) => (x.querySelector('.opt-name') || {}).innerText === '转化率');
    if (opt) opt.click();
    return { opened: opened, busy: busy, now: (document.querySelector('.kpi[data-slot="0"] .k') || {}).innerText };
  });
  ck('点卡片标题能展开指标面板', swap.opened === true, swap.opened ? '已展开' : '打不开');
  ck('被其他卡片占用的指标置灰（4 项）', swap.busy === 4, 'N=' + swap.busy);
  ck('选「转化率」后第 1 张卡片标题已替换', swap.now === '转化率', swap.now || '(读不到)');

  const reset5 = await page.evaluate(() => {
    const card = document.querySelector('.kpi[data-slot="0"]');
    card.querySelector('.kpi-head').click();
    const f = [...document.querySelectorAll('.kpi[data-slot="0"] .dd-foot')]
      .find((x) => x.innerText.indexOf('恢复默认') >= 0);
    if (!f) return null;
    f.click();
    return [...document.querySelectorAll('.kpi .k')].map((x) => x.innerText.trim()).join(',');
  });
  ck('「恢复默认 5 项」生效', reset5 === '订单量,销售额,销售件数,商品访客数,商品浏览量', reset5 || '（找不到按钮）');

  const enLeft = await page.evaluate(() => {
    const txt = document.body.innerText;
    return ['PDP UV', 'PDP PV', '店铺 UV', '店铺 PV', '加购 UV', 'PDP UV/PV'].filter((x) => txt.indexOf(x) >= 0);
  });
  ck('整页正文无英文指标缩写', enLeft.length === 0, enLeft.length ? enLeft.join(' / ') : '全中文');

  console.log('\\n=== 8e. 无数据的候选直接隐藏（不是置灰） ===');
  await reset();
  const siteAll = await page.evaluate(() => [...document.querySelectorAll('#ddSiteList .dd-opt')]
    .map((x) => x.innerText.split('\\n')[0]));
  ck('全量时站点候选 = 4 个', siteAll.length === 4, siteAll.join(' '));
  // 「激光模块」只在 DE/FR/NL 卖（无 UK）→ 选它后 UK 应从站点下拉消失
  await pickOpt('ddSeries', 'ddSeriesList', 'Laser Module');
  const siteNarrow = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#ddSiteList .dd-opt')].map((x) => x.innerText.split('\\n')[0]),
    dim: document.querySelectorAll('#ddSiteList .dd-opt.dim').length,
    foot: (document.querySelector('#ddSiteList .dd-foot.info') || {}).innerText || ''
  }));
  ck('选「激光模块」后无 UK 的站点直接消失',
    siteNarrow.opts.length > 0 && siteNarrow.opts.every((t) => t.indexOf('UK') < 0), siteNarrow.opts.join(' '));
  ck('用的是「隐藏」而非「置灰」', siteNarrow.dim === 0, '置灰项 ' + siteNarrow.dim);
  ck('面板底部提示已隐藏项数', siteNarrow.foot.indexOf('已按当前筛选隐藏') >= 0, siteNarrow.foot || '（缺失）');
  const wkAll = await page.evaluate(() => document.querySelectorAll('#ddWeekList .dd-opt').length);
  ck('周数候选同样被收窄（< 18）', wkAll > 0 && wkAll < 18, '剩 ' + wkAll + ' 周');
  await reset();

  console.log('\\n=== 9. 多选 ===');""",
    '8d/8e 新段')

# ---------- 4) 文件头说明 ----------
rep(""" * 覆盖 44 项：""", """ * 覆盖项：""", '文件头-项数')
rep(""" *   9  Ctrl 多选""",
    """ *   8d KPI 固定 5 张 · 可下拉替换 · 指标全中文 · 恢复默认
 *   8e 无数据的候选**直接隐藏**（不是置灰）+ 隐藏计数提示
 *   9  Ctrl 多选""", '文件头-覆盖点')

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('测试脚本同步完成 %d 处' % n)
