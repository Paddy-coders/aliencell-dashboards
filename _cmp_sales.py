# -*- coding: utf-8 -*-
"""拆解: 业务报告(日看板源) vs ERP利润报表 的销售额差异 — 2026-07 逐店逐ASIN"""
import json, sys, os
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _grab_json import grab

BASE = os.path.dirname(os.path.abspath(__file__))
YM = sys.argv[1] if len(sys.argv) > 1 else '2026-07'


def num(x):
    try:
        return float(x or 0)
    except Exception:
        return 0.0


# 业务报告 (日看板 DATA)
d, _ = grab(os.path.join(BASE, '_deploy/daily.html'), 'DATA')
biz = defaultdict(float)          # (site, ua, asin) -> sales
biz_site = defaultdict(float)
for day, payload in (d.get('days') or {}).items():
    if day[:7] != YM:
        continue
    for r in (payload.get('biz') or []):
        k = (r.get('site') or '', r.get('user_account') or '', r.get('asin') or '')
        v = num(r.get('ordered_product_sales_amount'))
        biz[k] += v
        biz_site[r.get('site') or ''] += v

# ERP 利润报表
pm = json.load(open(os.path.join(BASE, 'profit_metrics.json'), encoding='utf-8'))
erp = defaultdict(float)
erp_site = defaultdict(float)
for r in pm['rows']:
    if r['d'][:7] != YM:
        continue
    erp[(r['site'], r['ua'], r['as'])] += r['sales']
    erp_site[r['site']] += r['sales']

print('========== %s 销售额对比 (原币种混合前先看站点) ==========' % YM)
print('%-6s %14s %14s %10s' % ('站点', '业务报告', 'ERP利润', '差额'))
for s in sorted(set(biz_site) | set(erp_site)):
    b, e = biz_site[s], erp_site[s]
    print('%-6s %14.2f %14.2f %10.2f' % (s or '-', b, e, b - e))
print('%-6s %14.2f %14.2f %10.2f' % ('合计', sum(biz_site.values()), sum(erp_site.values()),
                                     sum(biz_site.values()) - sum(erp_site.values())))

print()
print('========== 业务报告有、ERP利润没有的 店铺×ASIN 组合 ==========')
onlybiz = [(k, v) for k, v in biz.items() if v > 0 and k not in erp]
onlybiz.sort(key=lambda x: -x[1])
print('共 %d 组, 合计 %.2f' % (len(onlybiz), sum(v for _, v in onlybiz)))
for k, v in onlybiz[:25]:
    print('   %-4s %-28s %-12s %12.2f' % (k[0], k[1], k[2], v))

print()
print('========== ERP利润有、业务报告没有的 组合 ==========')
onlyerp = [(k, v) for k, v in erp.items() if v != 0 and k not in biz]
onlyerp.sort(key=lambda x: -abs(x[1]))
print('共 %d 组, 合计 %.2f' % (len(onlyerp), sum(v for _, v in onlyerp)))
for k, v in onlyerp[:15]:
    print('   %-4s %-28s %-12s %12.2f' % (k[0], k[1], k[2], v))

print()
print('========== 两边都有但金额差 >5%% 的组合 (前 25) ==========')
rows = []
for k in set(biz) & set(erp):
    b, e = biz[k], erp[k]
    if abs(b - e) > max(1.0, abs(b) * 0.05):
        rows.append((abs(b - e), k, b, e))
rows.sort(reverse=True)
print('共 %d 组, 业务报告合计 %.2f / ERP合计 %.2f' % (len(rows), sum(r[2] for r in rows), sum(r[3] for r in rows)))
for _, k, b, e in rows[:25]:
    print('   %-4s %-28s %-12s  业务 %11.2f  ERP %11.2f  差 %10.2f' % (k[0], k[1], k[2], b, e, b - e))
