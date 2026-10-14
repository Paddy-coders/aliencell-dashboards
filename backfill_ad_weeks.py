# -*- coding: utf-8 -*-
"""回填 ad_weekly_all.json 缺失的周 —— 从日看板的逐日广告明细（覆盖全期）折算而来。

背景（2026-10-10 排查）:
  cdp_fetch_ad_weekly.js 每次只抓「最近 7 周」并**整份覆盖** ad_weekly_all.json,
  导致周看板(product.html)的广告数据永远只有最近 7 周 —— 更早的周广告花费为 0,
  毛利被高估、ROAS/ACOS 失真, 而日/月看板有全期广告数据 → 三看板对不上。
  日看板的 daily_data.json 里每天都带 ads[国家] = [广告明细行](与周报同形),
  覆盖 2026-06-23 起全期, 故用它把缺失周补回。

口径:
  周 = 周六~周五 (与看板一致); 同一条广告行按 (CampaignID, AdGroupID, Asin, Sku) 合并求和;
  只补「文件里没有」的周, 已有周不动(仅做一致性核对并打印差异)。

用法:
  python backfill_ad_weeks.py            # 干跑, 只报告
  python backfill_ad_weeks.py --write    # 备份后写入
"""
import json
import os
import sys
import shutil
import datetime
from collections import defaultdict

A_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33'
B_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'
WEEKLY = os.path.join(A_DIR, 'ad_weekly_all.json')
DAILY = os.path.join(B_DIR, 'daily_data.json')

WEEK_FIELDS = ['Impressions', 'Clicks', 'Cost', 'Orders', 'SalesAmount']
KEY_FIELDS = ['Asin', 'Sku', 'AdGroupID', 'CampaignID', 'CampaignIDA_Str', 'CampaignID_Str',
              'Name', 'State', 'IsTotal', 'CampaignName', 'AdGroupName', 'PortfolioName', 'CampaignType']


def week_of(dstr):
    """周标签 = 该日所在「周六~周五」周, 返回 (start, end) ISO 字符串"""
    dt = datetime.date.fromisoformat(dstr)
    off = (dt.weekday() + 2) % 7          # 周一=0 … 周六=5 → 周六偏移 0, 周日 1, 周一 2 …
    start = dt - datetime.timedelta(days=off)
    return start.isoformat(), (start + datetime.timedelta(days=6)).isoformat()


def r2(x):
    return round(float(x) + 0.0, 2)


def merge_item(dst, src):
    rep = dst.setdefault('Report', {})
    srep = src.get('Report') or {}
    for f in WEEK_FIELDS:
        rep[f] = (rep.get(f) or 0) + (srep.get(f) or 0)
    imp, clk, cost = rep.get('Impressions') or 0, rep.get('Clicks') or 0, rep.get('Cost') or 0
    ords, sales = rep.get('Orders') or 0, rep.get('SalesAmount') or 0
    rep['ClickRate'] = r2(clk / imp * 100) if imp else 0
    rep['OrdersRate'] = r2(ords / clk * 100) if clk else 0
    rep['CPC'] = r2(cost / clk) if clk else 0
    rep['ACoS'] = r2(cost / sales * 100) if sales else 0


def main():
    write = '--write' in sys.argv
    daily = json.load(open(DAILY, encoding='utf-8'))
    wk = json.load(open(WEEKLY, encoding='utf-8'))
    out = wk['output']

    # 1) 日数据 → (国家, 周) → 合并后的广告行
    bucket = defaultdict(dict)          # (cc, wkkey) -> {rowkey: item}
    day_count = defaultdict(int)
    for day in sorted((daily.get('days') or {}).keys()):
        ads = daily['days'][day].get('ads') or {}
        if not ads:
            continue
        s, e = week_of(day)
        wkkey = s + '_' + e
        for cc, items in ads.items():
            day_count[(cc, wkkey)] += 1
            slot = bucket[(cc, wkkey)]
            for it in items:
                k = tuple(str(it.get(f)) for f in KEY_FIELDS)
                if k not in slot:
                    slot[k] = {f: it.get(f) for f in KEY_FIELDS}
                    slot[k]['Report'] = {}
                merge_item(slot[k], it)

    # 2) 覆盖情况
    print('=== ad_weekly_all.json 现状 ===')
    for cc in sorted(out):
        wks = sorted(out[cc]['weeks'].keys())
        print('  %-4s %d 周: %s ~ %s' % (cc, len(wks), wks[0][:10] if wks else '-', wks[-1][-10:] if wks else '-'))

    print('\n=== 回填计划（以日数据为准）===')
    added = defaultdict(list)
    for (cc, wkkey) in sorted(bucket):
        items = list(bucket[(cc, wkkey)].values())
        cost = sum((i['Report'].get('Cost') or 0) for i in items)
        exist = out.setdefault(cc, {}).setdefault('weeks', {})
        if wkkey in exist:
            have = sum(((i.get('Report') or {}).get('Cost') or 0) for i in exist[wkkey])
            if abs(have - cost) > 1.0:
                print('  ⚠ 差异 %-4s %s  文件 %9.2f  日数据 %9.2f  差 %8.2f' % (cc, wkkey, have, cost, have - cost))
            continue
        if cost <= 0:
            print('  -  %-4s %s  花费 0 → 跳过（无活动）' % (cc, wkkey))
            continue
        added[cc].append(wkkey)
        print('  +  %-4s %s  %3d 行  花费 %9.2f  (%d 天数据)' % (
            cc, wkkey, len(items), cost, day_count[(cc, wkkey)]))

    if not any(added.values()):
        print('\n无需回填。')
    else:
        print('\n待补周数: %s' % {c: len(v) for c, v in added.items() if v})

    if not write:
        print('\n(干跑模式；加 --write 才写入)')
        return

    # 3) 写入
    bak = WEEKLY + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    shutil.copy2(WEEKLY, bak)
    print('\n已备份原文件 →', os.path.basename(bak))
    for cc, wks in added.items():
        for wkkey in wks:
            out[cc]['weeks'][wkkey] = list(bucket[(cc, wkkey)].values())
    json.dump(wk, open(WEEKLY, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('已写入', WEEKLY, os.path.getsize(WEEKLY), 'bytes')
    for cc in sorted(out):
        wks = sorted(out[cc]['weeks'].keys())
        print('  %-4s %d 周: %s ~ %s' % (cc, len(wks), wks[0][:10], wks[-1][-10:]))


if __name__ == '__main__':
    main()
