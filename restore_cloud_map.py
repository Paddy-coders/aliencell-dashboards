"""从本地 _map_cache.json 恢复云端 mapping.data 的 asinMap / catalog（仅这两个键，其余保持云端现值）。
用途：一次测试脚本误把假数据推到云端后的回滚。带前后条数断言 + 回读校验。
"""
import json, sys, urllib.request

URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?id=eq.1'
HDR = {
    'apikey': 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s',
    'Authorization': 'Bearer sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s',
    'Content-Type': 'application/json',
    'x-admin-key': 'wb-map-2026',
}


def req(method, url, body=None, headers=None):
    h = dict(HDR)
    if headers:
        h.update(headers)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=30) as resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


def get_data():
    _, rows = req('GET', URL + '&select=data')
    return rows[0]['data']


def patch(data):
    st, _ = req('PATCH', URL, {'data': data}, {'Prefer': 'return=minimal'})
    return st


def main():
    dry = '--dry-run' in sys.argv
    local = json.load(open('_map_cache.json', encoding='utf-8'))
    want_asin = local['asinMap']
    want_cat = local['catalog']
    print(f'本地快照: asinMap={len(want_asin)} catalog={len(want_cat)}')

    cur = get_data()
    print(f'云端当前: asinMap={len(cur.get("asinMap") or [])} catalog={len(cur.get("catalog") or [])} 键={list(cur.keys())}')

    new = dict(cur)
    new['asinMap'] = want_asin
    new['catalog'] = want_cat
    if dry:
        print('[dry-run] 不写入。恢复后将变为 asinMap=%d catalog=%d' % (len(want_asin), len(want_cat)))
        return

    st = patch(new)
    print('PATCH ->', st)

    back = get_data()
    ok_asin = len(back.get('asinMap') or []) == len(want_asin)
    ok_cat = len(back.get('catalog') or []) == len(want_cat)
    same = json.dumps(back['asinMap'], sort_keys=True, ensure_ascii=False) == json.dumps(want_asin, sort_keys=True, ensure_ascii=False)
    print(f'回读: asinMap={len(back.get("asinMap") or [])} catalog={len(back.get("catalog") or [])} 逐字段一致={same}')
    print('其它键:', {k: len(v) if isinstance(v, list) else 'obj' for k, v in back.items() if k not in ('asinMap', 'catalog')})
    bad = [x for x in (back.get('asinMap') or []) if str(x.get('asin', '')).startswith(('AUS', 'AUK', 'BEU', 'NONE'))]
    print('残留测试行:', len(bad))
    print('RESULT:', 'OK' if (ok_asin and ok_cat and same and not bad) else 'FAIL')


if __name__ == '__main__':
    main()
