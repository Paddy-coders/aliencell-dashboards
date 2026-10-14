# -*- coding: utf-8 -*-
"""
Aliencell JoyBuy：SKU → 产品系列 / 产品名 映射生成器

背景
----
看板要做到「按 国家 / 产品系列 / 产品名 / 周数 筛选」，前提是每个 SKU 都知道自己属于哪条产品线、
叫什么产品名。后台只给 `skuName`（各站点文案还不统一）+ `color`（变体名），没有规范化的系列/产品名字段，
所以这里做一次**规则推导**，产出可人工精修的映射文件 `joybuy_sku_map.json`。

产品名 = 系列 + 关键配置，套装另立维度
------------------------------------
运营真实要对比的是「X1 20W vs X1 40W vs X1 60W」这种同型号不同配置的差异，
所以产品名 = **系列 + 功率/关键配置**（滤芯型号也进名字，因为它是不同商品）。

而「Air Assist」「+蜂窝板+旋转轴」这类**套装组合不进产品名**，单独抽成 `bundle` 维度
（2026-09-26 业务确认）—— 好处是同一功率的单机与套装能干净汇总，
要看套装再单独筛即可（`bundleOrder` 给出固定顺序）。

跨站点归一
----------
同一款产品在 4 个站点的 skuId 完全不同（例：X1 20W 在 UK=100006080223395、DE=100012780039688），
本脚本会把它们归到同一个「产品名」下 —— 这正是「产品名」筛选能跨国家汇总的原因。

人工覆盖
--------
`joybuy_sku_map.json` 里的 `overrides`（形如 {"skuId": {"series":..,"name":..,"bundle":..,"note":".."}}）
优先级最高，重新生成时会保留。文案仍有歧义的会被标 `review: true`
并输出到 `_sku_review.csv` 供人工确认。

**已知人工结论（2026-09-26 业务确认）**
--------------------------------------------------
后台 DE 站的 `Aliencell X1L closed diode laser engraver ... 26 × 21 inch` 归入 **X1 Lite 系列**。
> 佐证：X1 Lite 的商品名里 UK 写 `26 * 21" Bed Size`、DE/FR 写 `610 × 465 mm working area`
> —— **X1 Lite 自己的文案就不一致**，`26 × 21 in` 并非 X1L 独有；两条 listing 的配件描述也互相混用。
> X1L 的原始系列名仍记在每条 SKU 的 `srcSeries` 字段里，随时可回溯。
> ⚠️ 注意 X1L 的 listing 写的是 `20 W/40 W/60 W`（含 60W），合并后 X1 Lite 因此多出 60W 一档。

用法
----
  python build_joybuy_sku_map.py                       # 读 joybuy_compass_data.json，生成映射
  python build_joybuy_sku_map.py --check               # 只体检：列出未归类/有歧义的 SKU
  python build_joybuy_sku_map.py --review              # 额外导出 _sku_review.csv 待确认清单
"""
import argparse
import csv
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_COMPASS = os.path.join(HERE, 'joybuy_compass_data.json')
DEFAULT_MAP = os.path.join(HERE, 'joybuy_sku_map.json')
DEFAULT_REVIEW = os.path.join(HERE, '_sku_review.csv')

SERIES_ORDER = ['X1', 'X1 Lite', 'E1', 'Air Purifier', 'Honeycomb Table',
                'Laser Module', 'Starter Kit', 'Vacuum Cleaner', '其他']

# 套装/配件组合（产品名不含它，看板单独用一个下拉筛）。
# ⚠️ 只认后台的 `color`（规格/变体名）—— 商品名里几乎每台都写 "with Air Assist"，
#    拿 name 判会让所有机器都变成 Air Assist，维度就失去区分度了。
BUNDLE_ORDER = ['标配', 'Air Assist', 'Air Assist+蜂窝板+旋转轴']


# ------------------------------------------------------------------ 工具
def norm_ws(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()


def find_power(text):
    """从文本里抽功率：'20 W' / '20W' / '20 W with Air Assist' → 20"""
    if not text:
        return None
    m = re.search(r'\b(\d{1,3})\s*[Ww]\b', text)
    if m:
        v = int(m.group(1))
        if 5 <= v <= 200:
            return v
    return None


def find_power_in_name(name):
    """名称里可能写 '20W/40W/60W' 这种范围，取**第一个** —— 但机器类优先用 color，见 classify()"""
    return find_power(name)


def detect_filter(color, name):
    """空气净化器变体：目前 6 种（主机 + 5 种滤芯）"""
    c = (color or '').lower()
    n = (name or '').lower()
    blob = c + ' ' + n
    # 顺序有讲究：超密碳网的名字里同时含 'activated carbon'，必须先判
    if 'ultra-dense' in blob or 'ultradense' in blob or 'carbon mesh' in blob or '超密' in blob:
        return '超密碳网'
    if re.search(r'h13', blob):
        return 'H13'
    if re.search(r'h11', blob):
        return 'H11'
    if re.search(r'f8', blob):
        return 'F8'
    if 'activated carbon' in blob or 'active carbon' in blob or '活性炭' in blob:
        return '活性炭'
    return None


def classify(sku_name, color):
    """
    返回 (series, name, bundle, review, note)
    - name   = 系列 + 功率/关键配置（**不含套装**，套装走 bundle）
    - bundle = 套装/配件组合，见 BUNDLE_ORDER
    - review=True 表示文案有歧义，建议人工确认（会进 _sku_review.csv）。
    """
    n = norm_ws(sku_name).lower()
    c = norm_ws(color)
    bd = detect_bundle(c, n)

    if not n:
        return ('其他', '未命名 SKU', bd, True, '后台未返回 skuName')

    # ---- 1) 材料/配件套装（必须先于整机，名称里常带 'Laser Engraver'）----
    if ('starter' in n or 'material kit' in n or 'craft supplies' in n
            or 'starter set' in n or '材料' in n):
        return ('Starter Kit', 'Starter Kit 材料包', bd, False, '')

    # ---- 2) 空气净化器（主机 + 滤芯）----
    if 'air purifier' in n:
        f = detect_filter(c, n)
        if f:
            return ('Air Purifier', 'Air Purifier 滤芯' + f, bd, False, '')
        # color 恰好是 'Air Purifier' 或空 → 主机
        return ('Air Purifier', 'Air Purifier 主机', bd, False, '')

    # ---- 3) 蜂窝台（名称里会同时出现 X1 / X1 Lite，必须先于整机）----
    if 'honeycomb' in n and ('table' in n or 'plate' in n):
        return ('Honeycomb Table', 'Honeycomb Table 665×510', bd, False, '')

    # ---- 4) 手持吸尘器 ----
    if 'vacuum cleaner' in n:
        return ('Vacuum Cleaner', 'Vacuum Cleaner', bd, False, '')

    # ---- 5) 激光模块（配件，名称形如 '20 W, 40 W and 60 W laser modules for X1 20 W'）----
    if 'laser module' in n:
        p = find_power(c) or find_power_in_name(n)
        return ('Laser Module', 'Laser Module %dW' % p if p else 'Laser Module', bd, False, '')

    # ---- 6) 整机：X1 Lite / X1L / X1 / E1（顺序敏感，'x1 lite' 要先于 'x1'）----
    if re.search(r'\be1\b', n):
        p = find_power(n) or find_power(c)
        return ('E1', 'E1 %dW' % p if p else 'E1', bd, False, '')

    if 'x1 lite' in n or 'x1lite' in n:
        p = find_power(c) or find_power_in_name(n)
        return ('X1 Lite', 'X1 Lite %dW' % p if p else 'X1 Lite', bd, False, '')

    # ⚠️ 坑：别用 `'x1 l' in n` 判 X1L —— UK 的 X1 名称是
    #    "Aliencell X1 Laser Engraver..."，lowercase 后含 "x1 l"（来自 "x1 laser"），
    #    会把 3 个 UK 的 X1 SKU 全判成 X1L。必须用词边界 \bx1l\b。
    #
    # 2026-09-26 业务确认：X1L 并入 X1 Lite 系列（理由见文件头「已知人工结论」）。
    # 产品名只留「系列+功率」，Air Assist / 蜂窝板+旋转轴 交给 bundle 维度。
    if re.search(r'\bx1l\b', n):
        p = find_power(c) or find_power_in_name(n)
        nm = ('X1 Lite %dW' % p) if p else 'X1 Lite'
        return ('X1 Lite', nm, bd, False,
                '原 X1L 系列，按业务确认并入 X1 Lite（原始系列名见 srcSeries）')

    if re.search(r'\bx1\b', n):
        p = find_power(c) or find_power_in_name(n)
        return ('X1', 'X1 %dW' % p if p else 'X1', bd, False, '')

    return ('其他', norm_ws(sku_name)[:40] or '未归类 SKU', bd, True, '规则未命中')


def detect_bundle(color, name):
    """套装/配件组合 → bundle 标签（见文件头 BUNDLE_ORDER 的说明）"""
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


# ------------------------------------------------------------------ 主流程
def load_json(path):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)


def collect_skus(compass):
    """从各站 skuDetail + skuWeekly.skusMeta 汇总去重 SKU"""
    out = {}
    for code, sh in (compass.get('shops') or {}).items():
        rows = ((sh.get('skuDetail') or {}).get('data') or [])
        for r in rows:
            sid = str(r.get('skuId') or '')
            if not sid:
                continue
            e = out.setdefault(sid, {'skuId': sid, 'skuName': norm_ws(r.get('skuName')),
                                     'color': norm_ws(r.get('color')), 'sites': [], 'upc': r.get('upc') or ''})
            if code not in e['sites']:
                e['sites'].append(code)
            if len(norm_ws(r.get('skuName'))) > len(e['skuName']):
                e['skuName'] = norm_ws(r.get('skuName'))
            if not e['color'] and norm_ws(r.get('color')):
                e['color'] = norm_ws(r.get('color'))
        for m in ((sh.get('skuWeekly') or {}).get('skusMeta') or []):
            sid = str(m.get('skuId') or '')
            if sid and sid not in out:
                out[sid] = {'skuId': sid, 'skuName': norm_ws(m.get('skuName')),
                            'color': norm_ws(m.get('color')), 'sites': [code], 'upc': m.get('upc') or ''}
    for e in out.values():
        e['sites'].sort()
    return out


def load_overrides(path):
    if not os.path.exists(path):
        return {}
    try:
        d = load_json(path)
    except Exception:
        return {}
    return d.get('overrides') or {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--compass', default=DEFAULT_COMPASS)
    ap.add_argument('--out', default=DEFAULT_MAP)
    ap.add_argument('--review', action='store_true', help='导出 _sku_review.csv 待确认清单')
    ap.add_argument('--check', action='store_true', help='只体检，不写文件')
    args = ap.parse_args()

    if not os.path.exists(args.compass):
        print('✗ 找不到 %s，请先执行 node joybuy_compass_fetch.js' % args.compass)
        return 2

    compass = load_json(args.compass)
    skus = collect_skus(compass)
    overrides = load_overrides(args.out)
    print('读入 SKU %d 个（来自 %d 个站点）' % (len(skus), len(compass.get('shops') or {})))
    if overrides:
        print('  沿用人工覆盖 %d 条' % len(overrides))

    sku_map, review_rows, series_names = [], [], {}
    for sid in sorted(skus, key=lambda s: (int(s) if s.isdigit() else 0)):
        e = skus[sid]
        ov = overrides.get(sid)
        series, name, bundle, rev, note = classify(e['skuName'], e['color'])
        src_series = 'X1L' if re.search(r'\bx1l\b', (e['skuName'] or '').lower()) else series
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
                        'skuName': e['skuName'], 'color': e['color'], 'review': rev, 'note': note})
        series_names.setdefault(series, set()).add(name)
        if rev:
            review_rows.append(sku_map[-1])

    catalog = [{'series': s, 'names': sorted(series_names.get(s, []))}
               for s in SERIES_ORDER if s in series_names]

    print('\n产品系列 %d 条 / 产品名 %d 个：' % (len(catalog), sum(len(c['names']) for c in catalog)))
    for c in catalog:
        print('  %-16s %s' % (c['series'], ' ｜ '.join(c['names'])))

    print('\n套装分布（bundle 维度）：')
    for b in BUNDLE_ORDER:
        hit = [m for m in sku_map if m['bundle'] == b]
        if hit:
            print('  %-28s %2d SKU ｜ %s' % (b, len(hit), ','.join(sorted(hit[0]['site']))))

    # 跨站点一致性：同一产品名应尽量出现在多个站点（说明确实是同一款）
    name2sites = {}
    for m in sku_map:
        name2sites.setdefault((m['series'], m['name']), set()).update(m['site'])
    print('\n产品名覆盖站点数（1 个站点 = 该站独有，注意是否真的独有）：')
    for (s, nm) in sorted(name2sites, key=lambda x: (SERIES_ORDER.index(x[0]), x[1])):
        st = sorted(name2sites[(s, nm)])
        print('  %-22s %s' % (nm, ','.join(st)))

    if review_rows:
        print('\n⚠ 待人工确认 %d 条：' % len(review_rows))
        for m in review_rows:
            print('  %s  [%s]  %s    ← %s' % (m['skuId'], ','.join(m['site']), m['name'], m['note']))
    else:
        print('\n✓ 无待确认项')

    if args.review and review_rows:
        with io.open(DEFAULT_REVIEW, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['skuId', '站点', '当前系列', '当前产品名', '后台色号/变体', '后台商品名', '待确认原因', '人工修正系列', '人工修正产品名'])
            for m in review_rows:
                w.writerow([m['skuId'], '/'.join(m['site']), m['series'], m['name'], m['color'],
                            m['skuName'], m['note'], '', ''])
        print('已导出待确认清单 → %s' % DEFAULT_REVIEW)

    if args.check:
        return 0

    payload = {
        'version': 1,
        'generatedAt': compass.get('fetchedAt') or '',
        'source': 'build_joybuy_sku_map.py（规则推导 + overrides 人工覆盖）',
        'seriesOrder': SERIES_ORDER,
        'bundleOrder': BUNDLE_ORDER,
        'catalog': catalog,
        'skuMap': sku_map,
        'overrides': overrides,
    }
    with io.open(args.out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print('\n✓ 已写入 %s  (%d SKU · %d 产品名)' % (args.out, len(sku_map), sum(len(c['names']) for c in catalog)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
