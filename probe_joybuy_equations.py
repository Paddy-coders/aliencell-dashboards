# -*- coding: utf-8 -*-
"""
JoyBuy Data Compass 采集口径三等式自检（只读探针）

等式：
  ① Σ(SKU 订单)  == 交易汇总订单   (Σ skuDetail.popOrders      vs Σ transactionTrend.currentData.popOrders)
  ② Σ(SKU GMV)   == 交易汇总 GMV   (Σ skuDetail.popGmv         vs Σ transactionTrend.currentData.popGmv)
  ③ Σ(关键词 UV) ÷ Σ(站点 PDP UV) ∈ [20%, 40%]   (长尾截断的合理区间)
      分子 = Σ searchTerms.data[].popKeywordPdpUv
      分母 = Σ trafficTrend.currentData[].popPdpUv
      —— 越过上界说明关键词重复计数；过低说明截断过狠或关键词接口漏数。

【关键口径坑（2026-09-28 定位）】
  trafficSummary / transactionSummary 是**最新一天的快照**，不是窗口汇总！
  证据：四站的 trafficSummary.popPdpUv 分别等于各自 trafficTrend 最后一行（末日）的 popPdpUv
        （UK 17==17 / DE 11==11 / NL 23==23 / FR 18==18）。
  因此「窗口内交易汇总」必须取 **transactionTrend.currentData 的逐日累加**；
  误用 transactionSummary 会得到「ΣSKU=1803.89 vs 交易汇总=0」这种假告警。
  同理 Σ(站点 PDP UV) 必须用 trafficTrend 累加，而不是 summary 的单日值。

用法: python probe_joybuy_equations.py [--json joybuy_compass_data.json]
退出码: 0 = 全部通过；1 = 有等式越界（需判读）
"""
import json
import os
import sys

SRC = 'joybuy_compass_data.json'
if '--json' in sys.argv:
    SRC = sys.argv[sys.argv.index('--json') + 1]

LO, HI = 0.20, 0.40


def num(v):
    return v if isinstance(v, (int, float)) else 0


def total(rows, key):
    return sum(num(r.get(key)) for r in rows)


def main():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), SRC)
    d = json.load(open(path, encoding='utf-8'))
    print(f"来源: {SRC}  采集于 {d.get('fetchedAt')}  窗口 {d['range']['startDate']} ~ {d['range']['endDate']}")
    print('=' * 78)
    bad = 0
    for shop, s in d['shops'].items():
        cur = s.get('currency') or ''
        tx_rows = (s.get('transactionTrend') or {}).get('currentData') or []
        tr_rows = (s.get('trafficTrend') or {}).get('currentData') or []
        rows = (s.get('skuDetail') or {}).get('data') or []
        kw_rows = (s.get('searchTerms') or {}).get('data') or []

        s_ord, s_gmv = total(rows, 'popOrders'), total(rows, 'popGmv')
        t_ord, t_gmv = total(tx_rows, 'popOrders'), total(tx_rows, 'popGmv')
        kw_uv, pdp_uv = total(kw_rows, 'popKeywordPdpUv'), total(tr_rows, 'popPdpUv')
        ratio = (kw_uv / pdp_uv) if pdp_uv else None

        ok1 = abs(s_ord - t_ord) < 1e-6
        ok2 = abs(s_gmv - t_gmv) < 1e-2
        ok3 = ratio is not None and LO <= ratio <= HI
        if not (ok1 and ok2 and ok3):
            bad += 1

        print(f"[{shop}]  窗口 {len(tx_rows)}/{len(tr_rows)} 天  "
              f"SKU 明细 {len(rows)} 行 / 关键词 {len(kw_rows)} 条 / 币种 {cur}")
        print(f"  ① 订单   ΣSKU={s_ord:.0f}  vs  Σ趋势={t_ord:.0f}          "
              f"{'✓' if ok1 else '✗ 偏离 %+.2f' % (s_ord - t_ord)}")
        print(f"  ② GMV    ΣSKU={s_gmv:.2f}  vs  Σ趋势={t_gmv:.2f}   "
              f"{'✓' if ok2 else '✗ 偏离 %+.2f' % (s_gmv - t_gmv)}")
        if ratio is None:
            print('  ③ 关键词UV ÷ 站点PDPUV = 站点 PDP UV 为 0，无法判定 ✗')
        else:
            print(f"  ③ 关键词UV {kw_uv:.0f} ÷ 站点PDPUV {pdp_uv:.0f} = {ratio * 100:.1f}%   "
                  f"(合理区间 {LO * 100:.0f}%~{HI * 100:.0f}%)  {'✓' if ok3 else '✗'}")
        print()

    print('=' * 78)
    print(f"结论: {'全部通过' if bad == 0 else str(bad) + ' 个站点存在越界项，需人工判读'}")
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
