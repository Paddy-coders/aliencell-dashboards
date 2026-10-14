"""Amazon MCF（Multi-Channel Fulfilment）尾程费计算 —— JoyBuy 侧调用

口径来源：`mcf_rate_card.json`（由 `gen_mcf_rate_card.js` 从利润计算器
          `profit-calculator.html` 的 MCF_RATES 提取，那份又是从官方费率卡
          MCF-EU-2026.pdf / MCF-UK.pdf 提取并带自检生成的）。
尺寸来源：`product_dims.json`（产品包装尺寸/毛重，从计算器成本表解密抽取）。

本模块是**计算器 mcfFee() 的 Python 等价实现**，规则逐条对齐：
  · 分段顺序 = tierDefs 顺序，从最小到最大找第一个「长/中/短边 + 单位重 + 体积重」全满足的档
  · 计费重 = max(单位重, 体积重)；欧洲体积重 = 长×宽×高(cm) ÷ 5000 × 1000（g）
  · 含燃油附加（欧英 1.5%）；官方费率卡本身**不含**燃油
  · 发货仓口径（业务确认）：欧陆统一德国仓 → DE 站取「德国本国列」，
    NL → 德国卡 ZONE 1、FR → ZONE 2、ES → ZONE 3、UK → 英国本国列
  · 超出费率卡所有档位 → 标 over（宁高不低），不静默当成小档
  · 官方费率卡未列示的档位 → 标 missing，由调用方决定「不可用」而不是套用小档

⚠️ 与计算器的一处**有意差异**：计算器的 classifyTier() 里有一段「官方特殊大件（EU_SPECIAL）」
   判定 —— 那是 FBA 13 分段表的门槛。MCF 的 EU 卡只有 6 个分段、且没有 special_os 档，
   所以这里不做 special 判定，超范围一律走 over 兜底（与计算器 mcfEuTiers 无 special 档一致）。
"""

import json
import os
from typing import Dict, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
CARD_FILE = os.path.join(HERE, 'mcf_rate_card.json')
DIMS_FILE = os.path.join(HERE, 'product_dims.json')

# 站点 → 取费率卡的哪一列（发货仓固定德国仓，目的地决定分区）
def series_key(country: str, card: dict) -> Optional[str]:
    country = (country or '').upper()
    if country == 'US':
        return None                      # 美国走独立卡，JoyBuy 用不到
    if country == 'UK':
        return 'UK'
    if country == 'DE':
        return 'DE'
    z = (card['rates']['eu'].get('deZoneOf') or {}).get(country)
    return ('DE_' + z) if z else None


def series_label(country: str, card: dict) -> str:
    country = (country or '').upper()
    if country == 'UK':
        return '英国卡（本国）'
    if country == 'DE':
        return '德国卡（本国）'
    z = (card['rates']['eu'].get('deZoneOf') or {}).get(country)
    if z:
        members = card['rates']['eu']['deZoneMembers'].get(z, '')
        return '德国仓 → EU ZONE %s（%s）' % (z[1:], members)
    return '—'


# ---------------------------------------------------------------- 几何判定

def _eu_tiers(card: dict, key: str) -> Optional[dict]:
    """把「30 档平铺费率」切成 tierDefs 定义的 6 个分段（每个分段完整继承几何门槛）。"""
    eu = card['rates']['eu']
    arr = eu['std'].get(key)
    if not arr:
        return None
    at = 0
    order, tiers = [], {}
    for defn in eu['tierDefs']:
        steps = []
        for band_g in defn['w']:
            steps.append({'limit': band_g, 'fee': arr[at]})
            at += 1
        order.append(defn['key'])
        tiers[defn['key']] = {
            'key': defn['key'], 'label': defn['label'], 'steps': steps,
            'maxL': defn['maxL'], 'maxM': defn['maxM'], 'maxS': defn['maxS'],
            'maxW': defn['maxW'], 'useDim': defn.get('useDim', False),
            'dimMax': defn.get('dimMax'),
        }
    return {'unit': eu['unit'], 'dimDivisor': eu['dimDivisor'], 'order': order, 'tiers': tiers}


def _dim_weight_g(tiers: dict, t: dict, dims_cm) -> float:
    """体积重（g）。欧洲 = 长×中×短(cm) ÷ dimDivisor × 1000。不适用体积重的档返回 0。"""
    if not t or not t.get('useDim') or not tiers.get('dimDivisor'):
        return 0.0
    if not dims_cm or len(dims_cm) < 3:
        return 0.0
    d = sorted(dims_cm, reverse=True)
    return (d[0] * d[1] * d[2]) / tiers['dimDivisor'] * 1000.0


def shipping_weight_g(tiers: dict, t: dict, dims_cm, weight_kg: float) -> float:
    """计费重 = max(单位重, 体积重)，单位 g。"""
    unit_w = weight_kg * 1000.0
    if not t or not t.get('useDim'):
        return unit_w
    return max(unit_w, _dim_weight_g(tiers, t, dims_cm))


def _tier_fits(tiers: dict, t: dict, dims_cm, weight_kg: float, L, M, S) -> bool:
    if L > t['maxL'] or M > t['maxM'] or S > t['maxS']:
        return False
    unit_w = weight_kg * 1000.0
    if unit_w > t['maxW'] + 1e-9:
        return False
    if t.get('dimMax'):
        if t.get('useDim') and _dim_weight_g(tiers, t, dims_cm) > t['dimMax'] + 1e-9:
            return False
    else:
        if shipping_weight_g(tiers, t, dims_cm, weight_kg) > t['maxW'] + 1e-9:
            return False
    return True


def classify_tier(tiers: dict, dims_cm, weight_kg: float) -> Optional[dict]:
    """返回 {key,label,L,M,S,unitW,shipW,over,missing}；判不出返回 None。"""
    if not tiers or not dims_cm or len(dims_cm) < 3:
        return None
    if not (dims_cm[0] > 0 and dims_cm[1] > 0 and dims_cm[2] > 0 and weight_kg > 0):
        return None
    order = tiers['order']
    d = sorted(dims_cm, reverse=True)
    L, M, S = d[0], d[1], d[2]
    unit_w = weight_kg * 1000.0

    def hit(key, t, extra=None):
        sw = shipping_weight_g(tiers, t, dims_cm, weight_kg)
        o = {'key': key, 'label': t.get('label', key), 'L': L, 'M': M, 'S': S,
             'unitW': unit_w, 'shipW': sw, 'dimApplied': sw > unit_w + 1e-9,
             'over': False, 'missing': False}
        if extra:
            o.update(extra)
        return o

    # 1) 常规：从最小到最大，第一个全满足的
    for k in order:
        t = tiers['tiers'].get(k)
        if not t or not t['steps']:
            continue
        if _tier_fits(tiers, t, dims_cm, weight_kg, L, M, S):
            return hit(k, t)

    # 2) 兜底：超出本表所有档位 → 取「能容纳的最大档」（宁高不低），标 over
    fb, fb_key = None, None
    for k in reversed(order):
        t = tiers['tiers'].get(k)
        if not t or not t['steps']:
            continue
        if fb is None:
            fb, fb_key = t, k
        if _tier_fits(tiers, t, dims_cm, weight_kg, L, M, S):
            return hit(k, t)
    if fb:
        return hit(fb_key, fb, {'over': True, 'missing': True})
    return None


def tier_fee(tiers: dict, tier_key: str, dims_cm, weight_kg: float) -> Tuple[float, Optional[dict], float]:
    t = tiers['tiers'].get(tier_key)
    w = shipping_weight_g(tiers, t, dims_cm, weight_kg)
    if not t or not t['steps']:
        return 0.0, None, w
    for st in t['steps']:
        if w <= st['limit'] + 1e-9:
            return float(st['fee']), st, w
    last = t['steps'][-1]
    return float(last['fee']), last, w


# ---------------------------------------------------------------- 对外入口

class McfPricer:
    """一次性加载费率卡 + 产品尺寸，之后可反复询价。

    ⚠️ **费率口径 = 1 UPO（每个订单 1 件商品）**。
      亚马逊官方明确：订单件数决定按件收费档 —— 1 件 / 2 件 / 3 件及以上分别对应
      1 UPO / 2 UPO / 3+ UPO，「**无论尺寸分段如何**，按件费用都基于每单件数」。
      本费率卡（EU27 zonal rate card，2026-05-29 生效）列示的是 1 UPO 价。
      ⇒ 订单件数 > 1 时本模块的估值**不是精确值**（2 UPO 单价通常更低，会偏高估）。
        这种情况会带 upoWarning 返回，且 build_joybuy_profit.py 会计入 selfCheck，
        不会静默当成精确值用。
    """

    def __init__(self, card_file: str = CARD_FILE, dims_file: str = DIMS_FILE,
                 fuel_pct: Optional[float] = None):
        with open(card_file, encoding='utf-8') as f:
            self.card = json.load(f)
        with open(dims_file, encoding='utf-8') as f:
            self.dims_doc = json.load(f)
        self.dims = self.dims_doc['products']
        eu = self.card['rates']['eu']
        # ⚠️ 燃油附加在费率卡**顶层**（euFuelPct / usFuelPct），不在 eu 子对象里。
        #    曾经写成 eu.get('fuelPct', 1.5) —— 那会静默吃默认值：官方调到 2.0% 时
        #    代码仍按 1.5% 算，金额偏低且毫无提示（被 test_mcf_fee.js 的双实现比对抓出来）。
        #    所以这里显式优先读顶层，并记录来源，让测试能断言「不是走的兜底」。
        top_fuel = self.card['rates'].get('euFuelPct')
        if fuel_pct is not None:
            self.fuel_pct = float(fuel_pct)
            self.fuel_pct_source = 'override'
        elif top_fuel is not None:
            self.fuel_pct = float(top_fuel)
            self.fuel_pct_source = 'rateCard.euFuelPct'
        else:
            self.fuel_pct = float(eu.get('fuelPct', 1.5))
            self.fuel_pct_source = 'fallback(default 1.5)'
        self.effective = self.card['rates'].get('euEff')

    # -- 产品尺寸 ----------------------------------------------------------
    def dims_of(self, product_name: str):
        d = self.dims.get(product_name)
        if not d:
            return None
        return d['dimsCm'], d['weightKg']

    # -- 币种 --------------------------------------------------------------
    def _cur_of(self, country: str, key: Optional[str]) -> Optional[str]:
        """报价币种由**取的是哪一列**决定，不能只查 cur 表。

        ⚠ 实测缺口：官方卡的 `cur` 表只有 {DE,FR,IT,ES: EUR, UK: GBP}，**没有 NL**，
          但 NL 确实在 deZoneOf 里（ZONE 1）。若按 cur 表查，NL 会被误判成
          「不在费率卡覆盖范围」——这是静默漏站，不是真的不支持。
          DE / DE_Z1 / DE_Z2 / DE_Z3 都是德国仓发出的欧元报价（Z* 是分区不是另一国），
          所以按列名推币种才是对的。"""
        if key == 'UK':
            return 'GBP'
        if key == 'DE' or (key or '').startswith('DE_'):
            return 'EUR'
        if key == 'US':
            return 'USD'
        return (self.card['rates']['eu'].get('cur') or {}).get((country or '').upper())

    # -- 询价 --------------------------------------------------------------
    def quote(self, country: str, dims_cm, weight_kg: float, upo: int = 1) -> dict:
        """询价。upo = 每个订单的件数（units per order）。

        费率卡只有 1 UPO 列，所以 upo > 1 时会给 upoWarning（估值可能偏高），
        不会假装是精确值。"""
        country = (country or '').upper()
        out = {'fee': None, 'base': None, 'cur': None, 'tier': None, 'tierLabel': None,
               'bandG': None, 'shipWG': None, 'unitWG': None, 'dimApplied': False,
               'series': None, 'seriesLabel': None, 'fuelPct': self.fuel_pct,
               'fuelPctSource': self.fuel_pct_source, 'upo': int(upo or 1),
               'upoWarning': None,
               'effective': self.effective, 'missing': False, 'over': False,
               'src': '', 'error': None}
        if int(upo or 1) > 1:
            out['upoWarning'] = ('费率卡仅列示 1 UPO（每单 1 件）价；本单 %d 件，'
                                 '按 1 UPO 估算会偏高（2 UPO / 3+UPO 单价通常更低）' % int(upo))
        if not (dims_cm and len(dims_cm) == 3 and all(x > 0 for x in dims_cm) and weight_kg > 0):
            out['error'] = '缺包装尺寸/毛重'
            out['missing'] = True
            return out
        key = series_key(country, self.card)
        out['cur'] = self._cur_of(country, key)
        out['series'] = key
        out['seriesLabel'] = series_label(country, self.card)
        if not key or not out['cur']:
            out['error'] = '该站点不在 MCF 欧英费率卡覆盖范围内'
            out['missing'] = True
            return out
        tiers = _eu_tiers(self.card, key)
        if not tiers:
            out['error'] = '费率卡无 %s 列' % key
            out['missing'] = True
            return out
        cls = classify_tier(tiers, dims_cm, weight_kg)
        if not cls:
            out['error'] = '尺寸太重/太大，判不出分段'
            out['missing'] = True
            return out
        out.update({'tier': cls['key'], 'tierLabel': cls['label'], 'unitWG': cls['unitW'],
                    'shipWG': cls['shipW'], 'dimApplied': cls['dimApplied'],
                    'over': cls['over'], 'missing': cls['missing']})
        base, step, ship_w = tier_fee(tiers, cls['key'], dims_cm, weight_kg)
        out['base'] = base
        out['bandG'] = step['limit'] if step else None
        if cls['over']:
            # 超范围：费率卡里没有能装下这件货的档，只能「宁高不低」按最大档估。
            # 必须在文案里说清楚，否则会被人当成真实可用的费率。
            out['error'] = ('⚠️ 超出 MCF %s 费率卡范围：货件 %sx%sx%s cm / %s kg 大于最大档 %s'
                            '（上限 %s）→ 已按最大档兜底估算，实际该单未必能用 MCF'
                            % (key, cls['L'], cls['M'], cls['S'], weight_kg, cls['label'],
                               self._tier_geom(tiers, cls['key'])))
        out['fee'] = round(base * (1 + self.fuel_pct / 100.0), 2)
        out['src'] = ('MCF %s · %s · 计费重 %sg（档上限 %sg）· 基价 %.2f %s + 燃油 %.1f%%%s%s'
                      % (out['seriesLabel'], cls['label'],
                         round(ship_w, 1), out['bandG'], base, out['cur'], self.fuel_pct,
                         ' · 1 UPO 口径' if out['upo'] == 1 else ' · ⚠️ %d 件（费率卡只有 1 UPO）' % out['upo'],
                         ' · ⚠️ 超范围兜底' if cls['over'] else ''))
        return out

    def _tier_geom(self, tiers: dict, key: str) -> str:
        t = tiers['tiers'].get(key) or {}
        return '%sx%sx%s cm / %s kg' % (t.get('maxL'), t.get('maxM'), t.get('maxS'), t.get('maxW'))


if __name__ == '__main__':
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    p = McfPricer()
    print('费率卡生效日 %s · 燃油附加 %.1f%%（来源 %s）· 产品尺寸 %d 个'
          % (p.effective, p.fuel_pct, p.fuel_pct_source, len(p.dims)))
    tests = [('材料包', 'DE'), ('X1系列蜂窝板', 'DE'), ('X1主机+60W蓝光头+气泵', 'DE'),
             ('滚轴', 'DE'), ('材料包', 'NL'), ('材料包', 'FR'), ('材料包', 'UK')]
    for name, co in tests:
        dd = p.dims_of(name)
        if not dd:
            print('%-28s %-3s  无尺寸数据' % (name, co))
            continue
        q = p.quote(co, dd[0], dd[1])
        print('%-28s %-3s  %s' % (name, co, q['src'] or q['error']))
        if q['fee'] is not None:
            print('%30s → %s %.2f' % ('', q['cur'], q['fee']))
