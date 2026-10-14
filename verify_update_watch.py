# -*- coding: utf-8 -*-
"""校验「云端更新提示」改动只新增了一段代码：把新产物里的片段删掉后，必须与被替换的旧部署文件逐字节一致。

这样可证明重新生成看板没有夹带任何数据/逻辑变化。
用法：python verify_update_watch.py
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))
DEPLOY = os.path.join(BASE, '_deploy')
PROD = r'C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33'

PAIRS = [
    ('daily.html',   os.path.join(BASE, 'daily.html'),                   os.path.join(DEPLOY, 'daily.html')),
    ('ad.html',      os.path.join(BASE, 'ad_dashboard.html'),            os.path.join(DEPLOY, 'ad.html')),
    ('monthly.html', os.path.join(BASE, 'monthly.html'),                 os.path.join(DEPLOY, 'monthly.html')),
    ('target.html',  os.path.join(BASE, 'target.html'),                  os.path.join(DEPLOY, 'target.html')),
    ('product.html', os.path.join(PROD, 'filterable_dashboard.html'),    os.path.join(DEPLOY, 'product.html')),
]


def strip_watch(s):
    """摘掉提示条片段并把锚点还原成 cloudWootSync 段结尾，用于两侧对等比较。"""
    i = s.find('// ===== 云端更新提示')
    if i < 0:
        return s
    while i > 0 and s[i - 1] in '\r\n':
        i -= 1
    j = s.find('})();', i) + len('})();')
    k = j
    while k < len(s) and s[k] in '\r\n':
        k += 1
    eol = '\r\n' if '\r\n' in s else '\n'
    return s[:i] + eol + s[k:]


def run():
    ok = True
    for name, new_path, old_path in PAIRS:
        if not (os.path.exists(new_path) and os.path.exists(old_path)):
            print('MISSING  %-14s new=%s old=%s' % (name, os.path.exists(new_path), os.path.exists(old_path)))
            ok = False
            continue
        with open(new_path, encoding='utf-8', newline='') as f:
            new = f.read()
        with open(old_path, encoding='utf-8', newline='') as f:
            old = f.read()
        if 'cloudUpdateWatch' not in new:
            print('NO-FRAG  %-14s 新产物里没有片段' % name)
            ok = False
            continue
        a, b = strip_watch(new), strip_watch(old)
        if a == b:
            print('PASS     %-14s 两侧摘掉片段后逐字节一致 (片段 %d 字符)' % (name, len(new) - len(a)))
        else:
            print('DIFF     %-14s 摘掉片段后仍不同: %d vs %d' % (name, len(a), len(b)))
            i = 0
            while i < min(len(a), len(b)) and a[i] == b[i]:
                i += 1
            print('         首个差异 @%d' % i)
            print('         新: %r' % a[max(0, i - 40):i + 60])
            print('         旧: %r' % b[max(0, i - 40):i + 60])
            ok = False
    print('\n结论:', 'ALL PASS' if ok else '存在问题，勿部署')
    return ok


if __name__ == '__main__':
    raise SystemExit(0 if run() else 1)
