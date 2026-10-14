# -*- coding: utf-8 -*-
"""三看板同期(月)销售额对比 — 按站点币种分组, 避免汇率干扰"""
import json, sys, os, datetime
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _grab_json import grab

BASE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(BASE, '_deploy')
MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
CUR = {'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR',
       'ES': 'EUR', 'NL': 'EUR', 'BE': 'EUR', 'IE': 'EUR', 'PL': 'PLN', 'SE': 'SEK', 'JP': 'JPY', 'AU': 'AUD'}


def num(x):
    try:
        return float(x or 0)
    except Exception:
        return 0.0


print('################ ① 日看板 daily.html (ORDERED_PRODUCT_SALES_AMOUNT, 原始币种) ################')
dDATA, _ = grab(os.path.join(D, 'daily.html'), 'DATA')
dd = defaultdict(float)
dq = defaultdict(float)
dsites = defaultdict(lambda: defaultdict(float))
dcnt = defaultdict(set)
for day, payload in (dDATA.get('days') or {}).items():
    ym = day[:7]
    for r in (payload.get('biz') or []):
        site = r.get('site') or ''
        cur = r.get('ordered_product_sales_currency_code') or CUR.get(site, '?')
        v = num(r.get('ordered_product_sales_amount'))
        dd[(ym, cur)] += v
        dq[(ym, cur)] += num(r.get('units_ordered'))
        dsites[ym][cur] += v
    dcnt[ym].add(day)
print('覆盖天数:', {k: len(v) for k, v in sorted(dcnt.items())})
for ym in MONTHS:
    parts = ['%s %.1f' % (c, dsites[ym][c]) for c in sorted(dsites[ym])]
    print('  %s  %s' % (ym, '  |  '.join(parts)))

print()
print('################ ② 月看板 monthly.html (DATA.rows.sales) ################')
mDATA, _ = grab(os.path.join(D, 'monthly.html'), 'DATA')
ms = defaultdict(lambda: defaultdict(float))
for r in (mDATA.get('rows') or []):
    ym, cc = r.get('ym'), r.get('cc')
    ms[ym][CUR.get(cc, '?')] += num(r.get('sales'))
for ym in MONTHS:
    parts = ['%s %.1f' % (c, ms[ym][c]) for c in sorted(ms[ym])]
    print('  %s  %s' % (ym, '  |  '.join(parts)))

print()
print('################ ③ 周看板 product.html (官方店铺, 周→月 按周五归属) ################')
pDATA, _ = grab(os.path.join(D, 'product.html'), 'DATA')
weeks = {w['label']: w for w in (pDATA.get('weeks') or [])}
ws = defaultdict(lambda: defaultdict(float))
wq = defaultdict(float)
for asin, av in (pDATA.get('asins') or {}).items():
    for wl, bycc in (av.get('weeks') or {}).items():
        w = weeks.get(wl)
        if not w:
            continue
        ym = datetime.date.fromisoformat(w['end']).strftime('%Y-%m')
        if not isinstance(bycc, dict):
            continue
        for cc, v in bycc.items():
            if not isinstance(v, dict):
                continue
            ws[ym][CUR.get(cc, '?')] += num(v.get('sales'))
            wq[ym] += num(v.get('orders'))
for ym in MONTHS:
    parts = ['%s %.1f' % (c, ws[ym][c]) for c in sorted(ws[ym])]
    print('  %s  %s' % (ym, '  |  '.join(parts)))

print()
print('################ ④ 周看板 Woot 渠道 (ASIN 元数据里的 woot 子 ASIN) ################')
meta = pDATA.get('asins') or {}
woot_like = [a for a, v in meta.items() if 'woot' in json.dumps(v.get('seller_sku') or [], ensure_ascii=False).lower()]
print('疑似 Woot 子 ASIN 数:', len(woot_like), woot_like[:8])

print()
print('################ ⑤ 利润报表口径 profit_metrics.json (原币种, 全渠道) ################')
pm = json.load(open(os.path.join(BASE, 'profit_metrics.json'), encoding='utf-8'))
ps = defaultdict(lambda: defaultdict(float))
pq = defaultdict(lambda: defaultdict(float))
for r in pm['rows']:
    ym = r['d'][:7]
    ps[ym][r['cur']] += r['sales']
    pq[ym][r['cur']] += r['qty']
for ym in MONTHS:
    parts = ['%s 销售%.1f/%.0f件' % (c, ps[ym][c], pq[ym][c]) for c in sorted(ps[ym]) if ps[ym][c] or pq[ym][c]]
    print('  %s  %s' % (ym, '  |  '.join(parts)))
