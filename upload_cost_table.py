#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地产品成本表 product_cost_table.json 上传到云端 mapping.data.costTable

用法:
    python upload_cost_table.py            # 上传（本地 → 云端）
    python upload_cost_table.py --dry-run  # 只比对，不写

为什么搬到云端:
    成本表原本只是本地文件, 只有主看板构建时才读 ⇒ 其它应用(运营工具/运费推演/广告等)
    拿不到成本。上传后所有应用读同一份 mapping.data.costTable, 一处维护处处生效。

写入保护:
    mapping 表 id=1 的 data 被 6+ 个页面共用 ⇒ 一律「读最新 → 只换 costTable → 整体 PATCH」,
    绝不覆盖 catalog / asinMap / woot / wootCfg / freight / finance 等其它键。
"""
import io
import json
import os
import sys
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COST_FILE = os.path.join(BASE_DIR, 'product_cost_table.json')
COST_CACHE = os.path.join(BASE_DIR, '_cost_cache.json')

SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping'
SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'
SB_ADMIN = 'wb-map-2026'


def read_json(p):
    try:
        with io.open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def fetch_row(timeout=15):
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


def main():
    dry = '--dry-run' in sys.argv
    local = read_json(COST_FILE) or {}
    products = local.get('products') or {}
    if not products:
        print('❌ 本地成本表为空:', COST_FILE)
        return 1

    cur = fetch_row()
    cloud_products = (cur.get('costTable') or {}).get('products') or {}
    print('本地成本表: %d 个产品 (updatedAt %s)' % (len(products), local.get('updatedAt', '-')))
    print('云端 costTable: %d 个产品' % len(cloud_products))
    print('云端其它键(必须原样保留): %s' % ', '.join(sorted(cur.keys())))

    if cloud_products:
        same = json.dumps(cloud_products, sort_keys=True, ensure_ascii=False) == \
               json.dumps(products, sort_keys=True, ensure_ascii=False)
        if same:
            print('✅ 云端与本地一致, 无需上传')
            if not dry:
                _write_cache(products)
            return 0
        lk, ck = set(products), set(cloud_products)
        if lk - ck:
            print('  本地新增 %d 个: %s' % (len(lk - ck), ', '.join(sorted(lk - ck))))
        if ck - lk:
            print('  ⚠️ 云端独有 %d 个(将被本地覆盖删除): %s' % (len(ck - lk), ', '.join(sorted(ck - lk))))

    if dry:
        print('(--dry-run) 不写入')
        return 0

    cost_table = {
        'products': products,
        'updatedAt': local.get('updatedAt') or time.strftime('%Y-%m-%d'),
        'source': 'product_cost_table.json → mapping.data.costTable（upload_cost_table.py 同步）',
        'note': local.get('note', ''),
        'pushedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    new_data = dict(cur)
    new_data['costTable'] = cost_table
    status = patch_data(new_data)
    print('PATCH 返回', status)

    back = (fetch_row().get('costTable') or {}).get('products') or {}
    ok = json.dumps(back, sort_keys=True, ensure_ascii=False) == \
         json.dumps(products, sort_keys=True, ensure_ascii=False)
    print(('✅ 回读校验一致: %d 个产品' if ok else '❌ 回读校验不一致: 云端 %d 个') % len(back))
    if ok:
        _write_cache(products)
    return 0 if ok else 2


def _write_cache(products):
    io.open(COST_CACHE, 'w', encoding='utf-8', newline='\n').write(json.dumps(
        {'products': products, 'fetchedAt': time.strftime('%Y-%m-%d %H:%M:%S')},
        ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    sys.exit(main())
