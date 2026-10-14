# -*- coding: utf-8 -*-
"""扫描构建脚本里的 Python 三引号块, 找「单反斜杠 + 单引号」(\\') 隐患。

背景: integrate_ads.py 等脚本用 '''...''' 包住要注入的 JS。块内若写 \\'
      Python 会把反斜杠吃掉, 注入到 JS 里就变成裸引号 → 整段 JS 语法错误 → 主脚本不执行(整页白屏)。
      正确写法是 \\\\' (Python 解析后剩 \\' 交给 JS)。
用法: python _scan_escapes.py [目录或文件...]   默认扫当前目录下所有 .py
"""
import os
import re
import sys

BS = chr(92)          # 反斜杠
SQ = chr(39)          # 单引号
BAD = BS + SQ         # \'  ← 隐患
OK = BS + BS + SQ     # \\' ← 正确写法

TRIPLE = SQ * 3


def scan(path):
    try:
        with open(path, encoding='utf-8') as f:
            src = f.read()
    except Exception as e:
        return [('读文件失败', str(e), '')]
    hits = []
    for m in re.finditer(TRIPLE + r'([\s\S]*?)' + TRIPLE, src):
        body = m.group(1)
        for i, line in enumerate(body.split('\n'), 1):
            # 先把正确的 \\' 抹掉, 再看还剩不剩 \'
            if BAD in line.replace(OK, ''):
                hits.append((path, i, line.strip()[:120]))
    return hits


def main():
    args = sys.argv[1:]
    if not args:
        args = ['.']
    files = []
    for a in args:
        if os.path.isdir(a):
            for fn in sorted(os.listdir(a)):
                if fn.endswith('.py') and not fn.startswith('_scan_escapes'):
                    files.append(os.path.join(a, fn))
        else:
            files.append(a)
    total = 0
    for f in files:
        hits = scan(f)
        if hits:
            total += len(hits)
            print('FAIL %s: %d 处 \\\' 隐患' % (f, len(hits)))
            for h in hits[:20]:
                print('     line %s: %s' % (h[1], h[2]))
            if len(hits) > 20:
                print('     ... 其余 %d 处' % (len(hits) - 20))
    if total:
        print('共 %d 处隐患 —— 请把 \\\' 改成 \\\\\'' % total)
        sys.exit(1)
    print('OK: 扫描 %d 个脚本, 三引号块内无 \\\' 隐患' % len(files))


if __name__ == '__main__':
    main()
