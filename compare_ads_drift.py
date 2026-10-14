# compare_ads_drift.py — 只读：精确区分「广告数据当时没采到(覆盖问题)」与「数值被上游改动(真实漂移)」
#
# 背景（2026-09-24）：用户指出复查的本意是**重新校准**（有数据的也会变）。
#   粗对比两份快照时，广告 item 数变化混杂了两种完全不同的原因：
#     A. 覆盖问题：当时只采到部分国家（如只 US/DE），后来补齐 → item 数增加，但值没变
#     B. 真实漂移：同一国家同一广告实体的 Cost/Sales 被上游修改
#   本脚本按 日期×国家 拆开，对两边都有的国家比较花费合计，只把 B 记为漂移。
# 只读，不写任何文件。
#
# 用法: python compare_ads_drift.py [旧快照] [新快照]

import json
import sys


def n(v):
    try:
        return float(str(v).replace(',', ''))
    except Exception:
        return 0.0


def load(p):
    with open(p, encoding='utf8') as f:
        return json.load(f)


def cc_stats(day, cc):
    items = day.get('ads', {}).get(cc) or []
    return len(items), sum(n((i.get('Report') or {}).get('Cost')) for i in items), sum(n((i.get('Report') or {}).get('SalesAmount')) for i in items)


def main():
    oldp = sys.argv[1] if len(sys.argv) > 1 else 'daily_data.json.bak-20260831'
    newp = sys.argv[2] if len(sys.argv) > 2 else 'daily_data.json'
    old = load(oldp)['days']
    new = load(newp)['days']
    common = sorted(set(old) & set(new))
    allcc = sorted({cc for d in common for cc in set(old[d].get('ads', {})) | set(new[d].get('ads', {}))})

    print(f'对比 {oldp}  vs  {newp}    共同日期 {len(common)} 天\n')
    hdr = '日期        ' + ''.join(f'{cc:>13s}' for cc in allcc)
    print(hdr)
    print('-' * len(hdr))

    coverage_days, drift_days = [], []
    drift_detail = []
    for d in common:
        cells, row_cov, row_drift = [], False, False
        for cc in allcc:
            oi, oc, os_ = cc_stats(old[d], cc)
            ni, nc, ns = cc_stats(new[d], cc)
            if oi == 0 and ni > 0:
                cells.append('       ←补齐')
                row_cov = True
            elif oi > 0 and ni == 0:
                cells.append('       →丢失')   # 反向: 旧有新无, 值得警惕
                row_cov = True
            elif oi > 0 and ni > 0 and (abs(oc - nc) > 0.01 or abs(os_ - ns) > 0.01):
                cells.append(f'{oc:6.1f}→{nc:6.1f}')
                row_drift = True
                drift_detail.append((d, cc, oc, nc, os_, ns))
            else:
                cells.append(f'{nc:13.1f}' if ni else '            -')
        if row_cov:
            coverage_days.append(d)
        if row_drift:
            drift_days.append(d)
        mark = ('D' if row_drift else ' ') + ('C' if row_cov else ' ')
        print(f'{d}{mark}' + ''.join(cells))

    print('\n' + '=' * 118)
    print(f'【覆盖补齐/丢失】的日期 {len(coverage_days)} 天  (D=数值漂移  C=覆盖变化)')
    if coverage_days:
        print('  ' + ', '.join(coverage_days))
    print(f'【真实数值漂移】的日期 {len(drift_days)} 天')
    if drift_days:
        print('  ' + ', '.join(drift_days))
        print('\n  明细（日期 国家 花费旧→新 / 销售额旧→新）:')
        for d, cc, oc, nc, os_, ns in drift_detail[:40]:
            print(f'    {d} {cc}  cost {oc:.2f}→{nc:.2f}   sales {os_:.2f}→{ns:.2f}')
        if len(drift_detail) > 40:
            print(f'    ... 共 {len(drift_detail)} 条')
    else:
        print('  无：两边都采到的国家，其花费/销售额完全一致 → 广告数值本身未被改动')


if __name__ == '__main__':
    main()
