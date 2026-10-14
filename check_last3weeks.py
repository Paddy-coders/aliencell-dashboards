# -*- coding: utf-8 -*-
"""
前N周数据复核: 对比 ad_dashboard_data.prev.json (旧) 与 ad_dashboard_data.json (新)
逐记录核对最近 N 周内 (国家, 周, 活动, 广告组) 的 花费/销售额/曝光/点击/订单/完播/播放一半 是否变化
同时检查更早周是否也有变化(用于发现历史修正)
用法: python check_last3weeks.py [--weeks N] [--prev 文件] [--new 文件]
退出码: 0=有变化或正常完成, 输出报告
"""
import json, sys, os, argparse

def load(p):
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)

MONEY_FIELDS = ['cost', 'sales']
NUM_FIELDS = ['impressions', 'clicks', 'orders', 'videoComplete', 'videoMidpoint']
ALL_FIELDS = MONEY_FIELDS + NUM_FIELDS
FIELD_CN = {
    'cost': '花费', 'sales': '销售额', 'impressions': '曝光', 'clicks': '点击',
    'orders': '订单', 'videoComplete': '视频完播', 'videoMidpoint': '播放一半',
}

def record_map(recs):
    """key -> record"""
    m = {}
    for r in recs:
        key = (r['country'], r['week'], r.get('campaignId', ''), r.get('adGroupId', ''))
        m[key] = r
    return m

def fmt_val(field, v):
    return f"{v:.2f}" if field in MONEY_FIELDS else str(int(v or 0))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--weeks', type=int, default=3, help='复核最近N周, 默认3')
    ap.add_argument('--prev', default='ad_dashboard_data.prev.json')
    ap.add_argument('--new', default='ad_dashboard_data.json')
    args = ap.parse_args()

    old = load(args.prev)
    new = load(args.new)
    if old is None:
        print('[复核] 未找到旧数据文件 %s —— 可能是首次运行, 跳过复核(已记录本次为基准)' % args.prev)
        return 0
    if new is None:
        print('[复核] 未找到新数据文件 %s' % args.new)
        return 1

    weeks = sorted({r['week'] for r in new['records']}, key=lambda x: int(x[1:]))
    if not weeks:
        print('[复核] 新数据无周记录')
        return 0
    check_weeks = set(weeks[-args.weeks:])  # 最近N周
    print('[复核] 新数据共 %d 周: %s | 复核最近 %d 周: %s' % (len(weeks), ','.join(weeks), args.weeks, ','.join(sorted(check_weeks, key=lambda x: int(x[1:])))))

    old_map = record_map(old['records'])
    new_map = record_map(new['records'])

    diffs = []       # 最近N周内的变化
    early_diffs = [] # 更早周的变化
    added = []       # 新出现记录(最近N周)
    removed = []     # 消失记录(最近N周)

    for key, nr in new_map.items():
        country, week, cid, gid = key
        in_check = week in check_weeks
        if key not in old_map:
            (added if in_check else early_diffs).append((country, week, nr.get('campaign', ''), nr.get('adGroup', ''), '新增记录'))
            continue
        orr = old_map[key]
        for f in ALL_FIELDS:
            ov = orr.get(f, 0) or 0
            nv = nr.get(f, 0) or 0
            if abs(ov - nv) > 0.004:
                item = (country, week, nr.get('campaign', ''), nr.get('adGroup', ''), f, fmt_val(f, ov), fmt_val(f, nv))
                (diffs if in_check else early_diffs).append(item)

    for key, orr in old_map.items():
        country, week, cid, gid = key
        if key not in new_map and week in check_weeks:
            removed.append((country, week, orr.get('campaign', ''), orr.get('adGroup', ''), '记录消失'))

    print()
    if diffs or added or removed:
        print('=== 最近 %d 周数据变化 ===' % args.weeks)
        for d in diffs:
            print('  [%s %s] %s / %s : %s %s -> %s' % (d[0], d[1], d[2], d[3], FIELD_CN.get(d[4], d[4]), d[5], d[6]))
        for a in added:
            print('  [%s %s] %s / %s : %s' % (a[0], a[1], a[2], a[3], a[4]))
        for r in removed:
            print('  [%s %s] %s / %s : %s' % (r[0], r[1], r[2], r[3], r[4]))
    else:
        print('=== 最近 %d 周数据变化 ===' % args.weeks)
        print('  ✅ 无任何变化 (前%d周数据与上次一致)' % args.weeks)

    if early_diffs:
        print()
        print('=== 更早周(%d周以前)数据变化 ===' % args.weeks)
        for d in early_diffs[:50]:
            print('  [%s %s] %s / %s : %s %s -> %s' % (d[0], d[1], d[2], d[3], FIELD_CN.get(d[4], d[4]), d[5], d[6]))
        if len(early_diffs) > 50:
            print('  ... 共 %d 条, 仅显示前50条' % len(early_diffs))
    else:
        print()
        print('=== 更早周(%d周以前) === ✅ 无变化' % args.weeks)

    # 合计对比
    def total(recs):
        t = {f: 0 for f in ALL_FIELDS}
        for r in recs:
            for f in ALL_FIELDS:
                t[f] += r.get(f, 0) or 0
        return t
    ot, nt = total(old['records']), total(new['records'])
    print()
    print('=== 合计指标 ===')
    for f in ALL_FIELDS:
        if abs(ot[f] - nt[f]) > 0.004:
            print('  %s: %s -> %s (变化 %+.2f)' % (FIELD_CN[f], fmt_val(f, ot[f]), fmt_val(f, nt[f]), nt[f] - ot[f]))
        else:
            print('  %s: %s (无变化)' % (FIELD_CN[f], fmt_val(f, nt[f])))
    return 0

if __name__ == '__main__':
    sys.exit(main())
