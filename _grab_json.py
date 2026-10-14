# -*- coding: utf-8 -*-
"""从单文件 HTML 里提取 `const XXX = {...};` 的 JSON 载荷 (供交叉核对临时使用)"""
import json, re, sys

BS = chr(92)  # backslash


def grab(path, var):
    s = open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'const %s = ' % re.escape(var), s)
    if not m:
        return None, 'no marker'
    i = m.end()
    if s[i] in '{[':
        op = s[i]
        cl = '}' if op == '{' else ']'
        d = 0
        instr = False
        esc = False
        q = ''
        for j in range(i, len(s)):
            ch = s[j]
            if instr:
                if esc:
                    esc = False
                elif ch == BS:
                    esc = True
                elif ch == q:
                    instr = False
                continue
            if ch in ('"', "'"):
                instr = True
                q = ch
                continue
            if ch == op:
                d += 1
            elif ch == cl:
                d -= 1
                if d == 0:
                    return json.loads(s[i:j + 1]), None
        return None, 'unbalanced'
    j = s.index(';', i)
    return s[i:j], None


if __name__ == '__main__':
    for path, var in [tuple(a.split('::')) for a in sys.argv[1:]]:
        d, err = grab(path, var)
        print('--- %s :: %s --- %s' % (path, var, ('ERR:' + err) if err else ''))
        if err:
            continue
        if isinstance(d, list):
            print('  list len', len(d))
            if d:
                print('  样例键:', list(d[0].keys()) if isinstance(d[0], dict) else str(d[0])[:200])
        elif isinstance(d, dict):
            print('  dict keys:', list(d.keys())[:25])
            k0 = list(d.keys())[0]
            print('  首键样例:', k0, '->', str(d[k0])[:300])
        else:
            print('  scalar:', str(d)[:300])
