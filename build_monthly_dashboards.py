# -*- coding: utf-8 -*-
"""生成 月度数据看板 (monthly.html) + 月度目标追踪看板 (target.html) 单文件

输入:
  daily_data.json     (fetch_daily_data.js 采集: 业务报告日粒度 + 广告按天, 自然月聚合的数据源)
  product_map.json    (ASIN→产品系列/产品名 映射, 内嵌兜底)
  monthly_targets.json(可选, 月度目标表 {targets:[{month,country,product,units,sales}], sample:bool})
模板:
  monthly_dashboard_template.html / target_dashboard_template.html
  占位符: __DATA_JSON__ / __GEN_TIME__ / __MAP_JSON__ / __TARGET_JSON__
输出:
  monthly.html / target.html (自包含, 可直接分享)

聚合粒度: 自然月(YYYY-MM) × 国家 × ASIN
  biz:  sessions/mob/brw/pv/units/b2b/orders/sales/bbSum/bbCnt
  ads:  adClicks/adCost/adOrders/adSales/adImpressions  (extractAsin 归类, 与每日看板一致)

平台维度(2026-10-09 新增): target.html 支持 平台筛选 Amazon / JoyBuy / 速卖通
  Amazon   → daily_data.json 聚合(上述口径)
  JoyBuy   → joybuy_monthly.json(build_joybuy_monthly.py 由 Data Compass 采集聚合) → __JOYBUY_JSON__
  速卖通   → 暂无数据(看板显示占位提示)
"""
import json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'
DATA_FILE = BASE_DIR + '/daily_data.json'
MAP_FILE = BASE_DIR + '/product_map.json'
TARGETS_FILE = BASE_DIR + '/monthly_targets.json'
FX_FILE = BASE_DIR + '/fx_rates.json'
MONTHLY_TPL = BASE_DIR + '/monthly_dashboard_template.html'
TARGET_TPL = BASE_DIR + '/target_dashboard_template.html'
OUT_MONTHLY = BASE_DIR + '/monthly.html'
OUT_TARGET = BASE_DIR + '/target.html'

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

# 站点国家 → 币种 (EU 各站点独立币种, 折算按国家币别精确换汇)
CUR_OF = {'US':'USD','CA':'CAD','MX':'MXN','UK':'GBP','JP':'JPY','AU':'AUD',
          'DE':'EUR','FR':'EUR','IT':'EUR','ES':'EUR','NL':'EUR','BE':'EUR','IE':'EUR','PL':'PLN','SE':'SEK'}
# 网络全部失败时的兜底汇率 (≈2026年参考值, 仅保底)
FX_FALLBACK = {'USD':7.20,'EUR':7.85,'GBP':9.15,'CAD':5.25,'MXN':0.38,'JPY':0.048,'AUD':4.70,'PLN':1.85,'SEK':0.70}

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

def build_fx(months, countries):
    """按 月×币种 抓汇率, 带缓存; 返回 (fx{ym:{CUR:rate}}, fx_cache, 缺失信息列表)"""
    ym_list = [m['ym'] for m in months]
    curs = sorted(set(CUR_OF.get(c, 'USD') for c in countries))
    cache = load_fx_cache()
    fx = {}
    missing = []
    changed = False
    for ym in ym_list:
        fx[ym] = {}
        for cur in curs:
            cached = (cache['rates'].get(ym) or {}).get(cur)
            if cached:
                fx[ym][cur] = cached
                continue
            rate, rdate = fetch_fx_rate(cur, ym)
            if rate is None:
                # 兜底: 其他月份同币种已知汇率 → 默认值
                rate = None
                for mm in fx:
                    if cur in fx[mm]:
                        rate = fx[mm][cur]
                        break
                if rate is None:
                    rate = FX_FALLBACK.get(cur)
                rdate = 'fallback'
                missing.append('%s %s' % (ym, cur))
            fx[ym][cur] = round(float(rate), 6)
            cache['rates'].setdefault(ym, {})[cur] = fx[ym][cur]
            cache['meta']['%s|%s' % (ym, cur)] = rdate
            changed = True
    if changed:
        try:
            cache['fetchedAt'] = cn_now().strftime('%Y-%m-%d %H:%M')
            with open(FX_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache, f, ensure_ascii=False, indent=1)
        except Exception as e:
            print('警告: fx_rates.json 写入失败:', e)
    return fx, cache, missing

# 广告条目 -> ASIN 归属：统一走 ad_asin_rules（唯一权威规则源，2026-10-10 收敛）
# ⚠️ 不要在本文件里再写一份 SPECIAL_ASIN / 正则副本。SB 品牌推广的兜底规则必须
#    按站点区分（同一个 SKU 在 US 与欧洲是不同 ASIN），副本必然漂移。
#    调用时必须把站点传进去，否则欧洲的 X1 会被归到北美 ASIN。
from ad_asin_rules import attribute as extract_asin

def cn_now():
    return datetime.now(timezone(timedelta(hours=8)))

CALIB_LABEL = {'rows': '业务行数', 'sessions': 'Sessions', 'orders': '订单量', 'sales': '销售额',
               'adItems': '广告条数', 'adCost': '广告花费', 'adSales': '广告销售额'}


def calib_note(data):
    """重新校准台账提示（2026-09-24 新增，与 build_daily_dashboard.py 同口径）

    复查 = 补空缺 + **重新校准**。上游会改数（广告花费因无效流量下调、销售额因归因回填后补），
    月度合计会随之变动，所以要让"这次重算过、且有天数被改过"可见。
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
    """数据完整性 + 重新校准提示（2026-09-24，与 build_daily_dashboard.py 同口径）

    月度/目标看板同样受「易仓按店铺同步延迟」影响：某天缺 US / 整天空时，当月合计会偏低。
    在头部直接写明「数据完整至哪天 + 哪几天缺什么」，避免用户误读当月数字；并附本次校准台账。
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

    days = sorted(data.get('days', {}).keys())
    if not days:
        raise SystemExit('daily_data.json 无数据')

    # ---------- 自然月 × 国家 × ASIN 聚合 ----------
    # key: (ym, cc, asin)
    agg = {}
    day_stat = {}  # ym -> set(days with data)

    def bucket(ym, cc, asin):
        k = (ym, cc, asin)
        if k not in agg:
            agg[k] = {'ym': ym, 'cc': cc, 'asin': asin,
                      'sessions': 0, 'mob': 0, 'brw': 0, 'pv': 0,
                      'units': 0, 'b2b': 0, 'orders': 0, 'sales': 0,
                      'bbSum': 0.0, 'bbCnt': 0,
                      'adClicks': 0, 'adCost': 0.0, 'adOrders': 0, 'adSales': 0.0, 'adImpr': 0}
        return agg[k]

    for d in days:
        day = data['days'][d]
        has_data = False
        day_yms = set()
        for r in day.get('biz', []):
            # 防线: 按行内自带 date 归月(而非存储键), 即使采集发生错位也不会重复计入月份
            rd = r.get('date') or d
            ym = rd[:7]
            cc = r.get('site') or r.get('user_account') or 'US'
            asin = r.get('asin')
            if not asin:
                continue
            b = bucket(ym, cc, asin)
            b['sessions'] += int(float(r.get('sessions') or 0))
            b['mob'] += int(float(r.get('mobile_app_sessions') or 0))
            b['brw'] += int(float(r.get('browser_sessions') or 0))
            b['pv'] += int(float(r.get('page_views') or 0))
            b['units'] += int(float(r.get('units_ordered') or 0))
            b['b2b'] += int(float(r.get('units_ordered_b2b') or 0))
            b['orders'] += int(float(r.get('total_order_items') or 0))
            b['sales'] += float(r.get('ordered_product_sales_amount') or 0)
            bb = r.get('buy_box_percentage')
            if bb is not None and bb != '':
                b['bbSum'] += float(bb); b['bbCnt'] += 1
            has_data = True
            day_yms.add(ym)
        for cc, items in (day.get('ads') or {}).items():
            ym = d[:7]  # 广告按存储键归月(广告采集逐日直连, 日期可信)
            for it in items:
                a = extract_asin(it, cc)
                if not a:
                    continue
                rep = it.get('Report') or {}
                b = bucket(ym, cc, a)
                b['adClicks'] += int(rep.get('Clicks') or 0)
                b['adCost'] += float(rep.get('Cost') or 0)
                b['adOrders'] += int(rep.get('Orders') or 0)
                b['adSales'] += float(rep.get('SalesAmount') or 0)
                b['adImpr'] += int(rep.get('Impressions') or 0)
                has_data = True
            day_yms.add(ym)
        if has_data:
            for ym in day_yms:
                day_stat.setdefault(ym, set()).add(d)

    # ---------- 月份元数据 ----------
    now = cn_now()
    cur_ym = now.strftime('%Y-%m')
    months = []
    for ym in sorted(day_stat.keys()):
        ds = sorted(day_stat[ym])
        y, m = int(ym[:4]), int(ym[5:7])
        # 该月天数
        if m == 12:
            nxt = (y + 1, 1)
        else:
            nxt = (y, m + 1)
        days_in_month = (datetime(nxt[0], nxt[1], 1) - datetime(y, m, 1)).days
        first_with_data, last_with_data = ds[0], ds[-1]
        first_of_month = '%04d-%02d-01' % (y, m)
        last_of_month = '%04d-%02d-%02d' % (y, m, days_in_month)
        months.append({
            'ym': ym,
            'label': '%d年%d月' % (y, m),
            'span': '%02d-01 ~ %02d-%02d' % (m, m, days_in_month),
            'daysTotal': days_in_month,
            'daysWithData': len([x for x in ds]),
            'dataFrom': first_with_data,
            'dataTo': last_with_data,
            'partial': first_with_data != first_of_month or last_with_data != last_of_month,
            'ongoing': ym == cur_ym,
        })

    rows = [agg[k] for k in sorted(agg.keys())]

    # ---------- 毛利合并 (易仓利润报表, 2026-10-10 新增) ----------
    # 口径: 毛利 = 报表销售额+促销折扣+销售佣金+配送费+商品成本+仓储费分摊+其他费用分摊 − 看板广告花费
    # 利润行已是「日×站点×ASIN」, 按月求和即可(仓储/其他费用在日粒度已分摊好, 月合计不变)
    profit_agg = {}
    try:
        import build_profit_metrics
        pdata = build_profit_metrics.build(verbose=False)
        for r in pdata['rows']:
            k = (r['d'][:7], r['site'], r['as'])
            node = profit_agg.setdefault(k, {
                'pSales': 0.0, 'pPromo': 0.0, 'pComm': 0.0, 'pFba': 0.0,
                'pCost': 0.0, 'pStorage': 0.0, 'pOther': 0.0, 'pVat': 0.0, 'pN': 0, 'pMiss': 0, 'pQty': 0.0,
                # 2026-10-12 第一轮: 多渠道 / 剔除加回 / 测评费
                'pMqty': 0.0, 'pMcost': 0.0, 'pMhead': 0.0,
                'pMship': 0.0, 'pMcAdj': 0.0, 'pReview': 0.0,
                # 2026-10-12 第二轮: FBA 库存费 8 细项(负) + 退款(按 ERP 原符号)
                #   ※「FBA物流国际货运费(入境)」按用户口径不展示不计入毛利 → 不再接 pInb
                'pFbRet': 0.0, 'pFbOth': 0.0, 'pFbOvr': 0.0, 'pFbCon': 0.0,
                'pFbCar': 0.0, 'pFbRem': 0.0, 'pFbMst': 0.0, 'pFbLst': 0.0,
                'pRefSales': 0.0, 'pRefPromo': 0.0, 'pRefComm': 0.0, 'pRefShip': 0.0,
                'pRefFba': 0.0, 'pRefQty': 0.0})
            for dst, src in (('pSales', 'sales'), ('pPromo', 'promo'), ('pComm', 'comm'),
                             ('pFba', 'fba'), ('pCost', 'cost'), ('pStorage', 'storage'),
                             ('pOther', 'other'), ('pVat', 'vat'),
                             ('pMcost', 'mcost'),
                             ('pMhead', 'mhead'), ('pMship', 'mship'),
                             ('pMcAdj', 'mcAdj'), ('pReview', 'review'),
                             ('pFbRet', 'fbRet'), ('pFbOth', 'fbOth'), ('pFbOvr', 'fbOvr'),
                             ('pFbCon', 'fbCon'), ('pFbCar', 'fbCar'), ('pFbRem', 'fbRem'),
                             ('pFbMst', 'fbMst'), ('pFbLst', 'fbLst'),
                             ('pRefSales', 'refSales'), ('pRefPromo', 'refPromo'),
                             ('pRefComm', 'refComm'), ('pRefShip', 'refShip'), ('pRefFba', 'refFba')):
                node[dst] += float(r.get(src) or 0)
            node['pQty'] += float(r.get('qty') or 0)   # 利润报表销量 → 头程(成本表RMB×销量) 用
            node['pMqty'] += float(r.get('mqty') or 0)  # 多渠道销量(台)
            node['pRefQty'] += float(r.get('refQty') or 0)  # 退款件数(退款率分子)
            node['pN'] += 1
            node['pMiss'] += int(r.get('miss') or 0)
        n_merged = 0
        for r in rows:
            node = profit_agg.pop((r['ym'], r['cc'], r['asin']), None)
            if node:
                r.update(node)
                n_merged += 1
        # 只有利润数据、没有业务/广告数据的 (月×国家×ASIN) → 补一行, 否则毛利会整块丢失
        n_added = 0
        for (ym, cc, asin), node in profit_agg.items():
            row = {'ym': ym, 'cc': cc, 'asin': asin,
                   'sessions': 0, 'mob': 0, 'brw': 0, 'pv': 0, 'units': 0, 'b2b': 0, 'orders': 0,
                   'sales': 0, 'bbSum': 0.0, 'bbCnt': 0,
                   'adClicks': 0, 'adCost': 0.0, 'adOrders': 0, 'adSales': 0.0, 'adImpr': 0}
            row.update(node)
            rows.append(row)
            n_added += 1
        print('毛利: 并入 %d 行 · 补建 %d 行(仅利润数据) · 共 %d 个(月×国家×ASIN)' % (n_merged, n_added, len(pdata['rows']) and len(profit_agg) + n_merged))
        # ⚠️ 有广告费、但没有利润报表行的 (月×国家×ASIN)：该行的行级「毛利」会显示 —
        #    （没有利润报表行可挂），但**该笔费用仍会被月 KPI 扣掉** ——
        #    aggMonth() 对范围内所有行都累加 adCost，pN 只用来判断"该月有没有利润报表数据"。
        #    （2026-10-10 修正过这个表述：早先写成"不计入毛利"，实测月 KPI 差额恒为 0。）
        #    典型来源：SB 兜底归到的 ASIN 在该站点没上架/没有利润报表行
        #    （2026-10 实测 UK 的 B0HH8J6SSL 就是这种情况）。必须显式报出来，不能静默。
        orphan = [(r['ym'], r['cc'], r['asin'], float(r['adCost'])) for r in rows
                  if float(r.get('adCost') or 0) > 0 and not r.get('pN')]
        if orphan:
            print('  ⚠️ %d 个(月×国家×ASIN)有广告费但无利润行 → 该行毛利显示 —（费用仍计入月 KPI）'
                  % len(orphan))
            for ym, cc, asin, cost in sorted(orphan):
                print('     %s %-3s %-12s 广告费 %9.2f' % (ym, cc, asin, cost))
    except Exception as e:
        import traceback
        print('警告: 毛利数据构建失败(月度看板毛利列将显示 —):', e)
        traceback.print_exc()

    out_data = {
        'generatedAt': data.get('generatedAt', ''),
        'daysRange': [days[0], days[-1]],
        'months': months,
        'rows': rows,
    }

    gen_time = data.get('generatedAt', '')[:16]
    gen_time = '%s · 数据范围 %s ~ %s (%d天) · 月度聚合 %d行' % (gen_time, days[0], days[-1], len(days), len(rows))

    data_json = json.dumps(out_data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # ---------- 产品映射嵌入 ----------
    if os.path.exists(MAP_FILE):
        try:
            with open(MAP_FILE, 'r', encoding='utf-8') as f:
                pmap = json.load(f)
            if not isinstance(pmap, dict):
                pmap = {}
        except Exception as e:
            print('警告: product_map.json 解析失败:', e)
            pmap = {}
    else:
        pmap = {}
    pmap.setdefault('catalog', [])
    pmap.setdefault('asinMap', [])
    map_json = json.dumps(pmap, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # ---------- 月度目标 (可选, 无则空) ----------
    targets = {'sample': True, 'targets': []}
    if os.path.exists(TARGETS_FILE):
        try:
            with open(TARGETS_FILE, 'r', encoding='utf-8') as f:
                targets = json.load(f)
            targets.setdefault('sample', False)
            targets.setdefault('targets', [])
        except Exception as e:
            print('警告: monthly_targets.json 解析失败, 使用空目标:', e)
            targets = {'sample': True, 'targets': []}
    target_json = json.dumps(targets, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # ---------- JoyBuy 月度数据 (target.html 平台筛选用) ----------
    # 由 build_joybuy_monthly.py 从 joybuy_compass_data.json 聚合; 缺失时看板该平台显示占位提示
    jby = {'rows': [], 'months': [], 'siteTotals': [], 'sites': [], 'generatedAt': '', 'note': ''}
    try:
        import build_joybuy_monthly
        jby = build_joybuy_monthly.build(verbose=False)
        print('JoyBuy: %d 行 · %d 站点 · 抓取于 %s' % (len(jby['rows']), len(jby['sites']), jby.get('dataFetchedAt', '?')))
    except Exception as e:
        print('警告: JoyBuy 月度数据构建失败(看板该平台将显示占位): %s' % e)
    jby_json = json.dumps(jby, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    # ---------- monthly.html 专用数据: 并入 JoyBuy 行(带 plat 标记) 2026-10-13 ----------
    # ⚠️ 不能直接改 data_json：monthly 与 target 共用同一个 __DATA_JSON__ 变量，
    #    给 target 塞 JoyBuy 行会与它自己的 __JOYBUY_JSON__ / JBY_ROWS 双计。故单独派生一份。
    # ⚠️ 行 schema 必须补齐 aggMonth() 里**没有 `||0` 兜底**的字段
    #    (sessions/mob/brw/pv/units/b2b/orders/sales/bbSum/bbCnt/adClicks/adOrders/adImpr)，
    #    否则 undefined 参与加法 → NaN 污染整月 KPI。
    # ⚠️ JoyBuy 的 sales 是**站点本币**(EUR/GBP)，与 Amazon 行同口径 ⇒ 前端 fxv(r.sales, r.cc, ym)
    #    会按国家自动折算到当前目标币种，这里不要再折一次。
    # ---------- JoyBuy 毛利 (2026-10-13 用户口径) ----------
    # 源 = joybuy_profit.json ← build_joybuy_profit.py（商家后台账单 + 订单 + 承运商），
    # 用户给定口径:
    #   平台毛利 = 货款 + 佣金 + 交易服务费 + 广告返点 + VAT + 退款 + 退回佣金 + 退货服务费
    #              + 海外物流仓储 + 其他        （账单里费用自带负号，直接相加）
    #   完整毛利 = 平台毛利 − 物流费(MCF 或 海外仓尾程) − 产品成本 − 头程
    # 做法: 造一组「等效利润字段」(pSales/pCost/pN/…) 挂到 JoyBuy 行上 ——
    #   monthly 模板的 aggMonth / profitOf / 所有占比列**一行都不用改**（与 Woot 同一手法）。
    #   pSales 取**账单「货款」**(Product Payment)，即用户公式的收入侧（不是 Data Compass GMV）。
    # ⚠️ 账单只到「站点 × 月」，看板行是「月 × 站点 × 产品」⇒ 按该(站点,月)的**行 GMV 占比**摊到各产品行。
    #    分摊后逐行相加 == 站点月账单合计（站点/月层面是账单真值，行级是近似值）。
    # ⚠️ 只摊到 sales>0 的行；没有账单数据的 (站点,月) 不写 pN ⇒ 该行毛利显示 —（不按 0 算，避免虚高）。
    jb_prof = {}
    try:
        _pf = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'joybuy_profit.json')
        if os.path.exists(_pf):
            with open(_pf, 'r', encoding='utf-8') as _f:
                _pd = json.load(_f)
            for _m in (_pd.get('months') or []):
                _cc = str(_m.get('site') or '').replace('-Site', '').strip().upper()
                if _cc and _m.get('ym'):
                    jb_prof[(_m['ym'], _cc)] = _m
            print('JoyBuy 毛利: %d 个(站点,月) · 生成于 %s'
                  % (len(jb_prof), _pd.get('generatedAt', '?')))
        else:
            print('警告: joybuy_profit.json 不存在 ⇒ JoyBuy 毛利列显示 —（先跑 build_joybuy_profit.py）')
    except Exception as e:
        print('警告: JoyBuy 毛利数据读取失败(该平台毛利显示 —): %s' % e)

    def _jb_prof(m, share):
        """账单口径 → 看板等效利润字段（字段语义见 monthly 模板 profitOf）"""
        def s(k):
            return float(m.get(k) or 0) * share
        return {
            'pSales': s('goods'),                       # 货款（收入侧 / 毛利率分母）
            'pPromo': 0.0,                              # JoyBuy 账单无促销折扣退款明细
            'pComm': s('commission'),                   # 佣金
            'pFba': -s('logisticsFee'),                 # 物流费(MCF 费率卡 / 海外仓尾程) —— 完整毛利才扣
            'pCost': -s('costLocal'),                   # 产品成本（成本表 costRMB ÷ 当月汇率）
            'pStorage': s('joybuyLogistics'),           # 海外物流仓储服务费
            'pOther': s('txnFee') + s('adsCredit') + s('otherFees'),   # 交易服务费 + 广告返点 + 其他
            'pVat': -s('vat'),                          # 账单 VAT 是负数, profitOf 里再减一次
            'pRefSales': s('refund') + s('refundCommission') + s('returnServiceFee'),
            'pHead': s('headLocal'),                    # 头程（成本表 headRMB ÷ 当月汇率）
            'pN': 1,
            'pQty': s('units'),
            'pMiss': 0,
        }

    _gmv = {}
    _grp = {}
    for jr in (jby.get('rows') or []):
        k = (jr.get('ym'), jr.get('cc'))
        _grp.setdefault(k, []).append(jr)
        _gmv[k] = _gmv.get(k, 0.0) + float(jr.get('sales') or 0)
    # 分摊基准：该(站点,月)里 **有 GMV 的行**（按 GMV 占比摊）。
    # ⚠️ 若该(站点,月)所有行 GMV 都是 0（账单里有「only-fee」行，如海外物流仓储费
    #    —— 实测 DE 2026-10 有一笔 €-1.83），则整笔挂在该组第一行上：
    #    否则这笔费用在看板上会**静默消失**（站点月合计 != 账单真值）。
    _basis = {}
    for k, rs in _grp.items():
        pos = [r for r in rs if float(r.get('sales') or 0) > 0]
        _basis[k] = (_gmv.get(k) or 0.0, bool(pos))

    jb_rows = []
    _cnt = {}
    for jr in (jby.get('rows') or []):
        k = (jr.get('ym'), jr.get('cc'))
        _i = _cnt.get(k, 0)
        _cnt[k] = _i + 1
        row = {
            'ym': jr.get('ym'), 'cc': jr.get('cc'), 'asin': None, 'plat': 'joybuy',
            'sales': float(jr.get('sales') or 0),
            'units': float(jr.get('units') or 0),
            'orders': float(jr.get('orders') or 0),
            'sessions': float(jr.get('sessions') or 0),
            'pv': float(jr.get('pv') or 0),
            'mob': 0, 'brw': 0, 'b2b': 0,
            'bbSum': 0.0, 'bbCnt': 0,
            'adClicks': 0, 'adCost': 0.0, 'adOrders': 0, 'adSales': 0.0, 'adImpr': 0,
            'series': jr.get('series') or '无', 'name': jr.get('name') or '无',
            'currency': jr.get('currency') or '',
        }
        _m = jb_prof.get(k)
        if _m:
            _tot, _hasPos = _basis.get(k, (0.0, False))
            if _hasPos and _tot > 0 and row['sales'] > 0:
                row.update(_jb_prof(_m, row['sales'] / _tot))
            elif not _hasPos and _i == 0:
                row.update(_jb_prof(_m, 1.0))
        jb_rows.append(row)
    monthly_data = dict(out_data)
    monthly_data['rows'] = list(rows) + jb_rows
    monthly_data_json = json.dumps(monthly_data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    monthly_gen_time = (gen_time + ' · 含 JoyBuy %d 行' % len(jb_rows)) if jb_rows else gen_time
    print('月度看板: Amazon %d 行 + JoyBuy %d 行 = %d 行' % (len(rows), len(jb_rows), len(rows) + len(jb_rows)))

    # ---------- 汇率 (目标看板: 每月1号 → 人民币) ----------
    countries = sorted(set(r['cc'] for r in rows) | set(jby.get('sites') or []))
    fx_months = list(months)
    for jm in (jby.get('months') or []):
        if not any(m['ym'] == jm['ym'] for m in fx_months):
            fx_months.append(jm)
    fx, fx_cache, fx_missing = build_fx(fx_months, countries)
    fx_json = json.dumps(fx, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    fx_dates = {}
    for ym in fx:
        d = fx_cache['meta'].get('%s|USD' % ym, '')
        if d and d != 'fallback':
            fx_dates[ym] = d

    # ---------- 头程成本表 (2026-10-10): 产品名 → {US/EU/UK: 头程RMB/台} ----------
    try:
        _tbl = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'product_cost_table.json'),
                              encoding='utf-8'))
        hf_json = json.dumps({n: (p.get('headRMB') or {}) for n, p in (_tbl.get('products') or {}).items()},
                             ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        # Woot 成本表 (2026-10-13): {产品名: 采购成本RMB/台} —— 仅月度看板用(Woot 成本回退)
        cost_json = json.dumps({n: (p.get('costRMB') or 0) for n, p in (_tbl.get('products') or {}).items()},
                               ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        print('头程表: %d 个产品 · Woot 成本表 %d 个产品'
              % (len(_tbl.get('products') or {}), len(_tbl.get('products') or {})))
    except Exception as e:
        print('警告: 头程表构建失败(头程列将显示 —):', e)
        hf_json = '{}'
        cost_json = '{}'

    # ---------- 渲染两个看板 ----------
    results = []
    for tpl_file, out_file, placeholders in [
        (MONTHLY_TPL, OUT_MONTHLY, {'__DATA_JSON__': monthly_data_json, '__GEN_TIME__': monthly_gen_time, '__MAP_JSON__': map_json, '__FX_JSON__': fx_json, '__DATA_NOTE__': data_note(data), '__HF_JSON__': hf_json, '__COST_JSON__': cost_json}),
        (TARGET_TPL, OUT_TARGET, {'__DATA_JSON__': data_json, '__GEN_TIME__': gen_time, '__MAP_JSON__': map_json, '__TARGET_JSON__': target_json, '__JOYBUY_JSON__': jby_json, '__FX_JSON__': fx_json, '__DATA_NOTE__': data_note(data)}),
    ]:
        with open(tpl_file, 'r', encoding='utf-8') as f:
            html = f.read()
        for ph, val in placeholders.items():
            html = html.replace(ph, val)
        html = inject_no_cache(html)
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(html)
        results.append('%s (%d bytes)' % (os.path.basename(out_file), os.path.getsize(out_file)))

    print('OK ' + ' · '.join(results))
    print('月份: ' + ' | '.join('%s%s%s' % (m['ym'], '(部分)' if m['partial'] else '', '(进行中)' if m['ongoing'] else '') for m in months))
    print('目标: %d 条%s' % (len(targets['targets']), ' (示例)' if targets.get('sample') else ''))
    print('汇率: %s' % ' | '.join('%s USD→CNY %.4f (%s)' % (ym, fx[ym].get('USD', 0), fx_dates.get(ym, '?')) for ym in sorted(fx.keys())))
    if fx_missing:
        print('警告: 汇率获取失败已兜底: ' + ', '.join(fx_missing))

if __name__ == '__main__':
    main()
