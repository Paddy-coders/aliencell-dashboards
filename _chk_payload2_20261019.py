# -*- coding: utf-8 -*-
import json
s = open(r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\joybuy.html', encoding='utf-8').read()
i = s.find('PAYLOAD = ')
j = s.find('{', i)
d = 0; instr = False; esc = False; q = ''
for k in range(j, len(s)):
    c = s[k]
    if instr:
        if esc:
            esc = False
        elif c == '\\':
            esc = True
        elif c == q:
            instr = False
        continue
    if c in '"\'':
        instr = True; q = c; continue
    if c == '{':
        d += 1
    elif c == '}':
        d -= 1
        if d == 0:
            end = k + 1; break
pl = json.loads(s[j:end])
print('windowLabel:', pl.get('windowLabel'))
print('trimmedWeeks:', json.dumps(pl.get('trimmedWeeks'), ensure_ascii=False)[:400])
print('warnings:'); 
for w in pl.get('warnings') or []:
    print('  -', w)
print('UK data keys:', list(pl['data']['UK'].keys()))
print('salesByCurrency:', pl.get('salesByCurrency'))
