# -*- coding: utf-8 -*-
"""广告条目 -> 产品 ASIN 归属（唯一权威规则源）

⚠️ 三处构建脚本必须共用本模块，禁止各自维护一份 extract_asin 副本
（2026-10-10 之前三处各有一份完全相同的 SPECIAL_ASIN + 正则，改一漏二）：
  - 周看板   : 2026-08-17-14-21-33/aggregate_ads.py
  - 月度看板 : build_monthly_dashboards.py
  - 广告看板 : 2026-08-17-14-21-33/build_ad_dashboard_data.py

## 为什么需要这个模块（2026-10-10 查明）

品牌推广(SB)按品牌 / 旗舰店 / 商品集投放，报表里 `Asin` 与 `Sku` **都是空的**
（SP/SD 都有值）。月度/周看板按 `(月/周, 国家, ASIN)` 聚合，取不到 ASIN 就
`continue` 跳过 ⇒ **SB 花费整块丢失**。实测 2026-08 丢 3,692 USD、2026-09 丢
6,971 USD；日看板按国家直接累加、不看 ASIN，所以口径反而是对的
（反推验证：2026-08 用 ERP 毛利反推广告费 17,697 vs 日看板 17,722，误差 0.14%）。

## 归属顺序（前者命中即返回）

1. 条目自带 `Asin`
2. 活动名 / 名称里的 ASIN 字面量 `B0[A-Z0-9]{8}`
3. `SPECIAL_ASIN` 精确名映射（历史遗留，活动名不含 ASIN 的几条）
4. `SB_FALLBACK` 系列兜底（2026-10-10 运营逐条指认）

**第 2 层在第 4 层之前是刻意设计**：运营已确认「后续会给 SB 广告标题加上 ASIN
码，然后直接按照标题 ASIN 归因」。等标题带上 ASIN，第 2 层自动命中，
第 4 层的兜底自动让位 —— 届时**不需要改任何代码**。

## 为什么第 4 层要区分站点

同一个 SKU 在不同区域是不同 ASIN（实测同名 SP 活动反查）：
    US  ACD-X1-40W-NA  -> B0H69JJZ1M
    DE  ACD-X1-40W-EU  -> B0HH8J6SSL
所以泛 X1 的兜底必须按站点走，不能一刀切。
"""

import re

# ---------------------------------------------------------------- 第 3 层
SPECIAL_ASIN = {
    'X1-SBV-片段2': 'B0H69JJZ1M',
    'X1-SB-定投旗舰店-LC-B2B': 'B0H69JJZ1M',
    'X1-SB-定投旗舰店首页-B2B': 'B0H69JJZ1M',
}

ASIN_RE = re.compile(r'B0[A-Z0-9]{8}')

# ---------------------------------------------------------------- 第 4 层
# X1 系列的兜底归属（按站点）：US 归 40W 的北美 ASIN，其它站点归 40W 的欧洲 ASIN。
# 依据：
#   1. 运营 2026-10-10 逐条指认（泛 X1 的 US 活动 -> B0H69JJZ1M；
#      泛 X1 的欧洲 片段1 活动 -> B0HH8J6SSL）
#   2. 既有 SPECIAL_ASIN 先例：X1-SBV-片段2 / X1-SB-定投旗舰店 都归 B0H69JJZ1M
#   3. 站点差异由 SP/SD 同名活动反查证实（见模块 docstring）
X1_FALLBACK = {
    'US': 'B0H69JJZ1M',
    'CA': 'B0H69JJZ1M',
    'MX': 'B0H69JJZ1M',
}
X1_FALLBACK_DEFAULT = 'B0HH8J6SSL'

# Lite 系列 SB（含 A-Lite-SB商品集）统一归 Lite 40W
LITE_FALLBACK = 'B0H9YBM4H1'

# 系列识别：`X1` 后面不能紧跟数字，否则 A-X140-* / X140 会被误判成 X1 系列。
RE_LITE = re.compile(r'lite', re.I)
RE_X1_SERIES = re.compile(r'X1(?!\d)', re.I)

# ⚠️ 兜底前的挡板：活动名里出现 `X1` 后紧跟数字（如 A-X140-*）说明是**另一条产品线**，
#    不能吃 X1 的兜底。实测 `A-X140-Auto` 的 PortfolioName 恰好也是 "X1"，
#    只看 PortfolioName 会把它误归到 X1 的 ASIN 上（2026-10-10 试跑时发现）。
#    这类活动正常都带 Asin 字段，走不到兜底；万一走到，宁可不归属也不要归错。
RE_OTHER_SERIES = re.compile(r'X1\d', re.I)


def attribute(item, cc=None):
    """广告条目 -> ASIN 字符串；无法归属时返回 None。

    item: 广告报表条目（含 Asin / CampaignName / PortfolioName / Sku）
    cc  : 站点码（US/DE/UK/...）。第 4 层兜底需要它区分区域，缺失时按欧洲款处理。
    """
    asin = (item.get('Asin') or '').strip()
    if asin:
        return asin

    camp = (item.get('CampaignName') or item.get('Name') or '').strip()
    if not camp:
        return None

    # 第 2 层：活动名里的 ASIN 字面量（运营加 ASIN 码后会命中这里）
    m = ASIN_RE.search(camp)
    if m:
        return m.group(0)

    # 第 3 层：精确名映射
    if camp in SPECIAL_ASIN:
        return SPECIAL_ASIN[camp]

    # 第 4 层：系列兜底。活动名 + PortfolioName 一起看 ——
    # 有些活动的活动名只有 "A-Lite-SB商品集"，系列信息在 PortfolioName("X1-Lite") 里。
    if RE_OTHER_SERIES.search(camp):
        return None  # 另一条产品线（X140 等），不吃 X1/Lite 的兜底
    key = camp + ' ' + (item.get('PortfolioName') or '')
    if RE_LITE.search(key):
        return LITE_FALLBACK
    if RE_X1_SERIES.search(key):
        return X1_FALLBACK.get((cc or '').strip().upper(), X1_FALLBACK_DEFAULT)

    return None


# 向后兼容：三处旧代码都叫 extract_asin(item)
def extract_asin(item, cc=None):
    return attribute(item, cc)
