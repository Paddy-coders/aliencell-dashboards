# -*- coding: utf-8 -*-
"""无回退校验：对比备份(第一次运行后)与当前(重跑后)"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

old = load(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\_bak\daily_data.pre-refetch-20260928.json')
new = load(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\daily_data.json')

def day_stats(dd):
    biz = dd.get('biz') or []
    ads = dd.get('ads') or {}
    items = []
    for ctry, lst in (ads.items() if isinstance(ads, dict) else []):
        if isinstance(lst, list):
            items.extend(lst)
    sessions = sum(int(r.get('sessions', 0) or 0) for r in biz)
    cost = sum(float((it.get('Report') or {}).get('Cost', 0) or 0) for it in items)
    sales = sum(float((it.get('Report') or {}).get('SalesAmount', 0) or 0) for it in items)
    return len(biz), sessions, len(items), cost, sales

od, nd = old['days'], new['days']
print('旧总天数:', len(od), ' 新总天数:', len(nd))
print()
print('日期        行数 O->N   Sess O->N      items O->N   花费 O->N            销售 O->N          判定')
issues = []
for d in sorted(set(od) | set(nd)):
    if d < '2026-08-01':
        continue
    o = day_stats(od.get(d, {}))
    n = day_stats(nd.get(d, {}))
    flag = 'OK'
    # 回退判据：业务行数或 sessions 变少；items 减少(除非上游删活动,注明)；花费/销售额巨变留给台账解释
    if n[0] < o[0]:
        flag = '⚠行数回退'
    if n[1] < o[1]:
        flag = '⚠sessions回退'
    if n[2] < o[2] - 0:
        flag = flag if flag != 'OK' else 'ℹitems变化'
    if flag != 'OK':
        issues.append(d)
    print(f'{d}  {o[0]:3d}->{n[0]:3d}   {o[1]:6d}->{n[1]:6d}   {o[2]:4d}->{n[2]:4d}   {o[3]:9.2f}->{n[3]:9.2f}   {o[4]:9.2f}->{n[4]:9.2f}   {flag}')

print()
print('总天数对比: 旧', len(od), '(2026-06-23~) 新', len(nd))
print('最早日期保持:', min(nd) == '2026-06-23')
print('需人工复核日期:', issues if issues else '无')
