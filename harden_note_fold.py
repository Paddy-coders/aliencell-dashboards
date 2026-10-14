# -*- coding: utf-8 -*-
"""折叠块 JS 加固（幂等）：说明块被 JS 异步填充时自动重跑空块判定。

背景：JoyBuy 的 #filterNote / #footNote 是运行时空占位，
首屏 sync() 时它们还是空的 → 被判为空块并 display:none；
之后 JS 填充了内容，display:none 却不会自己撤销 ⇒ 说明块永久消失。
修法：给每个 details.noteFold 挂 MutationObserver，内容一变就重跑 sync()。
（sync 只改 details 自身的 style，不触发 childList/characterData，不会自激。）
"""
import io
import os

OLD_BOOT = """  window.__syncNoteFold = sync;      // 供动态填充说明块的页面（JoyBuy）在填充后调用
  function boot(){ sync(); setTimeout(sync, 0); setTimeout(sync, 800); }"""

NEW_BOOT = """  window.__syncNoteFold = sync;      // 供动态填充说明块的页面（JoyBuy）在填充后调用
  function boot(){
    sync();
    // 说明块常由 JS 异步填充（如 JoyBuy 的 #filterNote/#footNote）：
    // 填充前被判为空块而 display:none，填充后必须重跑，否则说明块永久消失。
    if (window.MutationObserver) {
      var mo = new MutationObserver(function(){ sync(); });
      var ds = document.querySelectorAll('details.noteFold');
      for (var i = 0; i < ds.length; i++) mo.observe(ds[i], { childList: true, characterData: true, subtree: true });
    }
    setTimeout(sync, 0); setTimeout(sync, 800);
  }"""

FILES = [
    'monthly_dashboard_template.html',
    'target_dashboard_template.html',
    'daily_dashboard_template.html',
    'joybuy_template.html',
    'woot.html',
    'mapping.html',
    r'C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33/generate_filterable_report.py',
]

n = 0
for f in FILES:
    if not os.path.exists(f):
        print('%-38s 缺失，跳过' % os.path.basename(f))
        continue
    s = io.open(f, encoding='utf-8').read()
    if NEW_BOOT in s:
        print('%-38s 已加固（跳过）' % os.path.basename(f))
        continue
    if OLD_BOOT not in s:
        print('%-38s ⚠️ 未找到 boot 锚点' % os.path.basename(f))
        continue
    s = s.replace(OLD_BOOT, NEW_BOOT, 1)
    io.open(f, 'w', encoding='utf-8', newline='').write(s)
    n += 1
    print('%-38s ✅ 已加固' % os.path.basename(f))
print('改写文件数:', n)
