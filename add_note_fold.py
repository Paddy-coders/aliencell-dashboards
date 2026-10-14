# -*- coding: utf-8 -*-
"""
把各看板底部/表格下方的大段「解释文字」（指标口径 / 口径说明 / 脚注）改成可折叠块。

设计（2026-10-12）：
- 用原生 <details>/<summary>，**零依赖、无兼容问题**，默认收起。
- 包裹后的结构：
      <details class="noteFold"><summary>📖 xxx</summary>
        <div class="note">...原文...</div>
      </details>
- 动态填充的说明块（joybuy 的 filterNote / footNote）内容为空时自动隐藏。
- 幂等：已包裹过的文件再跑不会重复处理。

用法：
    python add_note_fold.py --check      # 只检查，不写
    python add_note_fold.py              # 就地改写
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
A_DIR = r'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33'

MARK_CSS = '/* note-fold: 解释块折叠 (2026-10-12) */'
MARK_JS = '/* note-fold: 空内容折叠块自动隐藏 (2026-10-12) */'

CSS_BLOCK = MARK_CSS + """
.noteFold{margin-top:8px;border:1px solid var(--border);border-radius:8px;background:rgba(127,127,127,.045);}
.noteFold>summary{cursor:pointer;list-style:none;padding:6px 10px;font-size:12px;font-weight:600;color:var(--muted);display:flex;align-items:center;gap:6px;user-select:none;}
.noteFold>summary::-webkit-details-marker{display:none;}
.noteFold>summary::marker{content:'';}
.noteFold>summary::before{content:'\\25B8';font-size:11px;display:inline-block;transition:transform .15s;}
.noteFold[open]>summary::before{transform:rotate(90deg);}
.noteFold>summary::after{content:'展开';margin-left:auto;font-weight:400;opacity:.6;}
.noteFold[open]>summary::after{content:'收起';}
.noteFold>.note,.noteFold>.foot-note{margin:0;padding:8px 10px 10px;border-top:1px dashed var(--border);text-align:left;line-height:1.7;}
"""

JS_BLOCK = """
<script>
""" + MARK_JS + """
(function(){
  function sync(){
    var ds = document.querySelectorAll('details.noteFold');
    for (var i = 0; i < ds.length; i++) {
      var b = ds[i].querySelector('.note,.foot-note');
      ds[i].style.display = (b && b.textContent.trim()) ? '' : 'none';
    }
  }
  window.__syncNoteFold = sync;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();
})();
</script>
"""


def inject_css(html):
    """在第一个 </style> 前插入折叠样式（幂等）"""
    if MARK_CSS in html:
        return html, False
    i = html.find('</style>')
    if i < 0:
        raise RuntimeError('未找到 </style>，无法注入样式')
    return html[:i] + CSS_BLOCK + html[i:], True


def inject_js(html):
    """在 </body> 前插入空内容隐藏脚本（幂等）"""
    if MARK_JS in html:
        return html, False
    i = html.rfind('</body>')
    if i < 0:
        i = len(html)
    return html[:i] + JS_BLOCK + html[i:], True


def find_div_end(html, start):
    """从 <div 位置找到配对的 </div> 结束下标（考虑嵌套）"""
    depth = 0
    i = start
    pat = re.compile(r'<div\b|</div>')
    while True:
        m = pat.search(html, i)
        if not m:
            raise RuntimeError('div 未闭合')
        if m.group(0) == '</div>':
            depth -= 1
            if depth == 0:
                return m.end()
        else:
            depth += 1
        i = m.end()


def wrap(html, anchor, summary, cls_re='note'):
    """
    把 <div class="note">...</div> 包成 <details class="noteFold">。
    anchor: 用于定位的片段（会先找到它，再回退到其所在 div 的开头）
    """
    # 已包裹则跳过
    if 'class="noteFold"' in html and anchor in html:
        # 判断紧邻前面是否已是 details
        ai = html.find(anchor)
        if ai > 0 and html.rfind('<details class="noteFold">', 0, ai) > html.rfind('</details>', 0, ai):
            return html, False
    ai = html.find(anchor)
    if ai < 0:
        return html, None          # 找不到 → 报 None 让调用方记录
    # 回退到该 div 的 '<'
    ds = html.rfind('<div', 0, ai)
    if ds < 0:
        return html, None
    de = find_div_end(html, ds)
    inner = html[ds:de]
    block = ('<details class="noteFold">\n  <summary>' + summary + '</summary>\n  ' +
             inner + '\n</details>')
    return html[:ds] + block + html[de:], True


TASKS = [
    # (文件, 锚点片段, 摘要标题)
    ('monthly_dashboard_template.html', '指标口径与周度汇总看板一致：转化率', '📖 指标口径与说明（毛利 / VAT / 费用占比 / 退款 / 多渠道等）'),
    ('target_dashboard_template.html', '匹配规则：目标表「产品」列', '📖 匹配规则与口径说明（平台 / 目标匹配 / 换算）'),
    ('daily_dashboard_template.html', '指标口径：流量=买家访问次数', '📖 指标口径与说明（毛利 / VAT / 退款 / 多渠道等）'),
    ('joybuy_template.html', 'id="filterNote"', '📖 数据可用性提示（窗口 / 上架 / 空周）'),
    ('joybuy_template.html', 'id="footNote"', '📖 数据源与口径说明'),
    ('woot.html', 'Woot 数据并入口径：所有看板均并入', '📖 Woot 并入口径与 Session 说明'),
    ('mapping.html', '数据自动同步到云端数据库（Supabase）', '📖 云端同步与导入导出说明'),
]

A_TASKS = [
    ('generate_filterable_report.py', 'BuyBox 占有率为各 ASIN 的日均值', '📖 指标口径与说明（毛利 / 头寸 / 退款 / FBA 库存费细项等）'),
]


def process(path, tasks, check_only=False):
    src = io.open(path, encoding='utf-8').read()
    html = src
    changed = []
    for anchor, summary in tasks:
        html, ok = wrap(html, anchor, summary)
        if ok is None:
            raise RuntimeError('%s 未找到锚点: %s' % (os.path.basename(path), anchor[:40]))
        if ok:
            changed.append(summary[:22])
    html, c1 = inject_css(html)
    html, c2 = inject_js(html)
    if c1:
        changed.append('CSS')
    if c2:
        changed.append('JS')
    if changed and not check_only:
        io.open(path, 'w', encoding='utf-8', newline='').write(html)
    return changed


def main():
    check_only = '--check' in sys.argv
    total = 0
    for fname, anchor, summary in TASKS:
        p = os.path.join(HERE, fname)
        ch = process(p, [(anchor, summary)], check_only)
        print('%-36s %s' % (fname, ('已折叠: ' + ', '.join(ch)) if ch else '已是最新'))
        total += len(ch)
    # A 目录（周看板模板，藏在内嵌模板字符串里）
    for fname, anchor, summary in A_TASKS:
        p = os.path.join(A_DIR, fname)
        ch = process(p, [(anchor, summary)], check_only)
        print('%-36s %s' % ('(A) ' + fname, ('已折叠: ' + ', '.join(ch)) if ch else '已是最新'))
        total += len(ch)
    print('---')
    print('%s，共 %d 项变更' % ('仅检查' if check_only else '完成', total))


if __name__ == '__main__':
    main()
