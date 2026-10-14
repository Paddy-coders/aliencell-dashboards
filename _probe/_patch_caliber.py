# -*- coding: utf-8 -*-
"""口径说明补丁：商品 PDP UV/PV 是 SKU 级相加，跨商品会重复计数。"""
import io

P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0

# 1) KPI 卡片副标题写清楚是「各商品之和」，而不是站点唯一访客
for old, new in [
    ("""{ k: '商品 PDP UV', v: fmtNum(t.pdpUv), d: '详情页访客' },""",
     """{ k: '商品 PDP UV', v: fmtNum(t.pdpUv), d: '各商品访客之和' },"""),
    ("""{ k: '商品 PDP PV', v: fmtNum(t.pdpPv), d: '详情页浏览' },""",
     """{ k: '商品 PDP PV', v: fmtNum(t.pdpPv), d: '各商品浏览之和' },"""),
]:
    assert s.count(old) == 1, 'KPI 锚点未找到: %s' % old[:28]
    s = s.replace(old, new); n += 1

# 2) 页脚补一句口径说明
old = """      '多站点视图<b>不混算销售额</b>（UK=GBP，DE/NL/FR=EUR）。';"""
new = """      '多站点视图<b>不混算销售额</b>（UK=GBP，DE/NL/FR=EUR）。' +
      '<b>商品 PDP UV/PV</b> 是各商品相加（同一访客浏览多个商品会重复计数），' +
      '所以比站点级「商品详情页访客数」大、换算出的加购率/转化率会偏低；' +
      '「店铺 UV/PV、收藏商品数」是站点级，只跟国家/周数走。';"""
assert s.count(old) == 1, '页脚锚点未找到'
s = s.replace(old, new); n += 1

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
