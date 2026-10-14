# -*- coding: utf-8 -*-
"""三看板对账 v2（诊断用，勿入回归）
把差异逐层拆开: 覆盖区间 / 币种折算 / 结算日vs下单日
"""
import json, sys, datetime
from collections import defaultdict
sys.path.insert(0, '.')

BASE = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'


def grab(path, var):
    s = open(path, encoding='utf-8', errors='replace').read()
    m = s.find('const %s = ' % var)
    if m < 0:
        return None
    i = m + len('const %s = ' % var)
    op = s[i]; cl = '}' if op == '{' else ']'
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


d = grab(BASE + '/_deploy/daily.html', 'DATA')
FXd = grab(BASE + '/_deploy/daily.html', 'FX')          # {months:{ym:{cur:1CUR->USD}}}
FM = (FXd or {}).get('months') or {}
DAYS = d['days']
CUR = {'US': 'USD', 'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR',
       'NL': 'EUR', 'BE': 'EUR', 'IE': 'EUR', 'PL': 'PLN', 'SE': 'SEK', 'CA': 'CAD', 'MX': 'MXN'}


def to_usd(v, site, ym):
    cur = CUR.get(site)
    if cur == 'USD' or not cur:
        return v
    r = (FM.get(ym) or {}).get(cur)          # 1 CUR = r USD
    return v * r if r else v


# 逐日逐站 销售额/件数/订单 → USD
day_sales_usd = defaultdict(float); day_units = defaultdict(float); day_orders = defaultdict(float)
site_month = defaultdict(float)
for day, p in DAYS.items():
    ym = day[:7]
    for r in (p.get('biz') or []):
        s = float(r.get('ordered_product_sales_amount') or 0)
        u = float(r.get('units_ordered') or 0)
        site = r.get('site')
        y = to_usd(s, site, ym)
        day_sales_usd[day] += y
        day_units[day] += u
        day_orders[day] += float(r.get('orders') or 0)
        site_month[(ym, site)] += y

print('=' * 104)
print('① 日看板原始数据（业务报告，按各自当月 1 号汇率折算 USD）')
print('=' * 104)
days = sorted(DAYS)
print('覆盖 %s ~ %s (%d 天)' % (days[0], days[-1], len(days)))
print('全期销售额(USD) = %.2f' % sum(day_sales_usd.values()))
print('全期订单件数    = %.0f' % sum(day_units.values()))
print()
for ym in sorted({x[:7] for x in days}):
    sub = [x for x in days if x[:7] == ym]
    print('  %s  %2d 天  USD %12.2f  件 %6.0f' % (ym, len(sub),
          sum(day_sales_usd[x] for x in sub), sum(day_units[x] for x in sub)))

# 周窗口
def wk_span(lab):
    n = int(lab[1:])
    # 用日数据反查该周标签的起止
    out = []
    for day in days:
        dt = datetime.date.fromisoformat(day)
        off = (dt.weekday() + 2) % 7
        fri = dt - datetime.timedelta(days=off) + datetime.timedelta(days=6)
        if 'W%02d' % fri.isocalendar()[1] == lab:
            out.append(day)
    return out


print()
print('=' * 104)
print('② 覆盖区间差异（周看板窗口 = 报表周 W27~W40）')
print('=' * 104)
w27 = wk_span('W27'); w40 = wk_span('W40')
if w27 and w40:
    lo, hi = w27[0], w40[-1]
    print('报表周窗口: %s ~ %s' % (lo, hi))
    inwin = [x for x in days if lo <= x <= hi]
    outwin = [x for x in days if x < lo or x > hi]
    print('  窗口内 %d 天: 销售额 USD %.2f  件 %.0f' % (len(inwin), sum(day_sales_usd[x] for x in inwin), sum(day_units[x] for x in inwin)))
    print('  窗口外 %d 天: 销售额 USD %.2f  件 %.0f  ← 周看板不含' % (len(outwin), sum(day_sales_usd[x] for x in outwin), sum(day_units[x] for x in outwin)))
    for x in outwin:
        print('     %s  USD %10.2f  件 %.0f' % (x, day_sales_usd[x], day_units[x]))
    print()
    print('  → 期望: 周看板销售额 ≈ %.2f, 日/月看板 ≈ %.2f' % (
        sum(day_sales_usd[x] for x in inwin), sum(day_sales_usd.values())))
