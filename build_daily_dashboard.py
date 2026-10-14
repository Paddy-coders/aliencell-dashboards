# -*- coding: utf-8 -*-
"""生成 每日数据看板 (daily.html) 单文件
输入: daily_data.json (由 fetch_daily_data.js 采集: 业务报告日粒度 + 广告按天)
      product_map.json (可选, ASIN→产品系列/产品名 映射, 未提供则空)
      fx_rates.json (月度汇率缓存, CNY 基准, 与 target.html 共用; 缺失项自动联网补抓)
模板: daily_dashboard_template.html (__DATA_JSON__ / __GEN_TIME__ / __MAP_JSON__ / __FX_JSON__ 占位符)
输出: daily.html (自包含, 可直接分享)
币种口径: 默认(未选国家或多国混合币种)统一显示 USD(按每月1号汇率折算);
         选中的国家同属一种币种时显示该币种原值。
"""
import json, os, re, urllib.request
from datetime import datetime, timedelta

BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'
DATA_FILE = BASE_DIR + '/daily_data.json'
TEMPLATE_FILE = BASE_DIR + '/daily_dashboard_template.html'
MAP_FILE = BASE_DIR + '/product_map.json'
FX_FILE = BASE_DIR + '/fx_rates.json'
OUT_FILE = BASE_DIR + '/daily.html'

# 站点国家 → 币种 (与 build_monthly_dashboards.py 保持一致)
CUR_OF = {'US':'USD','CA':'CAD','MX':'MXN','UK':'GBP','JP':'JPY','AU':'AUD',
          'DE':'EUR','FR':'EUR','IT':'EUR','ES':'EUR','NL':'EUR','BE':'EUR','IE':'EUR','PL':'PLN','SE':'SEK'}
# 网络全部失败时的兜底汇率 (CNY 基准, ≈2026年参考值, 仅保底)
FX_FALLBACK = {'USD':7.20,'EUR':7.85,'GBP':9.15,'CAD':5.25,'MXN':0.38,'JPY':0.048,'AUD':4.70,'PLN':1.85,'SEK':0.70}

# 禁缓存 meta: 部署后用户浏览器不会继续用旧缓存(看板"没更新"类反馈的常见根因)
NO_CACHE_META = (
    '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
    '<meta http-equiv="Pragma" content="no-cache">\n'
    '<meta http-equiv="Expires" content="0">\n'
)


def inject_no_cache(html):
    """在 <head> 后插入禁缓存 meta(幂等)"""
    if 'http-equiv="Cache-Control"' in html or "http-equiv='Cache-Control'" in html:
        return html
    if '<head>' in html:
        return html.replace('<head>', '<head>\n' + NO_CACHE_META, 1)
    return html


def load_fx_cache():
    try:
        with open(FX_FILE, 'r', encoding='utf-8') as f:
            j = json.load(f)
        if isinstance(j, dict) and isinstance(j.get('rates'), dict):
            j.setdefault('meta', {})
            return j
    except Exception:
        pass
    return {'rates': {}, 'meta': {}}


def fetch_fx_rate(cur, ym):
    """取 ym 月 1 号 cur→CNY 汇率; 非工作日向前回退最多 6 天。返回 (rate, 实际汇率日期) 或 (None, None)"""
    y, m = int(ym[:4]), int(ym[5:7])
    first = datetime(y, m, 1).date()
    for i in range(7):
        d = first - timedelta(days=i)
        url = 'https://api.frankfurter.dev/v1/%s?base=%s&symbols=CNY' % (d.isoformat(), cur)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=12) as resp:
                j = json.loads(resp.read().decode('utf-8'))
            rate = (j.get('rates') or {}).get('CNY')
            if rate:
                return float(rate), j.get('date', d.isoformat())
        except Exception:
            continue
    return None, None


def build_fx(months_needed):
    """确保 fx_rates.json 覆盖 months_needed × CUR_OF 全部币种 (增量补抓, 不删旧数据)。
    返回 (usd_base_fx{ym:{CUR: 1CUR=?USD}}, 缺失信息列表)。USD 基准 = cny_per_cur / cny_per_usd。"""
    cache = load_fx_cache()
    curs = sorted(set(CUR_OF.values()) | {'USD'})
    missing = []
    changed = False
    for ym in months_needed:
        for cur in curs:
            cached = (cache['rates'].get(ym) or {}).get(cur)
            if cached:
                continue
            rate, rdate = fetch_fx_rate(cur, ym)
            if rate is None:
                # 兜底: 其他月份同币种已知汇率 → 默认值
                rate = None
                for mm in sorted(cache['rates'].keys()):
                    if cur in (cache['rates'][mm] or {}):
                        rate = cache['rates'][mm][cur]
                        break
                if rate is None:
                    rate = FX_FALLBACK.get(cur)
                rdate = 'fallback'
                missing.append('%s %s' % (ym, cur))
            if rate is None:
                continue
            cache['rates'].setdefault(ym, {})[cur] = round(float(rate), 6)
            cache['meta']['%s|%s' % (ym, cur)] = rdate
            changed = True
    if changed:
        try:
            with open(FX_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache, f, ensure_ascii=False, indent=1)
        except Exception as e:
            print('警告: fx_rates.json 写回失败:', e)
    # 换算为 USD 基准: 1 CUR = (CUR→CNY) / (USD→CNY) USD
    usd_fx = {}
    for ym, rates in cache['rates'].items():
        usd_rate = rates.get('USD')
        if not usd_rate:
            continue
        row = {'USD': 1.0}
        for cur, v in rates.items():
            if cur != 'USD':
                row[cur] = round(v / usd_rate, 6)
        usd_fx[ym] = row
    return usd_fx, missing

CALIB_LABEL = {'rows': '业务行数', 'sessions': 'Sessions', 'orders': '订单量', 'sales': '销售额',
               'adItems': '广告条数', 'adCost': '广告花费', 'adSales': '广告销售额'}


def calib_note(data):
    """重新校准台账提示（2026-09-24 新增）

    复查的本意不只是「把空缺的补上」，而是「把已经采到的重新校准」——上游会改数：
    广告花费因无效流量扣减而下调、销售额因归因回填后补（实测跨度达 29 天仍有修正），
    业务报告则实测 16~61 天稳定。所以已采到的日期也会被定期重拉核对。
    这里把「本次重算了多少天、其中多少天数值确实被上游改过」显示出来，让"数据变过"这件事可见，
    而不是悄悄改掉用户昨天看到的数字。
    """
    cal = data.get('calibration') or {}
    if not cal:
        return ''
    checked = cal.get('checked') or 0
    changed = cal.get('changed') or []
    hot = cal.get('hotDays') or 0
    warm = cal.get('warmDays') or []
    pend = cal.get('pendingRechecked') or []
    scope = f'热区{hot}天全量重算 + 温区轮转校准{len(warm)}天 + 空缺复查{len(pend)}天'
    if not changed:
        return (f'<span class="note-calib" title="{scope}；重算结果与上次完全一致">'
                f'🔁 已校准 {checked} 天，数值无变化</span>')
    lines = []
    for c in changed[:15]:
        items = '、'.join(f'{CALIB_LABEL.get(k, k)} {v[0]}→{v[1]}' for k, v in (c.get('diffs') or {}).items())
        lines.append(f"{c.get('date')}（{c.get('age')}天前）: {items}")
    tip = f'{scope}；' + '；'.join(lines)
    return (f'<span class="note-calib" title="{tip}">'
            f'🔁 已校准 {checked} 天，其中 <b>{len(changed)}</b> 天的数值被上游修正（已按最新值更新，鼠标悬停看明细）</span>')


def data_note(data):
    """数据完整性 + 重新校准提示（2026-09-24 新增）

    背景：易仓业务报告**按店铺同步**，会出现部分延迟（US 还没出数、EU 已出）。若看板照常渲染，
    用户只看到"最近几天数字不对"却不知原因。此处把「数据完整至哪天 + 哪几天缺哪个店铺」直接写在页头，
    并附上本次重新校准的台账（复查 = 补空缺 + 重新校准两件事）。
    """
    days = data.get('days') or {}
    ks = sorted(d for d in days if len(d) == 10)
    if not ks:
        return ''
    complete = [d for d in ks if (days[d].get('biz') or []) and not (days[d].get('incomplete') or [])]
    thru = complete[-1] if complete else '—'
    pend = [d for d in ks[-7:] if (days[d].get('incomplete') or [])]
    if not pend:
        base = f'<span class="note-ok">数据完整至 {thru}</span>'
    else:
        no_data = [d[5:] for d in pend if days[d]['incomplete'] == ['全天无数据']]
        partial = [f"{d[5:]} 缺 {'/'.join(days[d]['incomplete'])}" for d in pend if days[d]['incomplete'] != ['全天无数据']]
        parts = '、'.join(partial)
        if no_data:
            parts += ('、' if parts else '') + '、'.join(no_data) + ' 源数据未同步'
        base = (f'<span class="note-warn">⚠️ 数据完整至 {thru}；{parts}'
                f'（易仓按店铺同步有延迟，系统每日自动复查补齐，无需手工处理）</span>')
    cn = calib_note(data)
    return base + (('&nbsp;|&nbsp;' + cn) if cn else '')


def main():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    gen_time = data.get('generatedAt', '')[:16]
    # 数据日期范围
    days = sorted(data.get('days', {}).keys())
    if days:
        gen_time = f"{gen_time} · 数据范围 {days[0]} ~ {days[-1]} ({len(days)}天)"

    data_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    # 转义 </script>
    data_json = data_json.replace('</', '<\\/')

    # ASIN 映射嵌入 (产品系列/产品名; 同事打开分享链接时作为兜底, 本机浏览器优先用 localStorage)
    if os.path.exists(MAP_FILE):
        try:
            with open(MAP_FILE, 'r', encoding='utf-8') as f:
                pmap = json.load(f)
            if not isinstance(pmap, dict):
                pmap = {}
        except Exception as e:
            print('警告: product_map.json 解析失败, 使用空映射:', e)
            pmap = {}
    else:
        pmap = {}
    pmap.setdefault('catalog', [])
    pmap.setdefault('asinMap', [])
    map_json = json.dumps(pmap, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # 汇率嵌入 (USD 基准, 每月1号汇率): 默认视图统一按 USD 折算, 选定同币种国家时用原币种
    months_needed = sorted({d[:7] for d in days}) if days else []
    usd_fx, fx_missing = build_fx(months_needed)
    fx_json = json.dumps({'months': usd_fx, 'src': 'ECB via frankfurter.dev · 每月1号汇率'},
                         ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    if fx_missing:
        print('警告: 以下 月×币种 汇率抓取失败, 使用兜底值:', ', '.join(fx_missing))

    # 毛利数据嵌入 (易仓利润报表; 缺文件时降级为空, 看板毛利列显示 —)
    profit = {'rows': [], 'generatedAt': '', 'note': ''}
    try:
        import build_profit_metrics
        profit = build_profit_metrics.build(verbose=False)
        n_days_p = len({r['d'] for r in profit['rows']})
        print('毛利: %d 行 · %d 天 · 抓取于 %s' % (len(profit['rows']), n_days_p, profit.get('generatedAt', '?')))
    except Exception as e:
        print('警告: 毛利数据构建失败(看板毛利列将显示 —):', e)
    profit_json = json.dumps(profit, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # 头程成本表嵌入 (2026-10-10): product_cost_table.json 的 headRMB + 月度 CNY/USD 汇率
    # 头程为预估值; 用户给「推移后的实际头程」时只需更新 product_cost_table.json 再重建
    try:
        tbl = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'product_cost_table.json'),
                             encoding='utf-8'))
        cache_rates = load_fx_cache()['rates']
        hf = {'products': {n: p.get('headRMB') or {} for n, p in (tbl.get('products') or {}).items()},
              'months': {ym: ((cache_rates.get(ym) or {}).get('USD')) for ym in months_needed
                         if (cache_rates.get(ym) or {}).get('USD')},
              'src': tbl.get('source', '')}
        hf_json = json.dumps(hf, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        # Woot 成本表 (2026-10-13): {产品名: 采购成本RMB/台} —— Woot 行经「产品关系管理」匹配产品名后取此表
        cost_json = json.dumps({n: (p.get('costRMB') or 0) for n, p in (tbl.get('products') or {}).items()},
                               ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        print('头程表: %d 个产品 · %d 个月汇率 · Woot 成本表 %d 个产品'
              % (len(hf['products']), len(hf['months']), len(tbl.get('products') or {})))
    except Exception as e:
        print('警告: 头程表构建失败(头程列将显示 0):', e)
        hf_json = '{"products":{},"months":{}}'
        cost_json = '{}'

    html = html.replace('__DATA_JSON__', data_json)
    html = html.replace('__GEN_TIME__', gen_time)
    html = html.replace('__DATA_NOTE__', data_note(data))
    html = html.replace('__MAP_JSON__', map_json)
    html = html.replace('__FX_JSON__', fx_json)
    html = html.replace('__PROFIT_JSON__', profit_json)
    html = html.replace('__HF_JSON__', hf_json)
    html = html.replace('__COST_JSON__', cost_json)
    # 注入禁缓存头: 避免浏览器/CDN 缓存导致用户看到旧数据(看板"没更新"类反馈的常见根因)
    html = inject_no_cache(html)

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(html)
    mapped = sum(1 for x in pmap['asinMap'] if x.get('asin'))
    print(f'OK daily.html ({os.path.getsize(OUT_FILE)} bytes, {len(days)} days, 映射 {mapped} ASIN)')

if __name__ == '__main__':
    main()
