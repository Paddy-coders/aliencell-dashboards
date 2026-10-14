# -*- coding: utf-8 -*-
"""将产品报表 filterable_dashboard.html 内联 Chart.js，生成自包含单文件 product.html"""
import io, re, sys

SRC = r"C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33\filterable_dashboard.html"
CHART_JS = r"C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33\chart.umd.min.js"
OUT = r"C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\_deploy\product.html"

with io.open(SRC, "r", encoding="utf-8") as f:
    html = f.read()

with io.open(CHART_JS, "r", encoding="utf-8") as f:
    chart_js = f.read()

# 替换外部引用为内联
pattern = re.compile(r'<script\s+src=["\']chart\.umd\.min\.js["\']\s*></script>', re.IGNORECASE)
replaced, n = pattern.subn(lambda m: "<script>\n" + chart_js + "\n</script>", html)

if n == 0:
    # 兼容不带 /> 的写法
    pattern2 = re.compile(r'<script\s+src=["\']chart\.umd\.min\.js["\']\s*/>', re.IGNORECASE)
    replaced, n = pattern2.subn(lambda m: "<script>\n" + chart_js + "\n</script>", html)

if n == 0:
    # Chart.js 可能已在生成阶段内联, 直接复制
    replaced = html
    print("WARN: 未找到 chart.umd.min.js 外部引用, 视为已内联, 直接复制")

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(replaced)

import os
print(f"OK: 已内联 {n} 处 Chart.js 引用" if n > 0 else "OK: Chart.js 已内联, 直接复制")
print(f"输出: {OUT} ({os.path.getsize(OUT)} bytes)")
