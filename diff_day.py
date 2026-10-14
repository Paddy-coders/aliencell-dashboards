# diff_day.py — 只读：对比两份 daily_data.json 中**某一天**的逐行差异，查清某个变化从哪来
#
# 用法: python diff_day.py 2026-09-21 [旧快照] [新快照]

import json
import sys


def nn(v):
    try:
        return float(str(v).replace(',', ''))
    except Exception:
        return 0.0


def main():
    day = sys.argv[1]
    oldp = sys.argv[2] if len(sys.argv) > 2 else 'backups/daily_data.json.pre-20260924-sweep2'
    newp = sys.argv[3] if len(sys.argv) > 3 else 'daily_data.json'
    a = json.load(open(oldp, encoding='utf8'))['days'].get(day, {})
    b = json.load(open(newp, encoding='utf8'))['days'].get(day, {})
    fields = ('sessions', 'total_order_items', 'ordered_product_sales_amount', 'units_ordered', 'buy_box_percentage')
    ka = {f"{r['asin']}|{r['site']}": r for r in (a.get('biz') or [])}
    kb = {f"{r['asin']}|{r['site']}": r for r in (b.get('biz') or [])}
    print(f'{day}  行数: 旧 {len(ka)} → 新 {len(kb)}')
    for k in sorted(set(ka) | set(kb)):
        ra, rb = ka.get(k), kb.get(k)
        if not ra:
            print(f'  [新增] {k}  sales={nn(rb["ordered_product_sales_amount"])}')
            continue
        if not rb:
            print(f'  [移除] {k}  sales={nn(ra["ordered_product_sales_amount"])}')
            continue
        d = [(f, nn(ra[f]), nn(rb[f])) for f in fields if nn(ra[f]) != nn(rb[f])]
        if d:
            print(f'  [变化] {k}  ' + '; '.join(f'{f}: {x} → {y}' for f, x, y in d))
    # 站点级合计
    print('\n站点合计对比:')
    for site in sorted({r['site'] for r in list(ka.values()) + list(kb.values())}):
        sa = sum(nn(r['ordered_product_sales_amount']) for r in ka.values() if r['site'] == site)
        sb = sum(nn(r['ordered_product_sales_amount']) for r in kb.values() if r['site'] == site)
        oa = sum(nn(r['total_order_items']) for r in ka.values() if r['site'] == site)
        ob = sum(nn(r['total_order_items']) for r in kb.values() if r['site'] == site)
        mark = '  ← 有变化' if (sa != sb or oa != ob) else ''
        print(f'  {site}: sales {sa} → {sb}; orders {oa} → {ob}{mark}')


if __name__ == '__main__':
    main()
