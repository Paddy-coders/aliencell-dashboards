# -*- coding: utf-8 -*-
"""给构建器补「站点数据覆盖范围」——NL 站数据只从 07-28 起，页面若静默显示 0 会被误读成没流量。"""
import io, re, sys

P = 'build_joybuy_dashboard.py'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0

# ---- 1) 每个站点输出 cover（起止 + 天数） ----
old = """        data[code] = dict(
            weeks=weeks,
            days=day_rows,"""
new = """        _ds = sorted(days.keys())
        data[code] = dict(
            # ⚠️ cover 用于前端提示「本站在所选窗口内实际只有哪几天」。
            # 例：NL 站后台趋势接口只返回 2026-07-28 起的数据，若页面直接显示 0，
            # 会被误读成「没流量」。有 cover 就能明确写成「该站无数据」。
            cover=dict(start=_ds[0], end=_ds[-1], nDays=len(_ds)),
            weeks=weeks,
            days=day_rows,"""
assert s.count(old) == 1, 'cover 锚点不唯一/未找到'
s = s.replace(old, new); n += 1

# ---- 2) 窗口算完后，逐站比对覆盖范围并给出提示 ----
old = """    for code in data:
        if not any(w['uv'] or w['pdpUv'] or w['orders'] for w in data[code]['weeks']):
            warnings.append('%s 站所选区间内所有指标为 0' % code)"""
new = """    for code in data:
        if not any(w['uv'] or w['pdpUv'] or w['orders'] for w in data[code]['weeks']):
            warnings.append('%s 站所选区间内所有指标为 0' % code)

    # 站点数据覆盖起止不一致时明确提示（后台趋势接口会裁掉开头的全 0 天）
    if days_all:
        w0 = days_all[0]
        late = [(c, data[c]['cover']) for c in sorted(data) if data[c]['cover']['start'] > w0]
        for c, cv in late:
            warnings.append('%s 站数据自 %s 起（全局窗口自 %s）—— 更早周次该站为「无数据」而非 0，'
                            '不要当成流量下滑' % (c, cv['start'], w0))"""
assert s.count(old) == 1, '警告锚点不唯一/未找到'
s = s.replace(old, new); n += 1

# ---- 3) 终端输出带上覆盖范围 ----
old = """        print('  [%s] 周数 %d ｜ 订单 %g ｜ 件数 %g ｜ 店铺UV %g ｜ PDP UV %g ｜ 加购 %g ｜ 收藏 %g'
              % (code, len(d['weeks']), t['orders'], t['units'], t['uv'], t['pdpUv'], t['addToCart'], t['favorites']))"""
new = """        print('  [%s] 周数 %d ｜ 日数 %d (%s~%s) ｜ 订单 %g ｜ 件数 %g ｜ 店铺UV %g ｜ PDP UV %g ｜ 加购 %g ｜ 收藏 %g'
              % (code, len(d['weeks']), d['cover']['nDays'], d['cover']['start'], d['cover']['end'],
                 t['orders'], t['units'], t['uv'], t['pdpUv'], t['addToCart'], t['favorites']))"""
assert s.count(old) == 1, '打印锚点不唯一/未找到'
s = s.replace(old, new); n += 1

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
