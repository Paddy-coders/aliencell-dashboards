# -*- coding: utf-8 -*-
"""审计「商品成本」是否核对完成(只读, 不入回归)

输出四块:
  A 映射覆盖: 映射里的 ASIN → 成本表产品名, 有没有落空
  B 成本表利用: 成本表里哪些产品名没被任何 ASIN 引用
  C 有销量行的成本匹配率 + 未匹配清单
  D 逐 ASIN×站点 的表/易仓单台偏差全量分布(不只看 >=30%)
"""
import io, json, os, sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
from cost_from_table import Resolver, make_rate_fn, SITE_CUR, load_cost_table  # noqa


def rd(p):
    try:
        with io.open(os.path.join(BASE, p), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


r = Resolver(refresh=False)
tbl = r.table
mp = r.mp
asin_map = mp.get('asinMap') or []
pm = rd('profit_metrics.json') or {}
rows = pm.get('rows') or []

print('=' * 74)
print('A 映射覆盖: 映射 %d 条 (源 %s) · 成本表 %d 个产品名' % (len(asin_map), mp.get('source'), len(tbl)))
no_tbl, no_name = [], []
for x in asin_map:
    a, n = (x.get('asin') or '').strip().upper(), x.get('name')
    if not n:
        no_name.append(a)
    elif n not in tbl:
        no_tbl.append((a, n))
print('   映射有条目但产品名为空: %d' % len(no_name))
print('   产品名不在成本表里(这些 ASIN 成本必然为 0): %d' % len(no_tbl))
for a, n in no_tbl:
    print('     - %s → 「%s」(成本表无此产品名)' % (a, n))

used = set(x.get('name') for x in asin_map if x.get('name'))
print('\nB 成本表 %d 个产品名中, 被映射引用的 %d 个; 未被引用 %d 个:' % (len(tbl), len(used & set(tbl)), len(set(tbl) - used)))
for n in sorted(set(tbl) - used):
    print('     - %s (costRMB=%s)  ← 没有 ASIN 指向它' % (n, tbl[n].get('costRMB')))

# C 有销量行
agg = defaultdict(lambda: {'q': 0, 'tbl': 0.0, 'erp': 0.0, 'sales': 0.0, 'per': [], 'erp0': 0})
rate_fn = make_rate_fn()
for x in rows:
    a = str(x.get('as') or '').upper()
    s = str(x.get('site') or '').strip().upper() or '(空)'
    q = float(x.get('qty') or 0) + float(x.get('mqty') or 0)
    if q <= 0:
        continue
    o = agg[(a, s)]
    o['q'] += q
    o['tbl'] += float(x.get('cost') or 0)
    o['erp'] += float(x.get('costErp') or 0)
    o['sales'] += float(x.get('sales') or 0)
    if float(x.get('qty') or 0) > 0:
        ce = abs(float(x.get('costErp') or 0))
        if ce:
            o['per'].append(ce / float(x['qty']))
        else:
            o['erp0'] += 1
qn = sum(v['q'] for v in agg.values())
hit = {k: v for k, v in agg.items() if r.cost_rmb(k[0])}
miss = {k: v for k, v in agg.items() if not r.cost_rmb(k[0])}
qh = sum(v['q'] for v in hit.values())
print('\n' + '=' * 74)
print('C 有销量(>0件)的 ASIN×站点: %d 组 / %g 件 → 命中成本表 %g 件 (%.2f%%)' % (len(agg), qn, qh, qh / qn * 100 if qn else 0))
print('   命中组数 %d / 未命中组数 %d' % (len(hit), len(miss)))
if miss:
    print('   ⚠️ 未命中(成本按 0 ⇒ 该行毛利虚高):')
    for (a, s), v in sorted(miss.items(), key=lambda x: -x[1]['q']):
        print('      %-12s %-5s %3g 件  sales=%.2f  产品名=%s' % (a, s, v['q'], v['sales'], r.name(a) or '（映射里没有此 ASIN）'))

print('\n' + '=' * 74)
print('D 命中组: 表成本合计 %.2f vs 易仓合计 %.2f (差 %+.2f)' % (
    sum(v['tbl'] for v in hit.values()), sum(v['erp'] for v in hit.values()),
    sum(v['tbl'] for v in hit.values()) - sum(v['erp'] for v in hit.values())))
print('   逐组单台偏差(表 vs 易仓逐行中位数, 全量按 |偏差| 降序):')
devs = []
for (a, s), v in hit.items():
    if not v['per'] or not v['q']:
        continue
    per = sorted(v['per']); med = per[len(per) // 2]
    if not med:
        continue
    unit = v['tbl'] / v['q']
    devs.append(((abs(unit) - med) / med, a, s, v, med, unit))
for dv, a, s, v, med, unit in sorted(devs):
    flag = '★≥30%' if abs(dv) >= 0.3 else ''
    print('   %-12s %-5s %3g 件  表 %9.2f/台  易仓中位 %9.2f/台  偏 %+8.1f%%  %-2s %s%s' % (
        a, s, v['q'], unit, med, dv * 100, flag, r.name(a),
        '  [易仓漏记成本行 %d]' % v['erp0'] if v['erp0'] else ''))
print('   共 %d 组可比; |偏差|<10%% 的 %d 组, 10~30%% 的 %d 组, >=30%% 的 %d 组' % (
    len(devs), sum(1 for d in devs if abs(d[0]) < 0.10),
    sum(1 for d in devs if 0.10 <= abs(d[0]) < 0.30), sum(1 for d in devs if abs(d[0]) >= 0.30)))
