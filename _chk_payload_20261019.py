# -*- coding: utf-8 -*-
"""从 joybuy.html 内嵌 PAYLOAD 提取关键指标（花括号配平解析，跳过字符串字面量）"""
import json, re, sys, collections

p = r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\joybuy.html'
s = open(p, encoding='utf-8').read()

i = s.find('PAYLOAD = ')
if i < 0:
    print('未找到 PAYLOAD'); sys.exit(1)
j = s.find('{', i)
depth = 0
instr = False
esc = False
quote = ''
for k in range(j, len(s)):
    ch = s[k]
    if instr:
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == quote:
            instr = False
        continue
    if ch in '"\'':
        instr = True; quote = ch; continue
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = k + 1
            break
raw = s[j:end]
pl = json.loads(raw)

print('builtAt:', pl.get('builtAt'))
rng = pl.get('range', {})
print('range:', rng)
weeks = pl.get('weeks') or pl.get('weekList') or []
print('顶层 keys:', list(pl.keys()))
print('周数:', len(weeks), weeks[:2], '...', weeks[-2:] if weeks else '')
data = pl.get('data', {})
print('站点:', list(data.keys()))

# 套装维度：payload.data.<站>.skuWeeks[].bundle
buckets = collections.Counter()
for site, v in data.items():
    sw = v.get('skuWeeks') or []
    for row in sw:
        buckets[(site, row.get('bundle') or '(空)')] += 1
print('\npayload skuWeeks 行数:', sum(buckets.values()))
for k2, n in sorted(buckets.items()):
    print('  ', k2, n)
allb = sorted({b for (_s, b) in buckets})
print('bundle 种类:', allb)

# 每站周数 / 日明细
for site, v in data.items():
    print(f'[{site}] 周数={len(v.get("weeks") or [])} 日明细={len(v.get("daily") or [])} SKU={len(v.get("skus") or [])}')
