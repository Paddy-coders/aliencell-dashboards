# -*- coding: utf-8 -*-
"""§B.2 数据校验：各国各周花费汇总（重点 US 最新完整周 W39 不能为 0）"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\ad_weekly_all_video.json', encoding='utf-8') as f:
    data = json.load(f)

out = data['output']

def week_agg(items):
    c = {'cost': 0.0, 'imp': 0, 'clk': 0, 'ord': 0, 'sales': 0.0, 'vcv': 0}
    for it in items:
        rep = it.get('Report') or {}
        c['cost'] += float(rep.get('Cost', 0) or 0)
        c['imp'] += int(float(rep.get('Impressions', 0) or 0))
        c['clk'] += int(float(rep.get('Clicks', 0) or 0))
        c['ord'] += int(float(rep.get('Orders', 0) or 0))
        c['sales'] += float(rep.get('SalesAmount', 0) or 0)
        c['vcv'] += int(float(rep.get('VideoCompleteViews', 0) or 0))
    return c

for ctry in ['US', 'DE', 'UK']:
    weeks = out[ctry]['weeks']
    print(f'[{ctry}] {len(weeks)} 周')
    for rng in sorted(weeks.keys()):
        agg = week_agg(weeks[rng])
        mark = '  <-- W39 最新完整周' if rng == '2026-09-19_2026-09-25' else ''
        print(f"  {rng}: cost={agg['cost']:10.2f} imp={agg['imp']:8d} clk={agg['clk']:6d} ord={agg['ord']:4d} sales={agg['sales']:10.2f} 完播={agg['vcv']}{mark}")
    print()

# 全局校验：US W39 cost
us39 = week_agg(out['US']['weeks'].get('2026-09-19_2026-09-25', []))
print('校验结果: US W39 cost =', us39['cost'], '->', 'PASS' if us39['cost'] > 0 else 'FAIL(瞬时异常,需等2-3分钟重跑)')
