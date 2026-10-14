# -*- coding: utf-8 -*-
"""回归脚本同步：新增套装维度 + 产品名 24→20。"""
import io

n = 0


def patch(path, pairs):
    global n
    s = io.open(path, encoding='utf-8').read()
    for old, new, tag in pairs:
        c = s.count(old)
        assert c == 1, '[%s] 锚点[%s] 实际 %d 处' % (path, tag, c)
        s = s.replace(old, new)
        n += 1
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('✓ %s（%d 处）' % (path, len(pairs)))


# ---------------- _jb_f_test.js ----------------
patch('_jb_f_test.js', [
    ("ck('产品名数 = 24', k['产品名数'] === '24', k['产品名数']);",
     "ck('产品名数 = 20', k['产品名数'] === '20', k['产品名数']);", '产品名数'),

    ("  for (const [id, nm] of [['ddSite', '国家'], ['ddSeries', '产品系列'], ['ddName', '产品名'], ['ddSku', 'SKU'], ['ddWeek', '周数']]) {",
     "  for (const [id, nm] of [['ddSite', '国家'], ['ddSeries', '产品系列'], ['ddName', '产品名'], ['ddBundle', '套装'], ['ddSku', 'SKU'], ['ddWeek', '周数']]) {",
     '下拉清单'),

    # 系列候选数断言（含 X1 Lite）
    ("  console.log('\\n=== 8b. 表头内嵌标签必须渲染成元素（不能被 esc 成字面量） ===');",
     """  console.log('\\n=== 7b. 套装维度（X1L 已按业务确认并入 X1 Lite） ===');
  await reset();
  await pickOpt('ddSite', 'ddSiteList', 'DE');
  await pickOpt('ddSeries', 'ddSeriesList', 'X1 Lite');
  k = await kpi();
  ck('X1 Lite 已含原 X1L（DE 站 SKU 数 = 7）', k['SKU 数'] === '7', k['SKU 数']);
  ck('X1 Lite 产品名数 = 3（20W/40W/60W）', k['产品名数'] === '3', k['产品名数']);
  const bdOpts = await optsOf('ddBundleList');
  ck('套装候选 = 标配 / Air Assist / Air Assist+蜂窝板+旋转轴',
    bdOpts.length === 3 &&
    bdOpts.some((x) => x.txt.indexOf('标配') >= 0) &&
    bdOpts.some((x) => x.txt.indexOf('Air Assist') >= 0) &&
    bdOpts.some((x) => x.txt.indexOf('蜂窝板') >= 0),
    bdOpts.map((x) => x.txt).join(' / '));
  ok = await pickOpt('ddBundle', 'ddBundleList', '蜂窝板');
  ck('能选中套装「Air Assist+蜂窝板+旋转轴」', ok, '套装=' + await summaryOf('ddBundleSum'));
  k = await kpi();
  ck('套装筛选后 SKU 数 = 2（20W/60W 套装）', k['SKU 数'] === '2', k['SKU 数']);
  ck('套装筛选后产品名数 = 2', k['产品名数'] === '2', k['产品名数']);
  ok = await pickOpt('ddBundle', 'ddBundleList', 'Air Assist');
  k = await kpi();
  ck('切到「Air Assist」后 SKU 数 = 3', k['SKU 数'] === '3', k['SKU 数']);

  console.log('\\n=== 8b. 表头内嵌标签必须渲染成元素（不能被 esc 成字面量） ===');""",
     '新增 7b 套装段'),
])

# ---------------- test_joybuy_entry_e2e.js ----------------
patch('test_joybuy_entry_e2e.js', [
    ("    check('筛选下拉 5 个（国家/系列/产品名/SKU/周数）', info.dd === 5, '实际 ' + info.dd);",
     "    check('筛选下拉 6 个（国家/系列/产品名/套装/SKU/周数）', info.dd === 6, '实际 ' + info.dd);",
     '下拉数'),
    (" *       12 KPI · 5 个筛选下拉（国家/产品系列/产品名/SKU/周数）· 7 标签页全部有内容 · 零 JS 报错",
     " *       12 KPI · 6 个筛选下拉（国家/产品系列/产品名/套装/SKU/周数）· 7 标签页全部有内容 · 零 JS 报错",
     '文件头注释'),
])

print('\n合计 %d 处' % n)
