# -*- coding: utf-8 -*-
"""落地说明同步：四维筛选看板 + SKU→产品名映射。"""
import io

P = 'JoyBuy接入落地说明.md'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d 处' % (tag or old[:30], cnt, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) 状态表 ----------
rep(
    "| ⑤ | `joybuy.html` 看板 + 并入统一入口共用云端链接 | ✅ 完成，回归 **30/30 + 17/17** |",
    "| ⑤ | `joybuy.html` 看板 + 并入统一入口共用云端链接 | ✅ 完成，回归 **30/30 + 17/17** |",
    tag='⑤ 保持')

rep(
    "| ⑦ | 发布上线（复用 sandboxId，链接不变） | ✅ 完成，线上与本地逐字节一致 |",
    "| ⑦ | 发布上线（复用 sandboxId，链接不变） | ✅ 完成，线上与本地逐字节一致 |\n"
    "| ⑧ | **四维筛选（国家 / 产品系列 / 产品名 / 周数）+ SKU→产品名映射** | ✅ 完成，筛选回归 **36/36**、入口 e2e **17/17** |",
    tag='⑧ 新增')

# ---------- 2) §五 看板内容 ----------
rep("### 看板内容（7 个标签页 × 5 站点视图）\n\n顶部为**站点切换 chips**：`全部站点` / `UK 站 GBP` / `DE 站 EUR` / `NL 站 EUR` / `FR 站 EUR`。",
    """### 看板内容（7 个标签页 × 五维筛选）

**筛选面板（与亚马逊看板同款级联下拉）**：`国家` · `产品系列` · `产品名` · `SKU` · `周数`

- **交互**：普通单击 = 单选替换；`Ctrl/⌘+单击` = 多选追加/取消；唯一选中项再点一次 = 取消回「全部」。
- **候选联动**：每个下拉的候选 = 满足**其余维度**的行里出现过的值；当前无数据的项置灰但仍可见。
- **空数组语义**：`STORE = { site: [], series: [], name: [], sku: [], week: [] }` —— **空 = 全部**，不写 `'ALL'`。
- 后端**不再预计算 `ALL`**，多站点由前端 `mergeSites()` 合并（否则会出现「预计算 ALL」与「部分站点合并」两套口径）。

**指标分层（务必分清，页面已用「站点级」标签标注）**

| 层级 | 指标 | 受哪些筛选影响 |
|---|---|---|
| **SKU 级** | PDP UV/PV · 加购 UV/件数 · 订单量 · 件数 · 销售额 · 加购率 · 转化率 | 国家 / 系列 / 产品名 / SKU / 周数 **全部** |
| **站点级** | 店铺 UV / PV · 收藏商品数 · 加购商品数 | **只受** 国家 / 周数 |

> ⚠️ 「商品 PDP UV/PV」是**各商品相加**，同一访客浏览多个商品会**重复计数**，
> 因此它比站点级「商品详情页访客数」大（实测约 1.11~1.19 倍），换算出的加购率/转化率天然偏低。""",
    tag='§五 筛选说明')

rep("| **概览趋势** | 订单量(柱) + 销售额(线) 双轴；流量/加购/收藏 四线；18 周明细 |",
    "| **概览趋势** | 订单量(柱) + 销售额(线) 双轴；流量/加购/收藏 四线；18 周明细 |", tag='概览 保持')
rep("| **商品流量** | SKU 维度 67 行：PV / 加购 / 收藏 / 订单量 / 件数 / 销售额 / 加购率 |",
    "| **商品 · 产品名** | 三层汇总：**9 个系列** / **24 个产品名** / **67 个 SKU**，各含 PDP UV·PV、加购、订单、销售额、加购率、转化率 |",
    tag='商品·产品名')
rep("| **店铺流量** | 店铺 UV / PV 趋势 + 周明细（人均浏览、转化率） |",
    "| **店铺流量** | 站点级：店铺 UV / PV 趋势 + 周明细（人均浏览、转化率） |", tag='店铺流量')

rep("**筛选**：站点 chips、周维度下拉、SKU/商品名搜索、一键重置（KPI 随筛选联动）。",
    "**筛选**：五维级联下拉（国家/产品系列/产品名/SKU/周数）+ 面板内关键字搜索 + 一键重置，KPI 与图表全部实时联动。",
    tag='筛选段')

# ---------- 3) §六 文件清单 ----------
rep("| `joybuy_compass_data.json` | Data Compass 产出（约 500 KB） |",
    "| `joybuy_compass_data.json` | Data Compass 产出（约 1.2 MB，含 `skuWeekly` 明细，不再另有 `ALL` 预计算） |",
    tag='compass data')
rep("| `joybuy_template.html` | 看板模板（7 标签页 × 5 站点视图；占位符 `__PAYLOAD__` / `__CHARTJS__`） |",
    "| `joybuy_template.html` | 看板模板（7 标签页 × 五维筛选；占位符 `__PAYLOAD__` / `__CHARTJS__`） |",
    tag='template 行')
rep("| `test_joybuy_portal.js` | 统一入口集成回归（**17/17**） |",
    """| **`build_joybuy_sku_map.py`** | **SKU → 产品系列 / 产品名 规则映射器**（`--check` 体检 / `--review` 导出待确认清单） |
| `joybuy_sku_map.json` | 映射产出：67 SKU → 9 系列 → 24 产品名（含 `overrides` 人工覆盖位） |
| `_sku_review.csv` | 待人工确认的 SKU（当前 5 条 DE 的 X1L） |
| `test_joybuy_portal.js` | 统一入口集成回归（**17/17**） |
| **`_jb_f_test.js`** | **五维筛选逻辑回归（36/36）**：下拉可点开、级联收窄、周筛选、空集、重置、Ctrl 多选 |""",
    tag='文件清单新增')
rep("| **`test_joybuy_entry_e2e.js`** | 统一入口**端到端**回归（外壳→页签→iframe，**16/16**，含 7 页签内容扫描） |",
    "| **`test_joybuy_entry_e2e.js`** | 统一入口**端到端**回归（外壳→页签→iframe，**17/17**，含 7 页签内容扫描） |",
    tag='e2e 行')

# ---------- 4) §七 回归测试 ----------
rep("node test_joybuy_entry_e2e.js                     # 16/16",
    "node test_joybuy_entry_e2e.js                     # 17/17", tag='e2e 命令')
rep("""# 亚马逊看板未被破坏（需 http.server 8899 从 _deploy 启动）
node verify_filters3.js                           # 全 PASS
```""",
    """# 五维筛选逻辑（需 joybuy_browser.js 保活；真实点 .dd-btn，能暴露内联 onclick 作用域问题）
node _jb_f_test.js                                # 36/36

# 亚马逊看板未被破坏（需 http.server 8899 从 _deploy 启动）
node verify_filters3.js                           # 全 PASS
```""", tag='筛选测试命令')

# ---------- 5) 排障补两条 ----------
rep("| 线上看到的还是旧版 | CDN 边缘缓存。核验一律带 `?cb=<时间戳>`；壳页面 iframe 自带 `?v=<小时时间戳>`，正常入口不受影响 |",
    """| 线上看到的还是旧版 | CDN 边缘缓存。核验一律带 `?cb=<时间戳>`；壳页面 iframe 自带 `?v=<小时时间戳>`，正常入口不受影响 |
| **下拉点了没反应** | 模板逻辑全在 IIFE + `'use strict'` 内，内联 `onclick/oninput` 只能访问**全局名**。新增交互函数必须 `window.xxx = xxx` 显式挂载（症状：`toggleDD is not defined`，且搜索框静默失效） |
| **表头出现 `<span ...>` 字面量** | `tableHtml()` 对列名统一 `esc()`。需要内嵌标签的列必须标 `raw: 1` |
| **某站早期周次全是 0** | 后台趋势接口会裁掉开头的全 0 天。例：NL 站数据自 **2026-07-28** 起（其余站自 05-29），更早周次是「无数据」而非 0 —— 页面已用「本站覆盖」提示标出 |""",
    tag='排障新增')

# ---------- 6) §九 日常流程补一步 ----------
rep("""# 4) 重建看板
python build_joybuy_dashboard.py""",
    """# 4) 重建看板
python build_joybuy_dashboard.py

# 4.5) 新增/变更 SKU 时，先刷新 SKU → 产品名映射（否则新 SKU 会落到「未分类」）
python build_joybuy_sku_map.py --check     # 只体检、不写文件
python build_joybuy_sku_map.py             # 重写 joybuy_sku_map.json + _sku_review.csv""",
    tag='日常流程')

# ---------- 7) 新增 §十 SKU 映射章节 ----------
rep("""## 八、排障""",
    """## 七点五、SKU → 产品系列 / 产品名 映射

`build_joybuy_sku_map.py` 按 **SKU 名称 + 规格色** 用规则推导，产出 `joybuy_sku_map.json`：

```
67 个 SKU  →  9 个产品系列  →  24 个产品名
```

| 产品系列 | 产品名数 | SKU 数 | 覆盖站点 |
|---|---|---|---|
| X1 | 3（20W / 40W / 60W） | 12 | DE / FR / NL / UK |
| X1 Lite | 2（20W / 40W） | 5 | DE / FR / UK |
| X1L | 5 ⚠️ | 5 | DE |
| E1 | 2（10W / 20W） | 6 | DE / FR / NL |
| Air Purifier | 6（主机 + 5 种滤芯） | 19 | DE / FR / NL / UK |
| Honeycomb Table | 1 | 4 | DE / FR / NL / UK |
| Laser Module | 3（20W / 40W / 60W） | 9 | DE / FR / NL |
| Starter Kit | 1（材料包） | 4 | DE / FR / NL / UK |
| Vacuum Cleaner | 1 | 3 | DE / FR / NL |

**判定优先级**：`材料套装` → `空气净化器`（主机/滤芯）→ `蜂窝台` → `吸尘器` → `激光模块` → `整机`（E1 → X1 Lite → X1L → X1）。

> ⚠️ **踩过的坑**：判 X1L **不能**用 `'x1 l' in name` —— UK 的 X1 商品名是
> `Aliencell X1 Laser Engraver...`，小写后含 `x1 l`（来自 `X1 Laser`），
> 会把 3 个 UK 的 X1 SKU 误判成 X1L。必须用**词边界** `re.search(r'\\bx1l\\b', n)`。

**人工覆盖**：`joybuy_sku_map.json` 里的 `overrides` 字段按 `skuId → {series, name}` 优先于规则，
改完重跑 `build_joybuy_sku_map.py` 即可（规则会保留 overrides）。

**待确认（`_sku_review.csv`）**：DE 站 5 个 `Aliencell X1L closed diode laser engraver... 26 × 21 inch`
与 X1 Lite（`610 × 465 mm`）尺寸文案不一致；但 `26 × 21 in = 660 × 533 mm`，与 **X1** 的床面尺寸一致，
故 X1L 大概率是独立产品线（封闭式）而非 X1 Lite 别名 —— 待业务侧拍板。

---

## 八、排障""",
    tag='§七点五 新增')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
print('文档大小: %.1f KB' % (len(s.encode('utf-8')) / 1024.0))
