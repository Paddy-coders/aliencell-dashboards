#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描「有销量但没有成本依据」的 ASIN，写云端 mapping.data.unmapped

用途（2026-10-21）:
    每天抓完数据后自动跑一次 —— 发现新增/漏维护的 ASIN，直接在产品关系管理页弹窗提醒，
    并在看板入口「产品关系管理」旁亮红色感叹号。不用等毛利算错了才发现。

两类问题都会进清单:
    no-map   = 云映射里根本没有这个 ASIN               → 页面把它归到「无」系列，成本 0
    no-cost  = 映射到了产品名，但成本表没有这个产品名   → 成本仍是 0，毛利虚高

用法:
    python sync_unmapped.py               # 扫描 + 写云端
    python sync_unmapped.py --dry-run     # 只打印
    python sync_unmapped.py --days 30     # 回看窗口(默认 30 天)
    python sync_unmapped.py --offline     # 只写本地 _unmapped.json，不碰云端

写入保护: mapping 表 id=1 单行被 6+ 页面共用 ⇒ 读最新 data → 只换 unmapped 键 → 整体 PATCH。
"""
import io
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DAILY_FILE = os.path.join(BASE_DIR, 'daily_data.json')
OUT_FILE = os.path.join(BASE_DIR, '_unmapped.json')

SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping'
SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'
SB_ADMIN = 'wb-map-2026'

REGION_OF_SITE = {'US': 'US', 'CA': 'US', 'MX': 'US', 'UK': 'UK',
                  'DE': 'EU', 'FR': 'EU', 'IT': 'EU', 'ES': 'EU', 'NL': 'EU',
                  'BE': 'EU', 'IE': 'EU', 'PL': 'EU', 'SE': 'EU'}


def read_json(p):
    try:
        with io.open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def fetch_cloud_data(timeout=15):
    req = urllib.request.Request(SB_URL + '?select=data&id=eq.1', headers={
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        rows = json.loads(r.read().decode('utf-8'))
    if not rows:
        raise RuntimeError('云端 mapping 表 id=1 不存在')
    return rows[0].get('data') or {}


def patch_data(data, timeout=20):
    body = json.dumps({'data': data, 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S')},
                      ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(SB_URL + '?id=eq.1', data=body, method='PATCH', headers={
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
        'x-admin-key': SB_ADMIN, 'Content-Type': 'application/json',
        'Prefer': 'return=minimal'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def fnum(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def build_report(days=30):
    """→ (report_dict, stats)"""
    daily = read_json(DAILY_FILE) or {}
    all_days = daily.get('days') or {}
    dates = sorted(d for d in all_days if (all_days[d] or {}).get('biz'))
    if not dates:
        return None, 'daily_data.json 里没有业务数据'
    through = dates[-1]
    start = dates[-1]
    # 取最近 days 天（按自然日跨度，容忍中间缺数）
    from datetime import date, timedelta
    y, m, d = (int(x) for x in through.split('-'))
    cutoff = (date(y, m, d) - timedelta(days=days - 1)).isoformat()
    window = [x for x in dates if x >= cutoff]

    agg = defaultdict(lambda: {'qty': 0.0, 'sales': 0.0, 'last': '', 'cur': '', 'item': '', 'sessions': 0})
    for dt in window:
        for r in (all_days[dt].get('biz') or []):
            asin = (r.get('asin') or '').strip().upper()
            if not asin:
                continue
            site = (r.get('site') or '').strip().upper()
            k = (asin, site)
            o = agg[k]
            o['qty'] += fnum(r.get('units_ordered'))
            o['sales'] += fnum(r.get('ordered_product_sales_amount'))
            o['sessions'] += fnum(r.get('sessions'))
            if dt > o['last']:
                o['last'] = dt
                o['cur'] = r.get('currency_code') or ''
                o['item'] = (r.get('item_name') or '')[:90]

    # 云端映射（重启再拉，保证是最新维护结果）
    asin_map, map_src = {}, 'cloud'
    try:
        cloud = fetch_cloud_data()
        for x in (cloud.get('asinMap') or []):
            if isinstance(x, dict) and x.get('asin'):
                asin_map.setdefault(str(x['asin']).strip().upper(), x.get('name'))
        cost_tbl = ((cloud.get('costTable') or {}).get('products') or {})
    except Exception:
        map_src = 'local'
        from cost_from_table import load_map_prefer_local, cost_table_doc
        for x in (load_map_prefer_local().get('asinMap') or []):
            if isinstance(x, dict) and x.get('asin'):
                asin_map.setdefault(str(x['asin']).strip().upper(), x.get('name'))
        cost_tbl = cost_table_doc(refresh=False)['products']

    items = []
    for (asin, site), o in agg.items():
        if o['qty'] <= 0:
            continue                      # 只提醒真出过货的：没销量不影响毛利
        name = asin_map.get(asin)
        if not name:
            reason, note = 'no-map', '未维护产品关系'
        elif name not in cost_tbl:
            reason, note = 'no-cost', '产品名「%s」不在成本表' % name
        else:
            continue
        items.append({'asin': asin, 'site': site, 'name': name or '',
                      'series': '', 'qty': round(o['qty'], 2), 'sales': round(o['sales'], 2),
                      'cur': o['cur'], 'lastDate': o['last'], 'sessions': int(o['sessions']),
                      'itemName': o['item'], 'reason': reason, 'note': note})

    items.sort(key=lambda x: (-x['sales'], -x['qty']))
    report = {
        'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'through': through,
        'windowDays': days,
        'windowStart': window[0] if window else '',
        'count': len(items),
        'countNoMap': sum(1 for x in items if x['reason'] == 'no-map'),
        'countNoCost': sum(1 for x in items if x['reason'] == 'no-cost'),
        'qty': round(sum(x['qty'] for x in items), 2),
        'sales': round(sum(x['sales'] for x in items), 2),
        'mapSource': map_src,
        'items': items,
    }
    return report, None


def main():
    argv = sys.argv[1:]
    dry = '--dry-run' in argv
    offline = '--offline' in argv
    days = 30
    if '--days' in argv:
        try:
            days = int(argv[argv.index('--days') + 1])
        except Exception:
            pass

    report, err = build_report(days)
    if err:
        print('❌', err)
        return 1

    print('回看窗口: %s ~ %s (%d 天) · 数据截至 %s'
          % (report['windowStart'], report['through'], report['windowDays'], report['through']))
    print('未维护成本依据的 ASIN: %d 个 (未映射 %d · 成本表缺产品名 %d) · 涉及 %g 台 / 销售额合计 %s'
          % (report['count'], report['countNoMap'], report['countNoCost'], report['qty'],
             ', '.join('%s %.2f' % (x['cur'] or '', x['sales']) for x in report['items'][:5]) or '-'))
    for x in report['items'][:15]:
        print('   %-12s %-3s %-32s %5g 台 %10.2f %-4s %s'
              % (x['asin'], x['site'], (x['name'] or '(未映射)')[:30], x['qty'], x['sales'],
                 x['cur'], x['note']))
    if report['count'] > 15:
        print('   … 还有 %d 条' % (report['count'] - 15))

    if dry:
        print('(--dry-run) 不写入')
        return 0

    io.open(OUT_FILE, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    print('已写本地快照', os.path.basename(OUT_FILE))

    if offline:
        print('(--offline) 不写云端')
        return 0

    cur = fetch_cloud_data()
    new = dict(cur)
    new['unmapped'] = report
    status = patch_data(new)
    back = (fetch_cloud_data().get('unmapped') or {})
    ok = back.get('count') == report['count'] and \
        [i.get('asin') for i in (back.get('items') or [])] == [i.get('asin') for i in report['items']]
    print(('PATCH %s · 回读校验 %s: count=%s' % (status, '✅ 一致' if ok else '❌ 不一致', back.get('count'))))
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
