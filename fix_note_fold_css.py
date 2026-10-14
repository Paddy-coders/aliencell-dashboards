# -*- coding: utf-8 -*-
"""
修正 add_note_fold.py 的注入位置：
把「塞进现有 <style> 尾部 / </body> 前」的 noteFold CSS+JS 挪成
**独立的 <style>+<script> 块插在 </head> 前**。

原因（2026-10-12 踩坑）：
    原做法把 CSS 插在第一个 `</style>` **之前**，而周看板注入链 integrate_ads.py 的锚点是
        `.country-tag {...}\n</style>`
    插入后 `</style>` 不再紧跟 `.country-tag` 规则 → 锚点失配
    → `AssertionError: KPI css anchor not found` → 整条注入链中断。
    ⇒ **不要改现有 <style> 区尾部，也不要动 </body> 尾部**，另起独立块最安全。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
A_DIR = r'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33'

MARK_CSS = '/* note-fold: 解释块折叠 (2026-10-12) */'
MARK_JS = '/* note-fold: 空内容折叠块自动隐藏 (2026-10-12) */'
OLD_CSS_TAIL = '.noteFold>.note,.noteFold>.foot-note{margin:0;padding:8px 10px 10px;border-top:1px dashed var(--border);text-align:left;line-height:1.7;}'

CSS_BLOCK = MARK_CSS + """
.noteFold{margin-top:8px;border:1px solid var(--border);border-radius:8px;background:rgba(127,127,127,.045);}
.noteFold>summary{cursor:pointer;list-style:none;padding:6px 10px;font-size:12px;font-weight:600;color:var(--muted);display:flex;align-items:center;gap:6px;user-select:none;}
.noteFold>summary::-webkit-details-marker{display:none;}
.noteFold>summary::marker{content:'';}
.noteFold>summary::before{content:'\u25b8';font-size:11px;display:inline-block;transition:transform .15s;}
.noteFold[open]>summary::before{transform:rotate(90deg);}
.noteFold>summary::after{content:'展开';margin-left:auto;font-weight:400;opacity:.6;}
.noteFold[open]>summary::after{content:'收起';}
.noteFold>.note,.noteFold>.foot-note{margin:0;padding:8px 10px 10px;border-top:1px dashed var(--border);text-align:left;line-height:1.7;}
"""

JS_BODY = MARK_JS + """
(function(){
  function sync(){
    var ds = document.querySelectorAll('details.noteFold');
    for (var i = 0; i < ds.length; i++) {
      var b = ds[i].querySelector('.note,.foot-note');
      ds[i].style.display = (b && b.textContent.trim()) ? '' : 'none';
    }
  }
  window.__syncNoteFold = sync;      // 供动态填充说明块的页面（JoyBuy）在填充后调用
  function boot(){ sync(); setTimeout(sync, 0); setTimeout(sync, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
"""

HEAD_BLOCK = ('<style>\n' + CSS_BLOCK.rstrip() + '\n</style>\n<script>\n' + JS_BODY.rstrip() +
              '\n</script>\n</head>')

FILES = [
    os.path.join(HERE, 'monthly_dashboard_template.html'),
    os.path.join(HERE, 'target_dashboard_template.html'),
    os.path.join(HERE, 'daily_dashboard_template.html'),
    os.path.join(HERE, 'joybuy_template.html'),
    os.path.join(HERE, 'woot.html'),
    os.path.join(HERE, 'mapping.html'),
    os.path.join(A_DIR, 'generate_filterable_report.py'),
]


def strip_old(s):
    removed = []
    i = s.find(MARK_CSS)
    if i >= 0:
        j = s.find(OLD_CSS_TAIL, i)
        if j >= 0:
            j += len(OLD_CSS_TAIL)
            s = s[:i] + s[j:].lstrip('\r\n')
            removed.append('CSS')
    i = s.find(MARK_JS)
    if i >= 0:
        start = s.rfind('<script>', 0, i)
        end = s.find('</script>', i)
        if start >= 0 and end >= 0:
            end += len('</script>')
            s = s[:start] + s[end:].lstrip('\r\n')
            removed.append('JS')
    return s, removed


def main():
    for p in FILES:
        s = io.open(p, encoding='utf-8').read()
        s, removed = strip_old(s)
        if MARK_CSS in s or MARK_JS in s:
            raise RuntimeError('旧块清理不干净: ' + p)
        assert '</head>' in s, p
        s = s.replace('</head>', HEAD_BLOCK, 1)
        io.open(p, 'w', encoding='utf-8', newline='').write(s)
        print('%-36s 移除旧块[%s] → 独立 style/script 插到 </head> 前'
              % (os.path.basename(p), ','.join(removed) or '-'))
    # 周看板：integrate_ads 的 `</style>` 锚点必须恢复
    a = io.open(os.path.join(A_DIR, 'generate_filterable_report.py'), encoding='utf-8').read()
    ok = '.country-tag { display:inline-block; background:#eef4ff;' in a and \
         a.find('.country-tag { display:inline-block; background:#eef4ff;') > 0
    print('A 模板 .country-tag 锚点存在:', ok)
    print('A 模板 </style> 紧跟锚点:', '.country-tag' in a and (a.index('</style>') - a.index('.country-tag {')) < 400)


if __name__ == '__main__':
    main()
