# -*- coding: utf-8 -*-
"""技能升级 v1.5.0 → v1.6.0：周维度采集 / 累加器播种坑 / SKU→产品名映射 / 五维筛选看板。"""
import io

P = r'C:\Users\paddy\.workbuddy\skills\joybuy-open-platform-api\SKILL.md'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d 处' % (tag or old[:40], cnt, c)
    s = s.replace(old, new)
    n += 1


# ---------------- 版本号 ----------------
rep("  version: 1.5.0", "  version: 1.6.0", tag='version')

# ---------------- description 追加关键词 ----------------
rep("多站点多币种看板、开发者注册",
    "多站点多币种看板、四维筛选看板（国家/产品系列/产品名/周数）、SKU→产品名映射、skuWeekly 按周采集、"
    "累加器播种 2 倍坑、IIFE 内联 onclick 作用域、tableHtml 表头转义、开发者注册",
    tag='description 关键词')

# ---------------- §4-d 之后插入 4-d2 周维度采集 ----------------
rep("""### 4-e. 切换店铺""",
    """### 4-d2. 按周分段采集（`skuWeekly`）：给看板做「产品 × 周」筛选的前提

detail 接口**没有** `groupBy: week` 这种维度，30 天上限也卡死了「一次性拉长区间」。
要拿到「SKU × 周」矩阵，只能**按周循环调 detail**：每周跨度 ≤7 天，天然满足 30 天上限。

```js
// joybuy_compass_fetch.js → skuWeeklyChunked(cfg, D1)
// 4 站 × 18 周 = 72 次调用，产出 { weeks, cells, skusMeta, okWeeks, totalWeeks }
for (const w of weekRanges(range.startDate, range.endDate)) {
  const r = await raw('dsm.compass.pop.productsAnalytics.detail', {
    ...base, startDate: w.startDate, endDate: w.endDate,
    groupBy: 'skuIds', pageSize: 200, sortBy: 'popPdpUv', sortOrder: 0,
  });
  for (const row of (r.json.data.data || [])) accDetailRow(byKey, row, 'skuId', w.days);
}
```

**周区间切分必须和后端看板同一口径**（本项目：**周六~周五**为一周，周号取该周**周五**所在 ISO 周）。
前端另算一遍 ISO 周会在**跨年时错一周**，所以：后端把 `{key,label,start,end}` 直接吐给前端，
前端只做**区间命中**（`WEEKS[i].start/end` 字符串比较），**不要在前端重算周号**。

新增 CLI：`--no-weekly`（跳过 SKU×周，快）· `--weeks`（只打印周划分、不联网，用于校验口径）。

### 4-d3. ❗❗累加器「播种」会把数据放大 —— 本项目最严重的一次错（整期 2 倍）

把多段结果累加时，**千万别用 `Object.assign({}, row, {...})` 给累加器播种**：

```js
// ❌ 错：播种时 row 的数值字段已经进了 acc，下面的循环再加一遍
let acc = byKey.get(k) || Object.assign({}, row, { __wsum: {}, __days: 0 });
for (const [kk, vv] of Object.entries(row)) { /* 按三档口径累加 */ }

// ✅ 对：播种只带「非数值」字段（skuId / color / 名称等标识），数值一律从 0 起累
if (!acc) {
  acc = { __wsum: {}, __days: 0 };
  for (const [kk, vv] of Object.entries(row)) if (typeof vv !== 'number') acc[kk] = vv;
  byKey.set(k, acc);
}
```

**症状极其迷惑人，两种口径错得不一样**：

| 口径 | 实际值 | 为什么 |
|---|---|---|
| 交易类（`popOrders`/`popGmv`） | **恰好 ×2** | `vv + vv = 2vv` |
| 流量类（`popPdpUv` 等，日均 × 天数） | **× (days+1)/days** | `vv + vv×days` → 周查 8/7 = **+14.3%**，30 天段 31/30 = **+3.3%**，净 **+12.9%** |
| 比率/存量类 | **反而正确** | 循环里走 `acc[kk] = null` 分支，把播种值覆盖掉了 |

比率类唯独没错 ⇒ 更容易误判成"只是某个指标口径错了"，而不是"累加器整体写错了"。

**定位套路**（这次就是这么揪出来的）：
1. 先排重复格子（`cells` 里同一 `skuId` 有没有重复）→ 0 重复，排除；
2. 三方对照：站点日序列 `transactionTrend`（3 单）↔ SKU 整段明细（3 单）↔ SKU 按周求和（**6 单**）→ 锁定在"按周求和"；
3. 写一个探针脚本固定单站单周**逐一改变量**，确认接口本身返回 1 单 → 结论是**我方累加逻辑**。

修复后的收尾自检必须过（写进采集脚本）：`Σ(SKU 周合计) == Σ(SKU 整段)`，
对 `popGmv` / `popOrders` / `popPdpUv` 三项逐站比对。本项目修复后 4/4 站全 ✓
（UK 617=617、DE 1803.89=1803.89 / 3=3、NL 705=705、FR 561=561）。

### 4-e. 切换店铺""",
    tag='新增 4-d2 / 4-d3')

# ---------------- §5 之后插入 SKU 映射与筛选章节 ----------------
rep("""## 6. 交付前的回归（本项目实测项数）""",
    """## 5b. SKU → 产品系列 / 产品名 映射（看板「产品维度」的数据基础）

后台只给到 `skuId`，产品系列/产品名全是**从 SKU 名称 + 规格色里规则推导**出来的。
参考实现 `build_joybuy_sku_map.py`（本项目 67 SKU → 9 系列 → 24 产品名）：

**判定优先级**（`classify(sku_name, color)`）：先配件、后整机 ——
`材料套装` → `空气净化器`（主机 / 各型滤芯）→ `蜂窝台` → `吸尘器` → `激光模块` → 整机（`E1` → `X1 Lite` → `X1L` → `X1`）。
顺序不能反，"配件名里含主机系列名"是常态。

**输出结构**：`{version, generatedAt, seriesOrder, catalog:[{series,names}], skuMap:[{skuId,site,series,name,color,skuName,review,note}], overrides}`
—— `skuMap` 用**数组**不是对象（同一 `skuId` 会出现在多个站点，一行一站点）。

### ❗词边界坑：判 `X1L` 不能用 `'x1 l' in name`

UK 的 X1 商品名是 `Aliencell X1 Laser Engraver with Air Assist, 660 × 533 mm ...`，
**小写后含 `x1 l`**（来自 `X1 **L**aser`）→ 会把 3 个 UK 的 X1 SKU 全判成 X1L。

```python
if re.search(r'\\bx1l\\b', n):   # ✅ 词边界
# if 'x1 l' in n:                # ❌ 命中 "X1 Laser"
```

**同类风险**：任何"缩写 = 另一个产品名 + 空格 + 后续单词首字母"的情况。
判定 SKU 系列时一律用 `\\b` 边界，并**回归一次全站点**（UK 的 X1 20W/40W/60W 必须仍归 X1）。

**人工覆盖位**：`overrides = { skuId: {series, name} }` 优先于规则；重跑脚本时 overrides 必须保留。
**歧义不要自己拍板**：规则判不准的写成 `review: true` + `note`，导 `_sku_review.csv` 交业务侧确认。
本项目 DE 站 5 条 `Aliencell X1L closed diode laser engraver ... 26 × 21 inch` 待确认
（`26×21 in = 660×533 mm`，与 **X1** 床面一致、与 X1 Lite 的 `610×465 mm` 不一致
⇒ 大概率是独立产品线，但涉及业务定义，不替客户决定）。

### 「产品维度」只能作用于 SKU 级数据

后台有**最小粒度就是站点×日**的指标：店铺 UV/PV、收藏商品数（`popCollectedProducts`）、
加购商品数、在售商品数 —— 这些**拆不到 SKU**。
所以看板里必须给它们挂「**站点级**」标签，并明确只响应**国家 / 周数**，
**绝不能假装它们会跟着产品系列变**（否则筛选后数字不变，会被当成 bug）。

### 多币种：跨站点不混算

UK = GBP，DE/NL/FR = EUR。多站点视图**只汇总无币种量**（UV/PV/加购/订单数/件数），
金额按币种分行展示。

## 5c. 四维筛选看板（国家 / 产品系列 / 产品名 / 周数）

对齐亚马逊看板（`product.html` / `daily.html`）的 `.dd` 级联下拉范式。

**前端筛选模型**
```js
var STORE = { site: [], series: [], name: [], sku: [], week: [] };  // 空数组 = 全部
function has(arr, v) { return !arr.length || arr.indexOf(v) >= 0; }
function filterRows(o) { return ROWS.filter(function (r) {
  return has(o.site||[], r.site) && has(o.week||[], r.week) &&
         has(o.series||[], r.series) && has(o.name||[], r.name) && has(o.sku||[], r.skuId); }); }
function rowsExcept(dim) { /* 排除该维度后的行 → 用于算该维度的候选选项 */ }
```

- **候选联动**：某维度的候选 = `rowsExcept(dim)` 里出现过的值；当前无数据的项**置灰但仍可见**。
- **交互语义**（踩过一次写反）：普通单击 = **单选替换**；`Ctrl/⌘+单击` = 多选追加/取消；
  **唯一选中项再点一次 = 取消回「全部」**。早期写成"从全部点一项 = 排除该项"，像反选，用户会以为点反了。
- **不要在模板里预计算 `ALL`**：若后端既给预计算 `ALL`、前端又能合并部分站点，就会出现两套口径。
  统一由前端 `mergeSites()` 合并。选「全部站点」只是「4 个站点全选」的特例。

### ❗❗IIFE + `'use strict'` 下的内联事件作用域（症状：下拉点了没反应）

模板逻辑全包在 `(function(){ 'use strict'; ... })()` 里，而按钮用的是内联
`onclick="toggleDD('ddSite')"` —— **内联事件处理函数只能访问全局名字**。
不显式挂到 `window` 就报 `toggleDD is not defined`；更坑的是
`oninput="kwSeries=this.value;renderDD()"` 这种**裸变量赋值会静默失败**（无报错、搜索框没反应）。

```js
window.toggleDD = toggleDD;
window.setKw = function (dim, v) { KW[dim] = v; renderDD(); };
window.setAll = function (dim, on) { STORE[dim] = []; renderDD(); render(); };
window.pick  = function (ev, dim, val) { /* ... */ };
```
内联里一律写成 `oninput="setKw('series', this.value)"`，并给模板加自检：
残留裸变量数 = 0、`renderDD` 已全局暴露。

**测试必须真实点按钮**（`document.querySelector('#ddX .dd-btn').click()`），
直接 `classList.add('open')` 会把这类问题全部掩盖掉。

### ❗表格渲染两个坑

1. **表头被转义**：`tableHtml()` 里 `'<th>' + esc(c.t) + '</th>'` 会让
   `<span class="scope-tag">站点级</span>` 原样打在页面上。需要内嵌标签的列显式标 `raw: 1`：
   `return '<th ...>' + (c.raw ? c.t : esc(c.t)) + '</th>';`
   → 加一条断言：表头内不得出现被转义的 `&lt;span`。
2. **Chart.js 动画会让截图超时**（Playwright 等不到"稳定"）→ 统一 `animation: false`。

### 站点级指标的「数据覆盖起点」必须标出来

后台 trend 接口会**裁掉开头的全 0 天**，于是各站数据起点不一致
（本项目 NL 站自 2026-07-28 起，其余站自 05-29）。
若页面直接显示 0，会被**误读成"流量归零"**。做法：
- 采集/构建时给每站算 `cover = {start, end, nDays}`；
- 起点晚于全局窗口时自动生成警告条；
- 筛选说明里加「本站覆盖」提示（选中该站时才出现）。

### 一个真实但不该"修"的口径差异

「商品 PDP UV/PV」是**各商品相加**，同一访客浏览多个商品会**重复计数**，
所以它**大于**站点级「商品详情页访客数」（本项目实测 1.11~1.19 倍，4 站方向一致），
据此算出的加购率/转化率天然偏低。**别去"修正"它**，在 KPI 副标题写「各商品访客之和」并在页脚说明即可。

## 6. 交付前的回归（本项目实测项数）""",
    tag='新增 5b / 5c')

# ---------------- §6 回归表补两行 ----------------
rep("""| 既有亚马逊回归 `verify_filters3.js` | 确认改动没破坏原看板 | 全 PASS |""",
    """| **`_jb_f_test.js`** | **五维筛选逻辑 36 项**：5 个下拉均可点开（真实 `.click()`）· 面板内搜索 · 国家/系列/产品名/周 逐级收窄 · 候选联动是否"干净" · 周筛选 · 空集归零 · 重置 · Ctrl 多选 · 表头无转义字面量 | 36/36 |
| **`test_joybuy_entry_e2e.js`** | 统一入口**端到端**：外壳 tab → iframe → 12 KPI → 5 个筛选下拉 → 7 个页签逐个扫内容 → 零 JS 报错 | 17/17 |
| 既有亚马逊回归 `verify_filters3.js` | 确认改动没破坏原看板 | 全 PASS |""",
    tag='回归表')

# ---------------- §7 踩坑速查追加 ----------------
rep("""- **调试浏览器必须长驻**：`node joybuy_browser.js --keep; sleep 5400` 放后台任务。""",
    """- **❗累加多段结果时别用 `Object.assign({}, row, ...)` 播种累加器** —— 交易类会**恰好 ×2**、
  流量类会 **×(days+1)/days**（周查 +14.3%）、比率类反而正确，极难看出是同一个 bug。
  播种只带非数值字段。定位靠"日序列 ↔ 整段 ↔ 按周求和"三方对照 + 探针脚本逐一改变量（详见 §4-d3）。
- **判产品系列缩写要用词边界**：`'x1 l' in name` 会命中 `X1 **L**aser`，把 UK 的 X1 全判成 X1L；
  用 `re.search(r'\\bx1l\\b', n)`（详见 §5b）。
- **IIFE + `'use strict'` 模板里新增交互函数必须挂 `window`**，否则内联 `onclick` 报
  `xxx is not defined`；`oninput` 里的裸变量赋值更会**静默失效**（搜索框没反应、控制台无报错）。
  测试要真实 `.click()` 按钮，别用 `classList.add('open')` 绕过（详见 §5c）。
- **`tableHtml` 的表头走 `esc()`**：要嵌 `<span class="scope-tag">` 的列必须标 `raw: 1`，
  否则页面上直接显示标签源码。
- **Chart.js 记得 `animation: false`**，否则 Playwright 截图等不到稳定态而超时（本项目 30s 超时）。
- **trend 接口会裁掉开头全 0 天**，各站数据起点可能不同（NL 站晚 2 个月）。
  页面要显式标「本站覆盖」，否则早于起点的周次会被误读成"流量归零"。
- **调试浏览器必须长驻**：`node joybuy_browser.js --keep; sleep 5400` 放后台任务。""",
    tag='踩坑速查')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
print('技能大小: %.1f KB' % (len(s.encode('utf-8')) / 1024.0))
