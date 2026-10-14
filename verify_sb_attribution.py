# -*- coding: utf-8 -*-
"""校验：品牌推广(SB)花费是否按 2026-10-10 运营指认的规则真正落进看板

背景：SB 报表里 Asin/Sku 都为空，旧规则按 ASIN 聚合时整块跳过 ⇒ 月/周看板的
      广告花费与毛利都少扣了 SB（2026-08 少 3,692 USD、2026-09 少 6,971 USD）。
      本脚本从**源数据**独立重算一遍归属，再和**已构建的 html 内嵌数据**比对，
      避免"改了规则但看板没重建"或"重建了但注入点没生效"这类静默失败。

用法：python verify_sb_attribution.py        （cwd 必须是 2026-08-18-14-43-38）
"""
import json
import re
import sys
import os
import collections

sys.stdout.reconfigure(encoding='utf-8')
import ad_asin_rules as R

HERE = os.path.dirname(os.path.abspath(__file__))
WEEK_DIR = os.path.join(HERE, '..', '2026-08-17-14-21-33')

FAIL = 0


def report(ok, title, detail=''):
    global FAIL
    if not ok:
        FAIL += 1
    print('%s | %s | %s' % ('PASS' if ok else 'FAIL', title, detail))


def extract_js_object(html, marker):
    """从 html 里抠出 `marker = {...}` 的对象字面量并 json.loads（大括号配平，跳过字符串）"""
    i = html.index(marker) + len(marker)
    depth = 0
    in_str = False
    esc = False
    for j in range(i, len(html)):
        c = html[j]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return json.loads(html[i:j + 1])
    raise ValueError('未找到完整对象: ' + marker)


# ---------------------------------------------------------------- 期望值：源数据重算
daily = json.load(open(os.path.join(HERE, 'daily_data.json'), encoding='utf-8'))
exp_month = collections.defaultdict(float)      # (ym, cc, asin) -> 广告花费
sb_month = collections.defaultdict(float)       # (ym, asin) -> SB 花费
for d in sorted(daily['days']):
    ym = d[:7]
    for cc, items in (daily['days'][d].get('ads') or {}).items():
        for it in items:
            a = R.attribute(it, cc)
            if not a:
                continue
            cost = float((it.get('Report') or {}).get('Cost') or 0)
            exp_month[(ym, cc, a)] += cost
            if (it.get('CampaignType') or '') == 'sponsoredBrands':
                sb_month[(ym, a)] += cost

# ---------------------------------------------------------------- 1. 月度看板
monthly_html = open(os.path.join(HERE, 'monthly.html'), encoding='utf-8').read()
DATA = extract_js_object(monthly_html, 'const DATA = ')
got_month = collections.defaultdict(float)
for r in DATA['rows']:
    got_month[(r['ym'], r['cc'], r['asin'])] += float(r.get('adCost') or 0)

bad = []
for k, v in exp_month.items():
    if abs(got_month.get(k, 0.0) - v) > 0.02:
        bad.append((k, round(v, 2), round(got_month.get(k, 0.0), 2)))
report(not bad, '月度看板 adCost 与源数据逐 (月×国家×ASIN) 一致',
       '比对 %d 组' % len(exp_month) if not bad else '不一致 %d 组, 例: %s' % (len(bad), bad[:3]))

# SB 是否真的进账（抽查运营指认的三个目标）
checks = [
    ('2026-08', 'US', 'B0H69JJZ1M', 'A-X1-40W-SBV 系列'),
    ('2026-09', 'US', 'B0H9YBM4H1', 'A-Lite-SB商品集'),
    ('2026-09', 'DE', 'B0HH8J6SSL', '泛 X1 欧洲 片段1'),
]
for ym, cc, asin, label in checks:
    v = got_month.get((ym, cc, asin), 0.0)
    report(v > 0, 'SB 已进账 %s · %s %s · %s' % (ym, cc, asin, label), 'adCost=%.2f' % v)

# ---------------------------------------------------------------- 2. 周度看板
prod_html = open(os.path.join(WEEK_DIR, 'filterable_dashboard.html'), encoding='utf-8').read()
ADS = extract_js_object(prod_html, 'const ADS = ')
ad_src = json.load(open(os.path.join(WEEK_DIR, 'ad_data_for_dashboard.json'), encoding='utf-8'))
exp_wk = collections.defaultdict(float)
for asin, weeks in ad_src.items():
    for start, countries in weeks.items():
        for cc, m in countries.items():
            exp_wk[(asin, cc)] += float(m.get('spend') or 0)
got_wk = collections.defaultdict(float)
for asin, node in ADS.items():
    for wk, countries in (node.get('weeks') or {}).items():
        for cc, m in countries.items():
            got_wk[(asin, cc)] += float(m.get('spend') or 0)
bad2 = []
for k, v in exp_wk.items():
    if abs(got_wk.get(k, 0.0) - v) > 0.02:
        bad2.append((k, round(v, 2), round(got_wk.get(k, 0.0), 2)))
report(not bad2, '周度看板 ADS 与 ad_data_for_dashboard.json 一致',
       '比对 %d 组' % len(exp_wk) if not bad2 else '不一致 %d 组, 例: %s' % (len(bad2), bad2[:3]))

sb_asin_total = sum(sb_month.values())
report(sb_asin_total > 0, '周/月共用的 SB 花费总量（源数据）', '%.2f USD' % sb_asin_total)

# ---------------------------------------------------------------- 3. 月合计对账
# 目的：抓住「广告费进了广告花费列、却没进毛利」这一类静默泄漏。
#   profitOf() 在没有利润行(pN=0)时返回 null ⇒ 该行的广告费既不显示毛利也不参与毛利合计。
#   实测案例：SB 兜底归到的 ASIN 在该站点没有利润报表行（2026-10 UK B0HH8J6SSL）。
CUR_OF = {'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR',
          'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'BE': 'EUR', 'IE': 'EUR', 'PL': 'PLN',
          'SE': 'SEK', 'JP': 'JPY', 'AU': 'AUD'}
_fx = json.load(open(os.path.join(HERE, 'fx_rates.json'), encoding='utf-8'))
FX = _fx.get('rates') or {}


def usd_per(ym, cc):
    """CNY 基准表交叉换汇：rates[ym][cur] 是 1 单位外币折多少 CNY"""
    cur = CUR_OF.get(cc, 'USD')
    if cur == 'USD':
        return 1.0
    m = FX.get(ym) or {}
    if m.get(cur) and m.get('USD'):
        return m[cur] / m['USD']
    for k in sorted(FX, reverse=True):
        mm = FX[k]
        if k <= ym and mm.get(cur) and mm.get('USD'):
            return mm[cur] / mm['USD']
    return 1.0


# 源侧：利润行 + **全部**广告条目（不分 ASIN，即日看板全局口径）
src_m = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
pm_rows = json.load(open(os.path.join(HERE, 'profit_metrics.json'), encoding='utf-8'))['rows']
for r in pm_rows:
    ym = r['d'][:7]
    k = usd_per(ym, r['site'])
    comp = sum(float(r.get(x) or 0) for x in ('promo', 'comm', 'fba', 'cost', 'storage', 'other'))
    src_m[ym][0] += float(r.get('sales') or 0) * k
    src_m[ym][1] += comp * k
for d in sorted(daily['days']):
    ym = d[:7]
    for cc, items in (daily['days'][d].get('ads') or {}).items():
        k = usd_per(ym, cc)
        for it in items:
            src_m[ym][2] += float((it.get('Report') or {}).get('Cost') or 0) * k

# 源侧 JoyBuy（2026-10-13 新增）：
#   板侧 JoyBuy 行现在带 pSales/pComm/pFba/pCost/pStorage/pOther（等效利润字段，见
#   build_monthly_dashboards.py 的 _jb_prof），而 profit_metrics.json **只有 Amazon**（6 站点）
#   ⇒ 不补这一段，「看板-源」差额恒等于 JoyBuy 那 6 个字段的小计（实测 2026-09 +933.36 /
#   2026-10 −2.07，看起来像"毛核算错了"，其实是脚本口径没跟上）。
#   这里用**同一字段集**直接从账单 JSON 算（独立于行级摊分）——真正校验的是
#   「账单 → 行 GMV 占比摊分 → 月 KPI」这条链不静默丢费（含「全 0-GMV 组整笔挂第一行」的陷阱）。
#   注：费用按账单符号（负）直接相加；不并入 vat / refund / head（板侧口径同样不含，两边一致才可比）。
try:
    _jbp = json.load(open(os.path.join(HERE, 'joybuy_profit.json'), encoding='utf-8'))
except Exception:
    _jbp = {}
jb_src_m = collections.defaultdict(float)
for _m in (_jbp.get('months') or []):
    _ym = _m.get('ym')
    _cc = str(_m.get('site') or '').replace('-Site', '').strip().upper()
    if not _ym:
        continue
    _k = usd_per(_ym, _cc)
    _goods = float(_m.get('goods') or 0)
    _comp = (float(_m.get('commission') or 0) - float(_m.get('logisticsFee') or 0)
             - float(_m.get('costLocal') or 0) + float(_m.get('joybuyLogistics') or 0)
             + float(_m.get('txnFee') or 0) + float(_m.get('adsCredit') or 0)
             + float(_m.get('otherFees') or 0))
    src_m[_ym][0] += _goods * _k
    src_m[_ym][1] += _comp * _k
    jb_src_m[_ym] += (_goods + _comp) * _k

# 看板侧：复刻「月 KPI」的真实口径 —— aggMonth() 把 **范围内所有行** 的 p* 与 adCost 都累加
#   （看板 monthVal('profit') = Σp* − ΣadCost；pN 只用于判断「该月到底有没有利润报表数据」）
#   ⚠️ 2026-10-10 修正：早先这里只累加 `pN` 为真的行，于是差额恒等于「孤儿广告费」，
#      看起来像"该费用没进毛利"。实测月度 KPI 差额为 0 —— 孤儿广告费**是**被扣掉的，
#      只是它所在那一行的行级「毛利」显示 —（没有利润报表行可挂）。别再把 KPI 差额当口径边界。
got_m = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
for r in DATA['rows']:
    k = usd_per(r['ym'], r['cc'])
    comp = sum(float(r.get(x) or 0) for x in ('pPromo', 'pComm', 'pFba', 'pCost', 'pStorage', 'pOther'))
    got_m[r['ym']][0] += float(r.get('pSales') or 0) * k
    got_m[r['ym']][1] += comp * k
    got_m[r['ym']][2] += float(r.get('adCost') or 0) * k

# 行级提示：有广告费但无利润行的行，行内「毛利」列显示 —（费用仍在 KPI 里被扣掉）
orphan_m = collections.defaultdict(float)
orphan_rows = []
for r in DATA['rows']:
    if float(r.get('adCost') or 0) > 0 and not r.get('pN'):
        v = float(r['adCost']) * usd_per(r['ym'], r['cc'])
        orphan_m[r['ym']] += v
        orphan_rows.append((r['ym'], r['cc'], r['asin'], float(r['adCost']), v))

print('\n=== 月度毛利总览（USD 折算；源数据口径 = 看板 KPI 口径，不含浏览器端注入的 Woot 行）===')
print('%-9s %13s %12s %13s %9s %10s %11s %11s' %
      ('月', '报表销售额', '广告花费', '毛利', '毛利率', '看板-源', '行级无利润行', '其中JoyBuy'))
bad4 = []
for ym in sorted(src_m):
    s, g = src_m[ym], got_m[ym]
    d_profit = (g[0] + g[1] - g[2]) - (s[0] + s[1] - s[2])
    prof = s[0] + s[1] - s[2]
    print('%-9s %13.2f %12.2f %13.2f %9s %10.2f %11.2f %11.2f'
          % (ym, s[0], s[2], prof, ('%.1f%%' % (prof / s[0] * 100)) if s[0] else '—',
             d_profit, orphan_m.get(ym, 0.0), jb_src_m.get(ym, 0.0)))
    if abs(d_profit) > 1:
        bad4.append((ym, round(d_profit, 2)))
report(not bad4, '月 KPI 毛利 = 源数据毛利（含 SB 全量归属 + JoyBuy 账单口径，差额应为 0）',
       '逐月 %d 个' % len(src_m) if not bad4 else '无法解释的差额: %s' % bad4)

print('\n=== 行级提示：有广告花费、但没有利润报表行的 (月×站点×ASIN) ===')
if orphan_rows:
    for ym, cc, asin, cost, usd in sorted(orphan_rows):
        print('   %s %-3s %-12s 广告费 %10.2f (≈%9.2f USD) → 该行毛利显示 —，但费用已计入月 KPI' % (ym, cc, asin, cost, usd))
else:
    print('   无')


# ---------------------------------------------------------------- 3. SB 专项：旧规则丢了多少
SPECIAL = {'X1-SBV-片段2', 'X1-SB-定投旗舰店-LC-B2B', 'X1-SB-定投旗舰店首页-B2B'}
RE_ASIN = re.compile(r'B0[A-Z0-9]{8}')
lost = collections.defaultdict(float)
for d in sorted(daily['days']):
    ym = d[:7]
    for cc, items in (daily['days'][d].get('ads') or {}).items():
        for it in items:
            camp = (it.get('CampaignName') or '').strip()
            if (it.get('Asin') or '').strip() or camp in SPECIAL or RE_ASIN.search(camp):
                continue
            lost[ym] += float((it.get('Report') or {}).get('Cost') or 0)
print('\n=== 旧规则每月丢掉的 SB 花费（现已被兜底规则接住）===')
for ym in sorted(lost):
    print('   %s  %9.2f USD' % (ym, lost[ym]))
print('   合计      %9.2f USD' % sum(lost.values()))

print('\n结果: %s' % ('全部通过' if FAIL == 0 else '存在 %d 项 FAIL' % FAIL))
sys.exit(1 if FAIL else 0)
