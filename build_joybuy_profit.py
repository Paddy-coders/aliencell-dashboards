#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_joybuy_profit.py — JoyBuy 利润模型（用户 2026-10-12 定的口径）

利润结构（用户原话）：
    货款 − 佣金 − 交易服务费 − 广告返点 − 增值税费 − 退款 + 退回佣金 − 退货服务费

物流费单独按承运商口径：
    承运商 = Amazon Logistics → 按 MCF 费用结算
    其它承运商            → 按成本表「海外仓尾程配送」结算

数据源：
    joybuy_orders.json        订单 + 承运商（开放平台 sp-order/v0 + waybill-traces）
    joybuy_bills.json         费项（商家后台账单明细，fetch_joybuy_bills.js）
    joybuy_sku_map.json       JoyBuy skuId → series/name/bundle
    product_cost_table.json   产品成本 / 头程(RMB) / 海外仓尾程(当地币)
    joybuy_cost_config.json   SKU→成本表产品名映射 + MCF 费率
    fx_rates.json             CNY per 1 当地币（逐月）

输出：joybuy_profit.json
"""
import json
import os
import re
import sys
import collections
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(BASE, *a)
for enc in (sys.stdout, sys.stderr):
    try:
        enc.reconfigure(encoding='utf-8')
    except Exception:
        pass


def load(name, default=None):
    p = P(name)
    if not os.path.exists(p):
        if default is None:
            raise SystemExit('缺少输入文件：%s' % name)
        return default
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    orders_f = load('joybuy_orders.json')
    bills = load('joybuy_bills.json')
    # 2026-10-21: 成本表已上云(mapping.data.costTable) —— 云端优先, 本地文件兜底
    from cost_from_table import cost_table_doc
    cost_tbl = cost_table_doc(verbose=True)
    sku_map = load('joybuy_sku_map.json', {})
    cfg = load('joybuy_cost_config.json')
    fx = load('fx_rates.json')
    rates = fx.get('rates') or {}
    fx_meta = {k: v for k, v in fx.items() if k != 'rates'}

    products = cost_tbl.get('products') or {}
    region_of = cfg.get('region') or {}
    cur_of = cfg.get('currencyOf') or {}
    fee_map = {k: v for k, v in (cfg.get('feeNameMap') or {}).items() if not k.startswith('_')}
    pats = {k: re.compile(v, re.I) for k, v in (cfg.get('feeNamePatterns') or {}).items() if not k.startswith('_')}
    mcf_cfg = (cfg.get('logistics') or {}).get('mcfFee') or {}
    country_of = {k: v for k, v in (cfg.get('countryOf') or {}).items() if not k.startswith('_')}
    overrides = {k: v for k, v in (cfg.get('skuOverrides') or {}).items() if not k.startswith('_')}

    # ---- MCF 询价器（官方费率卡 + 产品包装尺寸自动匹配分段）----
    # 拿不到费率卡时不静默按 0：MCF 行会记 null 并进 missingMcf，由测试打印提醒。
    pricer = None
    pricer_err = None
    if (mcf_cfg.get('source') or 'rateCard') == 'rateCard':
        try:
            import mcf_fee
            pricer = mcf_fee.McfPricer(
                card_file=P(mcf_cfg.get('rateCardFile') or 'mcf_rate_card.json'),
                dims_file=P(mcf_cfg.get('dimsFile') or 'product_dims.json'))
        except Exception as e:                      # 缺文件 / 解析失败都要看得见
            pricer_err = '%s: %s' % (type(e).__name__, e)
            print('⚠️ MCF 费率卡加载失败，MCF 行将记 null：%s' % pricer_err)

    # ---- skuId → series/name/bundle ----
    sku_meta = {}
    for m in sku_map.get('skuMap') or []:
        sku_meta[str(m.get('skuId'))] = {'series': m.get('series') or '', 'name': m.get('name') or '',
                                         'bundle': m.get('bundle') or ''}
    rules = ((cfg.get('costTableProductRules') or {}).get('rules') or [])

    def product_of(sku_id, sku_name=''):
        if sku_id in overrides:
            return overrides[sku_id], 'override'
        meta = sku_meta.get(sku_id)
        if not meta:
            return None, 'no-sku-map'
        for r in rules:
            mt = r.get('match') or {}
            if all(re.search(re.escape(v), str(meta.get(k) or ''), re.I) for k, v in mt.items()):
                return r.get('product'), 'rule'
        return None, 'no-rule'

    # ---- 汇率（CNY per 1 当地币）----
    def cny_per(cur, ym):
        r = rates.get(ym) or {}
        v = r.get(cur)
        if v:
            return float(v)
        # 回退：最近一个月有该币种
        for k in sorted(rates, reverse=True):
            if (rates[k] or {}).get(cur):
                return float(rates[k][cur])
        return None

    # ---- 把费项按订单归集 ----
    by_order = collections.defaultdict(lambda: collections.defaultdict(float))
    other_fees = []
    for it in bills.get('items') or []:
        name = it.get('feeName') or ''
        amt = float(it.get('bal') or 0)
        sign = 1.0 if int(it.get('direction') or 0) == 1 else -1.0
        field = fee_map.get(name)
        if field is None:
            field = None
            for pat_name, rx in pats.items():
                if rx.search(name):
                    field = pat_name
                    break
        if field is None:
            other_fees.append(it)
            field = 'otherFees'
        by_order[it.get('orderId')][field] += sign * amt

    # ---- 订单 / 物流 / 成本 ----
    FIELDS = ['goods', 'commission', 'txnFee', 'adsCredit', 'vat',
              'refund', 'refundCommission', 'returnServiceFee', 'joybuyLogistics', 'otherFees']
    rows = []
    missing_mcf = []
    over_range = []
    upo_approx = []
    unknown_product = []
    for o in orders_f.get('orders') or []:
        site = o.get('site')
        oid = str(o.get('orderId'))
        region = region_of.get(site) or 'EU'
        cur = o.get('currency') or cur_of.get(site) or 'EUR'
        units = int(o.get('units') or 0)
        fees = by_order.get(oid) or {}
        rec = {k: round(float(fees.get(k) or 0.0), 4) for k in FIELDS}
        # 平台毛利 = 货款 - 佣金 - 交易服务费 - 广告返点 - 增值税 - 退款 + 退回佣金 - 退货服务费
        platform = (rec['goods'] + rec['commission'] + rec['txnFee'] + rec['adsCredit'] + rec['vat']
                    + rec['refund'] + rec['refundCommission'] + rec['returnServiceFee']
                    + rec['joybuyLogistics'] + rec['otherFees'])
        rec['platformProfit'] = round(platform, 4)

        # 物流费
        basis = o.get('logisticsBasis') or 'UNKNOWN'
        logistics = None
        logistics_src = None
        mcf_detail = []
        if basis == 'MCF':
            country = country_of.get(site) or str(site or '').split('-')[0].upper()
            manual = mcf_cfg.get('default')
            per = (mcf_cfg.get('bySku') or {})
            items = o.get('items') or []
            for it in items:
                key = str(it.get('skuId') or it.get('outerSkuId') or '')
                if key and per.get(key) is not None:
                    manual = per[key]
                    break
            if manual is not None:
                # 手动单价覆盖（用于对账官方实际扣费 / 官方费率卡未覆盖的场景）
                n = max(units, 1)
                logistics = round(float(manual) * n, 4)
                logistics_src = 'MCF(手动单价 %s × %d 件)' % (manual, n)
            elif pricer is None:
                logistics = None
                logistics_src = 'MCF(费率卡不可用)'
                missing_mcf.append({'orderId': oid, 'site': site, 'country': country,
                                    'units': units, 'why': '费率卡加载失败：%s' % pricer_err,
                                    'skuIds': [str(i.get('skuId')) for i in items]})
            else:
                tot, ok = 0.0, True
                for it in items:
                    sku = str(it.get('skuId') or '')
                    num = int(it.get('num') or 0)
                    prod, m_src = product_of(sku)
                    dd = pricer.dims_of(prod) if prod else None
                    if not dd:
                        ok = False
                        mcf_detail.append({'skuId': sku, 'num': num, 'product': prod,
                                           'why': '无包装尺寸（产品「%s」不在尺寸表；mapsrc=%s）' % (prod, m_src),
                                           'fee': None})
                        continue
                    q = pricer.quote(country, dd[0], dd[1], upo=max(units, 1))
                    if q.get('upoWarning'):
                        upo_approx.append({'orderId': oid, 'site': site, 'upo': q['upo'],
                                           'why': q['upoWarning']})
                    mcf_detail.append({
                        'skuId': sku, 'num': num, 'product': prod,
                        'dimsCm': dd[0], 'weightKg': dd[1],
                        'tier': q['tier'], 'tierLabel': q['tierLabel'], 'bandG': q['bandG'],
                        'shipWG': None if q['shipWG'] is None else round(q['shipWG'], 1),
                        'base': q['base'], 'cur': q['cur'], 'fee': q['fee'],
                        'upo': q['upo'], 'upoWarning': q['upoWarning'],
                        'over': q['over'], 'src': q['src'], 'why': q['error']})
                    if q['fee'] is None:
                        ok = False
                    else:
                        tot += q['fee'] * num
                        if q['over']:
                            over_range.append({'orderId': oid, 'skuId': sku, 'product': prod,
                                               'dimsCm': dd[0], 'weightKg': dd[1], 'why': q['error']})
                logistics = round(tot, 4) if ok else None
                logistics_src = ('MCF(费率卡 %s · %s站%s · 按包装尺寸匹配分段)'
                                 % (pricer.effective, country,
                                    '' if ok else ' ⚠️部分行算不出'))
                if not ok:
                    missing_mcf.append({'orderId': oid, 'site': site, 'country': country,
                                        'units': units, 'skuIds': [str(i.get('skuId')) for i in items],
                                        'why': '部分 SKU 缺尺寸或判不出分段，整单记 null（不静默低估）',
                                        'detail': mcf_detail})
        elif basis == 'LASTMILE':
            tot = 0.0
            ok = False
            for it in o.get('items') or []:
                sku = str(it.get('skuId') or '')
                prod, src = product_of(sku)
                p = products.get(prod) if prod else None
                tail = ((p or {}).get('tailLocal') or {}).get(region)
                if tail is None:
                    unknown_product.append({'orderId': oid, 'skuId': sku, 'product': prod, 'why': src})
                else:
                    tot += float(tail) * int(it.get('num') or 0)
                    ok = True
            logistics = round(tot, 4) if ok else None
            logistics_src = 'LASTMILE(成本表尾程)'

        # 产品成本 / 头程（RMB）
        cost_rmb = head_rmb = 0.0
        cost_known = False
        for it in o.get('items') or []:
            sku = str(it.get('skuId') or '')
            n = int(it.get('num') or 0)
            prod, src = product_of(sku)
            p = products.get(prod) if prod else None
            if not p:
                unknown_product.append({'orderId': oid, 'skuId': sku, 'product': prod, 'why': src})
                continue
            cost_known = True
            cost_rmb += float(p.get('costRMB') or 0) * n
            head_rmb += float((p.get('headRMB') or {}).get(region) or 0) * n
        ym = None
        for t in [o.get('createdAt'), o.get('outboundAt'), o.get('finishedAt')]:
            if t:
                ym = datetime.fromtimestamp(t / 1000, timezone.utc).strftime('%Y-%m')
                break
        rate = cny_per(cur, ym) if ym else None

        # ⚠️ 只有「真的产生过账单」的订单才计成本与毛利。
        #    已取消/未支付订单（无货款、无任何费项）**不能**扣产品成本 —— 否则
        #    FR 那笔取消的 X1 会把 648 EUR 成本计进去，把月度毛利压成负的（实测踩过）。
        settled = (rec['goods'] != 0) or any(rec[f] != 0 for f in FIELDS)
        cost_local = round(cost_rmb / rate, 4) if (settled and rate and cost_known) else (0.0 if settled and cost_known else None)
        head_local = round(head_rmb / rate, 4) if (settled and rate and cost_known) else (0.0 if settled and cost_known else None)
        if not settled:
            cost_local = None
            head_local = None

        gross = None
        if settled and platform is not None and logistics is not None and cost_local is not None:
            gross = round(platform - logistics - cost_local - head_local, 4)
        rows.append({
            'orderId': oid, 'site': site, 'region': region, 'currency': cur, 'ym': ym,
            'status': o.get('status'), 'createdAt': o.get('createdAt'), 'settled': settled,
            'orphanFee': False,
            'carrierNames': o.get('carrierNames') or [],
            'logisticsBasis': basis,
            'logisticsFee': logistics, 'logisticsSource': logistics_src,
            'logisticsDetail': mcf_detail,
            'units': units,
            'skuIds': [str(i.get('skuId') or '') for i in (o.get('items') or [])],
            **rec,
            'costRMB': round(cost_rmb, 2), 'headRMB': round(head_rmb, 2),
            'fxCnyPerLocal': rate,
            'costLocal': cost_local, 'headLocal': head_local,
            'grossProfit': gross
        })

    # ---- 补：账单里有、订单列表里没有的行（孤儿费项，如平台单号 21xxxxxxxx 的海外物流仓储费）----
    order_ids = {str(o.get('orderId')) for o in (orders_f.get('orders') or [])}
    bill_meta = {}
    for it in bills.get('items') or []:
        oid = it.get('orderId')
        if oid in order_ids:
            continue
        b = bill_meta.setdefault(oid, {'site': it.get('site'), 'currency': it.get('currency'),
                                       'happen': it.get('happenTime'), 'ym': None})
        if it.get('happenTime') and not b['ym']:
            b['ym'] = datetime.fromtimestamp(it['happenTime'] / 1000, timezone.utc).strftime('%Y-%m')
    orphan_ids = list(bill_meta)
    for oid in orphan_ids:
        b = bill_meta[oid]
        fees = by_order.get(oid) or {}
        rec = {k: round(float(fees.get(k) or 0.0), 4) for k in FIELDS}
        platform = round(sum(rec.values()), 4)
        rows.append({
            'orderId': oid, 'site': b['site'], 'region': region_of.get(b['site']) or 'EU',
            'currency': b['currency'], 'ym': b['ym'], 'status': 'BILL_ONLY',
            'createdAt': b['happen'], 'settled': True, 'orphanFee': True,
            'carrierNames': [], 'logisticsBasis': 'N/A',
            'logisticsFee': None, 'logisticsSource': 'N/A（非平台发货单，无承运商）',
            'logisticsDetail': [],
            'units': 0, 'skuIds': [],
            **rec,
            'platformProfit': platform,
            'costRMB': 0.0, 'headRMB': 0.0, 'fxCnyPerLocal': cny_per(b['currency'], b['ym']),
            'costLocal': None, 'headLocal': None,
            'grossProfit': platform if platform else None
        })

    # ---- 月度 × 站点汇总 ----
    mon = collections.defaultdict(lambda: dict({k: 0.0 for k in FIELDS}, **{
        'platformProfit': 0.0, 'logisticsFee': 0.0, 'costLocal': 0.0, 'headLocal': 0.0,
        'grossProfit': 0.0, 'units': 0.0, 'orders': 0.0}))
    for r in rows:
        if not r.get('settled') and not r.get('orphanFee'):
            continue
        k = (r['ym'], r['site'], r['currency'])
        if k[0] is None:
            continue
        m = mon[k]
        for f in FIELDS:
            m[f] += r[f]
        m['platformProfit'] += r['platformProfit']
        m['units'] += r['units']
        m['orders'] += 1
        if r['logisticsFee'] is not None:
            m['logisticsFee'] += r['logisticsFee']
        if r['costLocal'] is not None:
            m['costLocal'] += r['costLocal']
        if r['headLocal'] is not None:
            m['headLocal'] += r['headLocal']
        if r['grossProfit'] is not None:
            m['grossProfit'] += r['grossProfit']
    months = []
    for (ym, site, cur) in sorted([k for k in mon if k[0]]):
        m = {kk: round(vv, 4) for kk, vv in mon[(ym, site, cur)].items()}
        months.append(dict(ym=ym, site=site, currency=cur, **m))

    # ---- 自检 ----
    # UPO 探针：费率卡只有 1 UPO 价，多件订单必须被标记（构造 2 件验证，不依赖当期是否有 2 件单）
    upo_probe = None
    if pricer is not None:
        for r0 in rows:
            if r0.get('logisticsBasis') != 'MCF':
                continue
            for d0 in (r0.get('logisticsDetail') or []):
                if not d0.get('dimsCm'):
                    continue
                co0 = (country_of.get(r0['site']) or r0['site'].split('-')[0])
                q2 = pricer.quote(co0, d0['dimsCm'], d0['weightKg'], upo=2)
                upo_probe = {'country': co0, 'product': d0['product'],
                             'upo2Warning': q2.get('upoWarning')}
                break
            if upo_probe:
                break
    vocab = sorted((bills.get('selfCheck') or {}).get('byFee', {}).keys())
    sc = {
        'ordersWithBills': len(rows),
        'settledOrders': sum(1 for r in rows if r.get('settled')),
        'orphanFeeRows': sum(1 for r in rows if r.get('orphanFee')),
        'ordersWithPayment': sum(1 for r in rows if r['goods']),
        'feeVocabulary': vocab,
        'unmappedFeeNames': sorted({(i.get('feeName') or '') for i in other_fees}),
        'otherFeeRows': len(other_fees),
        'platformProfitTotalByCurrency': {c: round(sum(r['platformProfit'] for r in rows if r['currency'] == c), 2)
                                          for c in sorted({r['currency'] for r in rows})},
        'missingMcf': missing_mcf,
        'mcfOverRange': over_range,
        'mcfUpoApprox': upo_approx,
        'mcfUpoProbe': upo_probe,
        'unknownProduct': unknown_product[:10],
        'byBasis': dict(collections.Counter(r['logisticsBasis'] for r in rows)),
        'mcfRateCard': None if pricer is None else {
            'effective': pricer.effective,
            'fuelPct': pricer.fuel_pct,
            'fuelPctSource': pricer.fuel_pct_source,
            'productsWithDims': len(pricer.dims),
            'source': (mcf_cfg.get('rateCardFile') or 'mcf_rate_card.json'),
        },
        'mcfPricerError': pricer_err,
    }
    payload = {
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'formula': '货款 − 佣金 − 交易服务费 − 广告返点 − 增值税费 − 退款 + 退回佣金 − 退货服务费',
        'logisticsRule': ('承运商=Amazon Logistics → MCF 官方费率卡按包装尺寸匹配分段（德国仓发货，'
                          '按目的地国家取列，含燃油 1.5%）；其它 → 成本表「海外仓尾程配送」'),
        'platformProfitFormula': 'goods + commission + txnFee + adsCredit + vat + refund + refundCommission + returnServiceFee + joybuyLogistics + otherFees',
        'grossProfitFormula': 'platformProfit − logisticsFee − costLocal − headLocal',
        'mcfRule': ('MCF 尾程费 = 官方费率卡（EU 生效 %s / UK 本国卡）× 尺寸分段；'
                    '计费重 = max(毛重, 长×宽×高÷5000)；发货仓固定德国仓 → DE 取本国列、'
                    'NL 取 ZONE1、FR 取 ZONE2、ES 取 ZONE3、UK 取英国列；含燃油附加 %s%%；'
                    '费率口径 = 1 UPO（每单 1 件），多件订单按 1 UPO 估算会偏高'
                    % (None if pricer is None else pricer.effective,
                       None if pricer is None else pricer.fuel_pct)),
        'platformProfitFormula': 'goods + commission + txnFee + adsCredit + vat + refund + refundCommission + returnServiceFee + joybuyLogistics + otherFees',
        'grossProfitFormula': 'platformProfit − logisticsFee − costLocal − headLocal',
        'fx': fx_meta,
        'orders': rows,
        'months': months,
        'selfCheck': sc
    }
    out = P('joybuy_profit.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print('已写出 %s（%d 单 / %d 月度行）' % (os.path.basename(out), len(rows), len(months)))
    print('费项词表：' + ' | '.join(vocab))
    if sc['unmappedFeeNames']:
        print('⚠️ 未映射费项：' + ', '.join(sc['unmappedFeeNames']))
    print('平台毛利合计（当地币）：' + json.dumps(sc['platformProfitTotalByCurrency'], ensure_ascii=False))
    if missing_mcf:
        print('⚠️ MCF 记 null 的单 %d 条：%s' % (len(missing_mcf), missing_mcf[0].get('why') or missing_mcf[0]))
    if over_range:
        print('⚠️ 超出 MCF 费率卡范围（按最大档兜底）%d 条：%s' % (len(over_range), over_range[0]['why']))
    if upo_approx:
        print('⚠️ MCF 多件订单（费率卡只有 1 UPO，估值偏高）%d 条' % len(upo_approx))
    if sc['unknownProduct']:
        print('⚠️ 未匹配成本表产品 %d 条，例：%s' % (len(sc['unknownProduct']), sc['unknownProduct'][0]))
    print('物流口径分布：' + json.dumps(sc['byBasis'], ensure_ascii=False))


if __name__ == '__main__':
    main()
