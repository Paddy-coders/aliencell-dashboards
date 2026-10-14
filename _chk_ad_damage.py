# -*- coding: utf-8 -*-
"""检查 2026-09-13 ~ 09-28 每日数据现状（广告是否受损/回退）— v2 修正结构"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\daily_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

days = data.get('days', {})
print('总天数:', len(days))
print('pendingDays:', data.get('pendingDays'))

print()
print('日期        业务行数  Sessions  广告items  广告花费    点击   订单   广告销售额  incomplete  lastChecked')
for d in sorted(days.keys()):
    if d < '2026-09-13':
        continue
    dd = days[d]
    biz = dd.get('biz') or []
    ads = dd.get('ads') or {}
    items = []
    if isinstance(ads, dict):
        for ctry, lst in ads.items():
            if isinstance(lst, list):
                items.extend(lst)
    sessions = sum(int(r.get('sessions', 0) or 0) for r in biz)
    def rep_sum(field):
        t = 0.0
        for it in items:
            rep = it.get('Report') or {}
            try:
                t += float(rep.get(field, 0) or 0)
            except (TypeError, ValueError):
                pass
        return t
    cost = rep_sum('Cost')
    clicks = rep_sum('Clicks')
    orders = rep_sum('Orders')
    sales = rep_sum('SalesAmount')
    inc = 'Y' if dd.get('incomplete') else '-'
    lc = dd.get('lastChecked', '-')
    print(f'{d}  {len(biz):4d}    {sessions:6d}   {len(items):5d}   {cost:10.2f}  {int(clicks):5d}  {int(orders):4d}  {sales:10.2f}   {inc}       {lc}')

all_days = sorted(days.keys())
print()
print('数据范围:', all_days[0], '~', all_days[-1])
