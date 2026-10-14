# -*- coding: utf-8 -*-
"""毛利指标计算模块 (供 daily / monthly / product 周报 三个看板共用)

输入:
  profit_data.json   (fetch_profit_data.js 产出)
    days[date]   = [ERP行]: as/pa(ASIN) site ua(店铺) cur qty sales promo comm fba adErp cost mst lst psvc svc gross
                            + mqty mcost mhead mship                    ← 2026-10-12 第一轮: 多渠道
                            + fbRet fbOth fbInb fbOvr fbCon fbRem fbMst fbLst fbTot stSite  ← 第二轮: 库存费 9 细项
                            + refSales refPromo refComm refFba refQty refRate refShip        ← 第二轮: 退款
    months[ym]   = 同结构 (月度查询; 仓储费类 fbMst/fbLst 只在月度行有效, 日粒度为 0)
    siteFees[ym][site] = 站点级(无ASIN)行 —— ★2026-10-12 第二轮起不再进入看板:
      实测站点级只有「FBA物流国际货运费(入境)」有值, 而用户明确「不展示、也不计入毛利」(头程按成本表预估),
      故 siteFees 仅用于审计输出(ignoredSiteFees), 不产生任何看板列。
  finance_inputs.json (财务手工录入: otherOrders 其他渠道订单 / reviewFees 测评费用)
  vat_rates.json     (EU/UK 增值税率)
  fx_rates.json      (月度汇率, CNY per 1 单位币种 —— 仅用于测评费币种折算)

口径 (2026-10-13 用户口径变更: 商品成本改为成本表匹配):
  毛利 = 销售额 + 促销折扣 + 销售佣金 + 配送费 + 商品成本 + 仓储分摊 + 其他费用分摊
         + FBA退货处理费 + 退款各项 + 其他渠道剔除加回
         - VAT(EU/UK) - 头程(成本表预估) - 测评费 - 广告费(看板)
  - ERP 各项费用为负值, 直接相加; 广告费由各看板用自己的广告数据(正值)取负
  - ★★商品成本(2026-10-13 起)**不再取易仓 productCostTotal**:
       商品成本 = 产品成本表 costRMB × 件数 ÷ 当月汇率(CNY per 1 站点币种)
       ASIN → 产品名: 「产品关系管理」(云端 mapping.data.asinMap, 与看板同源, 见 cost_from_table.py)
       件数 = qty + mqty (亚马逊销量 + 多渠道销量); 未匹配 ⇒ cost=0 且 miss=1 (不回退易仓)
       易仓原值保留在每行 costErp 字段, 仅供审计/对账, **不参与任何计算**
  - 其他费用 = 推广服务费汇总 + 服务费汇总(按「日期 × 国家」内产品行数均摊)
               + 「其他FBA库存和入境服务费 / 超量费 / 合仓费 / 合作承运费 / 移除费用」5 项月度分摊值
               (用户: 除仓储费与退货处理费, 其余细项合并入其他费用分摊)
  - FBA 库存费 9 细项拆列(用户要求逐项可见):
      仓储类   fbMst / fbLst  → 同时构成既有「仓储」列(仓储 = 月仓租 + 长期仓租), 独立计入毛利
      退货处理 fbRet           → 独立字段, 独立计入毛利
      其余 5 项                → 合并进「其他费用」, 随其他费用一起计入毛利
      ★ fbInb(FBA物流国际货运费/入境)→ 用户 2026-10-12 明确「不展示, 也不计入毛利」(头程用成本表预估替代)
  - 仓储类与其余库存费细项按 (月,ASIN,站点,店铺) 的**日行数**均摊到每天(列合计 == ERP 月度值)
  - ★头程由看板侧按「成本表 headRMB × 销量 ÷ 汇率」计算并扣入毛利(预估值口径, 成本表可改)
  - 退款(用户口径: 减去退款、加回促销折扣退款与销售佣金退款、配送/买家运费退款一并回冲):
      毛利 += refSales + refShip + refPromo + refComm + refFba   (按 ERP 原符号直接相加)
    退款率 = 退款数量 ÷ 销量(数量口径, 与易仓界面一致), 由看板侧计算
  - 不含: 税费 / 其他交易费(用户公式未列)
  - 币种: 原币种, 看板端自行按月/日汇率折算

  输出 build():
  rows: [{d, site, as, ua, cur, qty, sales, promo, comm, fba, cost, costErp, storage, other, vat, miss, gross,
          fbRet, fbOth, fbOvr, fbCon, fbCar, fbRem, fbMst, fbLst,
          refSales, refPromo, refComm, refFba, refShip, refQty,
          mqty, mcost, mhead, mship, mcAdj, review}]
    cost  = 商品成本(**成本表口径**, 负数, 站点币种) —— 2026-10-13 起唯一的入账值
    costErp = 易仓利润报表的 productCostTotal(负数, 站点币种) —— 仅审计, 不参与计算
    miss  = 1 表示有件数但**成本表匹配不到**(映射缺 ASIN 或成本表缺产品名) ⇒ 成本按 0, 毛利虚高
            ⚠️ 语义变更: 2026-10-13 前指「易仓商品成本=0」, 现在指「成本表未命中」(不回退易仓)
    vat   = EU/UK 增值税(正数, 作为费用从毛利中扣减); 非 EU/UK 国家为 0
    storage = FBA 仓储费分摊 = fbMst + fbLst (负)
    other = 其他费用分摊(含 5 项库存费细项, 负)
    fbRet = FBA退换货处理费分摊(负) —— 独立计入毛利
    fbOth/fbOvr/fbCon/fbCar/fbRem = 其他FBA库存和入境服务费/超量费/合仓费/合作承运费/移除费用 分摊值(负)
            ★ 已并入 other 列, 这里只做明细展示, 不要重复计入毛利
    fbMst/fbLst = FBA月仓租费 / FBA长期仓租费 分摊值(负) —— 已并入 storage 列, 只做明细展示
    ref*  = 退款各项(ERP 原符号: refSales/refShip/refComm/refFba 为负, refPromo 为正); refQty 退款件数
    mqty  = 多渠道销量(台); mcost/mhead/mship = 多渠道产品成本/头程/配送费(负)
            ★ 这三项本来就含在 cost / fba 里(ERP 公式: fbaFeesTotal 含多渠道配送费;
              productCostTotal 含多渠道订单采购成本与头程), 所以不重复扣, 只单独呈现
    mcAdj = 「其他渠道订单」剔除加回(正数) —— 导入订单对应部分的多渠道成本从亚马逊口径移出
    review= 测评费分摊(正数, 费用) —— 计入毛利

VAT (2026-10-10 用户口径):
  实测易仓利润报表的「产品税」与「亚马逊代扣代缴税款」两项正好互相抵消(净额 0)
  → 报表没有把 VAT 从毛利里扣掉, 需在看板侧手动扣。
  VAT = (销售额 + 促销折扣) × 税率  ← 即「销售价格 − 优惠价格」后的价格 × 税率
  税率见 vat_rates.json(单一配置源, 置 0 即回到不扣 VAT 的口径)。

入境货运费 (2026-10-12 第二轮用户口径变更):
  第一轮曾把站点级「FBA物流国际货运费(入境)」摊到 SKU 做展示列; 第二轮用户明确
  「不展示, 也不计入毛利 —— 头程运费按成本表预估」→ 本模块不再产出 inb/invx, 站点级费用仅审计。
"""
import json
import os
import re
import calendar

# 商品成本取数(2026-10-13): 「产品关系管理」映射 → 产品成本表 costRMB
#   导入失败(文件缺失等)时降级为「沿用易仓原值」并打印告警, 不让整条链路挂掉
try:
    from cost_from_table import Resolver as _CostResolver
except Exception:                                    # pragma: no cover
    _CostResolver = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFIT_FILE = os.path.join(BASE_DIR, 'profit_data.json')
VAT_FILE = os.path.join(BASE_DIR, 'vat_rates.json')
FIN_FILE = os.path.join(BASE_DIR, 'finance_inputs.json')
FX_FILE = os.path.join(BASE_DIR, 'fx_rates.json')

# 已知站点码 (与看板 COUNTRY_META 一致)
SITE_CODES = {'US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PL', 'SE', 'JP', 'AU'}
# 站点 → 币种 (与看板 CUR_OF 一致)
SITE_CUR = {'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'UK': 'GBP', 'JP': 'JPY', 'AU': 'AUD',
            'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'BE': 'EUR',
            'IE': 'EUR', 'PL': 'PLN', 'SE': 'SEK'}


def _days_in_month(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return calendar.monthrange(y, m)[1]


def site_of(r):
    """规范化站点: 利润报表的 site 字段会漏空(2026-10-10 实测 53 行), 此时用店铺名反推。
    店铺名形如 Aliencell_Direct_DE, 后缀两位即站点码; ua→site 实测一一对应。"""
    s = (r.get('site') or '').strip().upper()
    if s:
        return s
    ua = (r.get('ua') or '').strip().upper()
    m = re.search(r'_([A-Z]{2})$', ua)
    if m and m.group(1) in SITE_CODES:
        return m.group(1)
    return ''


def load_vat_rates():
    """EU/UK 增值税率 (单一配置源; 文件缺失 → 全部按 0 处理, 即不扣 VAT)"""
    try:
        with open(VAT_FILE, 'r', encoding='utf-8') as f:
            r = (json.load(f) or {}).get('rates') or {}
        return {str(k).upper(): float(v or 0) for k, v in r.items()}
    except Exception:
        return {}


def load_fx():
    """月度汇率: rates[ym][cur] = CNY per 1 单位币种 (文件缺失 → 返回空, 换算退化为 1:1 同币种)"""
    try:
        with open(FX_FILE, 'r', encoding='utf-8') as f:
            return (json.load(f) or {}).get('rates') or {}
    except Exception:
        return {}


def fx_rate(fx, ym, cur):
    """CNY per 1 cur; 找不到月份则取最近的可比月份"""
    if not cur or cur == 'CNY':
        return 1.0
    m = fx.get(ym) or {}
    if m.get(cur):
        return float(m[cur])
    best = None
    for k in sorted(fx.keys()):
        if k <= ym and (fx[k] or {}).get(cur):
            best = k
    if not best:
        for k in sorted(fx.keys()):
            if (fx[k] or {}).get(cur):
                best = k
                break
    return float((fx[best] or {})[cur]) if best else 1.0


def load_finance():
    """财务手工录入: otherOrders(其他渠道订单) / reviewFees(测评费用); 文件缺失 → 全空(不影响毛利)"""
    try:
        with open(FIN_FILE, 'r', encoding='utf-8') as f:
            d = json.load(f) or {}
    except Exception:
        return [], []
    oo, rf = [], []
    for x in (d.get('otherOrders') or []):
        try:
            ym = str(x.get('ym') or '').strip()[:7]
            asin = str(x.get('asin') or '').strip().upper()
            qty = float(x.get('qty') or 0)
            if ym and asin and qty > 0:
                oo.append({'ym': ym, 'asin': asin, 'qty': qty, 'note': x.get('note') or ''})
        except Exception:
            pass
    for x in (d.get('reviewFees') or []):
        try:
            ym = str(x.get('ym') or '').strip()[:7]
            site = str(x.get('site') or '').strip().upper()
            asin = str(x.get('asin') or '').strip().upper()
            amt = float(x.get('amount') or 0)
            if ym and site and amt:
                rf.append({'ym': ym, 'site': site, 'asin': asin, 'amount': amt,
                           'cur': str(x.get('cur') or '').strip().upper(), 'note': x.get('note') or ''})
        except Exception:
            pass
    return oo, rf


def _spread(keys, weight, total, ndigits=4):
    """把 total 按 weight 比例摊到 keys; 末尾项做残差修正, 保证合计 == total(消除浮点漂移)"""
    out = {k: 0.0 for k in keys}
    tw = sum(weight.get(k, 0.0) for k in keys)
    if not keys or not total:
        return out
    if tw <= 0:                                    # 退化为均分
        w = {k: 1.0 for k in keys}
        tw = float(len(keys))
    else:
        w = weight
    acc = 0.0
    for i, k in enumerate(keys):
        if i == len(keys) - 1:
            out[k] = round(total - acc, ndigits)
        else:
            v = round(total * w.get(k, 0.0) / tw, ndigits)
            out[k] = v
            acc += v
    return out


def build(base_dir=BASE_DIR, verbose=True, refresh_map=True):
    with open(PROFIT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    days = data.get('days', {})
    months = data.get('months', {})
    site_fees = data.get('siteFees', {}) or {}
    VAT = load_vat_rates()
    fx = load_fx()
    other_orders, review_fees = load_finance()

    # 0) 商品成本解析器 (2026-10-13 用户口径: 成本表匹配, 不从易仓取数)
    CR = None
    cost_src = 'erp-fallback'
    if _CostResolver is None:
        if verbose:
            print('  ⚠️ cost_from_table 不可用, 商品成本暂沿用易仓原值')
    else:
        try:
            CR = _CostResolver(refresh=refresh_map, verbose=verbose)
            cost_src = 'table'
        except Exception as e:
            if verbose:
                print('  ⚠️ 成本表解析器初始化失败(%s), 商品成本暂沿用易仓原值' % str(e)[:80])

    # 1) 月度 FBA 库存费细项: (ym, as, site, ua) -> 该月各项合计
    #    ⚠️ key 必须带月份: 原来只用 (as,site,ua), 同一 SKU 跨月都有仓储时会被相加,
    #       而日行仍按各自月份的天数除 → 列合计是月度值的倍数(2026-10-12 仓储变成实额后暴露)
    # 2026-10-12 第二轮: 由「月仓储+长期仓储」扩为 8 个细项 (入境货运费 fbInb 按用户口径不接出)
    FB_KEYS = ('fbRet', 'fbOth', 'fbOvr', 'fbCon', 'fbCar', 'fbRem', 'fbMst', 'fbLst')
    # 并入「其他费用」的 5 项 (用户: 除仓储费与退货处理费, 其余细项合并入其他费用)
    FB_OTHER = ('fbOth', 'fbOvr', 'fbCon', 'fbCar', 'fbRem')
    month_fb = {}
    for ym, rows in months.items():
        for r in rows:
            k = (ym, r['as'], site_of(r), r['ua'])
            node = month_fb.setdefault(k, {f: 0.0 for f in FB_KEYS})
            for f in FB_KEYS:
                if r.get(f) is not None:
                    node[f] += float(r.get(f) or 0)
            # 旧数据兼容: 没有 fbMst/fbLst 时回退到 mst/lst(同一 ERP 字段, 二者不可同时累加)
            if r.get('fbMst') is None and r.get('fbLst') is None:
                node['fbMst'] += float(r.get('mst') or 0)
                node['fbLst'] += float(r.get('lst') or 0)
    storage_days = {ym: _days_in_month(ym) for ym in months}
    # 日数据里每个 (ym,as,site,ua) 的行数 —— 月仓储按「行数」均摊而不是按「当月天数」,
    # 否则 SKU 只有部分天有行时列合计会小于 ERP 月度值(2026-10-12 仓储变实额后暴露: 少摊 11%)
    storage_rows = {}
    for d in days:
        ym = d[:7]
        for r in (days.get(d) or []):
            k = (ym, r['as'], site_of(r), r['ua'])
            storage_rows[k] = storage_rows.get(k, 0) + 1

    # 2) 站点级(无 ASIN)月度费用 —— 2026-10-12 第二轮起**不进入看板**
    #    实测站点级只有「FBA物流国际货运费(入境)」有值(本期 -2965.61); 用户明确
    #    「不展示, 也不计入毛利」(头程按成本表预估) → 只做审计输出, 不产生任何看板列。
    ignored_site_fees = []
    for ym, sm in sorted(site_fees.items()):
        for site, a in sorted((sm or {}).items()):
            amt = float((a or {}).get('fbTot') or 0)
            if amt:
                ignored_site_fees.append({'ym': ym, 'site': site, 'amount': round(amt, 2),
                                          'inb': round(float((a or {}).get('fbInb') or 0), 2)})

    # 2b) 日期 × 站点 的行索引 (测评费分摊仍按「站点 × 月」定位候选行)
    site_rows = {}
    for d in sorted(days.keys()):
        ym = d[:7]
        for r in (days.get(d) or []):
            site_rows.setdefault((ym, site_of(r)), []).append((d, r))

    # 3) 其他渠道订单剔除: (ym, asin) 导入数量 → 按多渠道销量占比分解到 (ym, asin, site) 组
    #    组内再把「多渠道产品成本+头程+配送费」乘以剔除比例 r, 作为加回额(mcAdj, 正数)
    grp = {}   # (ym, asin, site) -> {mqty, mcost, mhead, mship, rows:[(d,id(r),row)]}
    for d in sorted(days.keys()):
        ym = d[:7]
        for r in (days.get(d) or []):
            if not (r.get('mqty') or r.get('mcost') or r.get('mhead') or r.get('mship')):
                continue
            k = (ym, r['as'], site_of(r))
            g = grp.setdefault(k, {'mqty': 0.0, 'mcost': 0.0, 'mhead': 0.0, 'mship': 0.0, 'rows': []})
            g['mqty'] += float(r.get('mqty') or 0)
            g['mcost'] += float(r.get('mcost') or 0)
            g['mhead'] += float(r.get('mhead') or 0)
            g['mship'] += float(r.get('mship') or 0)
            g['rows'].append((d, id(r), r))

    # 导入数量按 (ym, asin) 汇总, 再按该 asin 当月各站点多渠道销量占比分解
    imp = {}
    for o in other_orders:
        imp[(o['ym'], o['asin'])] = imp.get((o['ym'], o['asin']), 0.0) + o['qty']
    mc_adj, mc_removed = {}, {}
    for (ym, asin), iq in imp.items():
        keys = [k for k in grp if k[0] == ym and k[1] == asin]
        if not keys:
            continue
        tot_mqty = sum(grp[k]['mqty'] for k in keys)
        if tot_mqty <= 0:      # 无多渠道销量记录 → 无法匹配, 跳过
            continue
        take = min(iq, tot_mqty)
        wt = {k: grp[k]['mqty'] for k in keys}
        per = _spread(keys, wt, take, 4)
        for k in keys:
            r = (per[k] / grp[k]['mqty']) if grp[k]['mqty'] else 0.0
            if r <= 0:
                continue
            g = grp[k]
            loss = g['mcost'] + g['mhead'] + g['mship']        # 负数
            add_back = -loss * r                                # 正数
            rk = [(d, rid) for d, rid, _ in g['rows']]
            rw = {kk: -((x.get('mcost') or 0) + (x.get('mhead') or 0) + (x.get('mship') or 0))
                  for kk, (_, _, x) in zip(rk, g['rows'])}
            got = _spread(rk, rw, add_back)
            for kk, v in got.items():
                mc_adj[kk] = mc_adj.get(kk, 0.0) + v
            mc_removed['%s|%s|%s' % (k[0], k[1], k[2])] = {'qty': round(per[k], 4), 'loss': round(-loss * r, 4)}

    # 4) 测评费: (ym, site, asin) → 折成站点币种后按行销量占比摊
    rev_bucket = {}
    for x in review_fees:
        ym, site, asin, amt = x['ym'], x['site'], x['asin'], x['amount']
        cur = x['cur'] or SITE_CUR.get(site, '')
        scur = SITE_CUR.get(site, '')
        v = amt
        if cur and scur and cur != scur:      # 币种折算: amt × (CNY/cur) ÷ (CNY/scur)
            r1, r2 = fx_rate(fx, ym, cur), fx_rate(fx, ym, scur)
            if r1 and r2:
                v = amt * r1 / r2
        rev_bucket.setdefault((ym, site), {}).setdefault(asin, 0.0)
        rev_bucket[(ym, site)][asin] += v
    rev_alloc = {}
    for (ym, site), byasin in rev_bucket.items():
        for asin, amt in byasin.items():
            cand = [(d, id(r), r) for d, r in site_rows.get((ym, site), []) if (asin == '' or r['as'] == asin)]
            if not cand:
                continue
            keys = [(d, rid) for d, rid, _ in cand]
            wt = {k: float(r.get('qty') or 0) for k, (_, _, r) in zip(keys, cand)}
            got = _spread(keys, wt, amt)
            for kk, v in got.items():
                rev_alloc[kk] = rev_alloc.get(kk, 0.0) + v

    # 5) 逐日行 enriched
    out_rows = []
    miss_cnt = 0
    for d in sorted(days.keys()):
        rows = days.get(d) or []
        if not rows:
            continue
        ym = d[:7]
        div = storage_days.get(ym) or _days_in_month(ym)        # 其他费用按 日期×国家 均摊 (站点先规范化, 空站点行并入其真实国家一起摊)
        site_rows_by_site = {}
        for r in rows:
            site_rows_by_site.setdefault(site_of(r), []).append(r)
        site_other = {}
        for site, rs in site_rows_by_site.items():
            total = sum((r.get('psvc') or 0) + (r.get('svc') or 0) for r in rs)
            n = len(rs)
            site_other[site] = (total / n) if n else 0.0
        for r in rows:
            site = site_of(r)
            k = (ym, r['as'], site, r['ua'])
            nrow = storage_rows.get(k) or 1
            node = month_fb.get(k) or {}
            # 8 细项按「该 key 的日行数」均摊 (列合计 == ERP 月度值)
            fb = {f: round((node.get(f, 0.0) / nrow), 4) for f in FB_KEYS}
            st = fb['fbMst'] + fb['fbLst']                     # 仓储列 = 月仓租 + 长期仓租
            other = site_other[site] + sum(fb[f] for f in FB_OTHER)   # 5 项细项并入其他费用
            # ---- 商品成本 (2026-10-13 用户口径): 成本表 costRMB × 件数 ÷ 当月汇率 ----
            #   件数 = qty + mqty; 站点币种取行的 cur, 缺失时用站点推断(利润报表 site/cur 都会漏空)
            row_cur = (r.get('cur') or SITE_CUR.get(site) or '').strip().upper()
            units = float(r.get('qty') or 0) + float(r.get('mqty') or 0)
            if CR is not None:
                if row_cur:
                    cost, cost_miss = CR.amount(r['as'], units, fx_rate(fx, ym, row_cur))
                else:                      # 币种不明 ⇒ 不折算(否则 RMB 当成站点币种), 记缺失
                    cost, cost_miss = 0.0, units > 0
            else:                          # 降级: 沿用易仓原值(仅当解析器不可用时)
                cost = float(r.get('cost') or 0)
                cost_miss = units > 0 and cost == 0
            miss = 1 if cost_miss else 0
            if miss:
                miss_cnt += 1
            # VAT (EU/UK): 基数 = 销售额 + 促销折扣(促销为负) = 销售价 − 优惠价
            rate = VAT.get(site) or 0.0
            vat = round((float(r.get('sales') or 0) + float(r.get('promo') or 0)) * rate, 2) if rate else 0.0
            rk = (d, id(r))
            out_rows.append({
                'd': d, 'site': site, 'as': r['as'], 'ua': r['ua'], 'cur': r['cur'],
                'qty': r.get('qty') or 0,
                'sales': round(r.get('sales') or 0, 2),
                'promo': round(r.get('promo') or 0, 2),
                'comm': round(r.get('comm') or 0, 2),
                'fba': round(r.get('fba') or 0, 2),
                'cost': round(cost, 2),                        # 商品成本: 成本表口径(唯一入账值)
                'costErp': round(r.get('cost') or 0, 2),       # 易仓原值: 仅供审计
                'storage': round(st, 4),
                'other': round(other, 4),
                'vat': vat,
                'miss': miss,
                'gross': round(r.get('gross') or 0, 2),
                # ---- 2026-10-12 第一轮: 多渠道 + 其他渠道剔除 + 测评费 ----
                'mqty': r.get('mqty') or 0,
                'mcost': round(r.get('mcost') or 0, 2),
                'mhead': round(r.get('mhead') or 0, 2),
                'mship': round(r.get('mship') or 0, 2),
                'mcAdj': round(mc_adj.get(rk, 0.0), 4),
                'review': round(rev_alloc.get(rk, 0.0), 4),
                # ---- 2026-10-12 第二轮: FBA 库存费 8 细项 (入境货运费按用户口径不接出) ----
                'fbRet': fb['fbRet'], 'fbOth': fb['fbOth'], 'fbOvr': fb['fbOvr'],
                'fbCon': fb['fbCon'], 'fbCar': fb['fbCar'], 'fbRem': fb['fbRem'],
                'fbMst': fb['fbMst'], 'fbLst': fb['fbLst'],
                # ---- 2026-10-12 第二轮: 退款 (日粒度直接透传, 不摊) ----
                'refSales': round(r.get('refSales') or 0, 2),
                'refPromo': round(r.get('refPromo') or 0, 2),
                'refComm': round(r.get('refComm') or 0, 2),
                'refFba': round(r.get('refFba') or 0, 2),
                'refShip': round(r.get('refShip') or 0, 2),
                'refQty': r.get('refQty') or 0,
            })

    payload = {
        'generatedAt': data.get('generatedAt', ''),
        'through': data.get('through', ''),
        'note': '毛利=销售额+促销折扣+销售佣金+配送费+商品成本+仓储分摊+其他费用分摊'
                '+FBA退货处理费+退款(商品/买家运费/促销折扣/销售佣金/配送费)+其他渠道剔除加回'
                '-广告费(看板)-VAT(EU/UK)-头程(成本表预估)-测评费; '
                '★商品成本=产品成本表 costRMB×件数÷当月汇率, ASIN→产品名走「产品关系管理」'
                '(不取易仓 productCostTotal, 原值仅存于 costErp 供审计; 未匹配则 cost=0 且 miss=1); '
                'VAT=(销售额+促销折扣)×vat_rates.json 税率; '
                '其他费用=推广服务费+服务费(按日期×国家产品行数均摊)+其他FBA库存和入境服务费/超量费/合仓费/合作承运费/移除费用 5 项分摊; '
                'FBA 库存费 8 细项按(月,ASIN,站点,店铺)日行数均摊(列合计=ERP月度值); 仓储列=月仓租+长期仓租; '
                '头程=成本表headRMB×销量÷汇率(预估值, 由看板侧计算); '
                'FBA物流国际货运费(入境)按用户 2026-10-12 口径不展示也不计入毛利(见 ignoredSiteFees); '
                '多渠道产品成本/头程/配送费已随商品成本按件数计入, 单独列示的 mcost 为易仓原值(仅审计); '
                '其他渠道订单按(月,ASIN)匹配多渠道记录, 按数量比例剔除该部分成本; '
                '退款率=退款数量÷销量(由看板侧计算); 不含税费/其他交易费; 原币种',
        'costSource': cost_src,
        'skipRows': 0,
        'ignoredSiteFees': ignored_site_fees,
        'mcRemoved': mc_removed,
        'financeInputs': {
            'otherOrders': len(other_orders),
            'otherOrdersQty': round(sum(o['qty'] for o in other_orders), 2),
            'reviewFees': len(review_fees),
            'reviewFeesAmt': round(sum(x['amount'] for x in review_fees), 2),
        },
        'rows': out_rows,
    }
    if verbose:
        n_days = len({r['d'] for r in out_rows})
        tot_sales = sum(r['sales'] for r in out_rows)
        tot_gross = sum(r['gross'] for r in out_rows)
        tot_vat = sum(r['vat'] for r in out_rows)
        n_vat = len({r['site'] for r in out_rows if r['vat']})
        tot_mqty = sum(r['mqty'] for r in out_rows)
        tot_mloss = -sum(r['mcost'] + r['mhead'] + r['mship'] for r in out_rows)
        tot_adj = sum(r['mcAdj'] for r in out_rows)
        tot_rev = sum(r['review'] for r in out_rows)
        tot_ret = sum(r['fbRet'] for r in out_rows)
        tot_mst = sum(r['fbMst'] for r in out_rows)
        tot_lst = sum(r['fbLst'] for r in out_rows)
        tot_fbo = sum(sum(r[f] for f in FB_OTHER) for r in out_rows)
        tot_refs = sum(r['refSales'] + r['refShip'] + r['refPromo'] + r['refComm'] + r['refFba'] for r in out_rows)
        tot_refq = sum(r['refQty'] for r in out_rows)
        print('毛利指标: %d 行 · %d 天 · 销售额 %.2f(原币种混合) · ERP毛利 %.2f · VAT %.2f(%d 个站点) · 成本未匹配行 %d' % (
            len(out_rows), n_days, tot_sales, tot_gross, tot_vat, n_vat, miss_cnt))
        tot_cost = sum(r['cost'] for r in out_rows)
        tot_coste = sum(r['costErp'] for r in out_rows)
        print('  商品成本(成本表口径) %.2f · 易仓原值 %.2f · 差 %+.2f · 来源=%s' % (
            tot_cost, tot_coste, tot_cost - tot_coste, cost_src))
        print('  多渠道 %g 台/损失 %.2f · 已剔除 %.2f (%d 组) · 测评费 %.2f' % (
            tot_mqty, tot_mloss, tot_adj, len(mc_removed), tot_rev))
        print('  FBA库存费细项(月): 退货处理 %.2f · 月仓租 %.2f · 长期仓租 %.2f · 并入其他费用(5项) %.2f' % (
            tot_ret, tot_mst, tot_lst, tot_fbo))
        print('  退款: 净额 %.2f (商品/运费/促销/佣金/配送 已按 ERP 符号合计) · 退款件数 %g' % (tot_refs, tot_refq))
        if ignored_site_fees:
            print('  ⓘ 站点级费用(按用户口径不展示不计入毛利):',
                  ', '.join('%s %s %.2f' % (x['ym'], x['site'], x['amount']) for x in ignored_site_fees))
    return payload


if __name__ == '__main__':
    import sys
    _argv = sys.argv[1:]
    if '--force-map' in _argv and _CostResolver is not None:
        from cost_from_table import refresh_map as _rm
        _rm(verbose=True, force=True)
    p = build(refresh_map=('--offline' not in _argv))
    out = os.path.join(BASE_DIR, 'profit_metrics.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(p, f, ensure_ascii=False, separators=(',', ':'))
    print('已写', out, os.path.getsize(out), 'bytes')
