#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
JoyBuy 看板构建器 v2：Data Compass 数据源 → 生成自包含 joybuy.html

数据源：
  1) joybuy_compass_data.json  ← joybuy_compass_fetch.js（商家后台 Data Compass：流量/加购/收藏/订单，4 站点）
  2) joybuy_api_data.json      ← fetch_joybuy_api.js（开放平台 SP-API：商品/SKU/库存/售后，可选）

用法：
  python build_joybuy_dashboard.py
  python build_joybuy_dashboard.py --compass x.json --api y.json --out _deploy/joybuy.html

周口径：周六 ~ 周五为一周；周号取该周「周五」所在 ISO 周（与亚马逊看板一致）。

⚠️ 币种：UK 站 GBP，DE/NL/FR 站 EUR。多站点汇总时**不混算销售额**，
   拆分到 currencyByShop 按币种分别展示；只有选中单站点时才给出金额。

⚠️ 聚合语义：Data Compass 的 trend 接口给出的是**日粒度真值**（可直接求和）；
   detail 接口给的是**日均值**，已在采集端 ×天数 还原为区间合计。
"""
import argparse
import io
import json
import os
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_COMPASS = os.path.join(HERE, 'joybuy_compass_data.json')
DEFAULT_API = os.path.join(HERE, 'joybuy_api_data.json')
DEFAULT_OUT = os.path.join(HERE, 'joybuy.html')
SKU_MAP = os.path.join(HERE, 'joybuy_sku_map.json')
TEMPLATE = os.path.join(HERE, 'joybuy_template.html')
CHARTJS = os.path.join(HERE, 'chart.umd.min.js')

SHOP_LABEL = {
    'UK': 'UK 站', 'DE': 'DE 站', 'NL': 'NL 站', 'FR': 'FR 站',
}
SHOP_FLAG = {'UK': '🇬🇧', 'DE': '🇩🇪', 'NL': '🇳🇱', 'FR': '🇫🇷'}

# 日粒度可求和指标：trafficTrend / transactionTrend / productTrend 字段名
DAY_METRICS = [
    ('uv', 'popStoreUv'),            # 店铺访客数
    ('pv', 'popStorePv'),            # 店铺浏览量
    ('pdpUv', 'popPdpUv'),           # 商品详情页访客数
    ('pdpPv', 'popPdpPv'),           # 商品详情页浏览量
    ('atcUv', 'popAtcUv'),           # 加购访客数
    ('addToCart', 'popAtcUnits'),    # 加购件数
    ('buyers', 'popPaidUsers'),      # 买家数
    ('visitDepth', 'popAverageVisitDepth'),
    ('sessionDuration', 'popAverageSessionDuration'),
]
TXN_METRICS = [
    ('gmv', 'popGmv'),
    ('orders', 'popOrders'),
    ('units', 'popSoldUnits'),
    ('cancelRate', 'popOrderCancelRate'),
]
PROD_METRICS = [
    ('onSale', 'popOnSaleProducts'),
    ('visited', 'popVisitedProducts'),
    ('favorites', 'popCollectedProducts'),   # 收藏商品数
    ('atcProducts', 'popAtcProducts'),       # 加购商品数
    ('activeProducts', 'popActiveProducts'),
    ('outOfStock', 'popOutOfStockProducts'),
]
SUM_KEYS = ['uv', 'pv', 'pdpUv', 'pdpPv', 'atcUv', 'addToCart', 'buyers',
            'gmv', 'orders', 'units', 'favorites', 'atcProducts', 'visited']
# 需要按天/周取平均而不是求和的（比率 / 存量类）
AVG_KEYS = ['visitDepth', 'sessionDuration', 'cancelRate',
            'onSale', 'outOfStock', 'activeProducts']


def num(v, d=0.0):
    try:
        if v is None or v == '':
            return d
        return float(v)
    except Exception:
        return d


def d2iso(s):
    """'25/09/2026' -> '2026-09-25'"""
    if not s or '/' not in s:
        return ''
    a, b, c = s.split('/')
    return '%s-%s-%s' % (c.zfill(4), b.zfill(2), a.zfill(2))


# ---------------------------------------------------------------- 周口径
def week_of(iso):
    d = datetime.strptime(iso, '%Y-%m-%d').date()
    dow = d.isoweekday() % 7                 # 周一=1 … 周六=6, 周日=0
    offset = (dow - 6) % 7                   # 距本周六的天数
    start = d - timedelta(days=offset)
    end = start + timedelta(days=6)          # 周五
    return start, end, 'W%d' % end.isocalendar()[1]


def week_label(start, end):
    return '%s (%s~%s)' % ('W%d' % end.isocalendar()[1],
                           start.strftime('%m-%d'), end.strftime('%m-%d'))


def blank():
    d = {k: 0 for k in SUM_KEYS}
    d['sales'] = 0.0
    for k in AVG_KEYS:
        d[k] = 0.0
    return d

# ---------------------------------------------------------------- 单站点解析
def listed_since(s):
    """商品上架日 = productTrend 里 popOnSaleProducts 首次 > 0 的日期。
    这是解释「为什么早期周次商品指标全是 0」的关键证据（见文件头）。"""
    rows = (s.get('productTrend') or {}).get('currentData') or []
    best = ''
    for r in rows:
        iso = d2iso(r.get('dt'))
        if iso and num(r.get('popOnSaleProducts')) > 0:
            if not best or iso < best:
                best = iso
    return best


def parse_shop(code, s):
    """把某站点数据摊平成 日粒度 records"""
    days = {}

    def rec(iso):
        return days.setdefault(iso, blank())

    tt = (s.get('trafficTrend') or {}).get('currentData') or []
    for r in tt:
        iso = d2iso(r.get('dt'))
        if not iso:
            continue
        c = rec(iso)
        for k, src in DAY_METRICS:
            c[k] += num(r.get(src))

    for r in (s.get('transactionTrend') or {}).get('currentData') or []:
        iso = d2iso(r.get('dt'))
        if not iso:
            continue
        c = rec(iso)
        for k, src in TXN_METRICS:
            c[k] += num(r.get(src))
        # 交易表里的买家数优先
        if r.get('popPaidUsers') is not None:
            c['buyers'] = max(c['buyers'], num(r.get('popPaidUsers')))

    for r in (s.get('productTrend') or {}).get('currentData') or []:
        iso = d2iso(r.get('dt'))
        if not iso:
            continue
        c = rec(iso)
        for k, src in PROD_METRICS:
            c[k] += num(r.get(src))

    return days


def rollup(days_map):
    """日 → 周 + 日列表"""
    day_rows = []
    weeks = {}
    for iso in sorted(days_map.keys()):
        c = days_map[iso]
        day_rows.append(dict(date=iso, **c))
        start, end, key = week_of(iso)
        w = weeks.setdefault(key, dict(key=key, start=start.strftime('%Y-%m-%d'),
                                       end=end.strftime('%Y-%m-%d'),
                                       label=week_label(start, end),
                                       nDays=0, **blank()))
        for k in SUM_KEYS:
            w[k] += c.get(k, 0)
        for k in AVG_KEYS:
            w[k] += c.get(k, 0)
        w['nDays'] += 1
        if iso > w.get('lastDate', ''):
            w['lastDate'] = iso
    for w in weeks.values():
        n = w['nDays'] or 1
        for k in AVG_KEYS:
            w[k] = round(w[k] / n, 4)
    return [weeks[k] for k in sorted(weeks.keys())], day_rows


def sum_days(days_map):
    t = blank()
    for c in days_map.values():
        for k in SUM_KEYS:
            t[k] += c.get(k, 0)
    return t


# ---------------------------------------------------------------- 窗口收紧
def week_has_data(w):
    """该周是否有数据 —— 所有指标全 0 即视为「没有数据的周」。

    ⚠️ 这里只看数值，不看原因。周的 0 可能来自两种情况（口径说明见 warnings）：
      ① 商品未上架 → 商品侧指标为 0，但店铺侧可能已有访客；
      ② 店铺尚无访客 → 全为 0。
    两者在周汇总层都表现为 0，所以判定「这周有没有数据」用同一个标准就够了。
    """
    for k in SUM_KEYS:
        if abs(num(w.get(k))) > 1e-9:
            return True
    for k in AVG_KEYS:
        if abs(num(w.get(k))) > 1e-9:
            return True
    return False


def trim_leading_empty_days(days_map):
    """把窗口起点后移到「第一个有数据的周」，删掉开头**连续**全 0 的周（含其日数据）。

    为什么只裁开头：
      · 开头连续全 0 = 窗口拉太早（商品还没上架 / 店铺还没流量），留着只会把趋势图
        X 轴拉长、并在视觉上伪装成「流量一直为零」；
      · 中间 / 尾部的 0 周是真实的「这周没人来」，属于业务信息，必须保留。

    返回 (裁剪后的日数据, 被裁掉的周 key 列表, 裁剪边界的日期)
    """
    weeks, _ = rollup(days_map)
    cut_keys, cut_end = [], ''
    for w in weeks:
        if week_has_data(w):
            break
        cut_keys.append(w['key'])
        cut_end = w['end']
    if not cut_end:
        return days_map, [], ''
    kept = dict((iso, c) for iso, c in days_map.items() if iso > cut_end)
    return kept, cut_keys, cut_end


RATE_KEYS = ['visitDepth', 'sessionDuration', 'cancelRate']      # 比率类：合并取最大
LEVEL_KEYS = ['onSale', 'outOfStock', 'activeProducts']          # 存量类：合并求和


def merge_days(maps):
    """多个站点的日数据合并（销售额不合并，避免混币种）"""
    out = {}
    for m in maps:
        for iso, c in m.items():
            t = out.setdefault(iso, blank())
            for k in SUM_KEYS:
                if k == 'gmv':
                    continue                      # 混币种不合并金额
                t[k] += c.get(k, 0)
            for k in LEVEL_KEYS:
                t[k] += c.get(k, 0)
            for k in RATE_KEYS:
                t[k] = max(t[k], c.get(k, 0))
    return out


def norm_sku(sku_rows, top_n=200):
    out = []
    for r in (sku_rows or []):
        pdp = num(r.get('popPdpUv'))
        atc = num(r.get('popAtcUv'))
        out.append(dict(
            skuId=str(r.get('skuId') or ''),
            name=(r.get('skuName') or '').strip(),
            category=(r.get('categoryCate4Name') or r.get('categoryCate3Name') or '').strip(),
            pdpUv=round(pdp, 2),
            pdpPv=round(num(r.get('popPdpPv')), 2),
            atcUv=round(atc, 2),
            addToCart=round(num(r.get('popAtcUnits')), 2),
            atcRate=round(atc / pdp * 100, 2) if pdp else None,
            orders=round(num(r.get('popOrders')), 2),
            units=round(num(r.get('popSoldUnits')), 2),
            sales=round(num(r.get('popGmv')), 2),
            buyers=round(num(r.get('popPaidUsers')), 2),
            stock=round(num(r.get('popStockUnits')), 1),
            sessionDuration=round(num(r.get('popAverageSessionDuration')), 2),
            convRate=round(num(r.get('popPdpUvToPaidUserConversionRate')) * 100, 2),
            status=(r.get('status') or r.get('skuStatus') or ''),
        ))
    out.sort(key=lambda x: (-x['pdpUv'], x['skuId']))
    return out[:top_n]


def norm_channels(rows):
    out = []
    tot = sum(num(r.get('popPdpUv')) for r in (rows or []))
    for r in (rows or []):
        v = num(r.get('popPdpUv'))
        out.append(dict(
            channel=(r.get('searchChannel') or '').strip() or '—',
            pdpUv=round(v, 2),
            share=round(v / tot * 100, 2) if tot else 0,
            cr=round(num(r.get('popPdpPvToOrdersConversionRate')), 2),
        ))
    out.sort(key=lambda x: -x['pdpUv'])
    return out


def norm_keywords(rows):
    """搜索词明细。分组键 groupBy='keywords'，词字段是 keyword。"""
    out = []
    tot = sum(num(r.get('popKeywordPdpUv')) for r in (rows or []))
    for r in (rows or []):
        v = num(r.get('popKeywordPdpUv'))
        out.append(dict(
            keyword=(r.get('keyword') or '').strip() or '—',
            pdpUv=round(v, 2),
            share=round(v / tot * 100, 2) if tot else 0,
            cr=round(num(r.get('popKeywordPdpPvToOrdersConversionRate')), 2),
        ))
    out.sort(key=lambda x: -x['pdpUv'])
    return out


# ---------------------------------------------------------------- SKU × 周
def load_sku_map(path):
    """
    读取 build_joybuy_sku_map.py 产出的映射。
    返回 (skuId -> {series,name,bundle}, catalog, seriesOrder, bundleOrder)
    缺文件时退化为空映射 —— 看板仍可跑，只是「产品系列/产品名」筛选只剩「未分类」。
    """
    if not path or not os.path.exists(path):
        return {}, [], [], []
    try:
        d = json.load(io.open(path, encoding='utf-8'))
    except Exception:
        return {}, [], [], []
    m = {}
    for x in (d.get('skuMap') or []):
        sid = str(x.get('skuId') or '')
        if sid:
            m[sid] = x
    return (m, (d.get('catalog') or []), (d.get('seriesOrder') or []),
            (d.get('bundleOrder') or ['标配']))


# 客户端要按「国家 / 产品系列 / 产品名 / SKU / 周数」任意组合筛选，
# 所以必须把 SKU × 周 的原始格子整批发给浏览器，由前端实时聚合 ——
# 不能在后端预先算好 ALL 汇总，否则任何筛选组合都要重跑一次采集。
SKU_WEEK_FIELDS = [
    ('pdpUv', 'popPdpUv'), ('pdpPv', 'popPdpPv'),
    ('atcUv', 'popAtcUv'), ('addToCart', 'popAtcUnits'),
    ('orders', 'popOrders'), ('units', 'popSoldUnits'), ('sales', 'popGmv'),
    ('buyers', 'popPaidUsers'), ('stock', 'popStockUnits'),
]
SKU_WEEK_RATE = [
    ('sessionDuration', 'popAverageSessionDuration'),
    ('atcRate', 'popPdpUvToAtcUvConversionRate'),
    ('convRate', 'popPdpUvToPaidUserConversionRate'),
    ('aov', 'popAverageRevenuePerPaidUser'),
]


def norm_sku_weeks(sw, sku_map):
    """SKU×周 明细 → 扁平行（每行已带上 series/name，前端直接按维度筛）"""
    out = []
    for c in (sw or {}).get('cells') or []:
        sid = str(c.get('skuId') or '')
        if not sid:
            continue
        m = sku_map.get(sid) or {}
        row = dict(week=c.get('week') or '', skuId=sid,
                   series=m.get('series') or '未分类', name=m.get('name') or '未命名 SKU',
                   # bundle = 套装/配件组合（Air Assist / +蜂窝板+旋转轴），由 sku_map 给出；
                   # 产品名里**不含**套装，套装是独立维度，见 build_joybuy_sku_map.py 文件头。
                   bundle=m.get('bundle') or '标配',
                   color=m.get('color') or '')
        for k, src in SKU_WEEK_FIELDS:
            row[k] = round(num(c.get(src)), 2)
        for k, src in SKU_WEEK_RATE:
            v = c.get(src)
            row[k] = round(num(v), 2) if v is not None else None
        out.append(row)
    return out


def norm_sku_totals(rows):
    """把 SKU×周 明细汇总成「区间合计」，供商品表与交叉校验使用"""
    acc = {}
    for r in rows or []:
        sid = r['skuId']
        t = acc.setdefault(sid, dict(skuId=sid, series=r['series'], name=r['name'],
                                     bundle=r.get('bundle') or '标配', color=r.get('color') or '',
                                     pdpUv=0.0, pdpPv=0.0, atcUv=0.0, addToCart=0.0,
                                     orders=0.0, units=0.0, sales=0.0, buyers=0.0,
                                     stock=0.0, sessionDuration=0.0, __n=0, sites=set()))
        for k in ('pdpUv', 'pdpPv', 'atcUv', 'addToCart', 'orders', 'units', 'sales', 'buyers', 'stock'):
            t[k] += r.get(k) or 0
        if r.get('sessionDuration'):
            t['sessionDuration'] = max(t['sessionDuration'], r['sessionDuration'])
        t['__n'] += 1
    out = []
    for t in acc.values():
        n = t.pop('__n')
        t.pop('sites', None)
        for k in ('pdpUv', 'pdpPv', 'atcUv', 'addToCart', 'orders', 'units', 'sales', 'buyers', 'stock'):
            t[k] = round(t[k], 2)
        # SKU 层级的加购率/转化率由实际量算出（比后端比率更准，也避免加权口径争议）
        t['atcRate'] = round(t['atcUv'] / t['pdpUv'] * 100, 2) if t['pdpUv'] else None
        t['convRate'] = round(t['orders'] / t['pdpUv'] * 100, 2) if t['pdpUv'] else None
        t['weeks'] = n
        out.append(t)
    out.sort(key=lambda x: -x['pdpUv'])
    return out


# ---------------------------------------------------------------- 主流程
def build(compass_path, api_path, out_path):
    warnings = []
    compass = {}
    api = {}
    if compass_path and os.path.exists(compass_path):
        compass = json.load(io.open(compass_path, encoding='utf-8'))
    if api_path and os.path.exists(api_path):
        api = json.load(io.open(api_path, encoding='utf-8'))

    shops_raw = compass.get('shops') or {}
    if not shops_raw:
        warnings.append('joybuy_compass_data.json 中没有站点数据，请先执行 node joybuy_compass_fetch.js')

    per_shop_days = {}
    shop_meta = []
    trimmed = {}
    raw_first_day = {}
    for code, s in shops_raw.items():
        days = parse_shop(code, s)
        if not days:
            warnings.append('%s 站无有效日数据' % code)
            continue
        # 接口实际返回的第一天。用来区分两种「起点晚」：
        #   ① 等于采集起点 → 接口覆盖了整个窗口，更早的周只是全 0（被下面裁掉）；
        #   ② 晚于采集起点 → 接口本来就没返回更早日期（NL 的店铺流量记录 07-28 才开始）。
        raw_first_day[code] = min(days.keys())
        # 窗口起点后移：删掉开头连续全 0 的周（商品未上架 / 店铺尚无流量那段）
        days, cut_keys, cut_end = trim_leading_empty_days(days)
        if cut_keys:
            trimmed[code] = dict(keys=cut_keys, until=cut_end, n=len(cut_keys))
        if not days:
            warnings.append('%s 站在收紧窗口后没有剩余数据' % code)
            continue
        per_shop_days[code] = days
        shop_meta.append(dict(code=code, label=SHOP_LABEL.get(code, code),
                              flag=SHOP_FLAG.get(code, ''),
                              currency=s.get('currency') or '',
                              shopId=s.get('shopId') or ''))

    payload_shops = [dict(code='ALL', label='全部站点', flag='🌐', currency='')] + shop_meta

    sku_map, sku_catalog, series_order, sku_bundles = load_sku_map(SKU_MAP)
    if not sku_map:
        warnings.append('未找到 joybuy_sku_map.json —— 产品系列/产品名筛选将只有「未分类」，'
                        '请先执行 python build_joybuy_sku_map.py')

    data = {}
    for code, days in per_shop_days.items():
        weeks, day_rows = rollup(days)
        sku_weeks = norm_sku_weeks((shops_raw[code].get('skuWeekly') or {}), sku_map)
        if not sku_weeks:
            warnings.append('%s 站没有 SKU×周 明细（skuWeekly），产品维度筛选对该站无效 —— '
                            '请不带 --no-weekly 重新采集' % code)
        _ds = sorted(days.keys())
        _sw_weeks = sorted(set(c.get('week') or '' for c in (shops_raw[code].get('skuWeekly') or {}).get('cells') or []))
        data[code] = dict(
            listedSince=listed_since(shops_raw[code]),
            skuFirstWeek=(_sw_weeks[0] if _sw_weeks else ''),
            skuLastWeek=(_sw_weeks[-1] if _sw_weeks else ''),
            # ⚠️ cover = **裁剪后**的实际覆盖区间（前端用它提示「该站起点比窗口晚」）。
            # rawCoverStart = 接口实际返回的第一天，两者相同时说明接口覆盖了整窗。
            cover=dict(start=_ds[0], end=_ds[-1], nDays=len(_ds)),
            rawCoverStart=raw_first_day.get(code, ''),
            weeks=weeks,
            days=day_rows,
            skus=norm_sku((shops_raw[code].get('skuDetail') or {}).get('data')),
            skuWeeks=sku_weeks,
            skuTotals=norm_sku_totals(sku_weeks),
            channels=norm_channels((shops_raw[code].get('channels') or {}).get('data')),
            keywords=norm_keywords((shops_raw[code].get('searchTerms') or {}).get('data')),
            summary=shops_raw[code].get('trafficSummary') or {},
        )

    # ⚠️ 不再预先生成 data['ALL']。
    # 原因：客户端要按「国家 / 产品系列 / 产品名 / SKU / 周数」任意组合筛选，
    # 且「全部站点」只是「4 个站点全选」的一种特例。若后端另算一份 ALL，
    # 就会出现两条口径（预计算的 ALL vs 前端合并的部分站点），极易不一致。
    # 统一由前端 mergeSites() 合并，金额按币种分组，不混算。

    # 每站点销售额（用于全部站点视图的分币种展示）
    sales_by_cur = {}
    for code, days in per_shop_days.items():
        cur = dict((m['code'], m['currency']) for m in shop_meta).get(code, '')
        g = sum(c.get('gmv', 0) for c in days.values())
        sales_by_cur[cur] = sales_by_cur.get(cur, 0) + g

    # 开放平台侧信息（可选）
    catalog = {}
    if api:
        prods = api.get('products') or []
        skus = api.get('skus') or []
        stocks = api.get('stocks') or []
        afters = api.get('afsOrders') or []
        orders = api.get('orders') or []
        catalog = dict(products=len(prods), skus=len(skus), stocks=len(stocks),
                       afsOrders=len(afters), orders=len(orders))
        if not orders:
            warnings.append('开放平台 SP-API 近 120 天无订单（该店为新建店铺，订单量极少）')

    # 窗口起止 = 各站裁剪后的并集。各站起点本来就不同（UK 07-01 上架、
    # DE 08-05 / FR 08-07 / NL 08-10），裁剪后差异更明显，所以必须取并集而不是第一站。
    days_all = sorted(set(k for d in per_shop_days.values() for k in d.keys()))
    window = ('%s ~ %s' % (days_all[0], days_all[-1])) if days_all else '无数据'
    raw_range = compass.get('range') or {}
    raw_start_global = raw_range.get('startDate') or ''

    for code in data:
        if not any(w['uv'] or w['pdpUv'] or w['orders'] for w in data[code]['weeks']):
            warnings.append('%s 站所选区间内所有指标为 0' % code)

    # 窗口收紧说明：不写清楚「起点为什么不是采集范围起点」，看板上会显得像漏了数据。
    # ⚠️ 措辞里**不要出现「无数据」**—— 那是「漏采」的意思；这里是「全 0，所以不算数据」，
    #    与 warnings 下方的「真实的 0 / 接口没返回」是同一套口径。
    if trimmed and days_all:
        detail = ' ｜ '.join('%s 前 %d 周' % (c, trimmed[c]['n'])
                            for c in sorted(trimmed, key=lambda x: -trimmed[x]['n']))
        warnings.append('窗口起点已收紧到「首个有数据的周」：%s（原始采集自 %s 起；'
                        '其前各站连续全 0 的早期周已移除 —— %s）' % (days_all[0], raw_start_global, detail))

    # 站点数据覆盖起止不一致时明确提示。
    # ⚠️ 措辞要点：**不能说成「无数据」** —— 那会让人以为漏采了真实流量（上一版就是这么写错的）。
    #    再叠加「商品上架日」交叉验证，就能把「早期商品指标为 0」解释到位。
    if days_all:
        w0 = days_all[0]
        # 各站「商品上架日」—— 这是解释「早期周次商品指标全是 0」的关键，合并成一条，别每站刷一行。
        # ⚠️ 前端 warnbar 用 esc() 渲染，这里**不能用 markdown 加粗**，否则会显示成字面量星号。
        listed = [(c, data[c]['listedSince']) for c in sorted(data)
                  if data[c]['listedSince'] and data[c]['listedSince'] > w0]
        if listed:
            warnings.append('商品上架时间：' + ' ｜ '.join('%s %s' % (c, v) for c, v in listed) +
                            ' —— 早于上架日的周次，商品 UV / 加购 / 订单 / 销售额为 0 属正常（商品还没上架），'
                            '不是数据缺失，也不是流量下滑')
        # 「接口本来就没返回更早日期」才提示（NL：店铺流量记录 07-28 才开始）。
        # ⚠️ 不能用裁剪后的 cover.start 判断 —— 它是**裁剪边界**（各站都是某个周六），
        #    拿它跟窗口起点比，DE/FR 会被判成「接口不返回更早日期」，而事实是接口返回了、
        #    只是那段全是 0 被裁掉了。两种情况的成因不同，混在一起提示会误导。
        late = [(c, data[c]['rawCoverStart']) for c in sorted(data)
                if data[c]['rawCoverStart'] and raw_start_global
                and data[c]['rawCoverStart'] > raw_start_global]
        if late:
            warnings.append('店铺流量记录起点晚于窗口：' +
                            ' ｜ '.join('%s 自 %s' % (c, v) for c, v in late) +
                            '（接口不返回更早日期，推测当时本就为 0）')

    # 全局周列表 = 各站裁剪后周桶的**并集**。
    # ⚠️ 不能再「取首个站点」：裁剪后各站起点不同（UK W27 / DE·FR W32 / NL W33），
    #    取第一站会漏掉其他站更早/更晚的周。同一 key 的 start/end 由 week_of 纯函数给出，
    #    各站必然一致，所以直接用 dict 覆盖即可。按 start 日期排序（跨年时按 W 号排会错）。
    wk_dict = {}
    for code in data:
        for w in data[code]['weeks']:
            wk_dict[w['key']] = dict(key=w['key'], label=w['label'], start=w['start'], end=w['end'])
    global_weeks = [wk_dict[k] for k in sorted(wk_dict.keys(), key=lambda x: wk_dict[x]['start'])]

    # range 对外只暴露**裁剪后**的实际窗口（原始采集范围另放 fetchRange）。
    # 前端用 range.startDate 做「起点晚于窗口」的比较，若还留着原始采集起点，提示会失真。
    out_range = (dict(startDate=days_all[0], endDate=days_all[-1], nDays=len(days_all))
                 if days_all else dict(raw_range))

    payload = dict(
        builtAt=datetime.now().strftime('%Y-%m-%d %H:%M'),
        windowLabel=window,
        range=out_range,
        fetchRange=raw_range,
        trimmedWeeks=dict((c, dict(n=v['n'], keys=v['keys'], until=v['until']))
                          for c, v in trimmed.items()),
        fetchedAt=compass.get('fetchedAt') or '',
        sites=shop_meta,
        weeks=global_weeks,
        seriesOrder=series_order,
        bundleOrder=sku_bundles,
        catalogSeries=sku_catalog,
        skuMap=dict((k, dict(series=v.get('series'), name=v.get('name'),
                             color=v.get('color') or '', skuName=v.get('skuName') or '',
                             sites=v.get('site') or [], review=bool(v.get('review')),
                             note=v.get('note') or ''))
                    for k, v in sku_map.items()),
        data=data,
        salesByCurrency=sales_by_cur,
        catalog=catalog,
        source=dict(
            compass=bool(per_shop_days),
            api=bool(catalog),
            compassFile=os.path.basename(compass_path or ''),
            apiFile=os.path.basename(api_path or '') if catalog else '',
        ),
        warnings=warnings,
    )

    tpl = io.open(TEMPLATE, encoding='utf-8').read()
    chart = io.open(CHARTJS, encoding='utf-8').read().replace('</script>', '<\\/script>')
    pj = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html = tpl.replace('__CHARTJS__', chart).replace('__PAYLOAD__', pj)
    assert '__PAYLOAD__' not in html and '__CHARTJS__' not in html, '模板占位符未替换'

    io.open(out_path, 'w', encoding='utf-8', newline='\n').write(html)
    print('✓ 生成 %s  (%.1f KB)' % (out_path, os.path.getsize(out_path) / 1024.0))
    print('  窗口 %s ｜ 周数 %d ｜ 站点 %s'
          % (window, len(global_weeks), ', '.join(m['code'] for m in shop_meta)))
    if trimmed:
        print('  已收紧窗口起点（移除开头连续全 0 的周）: ' +
              ' ｜ '.join('%s 去掉 %s' % (c, ','.join(trimmed[c]['keys']))
                          for c in sorted(trimmed, key=lambda x: -trimmed[x]['n'])))
    for code in sorted(data):
        d = data[code]
        t = blank()
        for w in d['weeks']:
            for k in SUM_KEYS:
                t[k] += w.get(k, 0)
        print('  [%s] 周数 %d ｜ 日数 %d (%s~%s) ｜ 上架 %s ｜ SKU 明细 %s~%s ｜ 订单 %g ｜ 件数 %g ｜ 店铺UV %g ｜ PDP UV %g ｜ 加购 %g ｜ 收藏 %g'
              % (code, len(d['weeks']), d['cover']['nDays'], d['cover']['start'], d['cover']['end'],
                 d['listedSince'] or '—', d['skuFirstWeek'] or '—', d['skuLastWeek'] or '—',
                 t['orders'], t['units'], t['uv'], t['pdpUv'], t['addToCart'], t['favorites']))
    if sales_by_cur:
        print('  销售额(分币种): ' + ' ｜ '.join('%s %.2f' % (k or '—', v) for k, v in sales_by_cur.items()))
    if warnings:
        print('  提示:')
        for w in warnings[:8]:
            print('   - %s' % w)
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--compass', default=DEFAULT_COMPASS)
    ap.add_argument('--api', default=DEFAULT_API)
    ap.add_argument('--out', default=DEFAULT_OUT)
    a = ap.parse_args()
    build(a.compass, a.api, a.out)


if __name__ == '__main__':
    main()
