# -*- coding: utf-8 -*-
"""JoyBuy 月度数据聚合（供 月度目标追踪看板 target.html 使用）

输入:
  joybuy_compass_data.json  (joybuy_compass_fetch.js 采集: Data Compass 日粒度趋势 + SKU 周报)
  joybuy_sku_map.json       (SKU → 产品系列/产品名 映射)

输出: joybuy_monthly.json
  {
    generatedAt, source, dataFetchedAt,
    months: [{ym,label,daysWithData,daysTotal,partial,ongoing}],
    sites:  ['DE','FR','NL','UK'],
    rows:   [{ym,cc,series,name,units,orders,sales,sessions,pv,atcUv,atcUnits,stockUnits,currency,skus}],
    siteTotals: [{ym,cc,units,orders,sales,sessions,pv,atcUv}],
    recon:  [{ym,cc,siteUv,rawUv,factor}]          # 分摊口径 vs 站点口径（透明性记录）
  }

口径（写在最前面，改代码前先读）:
  ★ 权威合计 = 站点日度趋势（transactionTrend 出 GMV/订单/件数；trafficTrend 出 PDP UV/PV/ATC）
    —— 日粒度，跨月无需分摊，是站点月度真值。
  ★ 产品维度 = SKU 周报（skuWeekly.cells），按「周与自然月的重叠天数」等比分摊到月。
    实测两口径吻合（差异主要来自跨月周分摊 + 未结束周），因此产品行会按站点月合计
    **等比例校准**（factor 记录在 recon 里），保证「表格各行相加 = KPI 合计 = 站点口径」，
    避免用户对不上账。分摊只改总量、不改产品之间的相对份额（等比缩放）。
  ★ 未映射 SKU 归「其他」；无系列/产品名的归「未分类」。
  ★ 货币按站点：UK=GBP，DE/FR/NL=EUR（看板按每月1号汇率折人民币）。
"""
import json, os, collections
from datetime import datetime, date, timedelta, timezone

BASE_DIR = 'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38'
DATA_FILE = BASE_DIR + '/joybuy_compass_data.json'
SKU_MAP_FILE = BASE_DIR + '/joybuy_sku_map.json'
OUT_FILE = BASE_DIR + '/joybuy_monthly.json'

CUR_OF = {'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR', 'NL': 'EUR'}
MONTH_CN = {'01': '1月', '02': '2月', '03': '3月', '04': '4月', '05': '5月', '06': '6月',
            '07': '7月', '08': '8月', '09': '9月', '10': '10月', '11': '11月', '12': '12月'}
# 站点 → 中文名（看板里站点来自 ROWS 的 cc，沿用国家代码即可）
TRAFFIC_KEYS = ['popPdpUv', 'popPdpPv', 'popAtcUv', 'popAtcUnits', 'popStoreUv']
BIZ_KEYS = ['popGmv', 'popOrders', 'popSoldUnits', 'popPaidUsers']
SKU_CELL_KEYS = ['popPdpUv', 'popPdpPv', 'popAtcUv', 'popAtcUnits', 'popStockUnits',
                 'popGmv', 'popOrders', 'popSoldUnits']


def _iso(dt_str):
    """Data Compass 返回 dd/mm/yyyy → yyyy-mm-dd（写错顺序会让月份整体错位）"""
    if not dt_str:
        return None
    s = dt_str.strip()
    if '-' in s and len(s) == 10 and s[4] == '-':
        return s
    parts = s.split('/')
    if len(parts) != 3:
        return None
    dd, mm, yy = parts
    if len(yy) == 2:
        yy = '20' + yy
    return '%s-%s-%s' % (yy, mm.zfill(2), dd.zfill(2))


def _month_days(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    nxt = (y + 1, 1) if m == 12 else (y, m + 1)
    return (date(nxt[0], nxt[1], 1) - date(y, m, 1)).days


def _cn_now():
    return datetime.now(timezone(timedelta(hours=8)))


def load_sku_meta(path=SKU_MAP_FILE):
    """skuId → {series,name}（同 skuId 多站点时取第一条，命名一致）"""
    out = {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            j = json.load(f)
    except Exception as e:
        print('警告: joybuy_sku_map.json 读取失败: %s' % e)
        return out
    for it in (j.get('skuMap') or []):
        sid = str(it.get('skuId') or '').strip()
        if not sid or sid in out:
            continue
        out[sid] = {'series': (it.get('series') or '未分类').strip() or '未分类',
                    'name': (it.get('name') or it.get('color') or '其他').strip() or '其他'}
    return out


def build(base_dir=BASE_DIR, verbose=True):
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        d = json.load(f)
    sku_meta = load_sku_meta(os.path.join(base_dir, 'joybuy_sku_map.json'))

    # ---------- ① 站点日度（权威口径） ----------
    site = collections.defaultdict(lambda: collections.defaultdict(float))   # (ym,cc) -> metrics
    site_days = collections.defaultdict(set)                                  # (ym,cc) -> {dates}
    for cc, sh in (d.get('shops') or {}).items():
        for row in (sh.get('transactionTrend') or {}).get('currentData') or []:
            dt = _iso(row.get('dt'))
            if not dt:
                continue
            ym = dt[:7]
            got = False
            for k in BIZ_KEYS:
                v = row.get(k)
                if v:
                    site[(ym, cc)][k] += float(v)
                    got = True
            if got:
                site_days[(ym, cc)].add(dt)
        for row in (sh.get('trafficTrend') or {}).get('currentData') or []:
            dt = _iso(row.get('dt'))
            if not dt:
                continue
            ym = dt[:7]
            got = False
            for k in TRAFFIC_KEYS:
                v = row.get(k)
                if v:
                    site[(ym, cc)][k] += float(v)
                    got = True
            if got:
                site_days[(ym, cc)].add(dt)

    # ---------- ② SKU 周报 → 按重叠天数分摊到月（产品维度） ----------
    prod = collections.defaultdict(lambda: collections.defaultdict(float))    # (ym,cc,series,name) -> metrics
    prod_sku = collections.defaultdict(set)
    raw_month = collections.defaultdict(lambda: collections.defaultdict(float))  # (ym,cc) -> 分摊前的合计（核对用）
    for cc, sh in (d.get('shops') or {}).items():
        weeks = {w.get('key'): (w.get('startDate'), w.get('endDate'))
                 for w in ((sh.get('skuWeekly') or {}).get('weeks') or [])}
        for c in ((sh.get('skuWeekly') or {}).get('cells') or []):
            se = weeks.get(c.get('week'))
            if not se or not se[0] or not se[1]:
                continue
            try:
                ds = date(*map(int, se[0].split('-')))
                de = date(*map(int, se[1].split('-')))
            except Exception:
                continue
            total = (de - ds).days + 1
            if total <= 0:
                continue
            by_ym = collections.Counter()
            x = ds
            while x <= de:
                by_ym[x.strftime('%Y-%m')] += 1
                x += timedelta(days=1)
            sid = str(c.get('skuId') or '').strip()
            meta = sku_meta.get(sid) or {'series': '其他', 'name': (c.get('color') or '其他')}
            for ym, n in by_ym.items():
                f = float(n) / total
                key = (ym, cc, meta['series'], meta['name'])
                for k in SKU_CELL_KEYS:
                    v = c.get(k)
                    if v:
                        prod[key][k] += float(v) * f
                        raw_month[(ym, cc)][k] += float(v) * f
                if sid:
                    prod_sku[key].add(sid)

    # ---------- ③ 等比例校准：产品行合计对齐站点月合计 ----------
    recon = []
    for (ym, cc) in sorted({(k[0], k[1]) for k in prod.keys()}):
        sv = (site.get((ym, cc)) or {}).get('popPdpUv') or 0
        rv = (raw_month.get((ym, cc)) or {}).get('popPdpUv') or 0
        if sv > 0 and rv > 0:
            recon.append({'ym': ym, 'cc': cc, 'siteUv': round(sv, 1), 'rawUv': round(rv, 1),
                          'factor': round(sv / rv, 4)})
    factors = {'%s|%s' % (r['ym'], r['cc']): r['factor'] for r in recon}

    rows = []
    for (ym, cc, series, name), m in prod.items():
        f = factors.get('%s|%s' % (ym, cc), 1.0)
        rec = {
            'ym': ym, 'cc': cc, 'series': series, 'name': name,
            'currency': CUR_OF.get(cc, 'EUR'),
            'sales': round(m.get('popGmv', 0) * f, 2),
            'orders': round(m.get('popOrders', 0) * f, 2),
            'units': round(m.get('popSoldUnits', 0) * f, 2),
            'sessions': round(m.get('popPdpUv', 0) * f, 1),
            'pv': round(m.get('popPdpPv', 0) * f, 1),
            'atcUv': round(m.get('popAtcUv', 0) * f, 1),
            'atcUnits': round(m.get('popAtcUnits', 0) * f, 1),
            'stockUnits': round(m.get('popStockUnits', 0), 0),
            'skus': len(prod_sku.get((ym, cc, series, name)) or []),
            'calibrated': f != 1.0,
        }
        if any(rec[k] for k in ['sales', 'orders', 'units', 'sessions', 'pv', 'atcUv', 'atcUnits', 'stockUnits']):
            rows.append(rec)
    rows.sort(key=lambda r: (r['ym'], r['cc'], -r['sessions'], r['series'], r['name']))

    # 站点口径（= 校准后产品行合计，供核对；无产品行时退回日度原始值）
    site_totals = []
    by_site = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in rows:
        for k in ['sales', 'orders', 'units', 'sessions', 'pv', 'atcUv', 'atcUnits']:
            by_site[(r['ym'], r['cc'])][k] += r[k]
    for (ym, cc), m in sorted(by_site.items()):
        st = site.get((ym, cc)) or {}
        site_totals.append({
            'ym': ym, 'cc': cc, 'currency': CUR_OF.get(cc, 'EUR'),
            'sales': round(m['sales'], 2), 'orders': round(m['orders'], 2), 'units': round(m['units'], 2),
            'sessions': round(m['sessions'], 1), 'pv': round(m['pv'], 1),
            'atcUv': round(m['atcUv'], 1), 'atcUnits': round(m['atcUnits'], 1),
            'dayUv': round(st.get('popPdpUv', 0), 1),      # 站点日度口径（分摊前真值）
            'daysWithData': len(site_days.get((ym, cc)) or []),
        })

    # ---------- ④ 月份元数据 ----------
    now = _cn_now()
    cur_ym = now.strftime('%Y-%m')
    months = []
    for ym in sorted({r['ym'] for r in rows} | {s['ym'] for s in site_totals}):
        y, m = int(ym[:4]), int(ym[5:7])
        dset = sorted(set().union(*[site_days[(ym, cc)] for cc in
                                    {r['cc'] for r in rows if r['ym'] == ym}])) if site_days else []
        total = _month_days(ym)
        first_of_month = '%04d-%02d-01' % (y, m)
        last_of_month = '%04d-%02d-%02d' % (y, m, total)
        dfrom = dset[0] if dset else first_of_month
        dto = dset[-1] if dset else first_of_month
        months.append({
            'ym': ym,
            'label': '%d年%s' % (y, MONTH_CN['%02d' % m]),
            'span': '%02d-01 ~ %02d-%02d' % (m, m, total),
            'daysTotal': total,
            'daysWithData': len(dset),
            'dataFrom': dfrom, 'dataTo': dto,
            'partial': dfrom != first_of_month or dto != last_of_month,
            'ongoing': ym == cur_ym,
        })

    out = {
        'generatedAt': _cn_now().strftime('%Y-%m-%d %H:%M:%S'),
        'source': d.get('source', 'partner.joybuy.com Data Compass'),
        'dataFetchedAt': d.get('fetchedAt', ''),
        'range': d.get('range') or {},
        'sites': sorted({r['cc'] for r in rows}),
        'months': months,
        'rows': rows,
        'siteTotals': site_totals,
        'recon': recon,
        'scale': factors,
        'note': ('产品维度取自 JoyBuy SKU 周报（跨月周按重叠天数分摊），已按站点月度合计等比例校准；'
                 '站点合计来自 Data Compass 日粒度趋势。'),
    }
    with open(os.path.join(base_dir, 'joybuy_monthly.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    if verbose:
        tot_s = sum(r['sales'] for r in rows)
        print('JoyBuy 月度: %d 行 · %d 站点 · %d 月 · 产品行销售额合计 %.2f(本币)' % (
            len(rows), len(out['sites']), len(months), tot_s))
        for s in site_totals:
            print('  %s %s: GMV %.2f %s | 订单 %.1f | 件数 %.1f | PDP_UV %.0f (日度口径 %.0f) | ATC_UV %.0f | 数据 %d 天' % (
                s['ym'], s['cc'], s['sales'], s['currency'], s['orders'], s['units'],
                s['sessions'], s['dayUv'], s['atcUv'], s['daysWithData']))
        if recon:
            print('  校准系数(%d 月×站点): %s' % (len(recon), ' | '.join(
                '%s %s ×%.3f' % (r['ym'], r['cc'], r['factor']) for r in recon[:12])) +
                (' …' if len(recon) > 12 else ''))
    return out


if __name__ == '__main__':
    build()
