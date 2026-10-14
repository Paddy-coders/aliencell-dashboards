# -*- coding: utf-8 -*-
"""三看板同期对账（诊断用，勿入回归）
逐层拆解 日/月/周 三看板的差异来源：覆盖区间 / 广告数据覆盖 / 利润报表口径
"""
import json, sys, datetime
from collections import defaultdict
sys.path.insert(0, '.')

BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'
A = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33'


def grab(path, var):
    s = open(path, encoding='utf-8', errors='replace').read()
    m = s.find('const %s = ' % var)
    if m < 0:
        return None
    i = m + len('const %s = ' % var)
    op = s[i]
    cl = '}' if op == '{' else ']'
    d = 0; instr = False; esc = False; q = ''
    for j in range(i, len(s)):
        ch = s[j]
        if instr:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == q: instr = False
            continue
        if ch in '"\'':
            instr = True; q = ch; continue
        if ch == op: d += 1
        elif ch == cl:
            d -= 1
            if d == 0:
                return json.loads(s[i:j + 1])
    raise SystemExit('unbalanced ' + var)


def wk_label(dstr):
    dt = datetime.date.fromisoformat(dstr)
    off = (dt.weekday() + 2) % 7          # 周六=0 ... 周五=6
    fri = dt - datetime.timedelta(days=off) + datetime.timedelta(days=6)
    iso = fri.isocalendar()
    return 'W%02d' % iso[1]


# ---------- 日看板 ----------
d = grab(BASE + '/_deploy/daily.html', 'DATA')
DAYS = d['days']
biz_sales = defaultdict(float); biz_units = defaultdict(float)
ad_cost_d = defaultdict(float)
for day, p in DAYS.items():
    for r in (p.get('biz') or []):
        biz_sales[day] += float(r.get('ordered_product_sales_amount') or 0)
        biz_units[day] += float(r.get('units_ordered') or 0)
    for cc, items in (p.get('ads') or {}).items():
        ad_cost_d[day] += sum(float((it.get('Report') or {}).get('Cost') or 0) for it in items)

# ---------- 月看板 ----------
m = grab(BASE + '/_deploy/monthly.html', 'DATA')
mr = m['rows']
m_sales = defaultdict(float); m_ad = defaultdict(float)
for r in mr:
    m_sales[r['ym']] += float(r.get('sales') or 0)      # 原币种混合(未换算), 仅用于观察覆盖
    m_ad[r['ym']] += float(r.get('adCost') or 0)

# ---------- 周看板 ----------
w = grab(BASE + '/_deploy/product.html', 'DATA')
ADS = grab(BASE + '/_deploy/product.html', 'ADS')
PROFIT = grab(BASE + '/_deploy/product.html', 'PROFIT')
wk_sales = defaultdict(float); wk_units = defaultdict(float)
wk_ad = defaultdict(float)
for asin, v in w['asins'].items():
    for lab, bycc in (v.get('weeks') or {}).items():
        for cc, rec in bycc.items():
            wk_sales[lab] += float(rec.get('sales') or 0)
            wk_units[lab] += float(rec.get('units') or 0)
for asin, v in (ADS or {}).items():
    for lab, bycc in (v.get('weeks') or {}).items():
        for cc, rec in bycc.items():
            wk_ad[lab] += float((rec or {}).get('spend') or 0)

print('=' * 100)
print('① 覆盖区间差异')
print('=' * 100)
days = sorted(DAYS)
print('日看板: %d 天  %s ~ %s' % (len(days), days[0], days[-1]))
print('月看板: %s' % ' '.join(sorted({r['ym'] for r in mr})))
wl = sorted(set(wk_sales) | set(wk_ad))
print('周看板: %d 周  %s ~ %s' % (len(wl), wl[0], wl[-1]))

print()
print('=' * 100)
print('② 广告花费覆盖（历史差异根因）')
print('=' * 100)
ad_weeks_d = defaultdict(float)
for day in days:
    if ad_cost_d[day]:
        ad_weeks_d[wk_label(day)] += ad_cost_d[day]
print('%-6s %14s %14s %14s %12s' % ('周', '日数据折算', '周看板ADS', '月看板adCost', '日-周'))
tot_d = tot_w = 0
for lab in sorted(set(ad_weeks_d) | set(wk_ad)):
    a, b = ad_weeks_d.get(lab, 0), wk_ad.get(lab, 0)
    tot_d += a; tot_w += b
    flag = '' if abs(a - b) < 1 else '   <<< 差异'
    print('%-6s %14.2f %14.2f %14s %12.2f%s' % (lab, a, b, '-', a - b, flag))
print('%-6s %14.2f %14.2f' % ('合计', tot_d, tot_w))

print()
print('=' * 100)
print('③ 利润报表口径：结算日 vs 下单日 / 缺失日')
print('=' * 100)
pm = json.load(open(BASE + '/profit_metrics.json', encoding='utf-8'))
erp_days = defaultdict(float)
for r in pm['rows']:
    erp_days[r['d']] += float(r.get('sales') or 0)
biz_days_with = [x for x in days if biz_sales.get(x)]
miss = [x for x in biz_days_with if x not in erp_days]
print('业务报告有数据的日: %d 天' % len(biz_days_with))
print('利润报表缺行的日:   %d 天  → %s' % (len(miss), ', '.join(miss)))
print('  这些天业务报告销售额合计 %.2f' % sum(biz_sales[x] for x in miss))
print('利润报表覆盖的日:   %d 天  %s ~ %s' % (len(erp_days), min(erp_days), max(erp_days)))

print()
# 逐日对齐（结算日口径下，同一天的两个口径）
print('%-12s %14s %10s | %14s %10s' % ('日期', '业务报告$', '件', '利润报表$', '件'))
eq = defaultdict(float)
for r in pm['rows']:
    eq[r['d']] += float(r.get('qty') or 0)
show = sorted(set(miss) | set())
for x in show[:20]:
    print('%-12s %14.2f %10.0f | %14s %10s' % (x, biz_sales[x], biz_units[x], '(缺)', '-'))
