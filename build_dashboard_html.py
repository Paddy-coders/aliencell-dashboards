"""
生成自包含(单文件)广告周度看板 ad_dashboard.html
- 注入数据: ad_dashboard_data.json -> __DATA_JSON__
- 内联 Chart.js: chart.umd.min.js -> __CHART_JS__
分享给别人时只需发送这一个 HTML 文件即可(无需附带任何外部资源)
"""
import json, io, os

BASE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(BASE, 'ad_dashboard_template.html')
DATA = os.path.join(BASE, 'ad_dashboard_data.json')
CHART = os.path.join(BASE, 'chart.umd.min.js')
OUT = os.path.join(BASE, 'ad_dashboard.html')

tpl = open(TPL, encoding='utf-8').read()
assert '__DATA_JSON__' in tpl, '模板缺少 __DATA_JSON__ 占位符'
assert '__CHART_JS__' in tpl, '模板缺少 __CHART_JS__ 占位符'

obj = json.load(open(DATA, encoding='utf-8'))
payload = json.dumps(obj, ensure_ascii=False)
chart_js = open(CHART, encoding='utf-8').read()

out = tpl.replace('__DATA_JSON__', payload).replace('__CHART_JS__', chart_js)

# 内嵌产品映射 product_map.json（供看板按产品系列/产品名筛选；缺省空映射）
if '__MAP_JSON__' in out:
    try:
        mp = json.load(open(os.path.join(BASE, 'product_map.json'), encoding='utf-8'))
    except Exception:
        mp = {'catalog': [], 'asinMap': []}
    out = out.replace('__MAP_JSON__', json.dumps(mp, ensure_ascii=False))

# 禁缓存 meta: 部署后用户浏览器不会继续用旧缓存(看板"没更新"类反馈的常见根因)
NO_CACHE_META = (
    '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
    '<meta http-equiv="Pragma" content="no-cache">\n'
    '<meta http-equiv="Expires" content="0">\n'
)
if 'http-equiv="Cache-Control"' not in out and "http-equiv='Cache-Control'" not in out and '<head>' in out:
    out = out.replace('<head>', '<head>\n' + NO_CACHE_META, 1)

open(OUT, 'w', encoding='utf-8').write(out)
print('OK ad_dashboard.html (单文件, 含数据 + Chart.js 内联 + 产品映射):', len(out), 'bytes')
