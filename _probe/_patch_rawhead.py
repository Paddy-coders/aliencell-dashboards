# -*- coding: utf-8 -*-
"""修表头 HTML 被转义：`<span class="scope-tag">站点</span>` 被 esc() 成字面量文本。"""
import io

P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0

# 1) tableHtml 支持 raw 表头（默认仍转义，只对显式标记的列放开）
old = """      return '<th class="' + (c.l ? 'l' : '') + '">' + esc(c.t) + '</th>';"""
new = """      // 表头默认走转义（列名都是模板里写死的，但保持默认安全更稳）；
      // 需要嵌入 <span class="scope-tag"> 这类标签的列显式写 raw:1。
      return '<th class="' + (c.l ? 'l' : '') + '">' + (c.raw ? c.t : esc(c.t)) + '</th>';"""
assert s.count(old) == 1, 'tableHtml 锚点未找到'
s = s.replace(old, new); n += 1

# 2) 两处带标签的列标上 raw
for old, new in [
    ("""      { t: '店铺 UV <span class="scope-tag">站点</span>',""",
     """      { t: '店铺 UV <span class="scope-tag">站点</span>', raw: 1,"""),
    ("""      { t: '收藏 <span class="scope-tag">站点</span>',""",
     """      { t: '收藏 <span class="scope-tag">站点</span>', raw: 1,"""),
]:
    assert s.count(old) == 1, '列锚点未找到: %s' % old[:30]
    s = s.replace(old, new); n += 1

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)

# 体检：还有没有别的含标签的表头没标 raw
import re
bad = []
for m in re.finditer(r"\{\s*t:\s*'([^']*<[^']*)'([^}]*)\}", s):
    if 'raw' not in m.group(2):
        bad.append(m.group(0)[:80])
print('完成 %d 处修正' % n)
print('仍含标签但未标 raw 的表头: %d' % len(bad))
for b in bad:
    print('  !', b)
