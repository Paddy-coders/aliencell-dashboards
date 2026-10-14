# -*- coding: utf-8 -*-
"""模板：在筛选说明里补「本站数据覆盖起点」提示。"""
import io

P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0

old = """    var prodFiltered = STORE.series.length || STORE.name.length || STORE.sku.length;
    if (prodFiltered) parts.push('已按产品维度收窄 —— 标「站点级」的指标（店铺 UV/PV、收藏商品数）不受影响');
    $('filterNote').innerHTML = parts.join(' ｜ ');"""
new = """    var prodFiltered = STORE.series.length || STORE.name.length || STORE.sku.length;
    if (prodFiltered) parts.push('已按产品维度收窄 —— 标「站点级」的指标（店铺 UV/PV、收藏商品数）不受影响');
    // 站点数据覆盖起点不一致时要讲清楚，否则早于该站起始的周次会被误读成「流量归零」
    var gStart = (PAYLOAD.range || {}).startDate || '';
    var late = [];
    (STORE.site.length ? STORE.site : SITES.map(function (s) { return s.code; })).forEach(function (code) {
      var cv = D(code).cover;
      if (cv && gStart && cv.start > gStart) late.push(code + ' 自 ' + String(cv.start).slice(5));
    });
    if (late.length) parts.push('<span class="pill warn">本站覆盖</span>' + esc(late.join('、')) + ' 起有数据，更早周次为「无数据」');
    $('filterNote').innerHTML = parts.join(' ｜ ');"""
assert s.count(old) == 1, '筛选说明锚点未找到'
s = s.replace(old, new); n += 1

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
