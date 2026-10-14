# -*- coding: utf-8 -*-
"""汇总 §A/§C 汇报指标"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# §A 累计指标
with open(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\daily_data.json', encoding='utf-8') as f:
    data = json.load(f)
days = data['days']
sess = ord_n = 0
sales = cost = ad_clk = ad_ord = ad_sales = imp = 0.0
for d, dd in days.items():
    for r in dd.get('biz') or []:
        sess += int(r.get('sessions', 0) or 0)
        ord_n += int(r.get('total_order_items', r.get('orderItemCounts', 0)) or 0)
        try:
            sales += float(r.get('ordered_product_sales_amount', 0) or 0)
        except (TypeError, ValueError):
            pass
    ads = dd.get('ads') or {}
    for ctry, lst in (ads.items() if isinstance(ads, dict) else []):
        for it in (lst if isinstance(lst, list) else []):
            rep = it.get('Report') or {}
            imp += float(rep.get('Impressions', 0) or 0)
            ad_clk += float(rep.get('Clicks', 0) or 0)
            ad_ord += float(rep.get('Orders', 0) or 0)
            cost += float(rep.get('Cost', 0) or 0)
            ad_sales += float(rep.get('SalesAmount', 0) or 0)
print('=== §A 累计(全部98天) ===')
print(f'业务: Sessions={sess} 订单件数={ord_n} 销售额=${sales:,.2f}')
print(f'广告: 曝光={imp:,.0f} 点击={ad_clk:,.0f} 订单={ad_ord:,.0f} 花费=${cost:,.2f} 销售额=${ad_sales:,.2f} ACOS={cost/ad_sales*100:.1f}%' if ad_sales else 'ACOS n/a')

# 广告有花费国家 Top
by_c = {}
for d, dd in days.items():
    for ctry, lst in (dd.get('ads') or {}).items():
        if isinstance(lst, list):
            by_c[ctry] = by_c.get(ctry, 0) + sum(float((it.get('Report') or {}).get('Cost', 0) or 0) for it in lst)
top = sorted(by_c.items(), key=lambda x: -x[1])[:5]
print('广告花费Top国家:', ', '.join(f'{c} ${v:,.2f}' for c, v in top if v > 0))

# §C weekly 数据
print()
with open(r'C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33\weekly_all_data.json', encoding='utf-8') as f:
    wk = json.load(f)
rows = wk if isinstance(wk, list) else wk.get('data') or wk.get('rows') or []
print('=== §C 周度数据 ===')
print('周数:', len(rows))
if rows:
    print('字段样例:', list(rows[0].keys())[:15])
    # 最近4周汇总
    for w in rows[-4:]:
        d0 = str(w.get('date') or w.get('week') or w.get('week_start', '?'))
        s = sum(int(float(r.get('sessions', 0) or 0)) for r in [w])
        print(' ', d0, {k: w.get(k) for k in list(w.keys())[:8]})

# §C 广告聚合
with open(r'C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33\ad_data_for_dashboard.json', encoding='utf-8') as f:
    ad = json.load(f)
print()
print('=== §C 广告聚合 ===')
print('类型:', type(ad).__name__, 'keys:', list(ad.keys())[:10] if isinstance(ad, dict) else len(ad))
