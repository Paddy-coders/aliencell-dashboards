# -*- coding: utf-8 -*-
"""构建器：把 bundle（套装）维度接进 payload。"""
import io

P = 'build_joybuy_dashboard.py'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d' % (tag or old[:40], cnt, c)
    s = s.replace(old, new)
    n += 1


# 1) skuWeeks 扁平行带 bundle
rep("""        row = dict(week=c.get('week') or '', skuId=sid,
                   series=m.get('series') or '未分类', name=m.get('name') or '未命名 SKU',
                   color=m.get('color') or '')""",
    """        row = dict(week=c.get('week') or '', skuId=sid,
                   series=m.get('series') or '未分类', name=m.get('name') or '未命名 SKU',
                   # bundle = 套装/配件组合（Air Assist / +蜂窝板+旋转轴），由 sku_map 给出；
                   # 产品名里**不含**套装，套装是独立维度，见 build_joybuy_sku_map.py 文件头。
                   bundle=m.get('bundle') or '标配',
                   color=m.get('color') or '')""",
    tag='norm_sku_weeks bundle')

# 2) skuTotals 带 bundle
rep("""        t = acc.setdefault(sid, dict(skuId=sid, series=r['series'], name=r['name'], color=r.get('color') or '',""",
    """        t = acc.setdefault(sid, dict(skuId=sid, series=r['series'], name=r['name'],
                                     bundle=r.get('bundle') or '标配', color=r.get('color') or '',""",
    tag='norm_sku_totals bundle')

# 3) payload 暴露 bundleOrder
rep("""        seriesOrder=series_order,
        catalogSeries=sku_catalog,""",
    """        seriesOrder=series_order,
        bundleOrder=sku_bundles,
        catalogSeries=sku_catalog,""",
    tag='payload bundleOrder')

# 4) load_sku_map 返回 bundleOrder
rep("""    sku_map, sku_catalog, series_order = load_sku_map(SKU_MAP)""",
    """    sku_map, sku_catalog, series_order, sku_bundles = load_sku_map(SKU_MAP)""",
    tag='调用处')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)

# 看看 load_sku_map 现在长什么样
import re
m = re.search(r'def load_sku_map.*?(?=\ndef )', s, re.S)
print('---- load_sku_map ----')
print(m.group(0) if m else '未找到')
