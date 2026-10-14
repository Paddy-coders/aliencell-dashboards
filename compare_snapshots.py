# compare_snapshots.py — 只读对比两份 daily_data.json 快照，量化「历史数据会不会变」
#
# 背景（2026-09-24，用户指出）：复查的意义不只是补空缺，更在于**重新校准**——
#   已采到的数据在上游也会变（订单取消/退款/归因回填、易仓侧修正）。
# 本脚本用纵向快照（如 daily_data.json.bak-20260831 与当前 daily_data.json）
# 逐日期、逐键对比，回答：距上次采集 N 天后，数据到底变了没有、变的是什么。
# 只读，不写任何文件。
#
# 用法: python compare_snapshots.py [旧快照] [新快照]

import json
import sys


def n(v):
    try:
        return float(str(v).replace(',', ''))
    except Exception:
        return 0.0


def rk(r):
    return f"{r.get('date')}|{r.get('asin')}|{r.get('user_account') or r.get('site')}"


def load(p):
    with open(p, encoding='utf8') as f:
        return json.load(f)


def ad_stats(day):
    """返回 (广告 item 数, 花费合计, 销售额合计)"""
    items = cost = sales = 0
    for v in (day.get('ads') or {}).values():
        for i in (v or []):
            items += 1
            cost += n((i.get('Report') or {}).get('Cost'))
            sales += n((i.get('Report') or {}).get('SalesAmount'))
    return items, cost, sales


def biz_map(day):
    return {rk(r): r for r in (day.get('biz') or []) if r.get('asin')}


def main():
    oldp = sys.argv[1] if len(sys.argv) > 1 else 'daily_data.json.bak-20260831'
    newp = sys.argv[2] if len(sys.argv) > 2 else 'daily_data.json'
    old = load(oldp)['days']
    new = load(newp)['days']
    print(f'旧快照: {oldp}  ({len(old)} 天)')
    print(f'新快照: {newp}  ({len(new)} 天)')
    common = sorted(set(old) & set(new))

    print('\n日期          biz旧 biz新 | 仅旧 仅新 值变 | sessions旧  新     | ads旧 ads新 | 花费旧      新')
    print('-' * 118)
    drift_dates = []
    biz_changed_keys = 0
    for d in common:
        ob, nb = biz_map(old[d]), biz_map(new[d])
        only_old = [k for k in ob if k not in nb]
        only_new = [k for k in nb if k not in ob]
        chg = []
        for k in ob:
            if k not in nb:
                continue
            o, b = ob[k], nb[k]
            diffs = {}
            for m in ('sessions', 'total_order_items', 'ordered_product_sales_amount'):
                if n(o.get(m)) != n(b.get(m)):
                    diffs[m] = (n(o.get(m)), n(b.get(m)))
            if diffs:
                chg.append((k, diffs))
        so = sum(n(r.get('sessions')) for r in ob.values())
        sn = sum(n(r.get('sessions')) for r in nb.values())
        oi, oc, os_ = ad_stats(old[d])
        ni, nc, ns = ad_stats(new[d])
        addiff = (oi != ni) or abs(oc - nc) > 0.01
        bizdiff = bool(only_old or only_new or chg)
        mark = ''
        if bizdiff or addiff:
            drift_dates.append(d)
            mark = '*'
        print(f'{d}{mark} {len(ob):6d} {len(nb):6d} | {len(only_old):4d} {len(only_new):4d} {len(chg):4d} | '
              f'{so:9.0f} {sn:9.0f} | {oi:5d} {ni:5d} | {oc:10.2f} {nc:10.2f}')
        biz_changed_keys += len(chg)
        for k, diffs in chg[:2]:
            print(f'      · {k}  ' + '; '.join(f'{m}: {a}→{b}' for m, (a, b) in diffs.items()))

    print('-' * 118)
    print(f'共同日期 {len(common)} 天；存在差异的日期 {len(drift_dates)} 天；业务指标变动的键 {biz_changed_keys} 个')
    if drift_dates:
        print('差异日期: ' + ', '.join(drift_dates[:40]) + (' ...' if len(drift_dates) > 40 else ''))
        # 计算漂移日期距快照采集时间（以快照最新日期为基准）
        print('\n各差异日期的「年龄」（相对新快照最新日期）:')
        import datetime
        last = max(common)
        y, m, dd = map(int, last.split('-'))
        base = datetime.date(y, m, dd)
        ages = []
        for d in drift_dates:
            yy, mm, ddd = map(int, d.split('-'))
            ages.append((base - datetime.date(yy, mm, ddd)).days)
        ages.sort()
        print(f'  最小 {ages[0]} 天前 ~ 最大 {ages[-1]} 天前；分布: {ages}')
    else:
        print('两份快照完全一致 → 该区间内源数据未发生变化')


if __name__ == '__main__':
    main()
