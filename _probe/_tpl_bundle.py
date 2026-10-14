# -*- coding: utf-8 -*-
"""模板：新增第 6 个筛选维度「套装」(bundle)。"""
import io

P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d' % (tag or old[:40], cnt, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) HTML：产品名之后插入「套装」下拉 ----------
rep("""      <div class="dd" id="ddSku">""",
    """      <div class="dd" id="ddBundle">
        <button class="dd-btn" onclick="toggleDD('ddBundle')">
          <span class="dd-label">🧩 套装</span>
          <span class="dd-summary" id="ddBundleSum">全部</span>
          <span class="dd-arrow">▼</span>
        </button>
        <div class="dd-panel">
          <div class="dd-tools">
            <button class="btn" onclick="setAll('bundle',true)">全部（不筛选）</button>
            <span class="dd-hint">套餐/配件组合，来自后台规格</span>
          </div>
          <div class="dd-list" id="ddBundleList"></div>
        </div>
      </div>
      <div class="dd" id="ddSku">""",
    tag='HTML 套装下拉')

# ---------- 2) 状态 ----------
rep("  var STORE = { site: [], series: [], name: [], sku: [], week: [] };",
    "  var STORE = { site: [], series: [], name: [], bundle: [], sku: [], week: [] };",
    tag='STORE')

rep("  var SERIES_ORDER = PAYLOAD.seriesOrder || [];",
    "  var SERIES_ORDER = PAYLOAD.seriesOrder || [];\n"
    "  var BUNDLE_ORDER = PAYLOAD.bundleOrder || ['标配'];",
    tag='BUNDLE_ORDER')

# ---------- 3) 扁平行带 bundle ----------
rep("""        site: s.code, week: r.week, skuId: r.skuId, series: r.series, name: r.name,""",
    """        site: s.code, week: r.week, skuId: r.skuId, series: r.series, name: r.name,
        bundle: r.bundle || '标配',""",
    tag='ROWS bundle')

# ---------- 4) 行取值映射（替代嵌套三元） ----------
rep("""  function isAll(dim) { return !STORE[dim].length; }
  function has(arr, v) { return !arr.length || arr.indexOf(v) >= 0; }""",
    """  function isAll(dim) { return !STORE[dim].length; }
  function has(arr, v) { return !arr.length || arr.indexOf(v) >= 0; }

  /** 每个筛选维度从一行里取哪个字段 —— 加维度只改这里，别再去写嵌套三元 */
  var ROWKEY = {
    site: function (r) { return r.site; },
    series: function (r) { return r.series; },
    name: function (r) { return r.name; },
    bundle: function (r) { return r.bundle; },
    sku: function (r) { return r.skuId; },
    week: function (r) { return r.week; }
  };""",
    tag='ROWKEY')

# ---------- 5) filterRows / curRows / rowsExcept ----------
rep("""      if (!has(o.name || [], r.name)) return false;
      if (!has(o.sku || [], r.skuId)) return false;""",
    """      if (!has(o.name || [], r.name)) return false;
      if (!has(o.bundle || [], r.bundle)) return false;
      if (!has(o.sku || [], r.skuId)) return false;""",
    tag='filterRows')

rep("""    return filterRows({ site: STORE.site, week: STORE.week, series: STORE.series, name: STORE.name, sku: STORE.sku });""",
    """    return filterRows({ site: STORE.site, week: STORE.week, series: STORE.series,
                        name: STORE.name, bundle: STORE.bundle, sku: STORE.sku });""",
    tag='curRows')

rep("""    var o = { site: STORE.site, week: STORE.week, series: STORE.series, name: STORE.name, sku: STORE.sku };
    o[dim === 'sku' ? 'sku' : dim] = [];
    return filterRows(o);""",
    """    var o = { site: STORE.site, week: STORE.week, series: STORE.series,
              name: STORE.name, bundle: STORE.bundle, sku: STORE.sku };
    o[dim] = [];          // 本维度放开，其余维度保持约束
    return filterRows(o);""",
    tag='rowsExcept')

# ---------- 6) DIMS ----------
rep("""    name: { el: 'ddName', list: 'ddNameList', sum: 'ddNameSum', label: '产品名' },
    sku: { el: 'ddSku', list: 'ddSkuList', sum: 'ddSkuSum', label: 'SKU' },""",
    """    name: { el: 'ddName', list: 'ddNameList', sum: 'ddNameSum', label: '产品名' },
    bundle: { el: 'ddBundle', list: 'ddBundleList', sum: 'ddBundleSum', label: '套装' },
    sku: { el: 'ddSku', list: 'ddSkuList', sum: 'ddSkuSum', label: 'SKU' },""",
    tag='DIMS')

# ---------- 7) optionsFor 加 bundle ----------
rep("""    if (dim === 'name') {
      // 产品名按 PDP UV 降序，运营最关心的排前面""",
    """    if (dim === 'bundle') {
      return BUNDLE_ORDER.filter(function (b) {
        return uniq(rows.map(function (r) { return r.bundle; })).indexOf(b) >= 0;
      });
    }
    if (dim === 'name') {
      // 产品名按 PDP UV 降序，运营最关心的排前面""",
    tag='optionsFor bundle')

# ---------- 8) renderDD 取值 + 副标题 ----------
rep("""        var key = dim === 'sku' ? r.skuId : dim === 'site' ? r.site : dim === 'series' ? r.series : dim === 'name' ? r.name : r.week;""",
    """        var key = (ROWKEY[dim] || ROWKEY.week)(r);""",
    tag='renderDD key')

rep("""        if (dim === 'name' || dim === 'series') sub = fmtNum(uvMap[v], 0);""",
    """        if (dim === 'name' || dim === 'series' || dim === 'bundle') sub = fmtNum(uvMap[v], 0);""",
    tag='renderDD sub')

# 折叠判定：套装只有 3 个值，点一个就点到 100% 时不该变成「空数组」
# （pick 里已有 sel.length === all.length → [] 的逻辑，这里不动）

# ---------- 9) 重置 ----------
rep("""      STORE = { site: [], series: [], name: [], sku: [], week: [] };
      KW.series = KW.name = KW.sku = '';""",
    """      STORE = { site: [], series: [], name: [], bundle: [], sku: [], week: [] };
      KW.series = KW.name = KW.sku = '';""",
    tag='重置')

# ---------- 10) 筛选说明 + 页脚 ----------
rep("""    parts.push('命中 <b>' + t.skuCount + '</b> 个 SKU · <b>' + t.nameCount + '</b> 个产品名 · <b>' + t.seriesCount + '</b> 个系列 · <b>' + t.weeks.length + '</b> 周');""",
    """    parts.push('命中 <b>' + t.skuCount + '</b> 个 SKU · <b>' + t.nameCount + '</b> 个产品名 · <b>' + t.seriesCount + '</b> 个系列 · <b>' + t.weeks.length + '</b> 周');
    if (STORE.bundle.length) parts.push('套装：' + esc(STORE.bundle.join(' / ')));""",
    tag='筛选说明')

rep("""      '已映射 SKU ' + setCnt + ' 个 · 产品名 ' + uniq(ROWS.map(function (r) { return r.name; })).length + ' 个。' +""",
    """      '已映射 SKU ' + setCnt + ' 个 · 产品名 ' + uniq(ROWS.map(function (r) { return r.name; })).length + ' 个。' +
      '「套装」维度来自后台规格（如 Air Assist / +蜂窝板+旋转轴）；标「标配」表示后台规格未区分套装，' +
      '不代表不含 Air Assist。' +""",
    tag='页脚')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)

# 体检
import re
bad = re.findall(r"STORE\s*=\s*\{[^}]*\}", s)
print('完成 %d 处修正' % n)
print('STORE 定义共 %d 处：' % len(bad))
for b in bad:
    print('  ', b)
print('残留 kwSeries/kwName/kwSku:', len(re.findall(r'kwSeries|kwName|kwSku', s)))
print('window 暴露:', re.findall(r'window\.(\w+)', s))
