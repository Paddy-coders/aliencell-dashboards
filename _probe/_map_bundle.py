# -*- coding: utf-8 -*-
"""SKU 映射器升级：
   ① X1L 按业务确认并入 X1 Lite（保留 srcSeries 追溯）
   ② 产品名统一为「系列+功率」，套装/配件抽成独立 bundle 维度
"""
import io

P = 'build_joybuy_sku_map.py'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d' % (tag or old[:40], cnt, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) 文档头 ----------
rep("""为什么产品名要精确到「型号 + 功率/变体」
--------------------------------------
运营真实要对比的是「X1 20W vs X1 40W vs X1 60W」这种同型号不同配置的差异，
所以产品名 = 型号 + 关键变体（功率 / 滤芯型号 / 附件组合），而不是笼统的「X1」。""",
    """产品名 = 系列 + 关键配置，套装另立维度
------------------------------------
运营真实要对比的是「X1 20W vs X1 40W vs X1 60W」这种同型号不同配置的差异，
所以产品名 = **系列 + 功率/关键配置**（滤芯型号也进名字，因为它是不同商品）。

而「Air Assist」「+蜂窝板+旋转轴」这类**套装组合不进产品名**，单独抽成 `bundle` 维度
（2026-09-26 业务确认）—— 好处是同一功率的单机与套装能干净汇总，
要看套装再单独筛即可（`bundleOrder` 给出固定顺序）。""",
    tag='文档头')

rep("""`joybuy_sku_map.json` 里的 `overrides`（形如 {"skuId": {"series":..,"name":..,"note":".."}}）
优先级最高，重新生成时会保留。文案有歧义的（如 X1L 与 X1 Lite 的尺寸对不上、
各站点配件描述互相混用）会被标 `review: true` 并输出到 `_sku_review.csv` 供人工确认。""",
    """`joybuy_sku_map.json` 里的 `overrides`（形如 {"skuId": {"series":..,"name":..,"bundle":..,"note":".."}}）
优先级最高，重新生成时会保留。文案仍有歧义的会被标 `review: true`
并输出到 `_sku_review.csv` 供人工确认。

**已知人工结论（2026-09-26 业务确认）**
--------------------------------------------------
后台 DE 站的 `Aliencell X1L closed diode laser engraver ... 26 × 21 inch` 归入 **X1 Lite 系列**。
> 佐证：X1 Lite 的商品名里 UK 写 `26 * 21" Bed Size`、DE/FR 写 `610 × 465 mm working area`
> —— **X1 Lite 自己的文案就不一致**，`26 × 21 in` 并非 X1L 独有；两条 listing 的配件描述也互相混用。
> X1L 的原始系列名仍记在每条 SKU 的 `srcSeries` 字段里，随时可回溯。
> ⚠️ 注意 X1L 的 listing 写的是 `20 W/40 W/60 W`（含 60W），合并后 X1 Lite 因此多出 60W 一档。""",
    tag='文档头-人工结论')

# ---------- 2) 系列顺序：去掉 X1L ----------
rep("""SERIES_ORDER = ['X1', 'X1 Lite', 'X1L', 'E1', 'Air Purifier', 'Honeycomb Table',
                'Laser Module', 'Starter Kit', 'Vacuum Cleaner', '其他']""",
    """SERIES_ORDER = ['X1', 'X1 Lite', 'E1', 'Air Purifier', 'Honeycomb Table',
                'Laser Module', 'Starter Kit', 'Vacuum Cleaner', '其他']

# 套装/配件组合（产品名不含它，看板单独用一个下拉筛）。
# ⚠️ 只认后台的 `color`（规格/变体名）—— 商品名里几乎每台都写 "with Air Assist"，
#    拿 name 判会让所有机器都变成 Air Assist，维度就失去区分度了。
BUNDLE_ORDER = ['标配', 'Air Assist', 'Air Assist+蜂窝板+旋转轴']""",
    tag='SERIES_ORDER')

# ---------- 3) 新增 detect_bundle ----------
rep("""# ------------------------------------------------------------------ 主流程""",
    """def detect_bundle(color, name):
    \"\"\"套装/配件组合 → bundle 标签（见文件头 BUNDLE_ORDER 的说明）\"\"\"
    c = (color or '').lower()
    parts = []
    if 'air assist' in c:
        parts.append('Air Assist')
    if 'honeycomb' in c or '蜂窝' in c:
        parts.append('蜂窝板')
    if 'rotary' in c or '旋转' in c:
        parts.append('旋转轴')
    if not parts:
        # color 没带信息时才退回 name，且只认「真配件」（蜂窝板/旋转轴），不认 Air Assist
        nm = (name or '').lower()
        if 'honeycomb' in nm:
            parts.append('蜂窝板')
        if 'rotary' in nm:
            parts.append('旋转轴')
    return '+'.join(parts) if parts else '标配'


# ------------------------------------------------------------------ 主流程""",
    tag='detect_bundle')

# ---------- 4) classify 返回值加 bundle ----------
rep("""def classify(sku_name, color):
    \"\"\"
    返回 (series, name, review, note)
    review=True 表示文案有歧义，建议人工确认（会进 _sku_review.csv）。
    \"\"\"
    n = norm_ws(sku_name).lower()
    c = norm_ws(color)

    if not n:
        return ('其他', '未命名 SKU', True, '后台未返回 skuName')""",
    """def classify(sku_name, color):
    \"\"\"
    返回 (series, name, bundle, review, note)
    - name   = 系列 + 功率/关键配置（**不含套装**，套装走 bundle）
    - bundle = 套装/配件组合，见 BUNDLE_ORDER
    - review=True 表示文案有歧义，建议人工确认（会进 _sku_review.csv）。
    \"\"\"
    n = norm_ws(sku_name).lower()
    c = norm_ws(color)
    bd = detect_bundle(c, n)

    if not n:
        return ('其他', '未命名 SKU', bd, True, '后台未返回 skuName')""",
    tag='classify 头')

rep("        return ('Starter Kit', 'Starter Kit 材料包', False, '')",
    "        return ('Starter Kit', 'Starter Kit 材料包', bd, False, '')", tag='starter')
rep("            return ('Air Purifier', 'Air Purifier 滤芯' + f, False, '')",
    "            return ('Air Purifier', 'Air Purifier 滤芯' + f, bd, False, '')", tag='滤芯')
rep("        return ('Air Purifier', 'Air Purifier 主机', False, '')",
    "        return ('Air Purifier', 'Air Purifier 主机', bd, False, '')", tag='净化器主机')
rep("        return ('Honeycomb Table', 'Honeycomb Table 665×510', False, '')",
    "        return ('Honeycomb Table', 'Honeycomb Table 665×510', bd, False, '')", tag='蜂窝台')
rep("        return ('Vacuum Cleaner', 'Vacuum Cleaner', False, '')",
    "        return ('Vacuum Cleaner', 'Vacuum Cleaner', bd, False, '')", tag='吸尘器')
rep("        return ('Laser Module', 'Laser Module %dW' % p if p else 'Laser Module', False, '')",
    "        return ('Laser Module', 'Laser Module %dW' % p if p else 'Laser Module', bd, False, '')",
    tag='激光模块')
rep("        return ('E1', 'E1 %dW' % p if p else 'E1', False, '')",
    "        return ('E1', 'E1 %dW' % p if p else 'E1', bd, False, '')", tag='E1')
rep("        return ('X1 Lite', 'X1 Lite %dW' % p if p else 'X1 Lite', False, '')",
    "        return ('X1 Lite', 'X1 Lite %dW' % p if p else 'X1 Lite', bd, False, '')", tag='X1Lite')

# ---------- 5) X1L 分支 → 并入 X1 Lite ----------
rep("""    # ⚠️ 坑：别用 `'x1 l' in n` 判 X1L —— UK 的 X1 名称是
    #    "Aliencell X1 Laser Engraver..."，lowercase 后含 "x1 l"（来自 "x1 laser"），
    #    会把 3 个 UK 的 X1 SKU 全判成 X1L。必须用词边界 \\bx1l\\b。
    if re.search(r'\\bx1l\\b', n):
        p = find_power(c) or find_power_in_name(n)
        base = 'X1L %dW' % p if p else 'X1L'
        extra = []
        cl = c.lower()
        if 'air assist' in cl:
            extra.append('Air Assist')
        if 'honeycomb' in cl:
            extra.append('蜂窝板')
        if 'rotary' in cl:
            extra.append('旋转轴')
        nm = base + ((' ' + '+'.join(extra)) if extra else '')
        # X1L 的 work area 文案写 26×21in(=660×533mm)，与 X1 Lite 的 610×465mm 对不上，
        # 但配件文案又把两者当同一款 → 标 review 让人确认
        return ('X1L', nm, True, 'X1L 与 X1 Lite 尺寸文案不一致（26×21in vs 610×465mm），建议确认是否为同一产品')""",
    """    # ⚠️ 坑：别用 `'x1 l' in n` 判 X1L —— UK 的 X1 名称是
    #    "Aliencell X1 Laser Engraver..."，lowercase 后含 "x1 l"（来自 "x1 laser"），
    #    会把 3 个 UK 的 X1 SKU 全判成 X1L。必须用词边界 \\bx1l\\b。
    #
    # 2026-09-26 业务确认：X1L 并入 X1 Lite 系列（理由见文件头「已知人工结论」）。
    # 产品名只留「系列+功率」，Air Assist / 蜂窝板+旋转轴 交给 bundle 维度。
    if re.search(r'\\bx1l\\b', n):
        p = find_power(c) or find_power_in_name(n)
        nm = ('X1 Lite %dW' % p) if p else 'X1 Lite'
        return ('X1 Lite', nm, bd, False,
                '原 X1L 系列，按业务确认并入 X1 Lite（原始系列名见 srcSeries）')""",
    tag='X1L 并入')

rep("    if re.search(r'\\bx1\\b', n):\n        p = find_power(c) or find_power_in_name(n)\n        return ('X1', 'X1 %dW' % p if p else 'X1', False, '')",
    "    if re.search(r'\\bx1\\b', n):\n        p = find_power(c) or find_power_in_name(n)\n        return ('X1', 'X1 %dW' % p if p else 'X1', bd, False, '')",
    tag='X1')

rep("    return ('其他', norm_ws(sku_name)[:40] or '未归类 SKU', True, '规则未命中')",
    "    return ('其他', norm_ws(sku_name)[:40] or '未归类 SKU', bd, True, '规则未命中')",
    tag='其他')

# ---------- 6) 主循环：解包 5 元组 + srcSeries ----------
rep("""        ov = overrides.get(sid)
        if ov and ov.get('series') and ov.get('name'):
            series, name, rev, note = ov['series'], ov['name'], False, ov.get('note', '人工指定')
        else:
            series, name, rev, note = classify(e['skuName'], e['color'])
            if rev:
                # 规则有歧义但有覆盖部分字段时，尊重覆盖
                if ov:
                    series = ov.get('series') or series
                    name = ov.get('name') or name
                    rev = not (ov.get('series') and ov.get('name'))
        if series not in SERIES_ORDER:
            series = '其他'
        sku_map.append({'skuId': sid, 'site': e['sites'], 'series': series, 'name': name,
                        'skuName': e['skuName'], 'color': e['color'], 'review': rev, 'note': note})""",
    """        ov = overrides.get(sid)
        series, name, bundle, rev, note = classify(e['skuName'], e['color'])
        src_series = 'X1L' if re.search(r'\\bx1l\\b', (e['skuName'] or '').lower()) else series
        if ov:
            series = ov.get('series') or series
            name = ov.get('name') or name
            bundle = ov.get('bundle') or bundle
            note = ov.get('note') or note
            rev = False
        if series not in SERIES_ORDER:
            series = '其他'
        if bundle not in BUNDLE_ORDER:
            bundle = '标配'
        sku_map.append({'skuId': sid, 'site': e['sites'], 'series': series, 'name': name,
                        'bundle': bundle, 'srcSeries': src_series,
                        'skuName': e['skuName'], 'color': e['color'], 'review': rev, 'note': note})""",
    tag='主循环')

# ---------- 7) 体检输出：按系列打产品名时带上套装分布 ----------
rep("""    print('\\n产品系列 %d 条 / 产品名 %d 个：' % (len(catalog), sum(len(c['names']) for c in catalog)))
    for c in catalog:
        print('  %-16s %s' % (c['series'], ' ｜ '.join(c['names'])))""",
    """    print('\\n产品系列 %d 条 / 产品名 %d 个：' % (len(catalog), sum(len(c['names']) for c in catalog)))
    for c in catalog:
        print('  %-16s %s' % (c['series'], ' ｜ '.join(c['names'])))

    print('\\n套装分布（bundle 维度）：')
    for b in BUNDLE_ORDER:
        hit = [m for m in sku_map if m['bundle'] == b]
        if hit:
            print('  %-28s %2d SKU ｜ %s' % (b, len(hit), ','.join(sorted(hit[0]['site']))))""",
    tag='套装分布输出')

# ---------- 8) payload 加 bundleOrder ----------
rep("""        'seriesOrder': SERIES_ORDER,
        'catalog': catalog,""",
    """        'seriesOrder': SERIES_ORDER,
        'bundleOrder': BUNDLE_ORDER,
        'catalog': catalog,""",
    tag='payload')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
