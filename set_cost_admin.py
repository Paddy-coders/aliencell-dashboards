#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""维护「💰 产品成本」页的管理员邮箱白名单 — mapping.data.costAdmins

为什么需要它:
    mapping.html 的成本页有两道权限判定:
      ① wb_auth.role === 'admin'  —— 正道, login.html 从 profiles 表拉角色
      ② 本白名单                  —— 救急: 角色还没配好时, 靠邮箱先放行
    只用 ① 的话, 万一 profiles 表里 role 是 viewer, 用户自己也看不到刚做的成本页,
    且没有任何报错（只是 tab 不出现）。这条命令就是给这种情况兜底的。

用法:
    python set_cost_admin.py                      # 查看当前白名单
    python set_cost_admin.py  add a@b.com         # 追加
    python set_cost_admin.py  remove a@b.com      # 移除
    python set_cost_admin.py  clear               # 清空(只剩 role=admin 能进)
    python set_cost_admin.py  add a@b.com --dry-run

写入保护:
    只换 costAdmins 一个键, 其余键(catalog/asinMap/woot/costTable/…)一律原样回写。
"""
import io
import json
import os
import sys
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping'
SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'
SB_ADMIN = 'wb-map-2026'


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
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    cur = fetch_row()
    before = list(cur.get('costAdmins') or [])
    print('云端 costAdmins (%d): %s' % (len(before), ', '.join(before) or '(空)'))
    print('云端其它键(必须原样保留): %s' % ', '.join(sorted(cur.keys())))

    if not args:
        return 0

    op = args[0].lower()
    after = list(before)
    if op in ('add', 'remove', 'rm'):
        if len(args) < 2:
            print('❌ 用法: python set_cost_admin.py %s <邮箱>' % op)
            return 2
        for email in [a.strip().lower() for a in args[1:]]:
            if '@' not in email:
                print('❌ 不像邮箱, 跳过: %s' % email)
                continue
            if op == 'add':
                if email not in after:
                    after.append(email)
                    print('  + %s' % email)
            else:
                if email in after:
                    after.remove(email)
                    print('  - %s' % email)
    elif op == 'clear':
        after = []
        print('  清空白名单')
    else:
        print('❌ 未知操作: %s（可用 add / remove / clear）' % op)
        return 2

    if after == before:
        print('白名单无变化')
        return 0
    print('变更后 (%d): %s' % (len(after), ', '.join(after) or '(空)'))
    if dry:
        print('(--dry-run) 不写入')
        return 0

    new_data = dict(cur)
    if after:
        new_data['costAdmins'] = after
    else:
        new_data.pop('costAdmins', None)
    print('PATCH 返回', patch_data(new_data))

    back = list(fetch_row().get('costAdmins') or [])
    ok = sorted(back) == sorted(after)
    print(('✅ 回读校验一致: %s' % (', '.join(back) or '(空)')) if ok
          else ('❌ 回读不一致: %s' % ', '.join(back)))
    # 顺带确认没碰坏别的东西
    after_row = fetch_row()
    lost = [k for k in cur if k not in after_row]
    if lost:
        print('❌ 有键被弄丢了: %s' % ', '.join(lost))
        return 2
    print('✅ 其它键均完好')
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
