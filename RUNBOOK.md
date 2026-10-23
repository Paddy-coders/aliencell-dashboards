# Aliencell 亚马逊看板统一更新 · 运行手册（RUNBOOK）

> **维护约定**：本文件是自动化任务 automation-1787105514880 的唯一执行手册。
> 以后要优化任何链路（改命令、改口径、加步骤），**只改本文件**，不要改 automation 的 prompt。
> prompt 里只保留调度逻辑与全局红线。
> 2026-09-26 建立：由原 3 个自动化（每日 1787105514880 / 广告周度 1787561869471 / 产品周报 1786956560592）平移合并而成，步骤内容原样保留。

**执行方与调度逻辑**：
- 每天 15:00（北京时间）由 automation-1787105514880 触发。
- **非周一**：只执行 §A。
- **周一**：依次**串行**执行 §A → §B → §C。每条链路各自完成「构建 → 复制 _deploy → 部署 → 自检」后再进入下一条。
  - 串行的原因：§B/§C 原为两个独立任务同时 15:00 触发，曾出现 **CDP 9223 并发导致广告接口返回全 0 指标**（记录条数正常但花费/点击/曝光全 0）、以及**同时部署同一 `_deploy/` 目录的并发覆盖风险**。合并后串行执行，这两个问题从根上消除；若仍遇到全 0，等 2-3 分钟重跑该步采集即可。
  - 任一条链路失败：记录失败原因后**继续执行下一条**（不中断整场），最后在汇报最前面汇总所有失败。

**通用环境（三条链路共用）**：
- 主工作目录：`C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38`
- 产品报表目录（仅 §C 用）：`C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33`
- Node：`C:/Users/paddy/.workbuddy/binaries/node/versions/22.22.2-2/node.exe`（测试类脚本需 `NODE_PATH="C:/Users/paddy/.workbuddy/binaries/node/workspace/node_modules"`）
- Python：`C:/Users/paddy/.workbuddy/binaries/python/versions/3.13.12/python.exe`
- 云端固定链接：`https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host`（sandboxId `3577d1e878e64dc5837e56f9471dcefc`，部署复用，链接不变；2026-09-15 起域名以 `.host` 为准）
- 自检命令（所有链路部署后必跑）：
  `cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && C:/Users/paddy/.workbuddy/binaries/node/versions/22.22.2-2/node.exe check_data_integrity.js`
  - 任何 FAIL → 汇报**最前面**用【⚠数据自检未通过】标出，禁止静默忽略
  - FAIL=「线上与本地不一致」→ 重新部署后再跑一次自检（自检 F 项带 cache-buster 直取源站；CDN 对裸 URL 有独立缓存属正常）
  - WARN 属正常说明即可（A2b 老周稀疏 / G8 源延迟 / G9 温区未轮到）
- 完整架构、文件清单、坑清单见同目录 `HANDOVER.md`（权威入口）。

---

## §A 每日链路（每天必跑）：业务报告+广告 → daily/monthly/target

### §A.0 背景口径（务必遵守）

- 日期以北京时间为准（业务报告/广告数据按北京时间日期聚合）
- 环比 = 前一周的今天（同周几的上周同日）
- 业务报告约延迟 2~3 天且**按店铺陆续同步**（可能出现 US 缺失而 EU 已出的"半截数据"）→ 采集脚本自动给这类日期打 incomplete 标记并纳入近 60 天复查窗口，最近几天显示空白（—）属正常，不是错误，不要重试
- **采集分三层（复查 = 补空缺 + 重新校准，2026-09-24 起）**：
  ① 热区（近14天）每次运行全量重拉；② 标记 incomplete / 全天无数据的日期无条件复查（近 60 天内）；
  ③ 温区（15~60天）轮转校准，每次取「最久未被校准的」6 天，约 8 天覆盖一轮。
  为什么已采到的数据也要重拉：**上游会改数**——广告花费因无效流量扣减下调、销售额因归因回填后补（实测 46 天前仍被下调 1.2%；9/21 一笔 1599 订单被撤销）。变化写入 daily_data.json 顶层 `calibration.changed`，脚本结尾打印「🔁 校准台账」。
- **历史全量累积**：daily_data.json 按日期合并保留（旧日期不删除），历史从业务报表最早有数据的日期起持续累积（实测最早 **2026-06-23**；6/23~7/19 极零星流量是真实数据不是错误）
- **首次运行 / 补拉**：无数据文件或 `FULL_BACKFILL=1` 时自动探测最早日期回填（最多回溯 400 天）；历史漏段用 `BACKFILL_FROM=YYYY-MM-DD node fetch_daily_data.js`；数据文件最后日期早于今天时自动从最后日期+1 补齐
- 指标口径：流量=Sessions；订单量=total_order_items；销售额=ordered_product_sales_amount；转换率=订单件数÷流量；自然流量=流量−广告点击；广告订单=Report.Orders；CPC=花费÷点击；ACOS=花费÷广告销售额（Report 字段直接提供 Cost/Clicks/Orders/SalesAmount/CPC/ACoS）
- **产品映射**：`product_map.json`（结构 `{"catalog":[{series,name}],"asinMap":[{asin,series,name,country}]}`，云端 Supabase 为权威源），采集脚本自动读取并写快照进 `asinMeta`；构建脚本内嵌 `__MAP_JSON__` 兜底；未匹配 ASIN 归「无」
- **毛利口径（2026-10-10 新增，三看板共用）**：`毛利 = 销售额+促销折扣+销售佣金+配送费+商品成本+仓储费分摊+其他费用分摊 − 本看板广告花费`
  - 数据源=易仓「财务-营收利润 → 利润报表-ASIN」（见 §A.2b）。ERP 各项费用为**负值**，直接相加；广告费取**本看板自己**的广告花费列（正值）
  - ✅ **三看板广告花费口径已于 2026-10-10 对齐**（SB 归因修复落地）。下面保留完整根因，因为它决定了所有对账测试怎么写：
    - 日看板 = **全部**广告条目（`day.ads[国家]` 直接遍历累加；未选 ASIN 筛选时 `asinOk(null)` 返回 true，所以 SB 能被计入）→ 与 ERP 的 `otherTransactionFeeTotal` 口径一致（反推验证：2026-08 ERP 广告费 17,697 USD vs 日看板 17,721.74，误差 0.14%）
    - 月度/周看板 = 按 `(月/周, 国家, ASIN)` 聚合，**必须先把 SB 归属到具体 ASIN** 才能计入
    - **根因**：SP（商品推广）/SD（展示型推广）按 ASIN 投放、`Asin` 有值；**SB（品牌推广）按品牌/旗舰店/商品集投放，报表里 `Asin` 与 `Sku` 都为空**，只剩 `CampaignName`/`AdGroupName`/`PortfolioName` 文本 → 旧规则取不到 ASIN 就 `continue` 跳过，SB 整块丢弃
    - 修复前实测缺口：2026-07 丢 241.33、2026-08 丢 3,692.14、2026-09 丢 6,970.99、2026-10 丢 3,403.88 USD，**合计 14,308.34 USD**
    - **修复方式（已实施）**：归属规则收敛到唯一权威模块 **`ad_asin_rules.py`**，四级优先级
      1. 条目自带 `Asin`
      2. **活动名里的 ASIN 字面量** `B0[A-Z0-9]{8}` ← 运营已确认「后续会给 SB 广告标题加上 ASIN 码」，届时自动命中本层，下面兜底自动让位，**不需要改代码**
      3. `SPECIAL_ASIN` 精确名映射（历史遗留 3 条）
      4. 系列兜底（2026-10-10 运营逐条指认）：`Lite` → B0H9YBM4H1；`X1` → US/CA/MX 用 B0H69JJZ1M、其它站点用 B0HH8J6SSL
    - ⚠️ **兜底必须传站点**：同一个 SKU 在不同区域是不同 ASIN（实测 `US ACD-X1-40W-NA` → B0H69JJZ1M，`DE ACD-X1-40W-EU` → B0HH8J6SSL），漏传站点会把欧洲的 X1 归到北美 ASIN
    - ⚠️ **挡板**：活动名出现 `X1` 紧跟数字（如 `A-X140-*`）判为另一条产品线，不吃 X1 兜底 —— 实测 `A-X140-Auto` 的 `PortfolioName` 恰好也叫 "X1"，只看 PortfolioName 会误归
    - 三处构建调用方都必须引用该模块（自检 **G12** 守着这条线，防止副本再次分裂）：`aggregate_ads.py`（周）、`build_monthly_dashboards.py`（月）、`build_ad_dashboard_data.py`（ad.html）
    - **日看板是唯一在前端 JS 里跑归因的看板**（周/月/ad 都在 Python 侧算），所以它天然有一份 **JS 镜像**，必须同规则：
      - 2026-10-10 发现 `daily_dashboard_template.html` 里是**第四份副本**，且只有两级（自带 `Asin` + `SPECIAL_ASIN`）→ 全局视图口径正确（未选 ASIN 时 `asinOk(null)` 为 true，SB 能被计入），但**筛单个 ASIN 时 SB 被 `filterRows` 整块丢掉** → 该 ASIN 广告花费偏低、毛利偏高，页面上完全看不出来
      - 现已在 JS 侧补齐同一套四级规则（含 `X1_FALLBACK`/`LITE_FALLBACK` 与 `X1\d` 挡板），**所有 `extractAsin(it, cc)` 调用点都必须传站点**；G12 会同时校验模板与已构建的 `daily.html`
      - 实测（2026-09-07 筛 `B0H69JJZ1M`）：广告花费由 14.28 → 293.69 USD（其中 225.56 来自 SB 兜底归属、53.85 来自 Woot 注入行）
      - `test_daily_profit.js` ⑦/⑧ 锁死这条：期望值必须**从页面取广告条目**（`adItems()`）而不是读 `daily_data.json` —— 看板启动时会从 `pc_woot` 注入 Woot 广告行，只读源文件会恒差一截
    - 修复效果：2026-07 与 2026-08 的月合计已与源数据 / 日看板**完全一致**；未归属条目归零（全量 72,684.38 USD 全部有归属）
  - ⚠️ **「有广告费但无利润报表行」的行（2026-10-10 表述已修正）**：若归属到的 ASIN 在**该站点没有利润报表行**（如某国未上架），该行自身的「毛利」显示 —（没有利润行可挂），**但该笔费用仍会被月 KPI 扣掉** —— `aggMonth()` 对范围内**所有行**都累加 `adCost`，`pN` 只用来判断「该月到底有没有利润报表数据」。
    - ❌ 别再说成「不计入毛利」：早先 `verify_sb_attribution.py` 只累加 `pN` 为真的行，于是算出「看板毛利 = 源 + 孤儿」，看起来像口径边界；实测月度 KPI 差额恒为 **0.00**，已在脚本里修正为「所有行」口径并断言差额为 0
    - 存在的实测行：2026-09 UK `B0HH8J6SSL` 296.30、2026-10 UK 同款 522.41（折 USD 401.16 / 691.35）；另有一行**只在浏览器端**出现——Woot 注入的 `2026-09 US B0H69JJZ1M` 广告费 8,144.13（无利润行），所以「打开浏览器看月 KPI」与「直接算源数据」会差这笔 Woot 广告费
    - `build_monthly_dashboards.py` 每次构建会显式打印这批行（仅构建期固有的那批）
    - 日看板同理：单行 `aggRows` 在 `pRows === 0` 时毛利返回 null → 显示 —（`test_daily_profit.js` ⑦d 对此有分支断言）
  - 其他费用（推广服务费汇总+服务费汇总）按「日期 × 国家」内产品行数**均摊**；FBA月仓储费（含长期仓租）按「ASIN 月度值 ÷ 当月天数」分摊到每天（月合计不变）
  - **按亚马逊结算日期归属**，不是下单日期 → 与业务报告的销售额天然差 5%~15%，日视图存在跨天归集（某天有行但销售额为 0）。**不要试图逐日对齐两个口径**，只能月/周级对账
  - 不含：销售退款金额 / 税费 / 其他交易费（用户公式未列）
  - 已知覆盖缺口：利润报表只有 6 个站点（US/DE/UK/ES/IT/FR），CA/MX/NL/SE 等显示 —；数据自 **2026-07-15** 起
  - **Woot 走「供货价」模式（2026-10-10 用户确认口径，待实施）**：Woot 采购价 **1,380 USD/台**（注：Woot 报表里的 `sales` 是零售价约 1,899.98/台，**不能直接当收入**）；Woot 毛利 = `采购价 × Woot订单量 − 产品成本 − 运费 − 广告费`，需在 **woot.html 上传页新增「采购价」字段**后启用（「产品成本/运费」的来源待用户明确）
  - ⚠️ 当前实现（待 Woot 毛利落地后修正）：Woot 手工数据只有销售额与广告费、没有毛利口径，但它的广告费会被扣进 Amazon 毛利 → 毛利偏低（实测 2026-W40 多扣 2,232 USD）。Woot 数据在 localStorage `pc_woot` + 云端 Supabase 同步，测试时需 `addInitScript` 预设 `pc_woot=[]` 并拦 `supabase.co` 才能独立复现核心算法
  - 成本缺失（有销量但 `productCostTotal=0`）的行计 `miss=1`，毛利虚高，看板说明已标注
- **月度看板**：monthly.html（自然月聚合）与 target.html（月度目标追踪）由 build_monthly_dashboards.py 从 daily_data.json 重新聚合
- **月度目标文件 monthly_targets.json**：自动化只读取不修改；country 为**地区代码** NA/EU/UK/JP/AU（NA=US/CA/MX，EU=欧盟9国 DE/FR/IT/ES/NL/BE/IE/PL/SE，UK/JP/AU 独立）
- **人民币汇率口径（target.html）**：按每月 1 号 ECB 参考汇率（frankfurter.dev；1 号非工作日回退前一工作日）折算；缓存 `fx_rates.json` 自动增量更新，**不要删除**（fx_rates.json 本身不复制到 _deploy，汇率经 `__FX_JSON__` 内嵌）
- **广告占比追踪**：实际占比=¥广告花费÷¥销售额；目标为上限（越低越好）
- **筛选交互统一口径**：单击=单选替换；Ctrl/⌘+单击=多选追加/取消；单击唯一已选项=清空回全部；国家↔ASIN↔系列↔产品名 4 向联动；monthly.html 地区↔国家**双向自动同步**，下拉只显示有数据项（UK/JP/AU 无数据隐藏）；target.html 国家筛选=地区筛选。这些已内置，无需改代码。

### §A.1 前置自动登录

```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node auto_login_eccang.js
```
自动检测：127.0.0.1:9223 无调试实例 → 启动独立 Edge（profile `C:/Users/paddy/.workbuddy/edge-auto`）；检测到登录页 → 自动填表登录（YY-Paddy，**默认登录模式，不切 ERP1.0、不填客户代码**）；已登录 → 复用会话。返回 JSON，exit=0 且 ok=true 为就绪；否则如实汇报并停止。
（周一合并运行时 §A 已登录，§B/§C 重跑此脚本会直接复用会话，属正常。）

### §A.2 采集每日数据

```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node fetch_daily_data.js
```
- 通过 Edge CDP 调易仓 /traffic/list（逐天注入 13 国 user_account + 日期范围）与 ProductAd.GetFlatViewList（逐天×13国，同日并发），按北京时间日期合并保存 daily_data.json（保留历史，按日期覆盖），自动应用 product_map.json
- 某天无数据（接口正常响应但行为空）= 数据延迟或确实无流量，**不重试**；仅接口无响应才重试
- 结尾「⚠️ 数据完整性告警」（缺 US / 全天无数据等）= 源数据按店铺同步延迟，已自动标记 incomplete 纳入复查，无需处理，但**必须列入汇报**
- 结尾「🔁 校准台账」列出本次重算天数与被上游改数的日期（指标 A→B）——是上游正常修正，**必须如实列入汇报**，不要当成故障、更不要为消差异重跑
- **常规运行不要**手动指定更早范围、不要手动调 CALIB_PER_RUN 跑全量普查（轮转自动覆盖整个窗口）

### §A.2b 采集毛利数据（易仓利润报表 → 三看板共用）

```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node fetch_profit_data.js
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && python build_profit_metrics.py
```
- ⚠️ **这两条必须成对执行，不能只跑第一条**（2026-10-13 复核确认）：
  `build_daily_dashboard.py` / `build_monthly_dashboards.py` 是 `import build_profit_metrics; build()` **在内存里重建、不落盘**，
  **只有 `python build_profit_metrics.py` 才写 `profit_metrics.json`**（`build_profit_metrics.py:447` 是唯一的写入点）。
  而**周看板的 `integrate_profit.py` 只读这个文件**（常量 `PROFIT_METRICS` 指向本项目 `profit_metrics.json`），
  `verify_sb_attribution.py` 与各对账探针也读它 ⇒ 漏跑这一条，周一链路（§C.4）会拿**上一版**毛利算周报、
  所有读该文件的测试全部偏旧（实测曾出现文件 14:10 vs 源 15:03；源 1674 行 → 落盘应 1680 行）。
  **日/月看板不受影响**（它们直接吃内存里的结果），所以漏跑是"只有周报和测试看起来错"的静默故障。
- ⚠️ **第三层依赖：映射与成本表（2026-10-13 第八轮新增）**：`build_profit_metrics.py` 的**「商品成本」现在由「产品成本表 `costRMB` × 件数 ÷ 当月汇率」解析**，ASIN→产品名走**「产品关系管理」**（云端映射），**不再取易仓 `productCostTotal`**（易仓原值只落 `costErp` 供审计）。
  ⇒ **改过「产品关系管理」映射或 `product_cost_table.json` 之后，必须重跑 `python build_profit_metrics.py` 再重建看板**，否则日/月（内存重建，吃新映射）与周看板 + 各测试（读盘，旧值）**两套口径**。
  ⇒ 映射有**两份文件**：`_map_cache.json`（**生效**，`load_map_prefer_local()` 优先它，且**测试脚本会从云端刷新它**）与 `product_map.json`（**构建期内嵌用**）。`refresh_map()` 现已按生效映射的 mtime 判新鲜度并在跳过时**镜像对齐**内嵌映射，自检 **G19** 兜底断言「生效 ⊇ 内嵌」。
- 复用 §A.1 的 Edge 调试实例（CDP 9223）；接口是 `datacenter.eccang.com/ratel/api/productAsin/queryPage`，**必须在 Node 侧用 `context.request.post`**（页面内 fetch 会被 CORS 拦成 `Failed to fetch`）
- 产出 `profit_data.json`：`days[日期]` = 该日利润行（ASIN×店铺×站点，原币种），`months[月]` = 月度查询（月仓储费只在这里有值）
- 增量策略：**补空缺天 + 复核最近 6 天**（`REFRESH_DAYS`）+ 每月重抓一次月度（取月仓储费）。结算数据滞后仅 1~2 天，但 ERP 侧会被上游滚动修订（实测 9 月毛利同日从 6180→8192），所以必须反复复核而非只补缺
- 阶梯落盘 `profit_data.json.part` + 备份到 `backups/profit_data_*.json`（保留 4 份）；同步日志 `_fetch_profit_sync.log`
- 可选参数：`--force` 全量重抓 / `--from 2026-06-01` / `--to YYYY-MM-DD`
- ⚠️ **日期函数禁止用 `toISOString()`**：GMT+8 下会回退 8 小时使 `addDays(x,1)` 返回同一天 → 日期循环死循环把 Node 堆吃爆（实测 OOM 4GB、exit 134，`--max-old-space-size` 无效）。脚本已用 `fmtLocal()` 本地格式化，改脚本时不要退回
- ⚠️ `site` 字段会漏空（实测 1631 行里 53 行空），**用店铺 `userAccount` 后缀反推站点**（`Aliencell_Direct_DE` → `DE`）——`build_profit_metrics.py` 的 `site_of()` 已处理，不要绕过它直接用 `r['site']` 分组
- 补充历史：`node fetch_profit_data.js --from 2026-06-01`（利润报表数据自 2026-07-15 起，更早返回 0 行）

### §A.2c 成本表上云 + 未映射提醒（2026-10-21 新增）

**① 成本表已上云**：`product_cost_table.json` → 云端 `mapping.data.costTable`，所有应用读同一份。

```
python upload_cost_table.py            # 本地 → 云端（读最新 data → 只换 costTable → 整体 PATCH）
python upload_cost_table.py --dry-run  # 只比对不写
```
- 读取端统一收口 `cost_from_table.cost_table_doc()`：**云端优先** → 6h 快照缓存 `_cost_cache.json` → 拉不到回退本地文件。
  已接入 4 处：`build_profit_metrics.py`(Resolver) / `build_daily_dashboard.py`(头程 + Woot 成本) / `build_monthly_dashboards.py` / `build_joybuy_profit.py`。
- ⚠️ **本地文件仍是编辑入口**：改完 `product_cost_table.json` 必须跑 `upload_cost_table.py`，
  否则只有本机构建吃新价、别的应用仍是旧价。防呆已内置：本地 mtime 比快照新 ⇒ 用本地并打印「记得上传」。
- ⚠️ **成本数据不要放进 `_deploy/`**（静态站，谁拿到链接都能下）。云端 `costTable` 与 mapping 同权限（anon key 可读），
  属于"内部工具可接受"的暴露面；要收紧就得改成独立表 + RLS，先别擅自加。

**② 未映射提醒**（挂在 `build_daily_dashboard.py` 末尾自动跑，失败不阻断构建）：

```
python sync_unmapped.py                # 扫近 30 天 → 写云端 mapping.data.unmapped + _unmapped.json
python sync_unmapped.py --dry-run      # 只打印
python sync_unmapped.py --days 60      # 换窗口
```
- 两类问题：`no-map`（映射里没有这个 ASIN，页面归「无」、成本 0）、`no-cost`（映射到的产品名不在成本表，成本仍 0）
- 前端：`mapping.html` 顶部红条 + 首次自动弹窗（每条可直接选产品名建立关系，建完立刻从清单消失）；
  `index.html` 左侧「产品关系管理」旁红色感叹号（60s 轮询 + map-changed 即时刷新）
- 单独测试：`node test_unmapped_notice.js`（13 项，含「弹窗行数 = 云端清单实时过滤后条数」这类动态断言，别写死数字）

### §A.2d 匹配列表三层视图 + 改映射页的测试红线（2026-10-21 新增）

**① 三层树**（`mapping.html` 「ASIN 匹配」tab 的匹配列表）：

```
按系列  →  🏷️ 产品系列  ›  🌍 国家/地区  ›  📦 产品名  ›  ASIN 行
按国家  →  🌍 国家/地区  ›  🏷️ 产品系列  ›  📦 产品名  ›  ASIN 行
```
- 折叠状态是**「已折叠」集合 `collapsedAsin`**（不是老的 `openAsin`）⇒ **默认全部展开**，点一次收一层。
  localStorage 键名沿用 `pc_open_asin`（存的内容变语义），老数据不匹配新 key → 顶多表现为全展开，无害。
- 树 key 形如 `s:X1系列` / `s:X1系列›c:US` / `…›n:X1主机`（`›` = `\u203a`，产品名里不会出现）。
- 排序：**国家按 `COUNTRIES` 固定顺序**（EU/UK/US/CA/JP/AU），系列/产品名按中文拼音，**「无」一律沉底**。
- **单产品国家不单开 L3**：该国家下只有 1 个产品名时，产品名内联进国家头（`🌍 US · 📦 A主机`），直接列 ASIN 行。
  51 条真实数据下从 113 行降到 65 行左右，不牺牲信息。
- 回归：`node test_mapping_tree.js`（25 项）。老测试 `test_mapping_country_filter.js` 的 `expandAll/collapseAll` 已同步改新语义。

**② ⚠️⚠️ 改映射页的 playwright 测试必须先拦住写链路**（2026-10-21 真实事故）：
- `mapping.html` 的 `saveAll()` → 400ms 防抖 → `cloudSave()` → **直接 PATCH 云端**。
  测试里只要碰一下 `rowSeriesChange` / `rowNameChange` / `delAsin` / `saveAll`，**假数据就会真的写进生产云端**。
- 事故经过：临时脚本注入 6 条假数据验证三层树，`PATCH` 未拦截 ⇒ **云端 `asinMap` 51→5、`catalog` 26→3**。
  靠 `_map_cache.json` 全量回滚恢复（51/26 逐字段一致），其它键（woot/freight/wootCfg/unmapped/costTable）未受影响。
- **写测试的硬要求**（两条都要）：
  ```js
  await page.route('**/rest/v1/mapping*', async route => {      // ① 网络层：GET 给假数据，PATCH 只计数
    if (route.request().method() === 'PATCH') { patches++; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: FIXTURE }]) });
  });
  await page.addInitScript(() => {                              // ② 存储层：业务键不让落本地
    const o = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('pc_') === 0) return; return o.call(this, k, v); };
  });
  ```
  只加 `window.fetch` 包装不够稳（XHR/顺序问题都会绕开），**`page.route` 才是兜底**。
- **写完测试第一件事**：核对云端条数，别等用户发现：
  ```
  # 期望 51 / 26 / 25 产品 / unmapped 4
  ```
**③ 应急恢复**：`python restore_cloud_map.py`（从 `_map_cache.json` 恢复 `asinMap` + `catalog`，只换这两个键、
回读逐字段校验、打印残留测试行；`--dry-run` 只比对）。恢复后**必须**核对 `woot/freight/wootCfg/unmapped/costTable` 仍在。

### §A.2e 产品成本表页（💰 tab，仅管理员）+ 管理员权限（2026-10-21 新增）

**在哪**：`mapping.html` 第三个 tab「💰 产品成本」。表格 11 列：产品名 / 成本¥ / 头程 US·EU·UK /
尾程 US·EU·UK / 关联 ASIN 数 / 状态 / 操作。可直接改、可新增、可删除、可导出 CSV、可导入 CSV 批量回填。

**它解决的两个坑**（这两个坑以前是"看不见的错"）：
1. **目录里有产品名、成本表却没有这一行** ⇒ 这类产品一旦有 ASIN 映射，成本就是 0、毛利虚高，但页面
   以前根本不会把它列出来。现在表格会把它们**合成为「待补」行**（黄底 + 目录里有，成本表还没这一行），
   填了值才真正落到 `costTable`，没动过就不写进云端。
2. **成本表有行、但目录里没这个名字** ⇒ 永远匹配不上（当前 `气泵` 就是）。现在标「匹配不上」+ 红底。

**状态判据**（`costHealth()`，4 类）：
- `缺成本`（红）＝ `costRMB` 不是正数
- `缺头程 US/EU/UK`（黄）＝ costRMB 有但某个区域 `headRMB` 不是正数
- `匹配不上`（灰红）＝ 目录里没这个名字，且没有 ASIN 用它
- `暂未使用`（灰）＝ 成本齐全但暂时没有 ASIN 指向它（备而不用，正常）
- `OK`（绿）＝ 三项齐全且被 ASIN 使用

**权限（两道，任一命中即为管理员）**：
1. `wb_auth.role === 'admin'` —— 正道。角色由 `login.html` 从 `profiles` 表拉到后写进 `wb_auth`，
   `index.html` 右上角能直接看到「管理员 / 访客」；改角色走「👥 用户管理」`admin_users.html`。
2. 云端 `mapping.data.costAdmins` 邮箱白名单 —— **救急通路**。用 `python set_cost_admin.py add <邮箱>` 维护
   （`remove` / `clear` / `--dry-run`）。本机会缓存一份（`pc_cost_admins`），云端拉不到也能进。

> 为什么要留白名单：如果 `profiles` 里某个账号 role 还是 `viewer`，那他自己也看不到刚做的成本页，
> **而且没有任何报错，只是 tab 不出现**。这时候白名单是唯一能自救的路。

**防误操作的三条**（都是故意的）：
- 保存是**显式按钮**，不做自动推送 —— 成本是敏感数据 + `id=1` 单行共用，误推代价很大。
- 新增行时产品名走 `<datalist>` 自动补全目录产品名；**手打一个目录里没有的名字会弹二次确认**
  （成本按产品名精确匹配，拼错就永远对不上 ⇒ 毛利虚高且无报错）。
- 删除被 ASIN 使用的成本行会提示「正被 N 条映射使用」。

**⚠️ 改完必须重跑构建**：表格里改的是云端 `costTable`，而看板里的成本/头程是**构建期内嵌**的，
所以「保存到云端」≠「毛利立刻变」。顺序是 `python build_profit_metrics.py` → 重建看板 → 部署；
不然就等次日 15:00 的定时任务。

**测试**：`node test_cost_table_admin.js`（54 项；访客不可见/深链被弹回、表格数值与 fixture 逐格比对、
仅看待补、编辑→dirty→保存拦截、草稿行 datalist、导出 CSV 内容、白名单兜底）。
**跑完最后两条是硬的**：真去核云端 `costTable` 仍 25 个产品、`asinMap` 51 / `catalog` 26 未被测试污染。

**⚠️ TDZ 红线（G20）**：这块 JS 变量（`costAdminSet` / `costTable` / `costSig`…）**必须声明在脚本顶部**。
`applyAdminUI() → isAdmin()` 是在初始化流里**同步**调用的，若把这些 `let` 写在文件末尾，
初始化时读它就会踩 TDZ，**整个页面的 script 直接崩掉**（`Cannot access 'costAdminSet' before initialization`），
连 tab 都渲染不出来 —— 测试第一版就是这么炸出来的。

### §A.2f 月度看板「销售趋势」三张曲线图（2026-10-23 新增）

`monthly.html` 筛选区下方三张折线：**总计 / 主机 / 配件**，每张两条线
（销售额 = 业务报告 `sales`；营收额 = 销售额 − 促销）。纯 SVG 手绘，**不引第三方图表库**
（看板是单文件自包含，CDN 挂了就全白）。代码在模板 `renderCharts()` / `chSvg()` / `chBucket()`。

**⚠️ 分类规则（最容易踩）**：系列名带「系列」后缀，且配件系列也含 "X1"：

| 系列 | 归类 |
|---|---|
| `X1系列` / `X1 Lite系列` / `E1系列` | 主机 |
| `X1系列配件`（激光头/蜂窝板/增高底座/净化器/吸尘器/材料包） | **配件** |
| `无`（未映射）/ `Woot` | **不归类**，只计入总计 |

所以判据是 `String(series).replace(/系列$/, '')` 后**精确匹配** `X1` / `X1 Lite` / `E1` ——
绝不能按"包含 X1"或前缀判断，否则 `X1系列配件` 会被错判成主机。

**⚠️ 口径三条**：
1. **营收 = `sales + pPromo`**（`pPromo` 在易仓里是**负数**），不是减法。
2. **图表不含 JoyBuy**（用户 2026-10-23：JoyBuy 还没做产品映射）。因此
   `图表合计 + JoyBuy = 表格合计`，两者数字天然略有差异（当前 JoyBuy 全期仅 ~$1.6K）。
3. **X 轴跟随月份筛选**（`filteredRows()` 本身不含月份维度，`chartRows()` 里单独补的），
   否则"表格只算所选月、图是全期"会对不上。

**⚠️ 纵轴刻度 = 固定 20K 一格**（用户 2026-10-23 要求，**不要退回 1/2/5「好看步长」**）：
- `CH_STEP0 = 20000`，`chNiceStep(maxV)` 只在网格线会超过 9 条时才 `s *= 2`，
  即刻度恒为 **20K 的整数倍**（20K→40K→80K…），绝不会出现 25K 这种碎刻度。
- 非 USD 币种：`chStepBase()` 把 20K 美元按当前显示币种折算（`fxv(20000,'US',ym)`），
  再**对齐到 20K 的整数倍**（CNY ≈ 140K/格，避免出现 142K 这种数）。

**测试**：`node test_monthly_charts.js`（37 项）。关键断言是
「图表 + JoyBuy = 页面表格合计」（证明既没漏算也没重复算）、「三组覆盖全部行」、
「只筛一个月时单点仍绘制」。金额/月份数一律现算，别写死。

### §A.3 / §A.4 重建看板

```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && python build_daily_dashboard.py
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && python build_monthly_dashboards.py
```
- daily.html：单文件自包含，业务+广告+环比+4向联动筛选+列选择面板；头部自动显示「数据完整至 X」与「🔁 已校准 N 天…」
  - **毛利列（2026-10-10 新增）**：构建时读 `profit_data.json` 经 `build_profit_metrics.py` 均摊后注入 `__PROFIT_JSON__`，页面按日期建索引；列选择面板可开关「毛利/毛利率」两列（默认显示）；毛利按当前国家/ASIN/系列/产品名筛选对齐，广告费扣本看板的广告花费
  - 缺 `profit_data.json` 时降级为空 → 毛利列显示 —（构建会打「警告: 毛利数据构建失败」），不阻断 daily 构建
- monthly.html：19 指标口径与周度汇总一致，地区筛选 NA/EU/UK/JP/AU 在国家之前、双向自动同步
  - **毛利列（2026-10-10 新增）**：构建期把毛利字段直接合并进 `DATA.rows`（`pSales/pPromo/pComm/pFba/pCost/pStorage/pOther/pN/pMiss`）；月度聚合按自然月；只有利润数据、没有业务/广告数据的 (月×国家×ASIN) 会自动补建一行，否则毛利整块丢失（实测补建 66 行）
- target.html：读 monthly_targets.json；目标/实际销售额均人民币（每月1号汇率，缺失标⚠汇率）；销量+销售额完成率+广告占比目标 vs 实际；示例数据带警示条
  - **平台筛选（2026-10-09 新增）**：筛选区第一项「🧩 平台」= Amazon / JoyBuy / 速卖通，单选切换，切换后目标、实际、KPI、筛选项全部按该平台口径重算
    - Amazon = daily_data.json 月度聚合（原口径不变）；JoyBuy = **joybuy_monthly.json**（由 `build_joybuy_monthly.py` 从 `joybuy_compass_data.json` + `joybuy_sku_map.json` 聚合，构建时自动跑，无需单独命令）；速卖通 = 尚未接入 → 显示「数据尚未接入」占位
    - 目标表可用可选字段 `platform`（amazon/joybuy/aliexpress，缺省=amazon）指定归属平台；未指定目标的平台（当前 JoyBuy）表格自动退化为「实际数据视图」（产品×站点×月，目标列—），KPI 后两卡由广告占比换成「店铺流量(PDP UV)/加购」
    - JoyBuy 口径：站点月合计取 Data Compass **日粒度趋势**（权威），产品维度取 **SKU 周报**（跨月周按重叠天数分摊）并按站点合计**等比例校准**（系数见 joybuy_monthly.json 的 recon/scale），保证表格各行相加 = KPI 合计
    - JoyBuy 数据刷新：需重跑 `node joybuy_compass_fetch.js`（Data Compass 会话），再走 §A.3 构建即可；TLS/会话过期时看板沿用上次聚合值
- 两看板头部同样显示完整性与校准提示（某天缺数会让当月合计偏低，必须让用户看得见）
- 构建会自动增量更新 fx_rates.json（新增月份才联网），属正常

### §A.5 部署

```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38
cp daily.html monthly.html target.html _deploy/
cp product_map.json _deploy/product_map.json        # 若存在
cp daily_data.json _deploy/daily_data.json          # 映射管理页「从每日数据导入ASIN」依赖它
cp mapping.html _deploy/mapping.html                # 静态文件，通常不变
cp _unmapped.json _deploy/_unmapped.json            # 未映射清单（mapping 页离线兜底，2026-10-21）
# ⚠️ 不要把 product_cost_table.json 复制进 _deploy/ —— 成本是敏感数据，静态站上谁都能下
cp finance_inputs.html finance_inputs.json _deploy/ # 财务录入窗口(其他渠道订单/测评费) —— 2026-10-12 新增
```
- **不要覆盖** `_deploy/index.html` / `ad.html` / `product.html` / `joybuy.html`（各有归属）
- `_deploy/index.html` 本轮改过（新增「🧾 财务录入」入口按钮 + `openFinance()`），它在 `_deploy/` 下就地维护、仓库根目录**没有**同名源文件；再发布时**不要**用别处的 index 覆盖它
- `mapping.html` / `woot.html` 的云端写回已改为「读最新 → 合并 → PATCH」（否则会抹掉 `finance` 键），改这两个文件时不要退回「只写自己的键」
- 调用「发布为应用」skill（workbuddy_sites_deploy）：action="deploy"、directory="C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38\_deploy"、language="static"（复用 sandboxId 3577d1e878e64dc5837e56f9471dcefc，链接不变；变化则醒目提示）
  - ⚠️ **发布需要「本轮用户消息里明确要求发布」，同意不跨轮继承**（skill 的 Step 0 硬门槛；没要求时工具会返回 `sites_deploy_needs_confirmation`）。所以**先本地改完 + 让用户看本地预览 + 问一句**，得到明确答复再发
  - ⚠️ **自动化在本机跑 ≠ 线上已更新**：15:00 自动化只 `cp` 到 `_deploy/` 不发布（见其记忆）；反过来，若自动化在本地修好之前就部署过，线上会留一版**带 bug 的产物**（2026-10-13 线上 `monthly.html` 因加载期 TDZ 整页空白就是这种情况）⇒ **改完这类问题要主动核对线上是否已坏**
- 部署后 curl 验证 index/daily/monthly/target/mapping.html 与 product_map.json 均 HTTP 200
- ⚠️ **比对线上/本地一致性时别拿 JS 的字符串 `.length` 当字节数**：`fs.readFileSync(p,'utf-8').length` 是**字符数**（中文页会明显小于字节数；实测 product.html 564,161 字节 = 548,029 字符）。要 `curl -o 文件` 后 `cmp`，或比 Buffer 长度 —— 否则会得出「线上是旧版」的假结论

### §A.6 自检

跑「通用环境」一节的 check_data_integrity.js。附加判读：
- G8 WARN = 源延迟，自动复查补齐，正常；G9 WARN = 温区未轮到，正常；**G9 FAIL（近14天无 lastChecked）= 采集脚本没跑或被降级，必须排查**
- G10 FAIL = target.html 平台筛选缺失/JoyBuy 月度数据为空/**构建占位符泄漏**（文案里写了 `__XXX__` 会被全局替换成整段 JSON 印在页面上，真实踩过）→ 查 build_joybuy_monthly.py 与模板占位符
- **G11 FAIL（毛利+费用占比+头程）= 利润报表采集链路没跑 / 看板没重建 / 成本表没注入**：六项检查 ①`profit_data.json` 采集距今 ≤3 天 ②`profit_metrics.json` 有行 ③日/月/周三看板都含毛利列与毛利数据 ④无占位符泄漏（含 `__HF_JSON__`）⑤**11 个费用占比/绝对值键**（`costPct` / `fbaAbs` / `fbaPct` / `promoAbs` / `promoPct` / `storageAbs` / `storagePct` / `headAbs` / `headPct` / `otherAbs` / `otherPct`）都在 ⑥**头程成本表真实注入且非空** → 先跑 §A.2b，再跑 §A.3 两个构建（周看板另跑 §C.4 的 integrate_profit.py 四步）
  - ⑤ 的典型症状 = 只看板少了新列 → 说明有人**从旧模板重建**，或改了模板忘了同步 `build_daily_dashboard.py` / `build_monthly_dashboards.py` 的 `__HF_JSON__` 注入
  - ⑥ 是**故意查数据不只查键名**：`const HEADRMB = {}` 这种空表也能让 `headRmbOf` 存在，但看板会**静默显示头程 = 0**（头程% 全 0，且完全看不出报错）。标记取 `product_cost_table.json` 第一个产品名 + `"US":`，数据为空/文件缺失都会 FAIL
- **G12 FAIL（广告 ASIN 归属规则）**：某个构建脚本没有 `from ad_asin_rules import`，或者又自己写了一份 `SPECIAL_ASIN` 副本 → **不要各自修**，改回引用共享模块。副本漂移的代价是毛利挂到别的产品上且看板里看不出来
  - 也可能是**日看板 JS 镜像退化**：`daily_dashboard_template.html` / 已构建的 `daily.html` 里 `extractAsin` 少了站点参数、缺 `X1_FALLBACK`/`LITE_FALLBACK`、缺 `X1\d` 挡板，或出现 `extractAsin(it)` 漏传站点 → 按 §A.0 的四级规则补齐后**重建 daily.html 并同步 `_deploy/`**（只改模板不重建同样会 FAIL）
  - ⚠️ 占位符检查用**精确名单**（`__PROFIT_JSON__` / `__HF_JSON__` 等），不能用 `__[A-Z_]+__` 泛匹配 —— 周看板里有同形的 JS 变量名 `__PC_MAP__`，泛匹配会误报（2026-10-10 踩过）
- **G13 FAIL（销售店铺渠道筛选 / Woot 成本设置）**：某个看板丢了「销售店铺」筛选，或 `woot.html` 的采购价/成本字段/云端 `wootCfg` 丢了。**判读分两类**：
  - *行过滤式*（日/月/**目标**/**广告**）—— 必含 `channelOf` + `channel:'woot'` 注入标记；缺 `channel:'woot'` 说明 Woot 行/记录没打标，渠道根本拆不开
  - *逐键相减式*（周看板 `product.html`）—— 必含 `channelMerged` + `wootParts` + `wootAdParts`；它**没有** `channelOf`，别照着其他看板去"对齐"
  - 重建要求：日/月/目标/广告改模板后**必须重建并 cp 到 `_deploy/`**（日看板跑 §A 链、月/目标跑 `build_monthly_dashboards.py`、广告跑 `build_dashboard_html.py`）；周看板改 `integrate_ads.py` 后**必须重跑 §C.4 四步再 cp**（只改脚本不重建同样 FAIL）。若周看板整页白屏，先查 `integrate_ads.py` 注入块里有没有裸 `\'`（必须是 `\\'`，见 §C.4）
  - ⚠️⚠️ **周看板加「数值字段」必须改两处 acc 字面量，否则单看 Woot 的合计变 NaN（2026-10-10 踩过）**：`asinWeekData` 的 `acc` 和 `wootPartAcc` 的 `acc` 是**两份独立硬编码的键列表**（都在 `integrate_ads.py` 里），后者注释写着「必须与 asinWeekData 同形状」但很容易忘。加 `pQty/pHead` 时只改了前者 → `calc()` 里 `totals.pQty += undefined` = **NaN 污染单看 Woot 的整个 KPI**，而合并/单看官方店铺看不出问题。**新增字段时三处一起改**：① 两个 `acc` 字面量 ② `WT_PKEYS`（新毛利键要加进去，否则「单看官方店铺」会把它减成负数）③ 合并分支的 `rm.pX = chNum(all.pX) + chNum(w.pX)`（Woot 的贡献要叠加）。护栏：`test_woot_channel.js` 的「wootPartAcc 与 asinWeekData 键集一致」+ 反证断言，形状漂移会立刻红
  - **新增两项（2026-10-10 采购价每行可填）**：「缺 `wootPriceOf` 逐行采购价取值」= 退化成「默认价 × 订单量」，**同一 ASIN 不同批次采购价会算错**（数值只在逐行价 ≠ 默认价时才偏，平时看不出来）；「woot.html 表头识别缺 price 列 / 缺 onRowPrice / 缺「采购价」字样」= 用户上传时那个价填不进来
- ⚠️ **`localSig` 与 `cloudSig` 必须同段数（2026-10-10 踩过，提示条点不掉）**：日/月/周看板给「云端更新提示条」算签名时，`localSig()` 有 **4 段**（`pc_woot` / `pc_catalog` / `pc_asinmap` / `pc_woot_cfg`），而 `cloudSig(j)` 早先只有 **3 段** → **两边永不相等 ⇒ 提示条一直挂着、「立即刷新」点完又回来**。目标/广告看板因为不读 `pc_woot_cfg`，两边都是 3 段，反而正常 —— 所以**只有日/月/周三个看板的 `test_update_notice.js` 会红**。给签名加字段时**两边一起加**，并做 `j.x == null ? null : j.x` 归一化（云端没这个键 == 本机没存过）
  - 另有一个**非 FAIL 但会静默不一致**的点：五看板的「合并看（全部）」按钮 class 必须一致（现统一为朴素 `btn`）。`test_channel_ui_sweep.js` 会收集 5 个按钮的实际 class 做比对，改了某一家的 class 就会红
  - **渠道筛选回归怎么跑**（改过任何看板的渠道逻辑后必跑）：
    - 走 `_deploy/` http 服务（**必须从 `_deploy/` 起**，端口 8896）：`node test_channel_ui_sweep.js`（76 项，5 看板 UI 一致性）、`test_woot_rowprice.js`（55，**每行采购价**）、**`test_woot_cost_map.js`（19，Woot 成本经「产品关系管理」解析 + 手工配置优先）**、`test_woot_channel.js`（26）、`test_woot_margin.js`（22）、`test_woot.js`（49，含 ad.html 跨浏览器可见性）；提示条走 8899：`test_update_notice.js`（65）
      - ⚠️ **改过 `wootUnitCost` / `wootCostFromMap` / `__COST_JSON__` / 产品映射块位置后必跑 `test_woot_cost_map.js`**；它**不硬编码真实 ASIN**（动态从 `product_cost_table.json` 造合成 ASIN + 从 `fx_rates.json.rates` 取汇率），所以数据换了也不会失效。自检 **G16/G17** 是它的静态护栏（G17 = 映射块必须早于 Woot 装配块，防加载期 const TDZ）
    - 走 file://（直读工程目录）：`node test_target_channel.js`（49）、`test_ad_channel.js`（46）、`test_target_platform.js`（33）、`test_monthly_dashboards.js`（60）
    - **孤儿/合计层专用**：`node test_orphan_totals.js`（11 项，file://，**改过 `integrate_profit.py` 的「孤儿单元补进合计」或周看板渠道包装后必跑** —— 它自己造合成假孤儿并做反向对照，不依赖当期数据是否有非 0 孤儿）
    - **周看板汇率专用**：`node test_week_fx.js`（13 项，file://，**改过 `generate_filterable_report.py` 的 `FX_WK` 注入、`integrate_profit.py` 的 `rmbRateOf/fxTbl`、或任何 `fxv()` 调用点后必跑** —— 含「把某周汇率缩放 1.5× 则该周 RMB 必须同步变」的反向对照，防止回退成「全表用最新汇率」的旧口径）
    - **JoyBuy 利润链路**（无浏览器，纯 JSON 产物）：`node test_joybuy_profit.js`（38 项）。前置链：`node fetch_joybuy_orders.js` → `node fetch_joybuy_bills.js` → `python build_joybuy_profit.py`。**改过 `joybuy_cost_config.json` / `build_joybuy_profit.py` / 费项词表后必跑**；它把「未成交订单不得计产品成本」「账单孤儿费项不得丢弃」两个静默陷阱写成断言，并覆盖 MCF 按费率卡出费、费率卡信息/`mcfRule` 可追溯、算不出必须进 `missingMcf`、超范围必须进 `mcfOverRange`
    - **说明块折叠**：`node test_note_fold.js`（63 项，file://，需登录态注入）—— **改过任何 `details.noteFold` 结构 / 折叠 CSS-JS / 说明块文案或填充逻辑后必跑**；断言「默认全部收起 / 点击能展开且高度变大 / 再点能收起且高度回落 / 空内容块被隐藏 / 无 JS 报错」。⚠️ **必须桩掉 Supabase**（`ctx.route('**/rest/v1/mapping*')` 返回空 catalog/asinMap + 预注入 `pc_woot='[]'`），否则页面 `cloudWootSync` 触发 `location.reload()`，点击后的 evaluate 会报 `Execution context was destroyed`（2026-10-13 踩过）
    - **看板默认状态**：`node test_panel_defaults.js`（25 项）—— **新增或修改任何筛选器、或改动某看板的默认值后必跑**；核心是通用不变式「页面上每个 `.dd-summary` 默认文本都必须表达『全部/不筛选』」（比逐个 id 断言更强），另加每日全窗口天数、月度「N 个月合计」、目标默认「🌐 全部平台」、周/广告默认「全部（合并）」
    - **月度看板平台筛选**：`node test_monthly_platform.js`（41 项，file://，需登录态注入 + 桩 Supabase）—— **改过月度看板的 `plat`/平台下拉/JoyBuy 行并入/`rowMatch` 调用点后必跑**；核心是**用页面自身三个视图互验加和关系**（全部 = Amazon + JoyBuy 的 sessions/sales/units；全部平台的广告花费必须等于 Amazon 的 —— 不被 JoyBuy 摊薄），另有「单看 JoyBuy 时广告与毛利列全为 —」的渲染断言、与 `joybuy_monthly.json` 的动态对账、地区联动、以及「模板与产物 rowMatch 均 8/8 无漏传」。⚠️ 筛选下拉**选中后不自动收起**，`openDD()` 要先判 `open` 类，否则第二次点 `.dd-btn` 是把面板关掉 → 选项点击超时
    - **MCF 尺寸分段匹配专用**：`node test_mcf_fee.js`（33 项，无浏览器，纯 JSON）。前置链：`node gen_mcf_rate_card.js`（只在**费率卡源头变了**时跑：换官方 PDF / 改计算器 `MCF_RATES`）→ `python build_joybuy_profit.py`。**改过 `mcf_fee.py` / `mcf_rate_card.json` / `product_dims.json` / `gen_mcf_rate_card.js` 后必跑**。核心是 **JS 独立复算与 Python 产物逐条交叉比对**（故意不共用实现，只共用 `mcf_rate_card.json`），另有边界（计费重 = 档上限 / +1g）、两条反向对照（同货 DE vs FR 金额必须不同；超范围货压回档内必须不再 over）、以及 NL 币种静默陷阱与「燃油必须读自费率卡顶层而非兜底默认值」两条断言
    - ⚠️ 后两个新测试**自带映射预取**（云端 → `_map_cache.json` 回退）；若首次在离线环境跑、且没有缓存文件，会直接判 FAIL 中止，属正常保护，不是代码坏了
    - ⚠️⚠️ **拉真实云端数据的测试必须把 `pc_woot_cfg` 一起种，而且必须复刻看板的规范化结果（2026-10-10 踩过）**：看板 `cloudWootSync` 的判等是 `JSON.stringify` **字符串比较**，且云端 cfg 会先被规范化成 `{price: Number(price)>0 ? price : 1380, cost: obj}`（**键顺序固定 price→cost**）。测试里直接种 `md.wootCfg` 原始对象 → 键顺序/兜底值不同 → **永不相等 → 每次加载都 write + `location.reload()`**，表现为测试中途 `Element is not attached to the DOM` / `Execution context was destroyed` / 点击生效但选中态被重载清掉（`test_monthly_dashboards.js` 的「系列单选生效」莫名 FAIL 就是这个）。修法：种子里写成
      ```js
      const c = md.wootCfg && typeof md.wootCfg === 'object' ? md.wootCfg : null;
      localStorage.setItem('pc_woot_cfg', JSON.stringify(c ? {
        price: Number(c.price) > 0 ? Number(c.price) : 1380,
        cost: (c.cost && typeof c.cost === 'object') ? c.cost : {} } : null));
      ```
      **另一条更稳的路**：像 `test_monthly_profit.js` / `test_product_profit.js` 那样 `ctx.route('**supabase.co/**', r => r.abort())` 直接断网，本地种 `pc_woot='[]'` 即可（拉不到云端就不会 reload）。`test_ratio_cols.js` 的做法是**本地种子与拦截响应完全一致**（两边都 `woot: [], wootCfg: null`）—— 三种都行，**唯独「拉真云端却只种一半」不行**

### §A.7 汇报（要点）

- 自动登录状态；本次刷新范围（热区/空缺/温区各多少天）
- **数据完整性（必报）**：daily_data.json 顶层 pendingDays 与 days[d].incomplete →「数据完整至 X」+ 待补明细
- **重新校准台账（必报）**：calibration.changed 的天数与典型差异（如"08-09 广告花费 746.17→737.31"）
- 数据文件累计天数、最早日期（应为 2026-06-23）；产品映射 ASIN 数；广告哪些国家有数据（通常 US/DE，其他为 0 正常）
- 合计指标：总流量/订单/销售额/广告点击/广告订单/花费/销售额/ACOS
- 月度看板：覆盖月份、"进行中"标注、⚠汇率有无、目标是否示例数据
- **毛利（必报，2026-10-10 起）**：`profit_data.json` 采集时间/覆盖至哪天/行数；本月（或本次范围）毛利与毛利率；利润报表无数据的站点（CA/MX/NL/SE）与 2026-07 前显示 — 属正常；成本缺失行数（有销量但成本=0 → 毛利虚高）；上游修订导致的毛利变化（校准台账）
  - ⚠️ **商品成本已改口径（2026-10-13 第八轮）**：不再取易仓 `productCostTotal`，改为**产品成本表 `costRMB` × 件数 ÷ 当月汇率**、ASIN→产品名走**「产品关系管理」**；易仓原值只落 `costErp`（审计）。汇报口径要说「商品成本按成本表匹配」，**不要再说"易仓商品成本"**。
  - ⚠️ 「成本表未匹配行数」与「表 vs 易仓单台偏差」**已由自检 G18 自动统计（WARN 级；只有「口径没生效」才是 FAIL）**，汇报时直接取它的数字；若 G18 报 WARN，**必须点名是源数据问题、不是看板算错**，并给出建议核查对象（**未匹配 → 让运营在「产品关系管理」补映射或补成本表**；偏差 → 确认成本表该填单件还是整套）。
  - ⚠️ **映射一致性看 G19**（新增）：生效映射 `_map_cache.json` 必须被完整内嵌进 `product_map.json`，且 `profit_metrics` 里已算出成本的 ASIN 必须在内嵌映射里 —— 若 G19 FAIL，**先别重建看板**，说明构建期内嵌映射落后于生效映射（会导致「商品成本有值、页面头程=0」），跑一次 `python build_profit_metrics.py` 会自动镜像对齐。
- 自检 pass/warn/fail；云端链接确认不变；本地文件路径

---

## §B 广告周度+投放词链路（仅周一）→ ad.html

### §B.1 前置自动登录
同 §A.1（已登录则复用）。
【已知现象】若与其他任务并发使用 CDP 9223，广告接口可能返回全 0 指标（条数正常但花费/点击/曝光全 0）。合并后已串行化，理论不会再遇到；若遇到，等 2-3 分钟重跑采集即可，不要放弃。

### §B.2 抓取广告周度数据（含视频指标）
```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node fetch_ad_weekly_video.js
```
- Edge CDP 调 ProductAd.GetFlatViewList，按投放 ASIN 归属（SP/SD 按广告组 Asin 字段，SB 按活动名），13 国最近 8 周（周六~周五），含视频指标（完播/播放至一半/首播/3/4/5 秒/静音），自动动态算周范围，并取 Campaign.GetList 活动状态 → ad_weekly_all_video.json
- 【口径】周查询**不带** `State:"enabled"` 过滤（2026-09-07 修复）：欧洲花费全部来自已暂停的 A-X140 系列活动，过滤会导致欧洲广告数据消失
- 【数据校验】运行后检查 US 最新完整周花费：若为 0（正常周花费数千美元）判瞬时异常，等 2-3 分钟重跑本脚本，确认非 0 再继续

### §B.3 抓取投放词周度数据
```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node fetch_ad_keywords.js
```
13国 → Campaign.GetList → AdGroup.GetList → AdGroupBidKw.GetList → Report.GetAdvPerformanceList，本地按周六~周五聚合 → ad_keywords_all.json（目前 US/DE 为主，UK 少量）。

### §B.4 聚合 + 构建看板
```
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && python build_ad_dashboard_data.py
cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && python build_dashboard_html.py
```
- build_ad_dashboard_data.py：合并 ad_weekly_all_video.json + ad_keywords_all.json → ad_dashboard_data.json（国家/周/ASIN/广告形式/活动/广告组粒度 + 投放词明细）
- build_dashboard_html.py：注入 ad_dashboard_template.html（内联 Chart.js + product_map.json）→ ad_dashboard.html 单文件

### §B.5 复制 + 部署 + 自检 + 汇报
```
cp C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard.html C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/ad.html
```
- 部署：workbuddy_sites_deploy（同 §A.5，链接不变）；curl 验证 ad.html 200
- 自检：check_data_integrity.js（FAIL 是 C2 某国花费=0 → 等 2-3 分钟重跑 §B.2 再走完后续）
- 汇报：登录状态；抓取国家数/周数；US/DE 各周花费/点击/曝光/订单/销售额/完播（重点最新完整周）；活动状态分布；投放词各国关键词数；文件路径 ad_dashboard.html；自检计数；链接确认

---

## §C 产品周报+广告总览链路（仅周一）→ product.html

> 本链路数据采集在产品报表目录 `C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33`，登录脚本在主目录。

### §C.1 前置自动登录
同 §A.1（`cd C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38 && node auto_login_eccang.js`，已登录则复用）。

### §C.2 更新产品报告数据
```
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && node update_weekly_all_data.js
```
- 按"周六~周五"周维度，一次传入 13 国账号（Aliencell_Direct_BE/CA/DE/ES/FR/IE/IT/MX/NL/PL/SE/UK/US）
- 【数据延迟修正】每次从最近完整周五往前倒推 3 周，共重抓最近 4 周，用补全数据覆盖旧数据（复核修正）；更早的周已稳定保留；新周自动追加
- 【防降级护栏】若新抓周数据比已有明显缩水（行数<80% 且销售额<50%，或旧有销售新抓为 0），保留旧数据并打 [护栏] 警告——属正常保护，汇报中说明
- 写盘前自动备份旧文件到 backups/（保留 6 份）
- 目前仅 US 和 DE 有数据（其余站点无数据属正常）；若提示无法连接 Edge（127.0.0.1:9222/9223）说明登录前置失败

### §C.3 抓取广告模块数据（产品报表目录自己的管道）
```
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && node cdp_fetch_ad_weekly.js
```
- Edge CDP 调 ProductAd.GetFlatViewList，按投放 ASIN 归属，13 国最近 7 周（自动动态算周范围）→ ad_weekly_all.json
- 【口径】同 §B.2：周查询不带 State:"enabled" 过滤
- 指标：花费/点击/曝光/订单/销售额；类型 SP/SB/SD

### §C.4 聚合广告 + 生成报表 + 注入广告 + 注入毛利
```
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && python aggregate_ads.py
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && python generate_filterable_report.py
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && python integrate_ads.py
cd C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33 && python integrate_profit.py
```
- aggregate_ads.py：ad_weekly_all.json →（国家,周,ASIN）汇总 → ad_data_for_dashboard.json
- generate_filterable_report.py → filterable_dashboard.html：行=周（ISO 周数，以周五命名），列=10 个产品指标（买家访问/移动会话/浏览器会话/浏览量/订单量/转化率/B2B订单/订单件数/销售额/BuyBox 占有率）；转化率=订单÷买家访问；BuyBox=每日 BuyBox% 简单平均（分母 bb_cnt，2026-09-14 修复）；筛选=地区/国家/子ASIN/周维度（NA=US/CA/MX，EU=欧盟9国，UK/JP/AU 独立）；下拉只显示有数据项、已选项保留、地区↔国家双向同步、单击/Ctrl多选/唯一选中取消同 §A 口径；销售额按各国原币种合计不换汇
- integrate_ads.py：注入 9 个广告指标（花费/点击/订单/销售额/广告转化率/点击率/广告占比/ROAS/ACOS）+ 分组表头 + WK 列固定 + 9 个广告 KPI + 趋势图广告花费红虚线 + CSV 全 19 列
  - ⚠️ integrate_ads.py 按**字符串精确匹配**替换 generate_filterable_report.py 输出的函数块（asinInScope/weekInScope/asinWeekData/regionInScope 等）：改生成器这些函数时**必须同步更新 integrate_ads.py 的 old_* 匹配块**，否则 assert 失败
  - ⚠️ regionInScope **不得用** effectiveAsins()/effectiveWeeks()（会被国家选择修剪，选国家后其他地区被误判无数据无法切换）
  - Chart.js 已由生成器内联，无需再跑 inline_product_dashboard.py（已过时）
- **integrate_profit.py（2026-10-10 新增，必须排在 integrate_ads.py 之后）**：读 `../2026-08-18-14-43-38/profit_metrics.json`，按「周六~周五」归周聚合成周×站点×ASIN，注入 `const PROFIT` + `profitOf/marginOf` + 「毛利指标」分组两列（毛利/毛利率）+ 合计行（**毛利率不累加**，用 Σ毛利÷Σ报表销售额）+ KPI 两项 + 说明文案
  - 与 integrate_ads.py 同样按**字符串精确匹配 + assert** 注入，共 **24 个注入点**（原 19，2026-10-12 两条需求线各加若干）；命中数不符会直接报错退出（避免改模板后静默漏注入）
  - **重跑顺序**：改了 generate 或 integrate_ads 后必须重跑 integrate_profit.py（前者会覆盖掉毛利注入）；脚本开头有幂等检查，检测到已注入会提示先重跑前两步
  - 周报只覆盖到 weekly_all_data.json 里已有的周（当前 15 周 W27~W41）；更新的日期（如 10-10 之后）会被跳过并在日志里报「跳过 N 行」——属正常，等下周报表补上该周即可
  - **「孤儿单元补进合计」注入点（2026-10-12，用户决策「补进合计，不改行数」）**：`PROFIT` 里**不属于 `DATA.asin_list`** 的 ASIN，其 (ASIN×周×站点) 利润字段**只累加进 `totals`/`perWeek`（KPI 卡 + 表格合计行），不产生表格行**（行数 = `DATA.weeks` 长度 + 1）
    - ⚠️ **必须先聚合到本地对象再一次性并入**：直接对共享的 `perWeek[w]` 累加会让同周第 2 个孤儿把前一个**重复计入 totals**（`test_orphan_totals.js` 第 ① 项专抓）
    - ⚠️ **必须跟筛选维度对齐**：该块**直接读 `PROFIT`**，绕过了 `asinWeekData` 的渠道包装层 ⇒ 需自行护栏 `周 / 国家 / 系列 / ASIN / 渠道`。渠道护栏：`if (selChannel.size && !selChannel.has('amazon')) return;`（孤儿属亚马逊侧，**单看 Woot 时必须排除**）
    - **改这块前后必跑** `node test_orphan_totals.js`（11 项，自带合成假孤儿 + **反向对照**：删掉渠道护栏后「单看 Woot」必须出现污染值，以此证明护栏承重而不是"恰好视图为空"）
- **integrate_ads.py 的 woot_inject 块还负责三件事**（2026-10-10 起）：
  1. `injectWootWeekly` 在把 Woot 并入 `DATA.asins` 的同时，**额外记一份** `DATA.wootParts` / `DATA.wootAdParts`（渠道筛选要把 Woot 从合并值里减出来，没这份记录就减不了）
  2. **「销售店铺」筛选**（`CHANNELS` / `selChannel` / 包装 `asinWeekData`·`setAll`·`syncAndRender`·`updateSummaries` / `mountChannelDD`）。**用包装而不是改写**：本文件后面还有一串「精确字符串替换 + assert」的补丁块，改写函数体会让它们失配
  3. `cloudWootSync` 同时同步 `pc_woot_cfg`（Woot 成本设置），否则别人填的成本只有录入者本人看得到
  4. **Woot 毛利**：`wootProfitOf()` + `wootPartAcc` 里造「等效利润字段」（`pSales` = **该行采购价收入**、`pCost` = **−(成本+运费)×订单量**、`pN` = 1），让 `profitOf` 能算出 Woot 毛利；合并分支把它们叠加到官方店铺的毛利字段上。⚠️ 未配成本的 ASIN 不设 `pN` → 单看 Woot 显示 `—`、合并不加（**按 0 成本算会虚高**）
  5. **采购价「每行可填」（2026-10-10 补充口径）**：用户口径「**采购价以每行可填来进行，上传数据时一次性填好**」
     - 取值：`wootPriceOf(en.price)` —— **该行自己的 `price` 优先**，该行没填才回落「默认采购价」（`WOOT_PRICE`，默认 1380）
     - 因此 `wootAllocByAsin` 必须聚合 **`rev = Σ(采购价 × 订单量 × 分摊系数)`**（收入侧），**不能**只聚合订单量再乘一个全局单价 —— 同一 ASIN 不同批次采购价不同时会算错
     - 三看板的等价字段：日 `r.wootRev` / 月 `wmar.pSales` / 周 `wootParts[].rev`；`pCost` 一律是**成本负数**（写成「收入 − 成本」会让收入算两遍）
     - ⚠️ **幂等性放大效应**：采购价 = 默认价时「逐行」与「全局」两种写法**数值完全一样**（`test_woot_margin` 因此全绿也测不出来）→ 只有 `test_woot_rowprice.js` 用「同一 ASIN 同一周两个不同采购价」才能暴露。改这块**必须**跑它
     - 录入侧在 `woot.html`：表头识别列 `采购价/供货价/price`、记录列表逐行可改（`onRowPrice`）、导出 CSV 带该列、手动添加有 `mPrice`
- ⚠️ **Python 三引号里的 JS 转义陷阱（2026-10-10 踩过，整页白屏）**：`woot_inject` 是 `'''...'''` 字符串，内部写 `\'` 会被 **Python 吃掉反斜杠**，于是 JS 里 `onclick="toggleDD('ddChannel')"` 变成裸标识符 → `SyntaxError: Unexpected identifier` → **主脚本整体不执行**（`DATA`/`METRICS`/`calc` 全部 undefined，页面看似只有下拉缺失，实为全废）。要输出 JS 的 `\'` 必须写 **`\\'`**。两个配套工具（都在 `2026-08-18-14-43-38/`）：
  - `python _scan_escapes.py <目录>`：扫构建脚本的三引号块，任何 `\'` 都报出来（`\\'` 不算）→ **改完 `integrate_ads.py` 先跑它**
  - `node check_inline_js.js _deploy/*.html`：解析每个产物的内联 `<script>`（只解析不执行）→ **构建完先跑它**，能秒级区分「注入块写坏了」和「运行时逻辑问题」（周看板白屏那次的教训）
- ⚠️ **integrate_ads.py 不幂等**：它按精确字符串匹配替换 `const METRICS = [` 等锚点，**重跑前必须先跑 `generate_filterable_report.py`**（重新生成干净 HTML），否则 `AssertionError: METRICS block not found`。`integrate_profit.py` 同样，且必须排在 `integrate_ads.py` **之后**（它会覆盖毛利注入）


### §C.5 复制 + 部署 + 自检 + 汇报
```
cp C:/Users/paddy/WorkBuddy/2026-08-17-14-21-33/filterable_dashboard.html C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/_deploy/product.html
```
- 确认 _deploy/product.html 字节数与源一致
- 部署：workbuddy_sites_deploy（同 §A.5，链接不变）；curl 验证 index/product 200
- 自检：check_data_integrity.js（FAIL=「周度vs每日源交叉」说明坏数据覆盖了好数据 → 修复见 HANDOVER.md 坑 13：可用 daily_data.json 按周六~周五重建 weekly_all_data.json，或从 backups/ 回滚后重抓）
- 汇报：登录状态；复核修正了哪 4 周、条数变化；护栏拦截数（若有）；数据文件周数/子ASIN 数/哪些国家有数据；各周总销售额/Sessions 变化；广告抓取国家数/周数与总花费/点击/订单/销售额/占比/ROAS/ACOS；ASIN 花费分布（B0H69JJZ1M 占绝大部分属正常）；报表路径 filterable_dashboard.html；确认 product.html 含地区筛选；自检计数；链接确认

---

## §D 合并汇报格式（周一）

- 开头：一句话总览（A/B/C 三条链路各自的成败 + 自检计数）
- 若有任一 FAIL / 链路失败：【⚠更新失败/数据自检未通过】置于汇报**最前面**，逐条列原因与修复建议
- 然后 A、B、C 三段，各按 §A.7 / §B.5 / §C.5 的要点汇报
- 结尾：云端链接（确认不变）

## 变更记录
- 2026-10-14（**第十三轮：「云端数据已更新」提示条常驻修复**）：用户「为什么总是提示这个云端数据已刷新」
  - **根因 = 键顺序，不是数据变化**。看板 load 时把云端 `wootCfg` **规范化**成 `{"price":1380,"cost":{}}` 再写本机，而提示条 `cloudSig()` 用的是**云端原对象** `{"cost":{},"price":1380}`（Supabase 里就是这个顺序）；`JSON.stringify` **保留插入顺序** ⇒ 两串永不相等 ⇒「云端有新数据」判定永远成立 ⇒ 提示条常驻、点「立即刷新」重载后照旧弹出、点 × 只在当前页面会话内有效。
  - **影响面 3 个看板**：`daily.html` / `monthly.html` / `product.html`（签名含 `pc_woot_cfg` 第 4 段的）。`ad.html` / `target.html` 的签名只有 3 段（无 wootCfg）⇒ 不受影响。
  - **修法（唯一源 `cloud_update_watch.js` → `inject_update_watch.py --apply` → 6 个目标）**：① 新增 `stable(v)` = 对象 key **先排序**再序列化（键顺序无关）；② 新增 `normCfg(c)` = 与看板 load 同步**完全同款**的规范化（price 兜底 1380 / cost 兜底 `{}`）；③ `localSig/cloudSig` 全部改用 `stable()`，第 4 段再加两条护栏：**本机没有 `pc_woot_cfg` ⇒ 该段恒空、不参与判定**（广告看板不消费成本设置，否则又会常驻）、**云端缺 `wootCfg` ⇒ 沿用本机值**（否则删配置后永不消失）。
  - ⚠️ **注入脚本的老锚点已失效**：`ANCHOR_LF`（以 `cloudWootSync` 结尾定位）在各看板载入同步块被改写成「统一 dirty 同步」后**命中 0 次**。已改为**按片段标记原地替换**（`// ===== 云端更新提示` → `})();`；前后吃掉换行、插入时补一个空行保持排版），支持片段升级，六处片段逐字节一致（5,555 字符）。
  - **测试补盲**：`test_update_notice.js` 的 mock 云端**从来没有 `wootCfg`** ⇒ 这个坑一直测不出来。现 mock 与生产同构（`data.wootCfg = {cost, price}`，**cost 在前**），新增「本机已按 `{price,cost}` 规范化写入(前提)」「**键序差异不算更新（常驻回归）**」「值真的变化仍会提示」「恢复原配置后不提示」。**65 → 79 项**。
  - **守卫有效性已实测**：把 `_deploy/daily.html` 的签名临时回退成旧式 4 段 `JSON.stringify` ⇒ 精确报 **2 个 FAIL**（`云端与本机一致时不提示` + 新增的常驻回归项）；换回后 **79/0**。
  - 产物（**字节**，非字符数）：daily 10,529,662 B · monthly 294,291 B · target 303,695 B · ad 910,732 B · product 579,422 B（每份 +片段 ~1.2 KB）；`_deploy` 五页 + `product.html` 已同步。
  - 回归：**27 套全绿**（`test_update_notice` **79/0**、`test_ratio_cols` 41/0、`test_monthly_platform` 49/0、`test_monthly_dashboards` 60/0、`test_target_platform` 47/0、`test_channel_ui_sweep` 76/0、`test_woot*` 全绿、`test_joybuy_dashboard` 29/0、`test_joybuy_profit` 38/0 …），`verify_sb_attribution` 全部通过。自检 **38 pass / 3 warn / 2 fail**（2 个 FAIL 均为「本地比线上新」的防漏部署探针，发布即消）。
  - 诊断脚本：`_probe_update_bar.js`（种入与云端一致的本机缓存 → 加载 → 读提示条可见性 + **四段签名逐段比对** + KPI；也可用 `BASE=<线上地址>` 直接验线上）。
  - **已发布**（用户本轮确认「立即发布」）：deploy `verified: true`、**链接不变**。线上复核 9 页（daily/monthly/target/ad/product/joybuy/woot/mapping/index）**全部 HTTP 200 且与 `_deploy/` 逐字符一致**，新签名齐全、旧签名零残留；线上真实浏览器复验 daily/monthly/product 三页「提示条可见 = **false**」+ 签名相等。发布后自检回到 **40 pass / 3 warn / 0 fail ✅**。
- 2026-10-13（**第十二轮：「成本FBA%」→「成本%」全局改名 + 发布**）：用户「这个成本FBA%改为成本%」
  - 改名共 **6 类落点**（漏一处就会出现「两个名字并存」）：①月模板 `monthly_dashboard_template.html` 的 METRICS `short:` + 口径文案 2 处（总述 + JoyBuy 行释义）；②日模板 `daily_dashboard_template.html` 的 METRICS `label:` + 口径文案；③周报源 `integrate_profit.py`（注入的 METRICS 行 + 文案）与 `integrate_ads.py` 注释；④已构建产物 `daily.html` / `monthly.html` / `product.html`，以及周报工作区的 `filterable_dashboard.html`（**与 `product.html` 逐字节相同，改名后两边必须一致**）；⑤测试 `test_ratio_cols.js`（10 处，含 3 条按 label **精确匹配**的 `labels.includes(...)`，不改断言必挂）+ `test_monthly_profit.js` 注释；⑥文档 `RUNBOOK.md` 3 处 + 探针 `_probe_month_head.js` / `_probe_wk_ratios.js`。
  - **只改显示名，`key:'costPct'` 与计算逻辑零改动**（分母仍是利润报表销售额；JoyBuy 行仍是账单货款）。target / ad / woot / joybuy 四个看板**没有这一列**，无需改（在那四个文件里 `grep 成本FBA` 本来就是 0）。
  - 重建：`build_daily_dashboard.py` → daily.html **10,528,799 B**；`build_monthly_dashboards.py` → monthly.html **293,428 B** / target.html 302,073 B；周报侧直接改 `filterable_dashboard.html` 再 `cp` 为 `product.html` **578,590 B**（本轮未重跑周报链，但源脚本已同步 ⇒ 下次重跑会自然产出新名）。
  - `_deploy/`（daily / monthly / target / product）逐字节一致；发布后线上 6 页（daily / monthly / product / target / ad / index）**HTTP 200 且与本地逐字符一致，零「成本FBA」残留**；分享链接不变。
  - 回归 **27 套全绿**：`test_ratio_cols` **41/0**、`test_monthly_profit` 16/0、`test_monthly_platform` 49/0、`test_monthly_dashboards` 60/0、`test_target_platform` 47/0、`test_daily_profit` 27/0、`test_product_profit` 21/0、`test_note_fold` 63/0、`test_update_notice` 65/0、`test_confirm_bar` 78/0、`test_channel_ui_sweep` 76/0、`test_woot_channel` 28/0、`test_woot_margin` 35/0、`test_woot` 49/0、`test_woot_rowprice` 55/0、`test_joybuy_profit` 38/0、`test_joybuy_dashboard` 29/0、`test_product_region` 15/0、`test_kw_dashboard` 12/0、`test_buybox` 8/0、`test_mapping_country_filter` 23/0、`test_finance_inputs` 21/0、`test_currency_ads` 20/0、`test_orphan_totals` 11/0、`test_week_fx` 14/0、`test_ad_asin_rules` 22/0；`verify_sb_attribution` 全部通过。自检 **40 pass / 3 warn / 0 fail**。
- 2026-10-13（**第十一轮：映射定稿刷新 → 重建 → 发布；并修掉一个「接入 JoyBuy 后被带出来」的对账脚本缺口**）：用户「编辑好了，可以发布了」
  - **① 映射定稿（阻塞解除）**：云端 `asinMap` **50 条**；`_map_cache.json` / `product_map.json` / `_deploy/product_map.json` **三者皆 50 条、与云端差集 0、名字零不一致**；错拼 `BOH9YBM4H1`（字母 O）已清除，`B0HJBZ1QBQ → 材料包` 已纳入 ⇒ 原「少扣 ≈1,498 USD 商品成本 + 209 USD 头程」的风险消除。
  - **② 刷新入口必须带 `--force-map`**：`python build_profit_metrics.py --force-map`（内部走 `cost_from_table.refresh_map(force=True)`）。**不带 flag 会被 6h TTL 跳过**（`_map_cache.json` mtime 新 ⇒ 打印「映射快照 0.0 小时前(< 6h…), 跳过刷新」而什么都不做）。
    刷新后重算：`商品成本(成本表口径) -52855.99 · 易仓原值 -53746.13 · 差 +890.14 · 来源=table`（原 +892.86，纳入 `B0HJBZ1QBQ` 后差 0.14）。
  - **③ 重建 + 同步（顺序）**：`build_daily_dashboard.py`（daily.html **10,528,803 B / 映射 50 ASIN**）→ `build_monthly_dashboards.py`（monthly.html **293,434 B**、target.html **302,073 B**）→ `build_dashboard_html.py`（ad_dashboard.html **909,110 B**，只重注入不重取数）→ `cp daily.html monthly.html target.html _deploy/` + `cp ad_dashboard.html _deploy/ad.html` + `cp product_map.json daily_data.json _deploy/`，六项**逐字节一致**。备份 `_bak_20261013_map/`。
  - **④ ★ 修掉 `verify_sb_attribution.py` 的 FAIL（差额 2026-09 +933.36 / 2026-10 −2.07）**：
    - 根因：该脚本「板侧」用**硬编码 6 字段白名单**（`pPromo/pComm/pFba/pCost/pStorage/pOther`）从 `monthly.html` 的 `const DATA` 累加，而「源侧」`profit_metrics.json` **只有 Amazon 6 站点、没有 JoyBuy** ⇒ JoyBuy 行的贡献进了产物合计却无人对冲，**差额恒等于 JoyBuy 那 6 字段的小计**（10 月只有一条全 0-GMV 的 €−1.83 费用行 ⇒ 折 USD −2.07，与实测分毫不差）。
    - 修法：源侧补 JoyBuy —— 从 `joybuy_profit.json` 按**同字段集**（`goods + commission − logisticsFee − costLocal + joybuyLogistics + txnFee + adsCredit + otherFees`）**独立于行级分摊**计算，与前段 Amazon 源侧相加；输出**新增「其中JoyBuy」列**便于下次对账。
    - 修后：**差额 0.00 / −0.00，`结果: 全部通过`**（表内 2026-09 毛利 3,751.92 / 4.4%、2026-10 −6,328.91 / −13.0%）。
    - **一般化（已写进 skill）**：接新数据源时，**grep 一遍「谁在按字段名累加同一批行的金额」**（测试、对账脚本、报表、自检）—— 它们都吃「字段白名单」这碗饭，都会静默偏移；判别手法是**把差额按 `plat` 拆开**，差额全落在新渠道那侧就说明是脚本没跟上。
  - **⑤ 回归全绿**：`test_ratio_cols` **41/0**（原 39/2 的映射分叉症状消失）、`test_monthly_platform` 49/0、`test_joybuy_profit` 38/0、`test_monthly_profit` 16/0、`test_monthly_dashboards` 60/0、`test_target_platform` 47/0、`test_daily_profit` 27/0、`test_product_profit` 21/0、`test_note_fold` 63/0、`test_orphan_totals` 11/0、`test_channel_ui_sweep` 76/0、`test_woot_rowprice` 55/0、`test_woot_cost_map` 19/0、`test_woot_channel` 28/0、`test_woot_margin` 35/0、`test_woot` 49/0、`test_week_fx` 14/0、`test_update_notice` 65/0、`test_confirm_bar` 78/0、`test_finance_inputs` 21/0、`test_joybuy_dashboard` 29/0、`test_currency_ads` 20/0、`test_mapping_country_filter` 23/0、`test_buybox` 8/8、`test_product_region` 15/0、`test_kw_dashboard` 12/0、`test_ad_asin_rules.py` 22/0。
    - 走 `_deploy` http 服务的测试需**自建服务**（8896 主用 / 8899 提示条）：`python -m http.server 8896 --bind 127.0.0.1`（cwd = `_deploy`）。
  - **⑥ 自检与发布**：发布前 **39 pass / 3 warn / 1 fail**，唯一 FAIL = `F 线上与本地一致(ad.html)`（「本地比线上新」的防漏部署探针，正常）→ `workbuddy_sites_deploy`（`_deploy`、static、`userAskedToPublish=true`）→ `verified: true`、sandboxId `3577d1e878e64dc5837e56f9471dcefc` 未变、**链接不变** → **发布后 40 pass / 3 warn / 0 fail ✅ 可上线**（3 warn = A2b 历史细周 / G18 `B0H6QDFV5F` 源数据偏差 / G8 近 7 天源延迟，均既有）。
  - **⑦ 线上复核**：ad / daily / monthly / target / product / product_map.json / index **七项 HTTP 200 且与 `_deploy/` 逐字符一致**；线上 monthly.html 含 JoyBuy 毛利新口径文案、含 `B0HJBZ1QBQ`、**不含**错拼 `BOH9YBM4H1`。
- 2026-10-13（**第十轮：诊断「网页 9 月美国毛利为负」= 合并口径含 Woot 广告费；并复查映射（用户已补齐）**）：用户问「那为什么网页上的 9 月美国毛利是负数」
  - **① 结论：网页默认「销售店铺 = 全部店铺（合并）」，把 Woot 那一行算进来了；上一轮报的 +0.3% 是只看 Amazon 官方店铺。口径不同，两个数都对。**
    | 2026-09 美国 | 销售额 | 广告花费 | 毛利 | 毛利率 |
    |---|---|---|---|---|
    | 合并（默认） | $96,287.15 | **$32,204.13** | **−$4,574.53** | **−5.58%** |
    | Aliencell 官方店铺 | $86,787.24 | $24,087.17 | **+$209.07** | **+0.28%** |
  - **② 差额全部来自 Woot 行 `B0H69JJZ1M`（9 月 5 台）**：收入 5×1,380 = `6,900` − 产品成本 `3,179.58` − 头程 `387.05` = 毛利 `3,333.37`，再减 **Woot 广告费 `8,116.96`** ⇒ **−4,783.59**。
    - 这 `8,116.96` 来自云端 `mapping.data.woot` 的 **16 条 2026-09 日粒度条目**（用户在 Woot 页录入），**不在亚马逊广告报表里** ⇒ **任何"直接算源文件"的结果都会差这一笔**（旧记录 8,144.13 已被用户改小）。
    - ⚠️ 复现要点：`localStorage.pc_woot` 是页面**从云端 `data.woot` 同步**来的（`monthly.html` 573/646 行）⇒ 用「空 `pc_woot`」的测试桩**看不到**这个数，必须跑真实浏览器状态。诊断脚本（新增、不进回归）：`_probe_us_sep_profit.js`（`--woot` 注入云端 woot，按 (月,站点) 拆 `profitOf` 全字段）、`_probe_us_sep_ui2.js`（等云端同步→reload 后读渲染值，含切渠道/国家）。
    - 另：全地区 9 月合并行 = **−9,965.34 (−10.72%)**。
  - **③ 映射现状（原本的发布阻塞已基本解除）**：本轮多次拉云端条数在变（47→48→49→**50**）⇒ 用户正在「产品关系管理」里编辑。现在 **3 条丢失 ASIN 已全部补回** ✅（`B0H9Y7TG64` / `B0HF4GNDSM` / `B0H6QDJQR5`），`B0HJBZ1QBQ → 材料包` 也在 ✅。
    - 云端 **50** 条 vs 本地 `_map_cache.json`/`product_map.json` **51** 条，差集只剩 2 条且方向相反：本地多 1 条死数据 **`BOH9YBM4H1`（字母 O 错拼、无引用）**，云端多 1 条 **`B0HJBZ1QBQ`**；**同名 ASIN 产品名零不一致**。
    - ⚠️ **待用户确认编辑完成后**再：刷新 `_map_cache.json`（去错拼 + 纳入 `B0HJBZ1QBQ`）→ 重跑 `python build_profit_metrics.py` → 重建相关看板 → 同步 `_deploy` → `test_ratio_cols` 应回绿。**本轮未改任何数据/未重建/未发布。**
  - 产物：仅新增 2 个 `_probe_*.js` 诊断脚本；看板文件与 `_deploy` **未改动**。
- 2026-10-13（**第九轮：JoyBuy 毛利接入月看板 + 9 月美国毛利率下降归因 + 发现云端映射被覆盖丢 4 条**）：用户四条 ——「1. 已经进行映射匹配 2. 现在暂时还没有售卖，还没上架，但是未来会有售卖，所以有成本 3. 为什么9月份美国的毛利率变化了这么多，变低了这么多 4. Joybuy的毛利也要计算，只是他没有那么多项目要算，具体的计算方式前面已经给你了」
  - **① ★ 云端「产品关系管理」被整体覆盖，丢了 4 条（本轮最有价值的发现，尚未解决）**：云端 `asinMap` **47 条**，而本地生效映射 **51 条**。云端比本地 **多** `B0HJBZ1QBQ → 材料包`（用户本轮补的 ✅），**少** ↓ 4 条：
    `B0H9Y7TG64`(E1主机+10W蓝光头, US 4 件) · `B0HF4GNDSM`(材料包, US 28+2 件) · `B0H6QDJQR5`(X1L/X1通用增高底座, US 2 件) —— 这 3 条**有销量**，丢了会让商品成本/头程按 0 算（US 全期约 **1,498.48 + 209**）；`BOH9YBM4H1` 是**字母 O 错拼**（正解 `B0H9YBM4H1` 在云端）、无任何数据引用，删掉反而是好事。
    - **症状辨识**：`test_ratio_cols` 月看板「头程」FAIL（got 2771.55 / want 2573.92，差 197.63 = 这 3 个 ASIN 的头程）—— 该测试**实时拉云端映射**算期望值，而页面用**内嵌映射** ⇒ 两边分叉。**别怀疑公式，先比云端与内嵌的 ASIN 集合。**
    - 未在本轮改动云端（用户上轮表示「我自己改」）⇒ **本轮不发布**。
  - **② 成本表 8 个无 ASIN 指向的组合品 = 无需处理**：用户确认「还没上架、未来会卖、所以有成本」⇒ 映射现状正确。
  - **③ 9 月美国毛利率 −12.72 个百分点：全部来自「商品成本」一项**（销售额/促销/佣金/配送/仓储/其他/VAT 逐项**完全不变**）：
    - 美国月度（完整口径）：08 月 旧 −51.6% → 新 **−5.0%**；09 月 旧 13.0% → 新 **0.3%**；10 月 4.7% → **−5.4%**。
    - 09 月 `−9,352.19` 中 **−10,141.90 = 易仓对 7 个 ASIN / 46 件根本没记商品成本**（`B0H75KBB93` `B0H9YBM4H1` `B0H9YJWRHK` `B0H9Y7TG64` `B0H9Y5QJX5` `B0H75HMBF5` `B0HF4GNDSM`）。⚠️ **不是结算滞后** —— 这些 ASIN 在 10 月易仓同样是 0，即易仓侧**压根没维护成本**；反向仅 +790（`B0H69JJZ1M` 多记 832.53 等）。
    - 08 月的反差是**易仓单行错误**：`2026-08-29 US B0H69JJZ1M` 单台成本 **−15,631.61**（正常 ≈ −631.51，**24.8 倍**）⇒ 虚增 ≈15,000 ⇒ 旧口径把 8 月压成 −51.6%。**这就是 G18 里那个离群行。**
    - 全期两口径只差 **+892.86（1.66%）** ⇒ 本次切换主要是**在月份之间重新分配**（结算日期 vs 件数）。真实成本/销售额：08 27.1% · 09 28.8% · 10 34.5% ⇒ 8/9 月稳定、**10 月才是真偏高**；9 月毛利率仅 0.3% 的主因是**广告费 24,087 = 销售额 32.1%**。
  - **④ JoyBuy 毛利接入月看板**：口径（用户给定）`平台毛利 = 货款+佣金+交易服务费+广告返点+VAT+退款+退回佣金+退货服务费+海外物流仓储+其他`（费用自带负号直接相加）；`完整毛利 = 平台毛利 − 物流费(MCF 费率卡 / 海外仓尾程) − 产品成本 − 头程`。数据源 `joybuy_profit.json`（`build_joybuy_profit.py`；现 9 单 / 2 个月度行：DE 2026-09 €380.59、2026-10 €−1.83）。
    - **实现手法与 Woot 完全同构**：在 `build_monthly_dashboards.py` 组装 `jb_rows` 时给 JoyBuy 行挂「等效利润字段」⇒ monthly 模板的 `aggMonth` / `profitOf` / 所有占比列**一行都不用改**：
      `pSales=货款` · `pComm=佣金` · `pFba=−物流费` · `pCost=−产品成本` · `pStorage=海外物流仓储` · `pOther=交易服务费+广告返点+其他` · `pVat=−vat` · `pRefSales=退款+退回佣金+退货服务费` · `pHead=头程` · `pN=1`。
    - ⚠️ **账单只到「站点 × 月」**，看板行是「月 × 站点 × 产品」⇒ 按该(站点,月)的**行 GMV 占比**摊到产品行。站点/月合计 = 账单真值，行级是近似值。
    - ⚠️ **该(站点,月)所有行 GMV 都为 0 时必须把整笔挂到该组第一行** —— 否则这笔费用在看板上**静默消失**（实测 DE 2026-10 的 €−1.83「only-fee」海外物流仓储费；第一版丢了，被新增测试 `②毛利 = 账单完整毛利` 抓到差 2.07）。
    - 无账单的站点（UK / NL / FR）**不写 `pN` ⇒ 毛利显示 —**（不按 0 算）；**广告列仍只反映 Amazon**（单看 JoyBuy 显示 —）。
    - ⚠️ JoyBuy **毛利率的分母是账单「货款」**（Product Payment），与「销售额」列（Data Compass GMV）不同源（DE 2026-09：€1,803.89 vs €1,619.70）——口径文案已写明。
    - 产物：`monthly.html` 291,289 → **293,552 B**（`target.html` 无毛利列、字节不变）。回归 `test_monthly_platform.js` 41 → **49 项**（新增 5 条：毛利=账单完整毛利、毛利率=完整毛利÷货款、无账单站点留白、**按表头精确取「毛利」「毛利率」单元格**、④全部平台毛利 = Amazon + JoyBuy）。
  - **⑤ 本轮回归**：`test_monthly_platform` 49/0 · `test_joybuy_profit` 38/0 · `test_monthly_profit` 16/0 · `test_monthly_dashboards` 60/0 · `test_target_platform` 47/0 · `test_note_fold` 63/0 · `test_joybuy_dashboard` 29/0 · `test_orphan_totals` 11/0 · `test_woot_margin` 35/0 · `test_woot_channel` 28/0 · `test_channel_ui_sweep` 76/0 · `test_update_notice` 65/0 · `test_finance_inputs` 21/0 · `test_confirm_bar` 78/0 · `test_daily_profit` 27/0 · `test_product_profit` 21/0 · `test_woot_rowprice` 55/0 · `test_week_fx` 14/0 · `test_woot` 49/0；**唯一失败 `test_ratio_cols` 39/2 = ①的映射分叉症状**。自检 **40 pass / 3 warn / 0 fail**。`_deploy/monthly.html` + `target.html` 已同步（逐字节一致），**未发布**（等映射决议）。

- 2026-10-13（**第八轮：商品成本改由「产品成本表 × 产品关系管理」匹配取数（用户明确不取易仓）+ 修掉两份映射文件分叉导致的静默错数 + 三处口径文案同步 + 发布线上**）：用户两条 ——「1. 产品成本也是商品成本的取数全部取我给你的表格里面进行匹配，不要从易仓进行取数」「2. 发布」
  - **① 口径切换（单一收口在构建期）**：新增 **`cost_from_table.py`**（`Resolver` / `refresh_map` / `load_map_prefer_local` / `make_rate_fn` / `SITE_CUR`）。
    **商品成本 = 产品成本表 `costRMB` × 件数 ÷ 当月汇率**；件数 = `qty`(亚马逊销量) + `mqty`(多渠道销量)；ASIN→产品名走**「产品关系管理」**（云端 `mapping.data.asinMap`）。
    `build_profit_metrics.py` 里 `cost` 换成新口径、**易仓原值退到新字段 `costErp`（仅审计、不参与任何计算）**，payload 新增 `costSource`（`table` / `erp-fallback`）。
    **未匹配 ⇒ `cost=0` 且 `miss=1`，绝不回退易仓**（用户要求）；`miss` 语义改为「有件数但成本表未匹配」。
    ⇒ 因为日/月/周都吃 `build_profit_metrics.py` 的产出，**改一次三处同口径**；日/月内存重建、周读盘，所以改完必须补跑落盘那条（见 §A.2b 第三层依赖）。
    - ⚠️ `Resolver.amount()` 的缺失判定必须用 `bool(units)`：写成「未匹配就返回缺失」会让 `qty=0/sales=0` 的目录行**满屏误报**（实测 332 行 → 修后 12 行 → 映射补齐后 **1 行**）。
    - ⚠️ `coverage()` 之类人工核对要**折成同币种比单台**（表成本是 RMB、易仓是站点币种），否则得出「表 −348,536 vs 易仓 −53,746」的假偏差。
  - **② ★ 修掉「两份映射文件分叉」的静默错数（本轮最有价值的发现）**：映射有 **`_map_cache.json`（生效，`load_map_prefer_local()` 优先；且 `test_ad_channel.js` / `test_target_channel.js` / `test_woot_cost_map.js` 会从云端刷新它）** 与 **`product_map.json`（构建期内嵌用，被烧进 `EMBED_MAP` / `__PC_MAP__`）**。
    `refresh_map()` 原按 **`product_map.json` 自己的 mtime** 判「6 小时新鲜度」并跳过同步 ⇒ 只要缓存被别的流程刷新过就**自以为够新** ⇒ 两文件分叉（实测 **51 vs 48 条**，差 3 个 US ASIN）⇒ **构建期按映射算出了商品成本、页面端头程却按内嵌映射算成 0**（同一行两个口径、零报错，实测少算 **1,498.48**）。
    - **症状辨识**：某个占比/合计只有**极少数主体**对不上，且恰好是自检报「未匹配」的那批，但页面上它们**有值**、落盘文件里是 0。⇒ **先比两份映射的 ASIN 集合，别怀疑公式**（本轮就是靠 `test_ratio_cols` 月看板 28.83% vs 期望 27.24% 顺藤摸到）。
    - **修法**：`refresh_map()` 改为按**生效映射**的 mtime 判新鲜度，命中跳过时调新函数 **`_sync_baked()`** 把内嵌映射**镜像对齐**（幂等）。实测输出 `内嵌映射已与生效映射(_map_cache.json)对齐: asinMap 51 条(原 48 条)`。
    - **自检 G19**（新增）：ⓐ 生效映射里的 ASIN 必须全部内嵌 ⓑ `profit_metrics` 里**已解析出非 0 成本**的 ASIN 必须在内嵌映射里 ⓒ 已构建页面不含映射里的 ASIN（页面没随映射重建）→ ⓐⓑ **FAIL**、ⓒ WARN。已**反向验证**（摘掉 3 个 ASIN ⇒ G19 FAIL）。
  - **③ 口径说明文案三处同步**（长文案散落，最易只改一处）：日 `daily_dashboard_template.html`（口径句另来自 payload `profit_metrics.json.note`）、月 `monthly_dashboard_template.html`（硬编码 `<div class="note">`）、周 `integrate_profit.py` 的 `rep('页内说明: 毛利口径', …)` + `integrate_ads.py` 的 Woot 注释块。
    - 补进「商品成本自 2026-10-13 起改由「产品关系管理」映射到产品成本表 costRMB×件数÷当月汇率、**不再取易仓 productCostTotal**」。
    - **同时删掉被取代的旧句子**（本来与新机制自相矛盾）：「Woot 行目前只贡献订单/销售额/广告，没有利润报表行 → 单看 Woot 时毛利显示 —」「Woot 手工录入数据不参与毛利计算」「成本未配置时…单看 Woot 毛利显示 —」。
    - ⚠️ 周看板的 `rep(OLD→NEW)` 是**幂等替换**：只改 NEW 字符串而**不重跑 `generate_filterable_report.py`**，OLD 已不存在 ⇒ 直接跳过，「改了什么都没变」。必须跑完整三步链。
  - **④ 量化**：商品成本总额（站点币种混合）易仓 −53,746.13 → 成本表 **−52,853.27**（差 +892.86），其中**映射补齐**让 3 个 ASIN（`B0H9Y7TG64` E1主机+10W蓝光头 / `B0HF4GNDSM` 材料包 / `B0H6QDJQR5` X1L/X1通用增高底座，均 US）从「成本 0」变成有成本 = **−1,498.48**。
    未匹配行 **12 → 1**（只剩 `B0HJBZ1QBQ` UK 1 件，连映射都没有 ⇒ 需运营补「产品关系管理」）。
    **月度毛利 KPI（USD）**：2026-07 **+2,638.20**(14.2%) · 08 **−5,546.37**(−17.2%) · 09 **−5,621.30**(−6.7%，原 −4,229.65) · 10 **−8,476.30**(−17.4%，原 −8,074.29)；06 = —。
    附带收益：W36 的易仓成本离群（`B0H69JJZ1M` 08-29 −15,631.61 = 22.4 倍）**不再影响看板**。
    - ⚠️ 待运营确认（G18 WARN）：成本表 vs 易仓单台偏差 ≥30% 的 4 组 —— `B0H6QDFV5F` US −42.69/−1.41(+2928%)、`B0HCZ6CPT1` 材料包 DE ×2、`B0H6Q5MFT1` UK +77%、`B0H69JJZ1M` US −38%。
  - **⑤ 测试契约变更（3 个测试的老前提被推翻，不是代码坏了）**：内嵌映射**不再恒空** ⇒ 「离线 ⇒ `EMBED_MAP` 空 ⇒ 头程 0」失效。
    `test_woot_margin` 重写为 A/B/C 三场景（22→**35**）、`test_woot_channel` 断言改为「单看 Woot **有**毛利 / pN 合并 = 官方 + Woot」（28）、`test_product_profit` 期望值改为自己按成本表+映射+汇率算（21）、`test_week_fx` 加 ⑧d 钉死「头程是人民币固定额，不随汇率缩放」（14）、`test_monthly_platform` ③ 由 `indexOf` 子串改为精确相等（原来只因下拉为空才真空通过）。
    `test_ratio_cols` **41/0**（本轮 ② 修完映射后自然通过，**没有改测试**）。
    回归全绿：ratio_cols 41 · woot_channel 28 · woot_margin 35 · product_profit 21 · note_fold 63 · monthly_dashboards 60 · daily_profit 27 · monthly_profit 16 · panel_defaults 25 · woot_rowprice 55 · week_fx 14 · woot_cost_map 19 · woot 49 · target_platform 47 · monthly_platform 41 · channel_ui_sweep 76 · orphan_totals 11 · ad_channel 46 · target_channel 49 · check_inline_js 4/4 产物。
    第二批（读重建产物的其余套件）也全绿：update_notice 65 · currency_ads 20 · daily_currency 10 · daily_filters 12 · daily_filter_link 22 · product_region 15 · buybox 8/8 · mcf_fee 33 · finance_inputs 21 · mapping_country_filter 23 · mapping_csv 30 · week_toggle 10 · kw_dashboard 12 · confirm_bar 78 · autosync · auth_guard 35 · target_official（无 JS 错误）· daily_sales_campaign 7 · search_confirm 23 · week_reset_verify 17 · ad_asin_rules 22 · verify_sb_attribution · verify_update_watch。
    ⚠️ `test_auth_guard` 首跑 34/1、**紧接重跑即 35/0** —— 已知的「刚发布完 CDN 未收敛」现象。未跑：JoyBuy 系列（需 CDP 9333）/ `test_joybuy_online`（打线上）/ `test_auth_login|signup|redirect`（刻意不改）。
    自检最终 **36 pass / 3 warn / 0 fail ✅ 可上线**（warn = A2b 老周稀疏 + G8 日数据延迟 + G18 源数据质量）。
  - **⑥ 已发布**：`workbuddy_sites_deploy`（static，复用 sandbox `3577d1e878e64dc5837e56f9471dcefc`）→ `verified: true`，**链接不变**；线上 10 个页面逐字节比对 **全部 SAME**、HTTP 200。
  - **⑦ 收尾又抓到第 3 份陈旧映射**：`_deploy/product_map.json` 是**线上页面真实 fetch 的资产**（`mapping.html` 在「云端失败 + 本地无缓存」时拿它做**预填充**；陈旧会让离线回退用旧映射，保存时**可能覆盖云端**）。实测 48 条 vs 源 51 条 ⇒ 已同步。
    - 顺手把自检 **E 系列**扩到覆盖 `_deploy/` 里的**运行期 JSON**：`product_map.json` / `daily_data.json` / `monthly_targets.json` / `finance_inputs.json`（逐字节）。已反向验证（放回 48 条版 ⇒ FAIL，报源 6478 / 部署 6211 字节）。
    - 因 `_deploy/` 有变动**又重发一次**（同 sandbox、链接不变）；线上 **14 个文件**（10 页 + 4 个运行期 JSON）逐字节 **全部 SAME**、HTTP 200。
    - 自检最终 **40 pass / 3 warn / 0 fail ✅ 可上线**。
  - 备份：`_bak_note_2026-10-13/`（3 个文案源文件）、`_bak_product_map_48.json`、`_bak_profit_metrics_pre_costtable.json`。诊断探针（留用，勿入回归）：`_probe_month_cost.js`（逐 ASIN 比对月看板 vs `profit_metrics.json`，专治映射分叉）、`_probe_month_kpi.js`（读各月 KPI）。
- 2026-10-13（**第七轮：Woot 成本改由「产品关系管理」解析（用户确认口径）+ 36 周毛利率异常排查 + 修掉自己引入的加载期 TDZ**）：用户两条 ——「1. woot 的销售额和采购价是对的，它们确实是独立存在的计算方式。然后 woot 的产品是 X1 40W 产品，你可以通过产品关系管理里面进行匹配」「2. 需要调查 36 周为什么毛利率这么异常，FBA% 会这么高，需要看看是不是有问题」
  - **① 口径确认（第 1 条 = 不要再动销售额/采购价，改的是「成本怎么来」）**：用户肯定了「销售额（零售价）与采购价（供货价）各自独立」的既有设计 ⇒ 保留 `pSales = 采购价收入` 与报表 `sales = 零售价` 的双基数现状。真正要解决的是**成本**：原先只认「Woot 数据管理 → 💵 Woot 成本设置」逐 ASIN 手工录入，该配置为空 ⇒ Woot 行毛利恒为 —。用户指出 **Woot 的产品就是 X1 40W**，且该 ASIN 已在「产品关系管理」里匹配到产品名 ⇒ 成本应从映射解析。
  - **② 回退链（幂等脚本 `add_woot_cost_map.py`，标记 `COSTRMB`，备份 `_bak_woot_cost/`）**：
    - ① `WOOT_CFG.cost[asin]` 手工配置**优先**（保持既有行为、可覆盖）→ ② 未配置则走「产品关系管理」：`asinMap` → 产品名 → `product_cost_table.json` 的 `costRMB`(采购成本) 与 `headRMB.US`(US 头程) ÷ (CNY/USD) → USD/台 → ③ 两者都没有 = `null`（该 ASIN 不入毛利，**不按 0 成本算**，否则毛利虚高）。
    - 注入：`build_daily_dashboard.py` / `build_monthly_dashboards.py` 注入 `__COST_JSON__`；周看板走 `integrate_profit.py`（`COSTRMB`）+ `integrate_ads.py` 的 `woot_inject` 块（另加 `wootCnyPerUsd()`，因周看板汇率表口径是 `FX`/`FX_WK`）。三看板汇率口径不同，**别把日看板的 `HF.months` 写法抄到月/周**。
    - ⚠️ **月看板 Woot 行必须给全 `profitOf()` 直接相加的字段**（`pPromo/pComm/pFba/pStorage/pOther` 全给 0）：`wmar` 原来只写 5 个字段，`pN` 恒 0 时 `profitOf()` 提前 `return null` 把缺字段掩盖了；启用回退后 Woot 行首次真正入账，缺字段立刻表现为**「合并视图 / 单看 Woot 的毛利 = NaN」**（`aggMonth` 内部都有 `||0`，所以只有 `profitOf` 这条路径炸）。
  - **③ 修掉自己引入的加载期 TDZ（本轮最大的坑）**：启用回退后**月看板整段脚本在加载期抛 `ReferenceError: Cannot access 'EMBED_MAP' before initialization`** ⇒ 该 `<script>` 后面的代码全不执行（`let selChannel` 未定义）⇒ 点「销售店铺」报错、页面基本空白。根因：装配期 IIFE（月 `injectWootMonthly`、日「Woot 毛利率状态提示」块）会调 `wootCostFromMap → asinMetaOf`，而 `asinMetaOf` 读的 `const EMBED_MAP` / `localMeta` / `embeddedMeta` **定义在后面**。
    - 修法：幂等脚本 **`fix_map_hoist_tdz.py`**（标记 `MAPHOIST`，备份 `_bak_maphoist/`）把「映射块」整体**上移**到装配块之前（月：移到「Woot 店铺数据并入」前；日：移到「Woot 毛利率状态提示」前）。执行顺序必须是 `add_woot_cost_map.py` → `fix_map_hoist_tdz.py`（前者以 `COSTRMB` 整体跳过，管不了新顺序问题，所以另起一个脚本）。
    - ⚠️ **日看板当时并没炸**——它的调用被 `try/catch` 吞了 ⇒ 页脚「产品关系管理回退 N 个」**恒显示 0**（**静默错数，比崩更危险**）。上移后计数才对。
  - **④ 自检**：新增 **G16**（回退链在日/月/周三个看板都在 + 真被 `wootUnitCost` 调用 + 手工配置仍优先 + 构建脚本注入 `__COST_JSON__` + 内置 `COSTRMB` 非空 + 月看板 `wmar` 字段齐全 + `integrate_ads.py` 的 `acc` 形状与回退仍在）；新增 **G17**（**映射块必须早于装配块**，覆盖 日/月 模板 + 已构建产物 + `_deploy` 副本），已用修复前的备份**反向验证过能抓到**。自检 **35 pass / 2 warn / 0 fail ✅**。
  - **⑤ 新增回归 `test_woot_cost_map.js`（19 项全绿）**：**不硬编码任何真实 ASIN**——动态从 `product_cost_table.json` 取一个 `costRMB>0` 的产品造合成 ASIN，从 `fx_rates.json.rates` 取最新 USD 汇率，断言日/月/周解析出的 `unit/freight` 与手工算一致、月 Woot 行毛利 = 采购价收入 − 成本 − 头程 − 广告费 且**不是 NaN**、以及**配了手工成本时必须以手工为准**（`src='cfg'`）；真实 ASIN 若在 `_map_cache.json` 里则额外核对一遍实案。
    - ⚠️ 写这个测试踩到的坑：`fx_rates.json` 的结构是 **`{fetchedAt, meta, rates:{ym:{…}}}`**，直接当 `{ym:{…}}` 读会拿到 `undefined` 汇率 → 期望值全 NaN（先误判成功能没生效）。
  - **⑥ 第 2 条排查结论：36 周毛利率异常 = 源数据（易仓利润报表）的单日商品成本尖峰，不是看板 bug；同时挖出**第二个反方向**的源数据问题**
    - 症状：W36 毛利 **−9,215**（其余各周全为正），`成本%`(商品成本÷报表销售额) = **−127.29%**（其他周 −12%~−36%）；**`FBA%`(配送费) = −5.82%，完全正常** ⇒ 异常在**商品成本**列，不在 FBA/配送费列（「FBA% 高」的直接观感其实来自成本列）。
    - 定位：`profit_data.json` 里 ASIN **`B0H69JJZ1M`(US) 在 2026-08-29**：`qty=1, sales=1954, cost=−15631.61, gross=−14243.82`。该 ASIN 正常单台成本 **−698.52**（全期 44 台全一致）；**全库只有这一行 `cost < −3000`**。W36 合计 cost −17,893 vs sales 14,057。
    - **材料性（USD，ERP 口径）**：W36 毛利 `−12,847.92` → 修正后 `+697.38`；8 月毛利 `−18,759.26` → `−4,524.69`（毛利率 −58.1% → −14.0%）。**差额 +13,545 / +14,235**。
    - ⚠️ **该值今天（`profit_data.json` generatedAt = 2026-10-13 15:03:16、覆盖至 10-13）现拉仍在** ⇒ 不是我们的陈旧缓存，是**易仓侧当前就挂着这笔**。建议在 ERP 查这笔成本归集（成本调整单/采购成本核算），核实后由 ERP 修正；**看板一律如实展示，不做任何"修正"**（改了就会和源报表对不上）。
    - 🔍 **顺手扫出反方向的问题：32 行 / 58 件「有销量但商品成本 = 0」**（毛利被**高估**）。其中 55 件所在 ASIN **在 ERP 全期从未记过任何商品成本**，且集中在**高单价新品**：
      `B0HF4GNDSM`(US 26 件, `sales=19.99` 但 `promo=−19.99` ⇒ 净额 0，像是 100% 优惠券赠品)、**`B0H9YBM4H1`(X1L主机+40W，9 件，售价 1,599~1,999/台)**、`B0H75KBB93`(X1主机+60W，5 件)、`B0H9YJWRHK`(X1L+60W，5 件)、`B0H9Y7TG64`(4)、`B0H9Y5QJX5`(2)、`B0H6QDJQR5`(2)、`B0HJBZ1QBQ`(1)、`B0HCZ6CPT1`(1)。
      用成本表 `costRMB ÷ 汇率` 粗估这批少扣成本 **约 1.5 万 USD**（⚠️ 与 ERP 单台口径有 ~10% 差异，仅供参考；`B0HF4GNDSM`/`B0H9Y7TG64`/`B0H6QDJQR5`/`B0HJBZ1QBQ` 连映射里都没有，无法估）⇒ **这批新品要提醒运营在易仓维护商品成本**，否则毛利一直虚高。
    - 新增自检 **G18（WARN 级）**盯这两类：①`qty>0 且 cost=0` 的行数 ②单台成本偏离该 ASIN **中位数** 3 倍以上且绝对值 ≥ 2,000 的离群行。（⚠️ **本节描述已于 2026-10-13 第八轮作废**：商品成本改成本表口径后，这两类易仓源数据毛病不再影响看板，G18 已重写为「商品成本口径体检」，只保留「口径未生效 = FAIL」为硬判据；此处保留仅作历史记录。）⚠️ **基准必须用中位数不能用加权均值** —— 离群行会把均值自己拉高（实测把 22.4 倍拖成 14.9 倍）。**只报 WARN 不报 FAIL**：这是源数据质量，看板如实展示即可，不该拦住发布；但必须可见，否则下次又会被当成「看板算错了」。自检现 **35 pass / 3 warn / 0 fail**。
  - **⑦ 线上状态（重要）**：15:00 自动化在 `fix_map_hoist_tdz.py` 之前部署了一版 ⇒ **线上 `monthly.html` 目前是坏的**（探针实测 `pageerror: ReferenceError: Cannot access 'EMBED_MAP' before initialization`、`selChannel` 未定义、正文仅 532 字）。本轮已重建并把 `monthly/daily/target/product.html` 同步到 `_deploy/`，**但未发布**（本轮用户消息未要求发布）⇒ **待用户确认后 `workbuddy_sites_deploy`（复用 sandboxId `3577d1e878e64dc5837e56f9471dcefc`）**。
    - ⚠️ **比对线上/本地时别拿 JS 字符串 `.length` 当字节数**：`fs.readFileSync(p,'utf-8').length` 是**字符数**，中文页会明显小于字节数（实测 product.html 564,161 字节 = 548,029 字符），拿它跟 `wc -c` 比会得出「线上是旧版」的假结论。要 `curl -o 文件` 后 `cmp` 或比 Buffer 长度。
  - **产物/测试**：新增 `add_woot_cost_map.py` / `fix_map_hoist_tdz.py` / `test_woot_cost_map.js`；改动 `build_daily_dashboard.py` / `build_monthly_dashboards.py` / `daily_dashboard_template.html` / `monthly_dashboard_template.html` / `check_data_integrity.js`（新增 **G16/G17**，另加 **G18** 成本源数据体检·WARN 级）；周侧 `integrate_profit.py` / `integrate_ads.py`（已在 `2026-08-17-14-21-33`）。复核：`test_woot_margin` 22 / `test_woot_channel` 28 / `test_woot_rowprice` 55 / `test_woot` 49 / `test_week_fx` 13 / `test_orphan_totals` 11 / `test_panel_defaults` 25 / `test_note_fold` 63 / `test_monthly_dashboards` 60 / `test_monthly_platform` 41 / `test_ratio_cols` 41 / `test_target_platform` 47 / `test_channel_ui_sweep` 76 / `check_inline_js` 4 产物全过 / 自检 35 pass·3 warn·0 fail。
- 2026-10-13（**复核：毛利是否随每日更新一起跑 → 补上 §A.2b 缺失的落盘步骤**）：用户提问「利润是否也是跟随每次更新一起跑的」
  - **结论（先查证再答）**：是。自动化 `automation-1787105514880`（每日 15:00）的 §A 链路口径本来就含 **§A.2b 抓取毛利数据**，紧接着 §A.3/A.4 重建 daily/monthly/target ⇒ **日/月看板的毛利列每天都跟着刷新**。§A.2b 失败时不中止链路（构建降级为空、毛利列显示 —），自检 **G11 FAIL** 即为可见告警。
  - ⚠️ **复核中发现一个真缺口**：`profit_metrics.json` 只会被 `build_profit_metrics.py` 写盘（唯一写入点 `build_profit_metrics.py:447`），而日/月构建是 `import build_profit_metrics; build()` **内存重建不落盘** ⇒ 若只按 §A.2b 原文跑 `node fetch_profit_data.js` 就去重建看板，这个文件会**静默停在上一版**。受影响面：**周看板**（`integrate_profit.py` 的 `PROFIT_METRICS` 常量直接读它，周一 §C.4 会拿旧毛利算周报）+ `verify_sb_attribution.py` 与各对账探针。**日/月看板不受影响**，所以这类故障表现为"只有周报和测试看起来错"。
  - **修法**：§A.2b 的命令块改为**两条成对**（`node fetch_profit_data.js` **+** `python build_profit_metrics.py`），并写明为什么不能省第二条。自动化提示词里引用的是步骤名「§A.2b 抓取毛利数据」，故**不需要改自动化本身**，按手册执行即会带上这一步。
  - 当期实测（10-13 上午）：`profit_data.json` generatedAt 2026-10-12 15:03:40 / 134 天 / 1680 行 / 覆盖至 2026-10-12；`profit_metrics.json` generatedAt 同源、1680 行；两者一致 ⇒ 昨日链路正常。（今日 15:00 的 §A 尚未触发。）
- 2026-10-13（**第六轮：月度数据看板接入 JoyBuy + 新增「🌐 平台」筛选**）：用户需求 ——「月度数据面板里面引入了 Joybuy 平台的数据，是否可以增加平台的筛选条件」
  - **先纠正前提**：`monthly.html` 原本**只含 Amazon 11 国**（278 行），JoyBuy 只并入了 `target.html`（302 目标 + 191 实际行，且那边早有平台筛选）。用户是抱着「月度面板里已有 JoyBuy」的印象提需求 ⇒ 先说明现状再确认口径，用户选「月度数据看板接入 JoyBuy + 加筛选」。**教训：需求里的前提可能不成立，先读构建产物核实再动手，别照着描述改。**
  - **① 数据并入（构建侧）**：`build_monthly_dashboards.py` 在 JoyBuy 段之后派生出 **`monthly_data_json`**（`out_data` 深拷贝 + 191 行 JoyBuy），**只给 MONTHLY 模板**用；target 继续用原来的 `data_json`。
    - ⚠️ **不能直接往共用的 `data_json` 里塞** —— 两个模板共用同一个 `__DATA_JSON__` 变量，塞进去会让 target 与它自己的 `__JOYBUY_JSON__`/`JBY_ROWS` **双计**。自检 **G15** 已断言 `target.html` 的 `DATA.rows` 里不含 `plat:'joybuy'`。
    - JoyBuy 行 schema：`{ym, cc, asin:null, plat:'joybuy', sales, units, orders, sessions, pv, series, name, currency}` + 补齐 `mob/brw/b2b/bbSum/bbCnt/adClicks/adCost/adOrders/adSales/adImpr=0`。⚠️ 这几项在 `aggMonth()` 里**没有 `||0` 兜底**，缺一个就是 `undefined` 参与加法 → **NaN 污染整月 KPI**（G15 逐字段校验）。
    - ⚠️ JoyBuy 的 `sales` 是**站点本币**（EUR/GBP），与 Amazon 行同口径 ⇒ 前端 `fxv(r.sales, r.cc, ym)` 会按国家自动折算，**构建侧不要再折一次**。
    - 顶部 gen_time 单独派生 `monthly_gen_time`（加「· 含 JoyBuy 191 行」），避免改动 target 的 `__GEN_TIME__`。
  - **② 前端筛选（模板侧 12 组改动，幂等脚本 `add_monthly_platform.py`）**：平台 = **行级字段 `plat`，缺省 = amazon**（Amazon 行零迁移）；多选 Set `selPlatform`（空集 = 全部平台，摘要「全部平台」满足「默认必须表达全部」的不变式）。
    - ⚠️ **`rowMatch()` 的 8 个调用点必须全部补 `plat: selPlatform`** —— 漏传**不报错**，只会让 地区/国家/ASIN/系列/品名 的候选列表按「全部平台」算（选项多出/少掉）。G15 用「调用点数 == 带 plat 数」把它钉死，模板与产物都查。
    - `rowMeta()` 加 JoyBuy 分支（**行自带 `series`/`name`**）：JoyBuy 行没有 ASIN，不特判会全落「无」，产品系列/品名筛选直接失效。
    - `asinList` 必须 `filter(Boolean)`（JoyBuy 无 ASIN，否则下拉多一个空选项）；`asinScope()` 跳过无 ASIN 行。
    - `seriesList` 并入 JoyBuy 行系列（否则 JoyBuy 产品在「产品系列」里根本选不到）；同名系列（如 X1）自动与 Amazon 合并。
    - `setAll('platform', v)` 分支 + `buildPlatformOptions()` 挂进 `renderAll()`；下拉面板带「看全部平台」按钮。
  - **③ 顺手修掉一个既有显示不一致**：`monthVal('ad_share')` 原只判 `bizOk` ⇒ 单看 JoyBuy（有销售额、无广告）显示 **0.00%**，而同行 广告花费/ROAS/ACOS 都是 — ⇒ 自相矛盾且与说明块承诺不符。改为 `adOk && …`（无广告数据一律 —），与 `test_target_platform` 里「JoyBuy 不再显示广告占比卡」的口径一致。
  - **④ 说明块**：新增「🌐 平台筛选」段落（两平台口径、JoyBuy 无广告/无利润行 ⇒ 广告与毛利列只反映 Amazon 且不被摊薄、PDP UV 与 Amazon Sessions 不等价、订单/件数带小数、ASIN 筛选会排除 JoyBuy 行）。
  - **⑤ 自检**：新增 **G15**（模板+产物都含平台结构 / rowMatch 无漏传 / renderAll 挂了 buildPlatformOptions / asinList 过滤空值 / monthly 有 191 行 JoyBuy 且字段齐全 / **target 不被污染**）；**B2 断言过期修正** —— 并入 JoyBuy 后 B2 拿「全部行」与每日源比必然 FAIL，改为**只比 Amazon 行**，并新增 **B2b**（月度看板的 JoyBuy 行 == `joybuy_monthly.json`，且 全部 = Amazon + JoyBuy）。自检 **33 pass / 2 warn / 0 fail**。
  - **⑥ 新增回归 `test_monthly_platform.js`（41 项全绿）**：结构（2 项下拉、默认「全部平台」、无选中、有「看全部平台」按钮）、**加和关系用页面自身三视图互验**（`calcKpis()` 取精确值：全部 = Amazon + JoyBuy 的 sessions/sales/units；广告花费在全部平台 == Amazon，**不被摊薄**）、渲染层断言（单看 JoyBuy 广告花费/ROAS/合计行毛利与广告占比全为 —）、与源对账（sessions == `joybuy_monthly.json` 合计，动态读不硬编码）、联动（JoyBuy 视图系列下拉含全部 JoyBuy 系列、ASIN 下拉提示无匹配、Amazon 视图不含 JoyBuy 独有系列、+地区=欧盟 只剩欧盟站点）、无 NaN/无 JS 报错、模板与产物 rowMatch 均 8/8 无漏传。
    - ⚠️ **写这个测试踩到的坑**：筛选下拉**选中后不会自动收起** ⇒ 第二次直接点 `.dd-btn` 是把已打开的面板**关掉**，后续点选项必然超时（`element is not visible`）。已封装 `openDD()` 先判 `open` 类再决定是否点按钮。
  - **⑦ 复核**：`test_panel_defaults` 25 / `test_monthly_dashboards` 60 / `test_ratio_cols` 41 / `test_note_fold` 63 / `test_target_platform` 47 / `test_channel_ui_sweep` 76 / `test_woot_channel` 28 / `test_woot_margin` 22 / `check_inline_js` 全过 / 自检 33 pass·2 warn·0 fail；`target.html` 仅 `JOYBUY.generatedAt` 构建时间戳变化（6 字节），数值零变化。
  - **⑧ 实测数值**：Amazon 视图 销售额 $198,644.21 / Sessions 29,571（**与用户截图里的月度面板数字完全一致**，反证改造前月度面板确实不含 JoyBuy）；JoyBuy 视图 $1,891.77 / 3,293（= `joybuy_monthly.json` 合计）；全部平台 $200,535.98 / 32,864.4 = 二者之和；广告花费两视图均 $79,211.68。
  - **⑨ 发布上线（2026-10-13 12:30，用户说「发布」）**：发布前逐文件核对 `_deploy/` 与源（index/login/ad/product 在 `_deploy` 就地维护，不覆盖）；线上 vs 本地比对确认**只有 `monthly.html` 会变**（线上 219,516 → 279,637；index/target/mapping 字节已一致）。`workbuddy_sites_deploy`（`language=static`、`directory=...\_deploy`、`userAskedToPublish=true`）→ **sandboxId 与分享链接均未变**、`verified: true`。
    - 发布后核验：①**线上四个页面与 `_deploy/` 逐字节一致（`cmp` 0 diff）**（⚠️ 用 `$(curl …)` 取正文再 `wc -c` 会**吃掉结尾换行少 2 字节**，务必 `curl -o 文件` 再 `cmp`）②线上 `monthly.html` 含 `ddPlatform`×6、`含 JoyBuy 191 行`、`joybuy` 201 处 ③浏览器探针：monthly 第二个筛选器 = **「全部平台」**、说明块收起态 30px、折叠 CSS 在线 ④线上冒烟 `_probe_live.js`：8 页全 200、NaN 0 / undefined 0。
    - ⚠️ 线上带云端数据时，monthly 合并视图 KPI 销售额 = **$210,035.89** = Amazon $198,644.21 + JoyBuy $1,891.77 + **Woot $9,499.91**（渠道默认「全部（合并）」；隔离测试预注入 `pc_woot='[]'` 所以只有 $200,535.98）。拆解探针见 `_probe_live_woot.js`。
    - 📌 **待用户确认的口径项（未改动）**：Woot 行的 `sales` 字段取的是**上传报表的零售价**（`sales: al.sales`，合计 9,499.91 / 5 台），而该行毛利走的是**等效字段 `pSales`**（采购价收入，本行因未配产品成本而 `pSales=0` ⇒ 毛利显示 —）。即「销售额列」与「毛利列」在 Woot 行上**不同基数**，与「报表 sales 是零售价不能当收入」的表述有张力（按供货价口径应为 1,380×5 = 6,900）。这是 10-10 就有的既有设计、本次发布未触碰，改它会动到所有合并视图总数 ⇒ 留待用户定夺。
  - **产物**：`monthly.html` 219,516 → **279,637**；模板 `monthly_dashboard_template.html`；构建脚本 `build_monthly_dashboards.py`；新增 `add_monthly_platform.py` / `test_monthly_platform.js`；备份 `.bak_platform/`；探针 `_probe_monthly_plat.js` / `_shot_monthly_plat.js`（勿入回归）。

- 2026-10-13（**第五轮收尾：定位「用户看不到折叠」= 未发布 + 折叠测试抖动修复**）：用户再次提出同一需求（说明块折叠 + 进入默认展示全部站点/平台之和）
  - **核对结论：本地早已实现且全绿，问题在线上是旧版**。用 `_probe_live_fold.js`（新增，诊断用勿入回归）带 `?cb=` 逐页读线上：7 个产物 `details.noteFold` **全为 0**、折叠 CSS 未注入，且 `target.html` 线上默认平台仍是 `🅰️ Amazon`（徽标「Amazon · 302 条目标」）⇒ 第五轮做完只同步了 `_deploy/`，**从未 `workbuddy_sites_deploy`**。教训：**本地改完 ≠ 线上生效**，用户在线上看到"没变"时先核对版本特征串，别急着重写代码。
  - **`test_note_fold.js` 抖动修复（真故障，不是环境问题）**：点击 summary 后报 `Execution context was destroyed, most likely because of a navigation`。根因 = 测试未桩 Supabase，页面 `cloudWootSync` / 映射同步拉到云端真实数据后与本机缓存不一致 ⇒ `location.reload()` 在 evaluate 中途销毁执行上下文。修法：每个文件改用**独立 context** 并 `ctx.route('**/rest/v1/mapping*')` 返回 `[{data:{catalog:[],asinMap:[]}}]`（两处同步都在开头 `return`）+ `addInitScript` 预注入 `pc_woot='[]'` 双保险；`page.close()` 一并改 `ctx.close()`。修后 **63/63 全绿**。
  - **复核**：`test_note_fold.js` 63/63、`test_panel_defaults.js` 25/25（7 个看板每个 `.dd-summary` 默认均为「全部」）、`check_inline_js.js` 8 产物全过、`check_data_integrity` **30 pass / 3 warn / 0 fail ✅ 可上线**。
  - **已发布上线（用户当场确认「立即发布更新」）**：`workbuddy_sites_deploy`（`_deploy/` 全目录、`static`、复用 sandboxId `3577d1e878e64dc5837e56f9471dcefc`）→ 链接不变。
  - **发布后线上核验（`_probe_live_fold.js`）**：daily/monthly/target/product/woot/mapping 各 **1 个** `details.noteFold`、joybuy **2 个**，全部**默认收起**（首块高 30~33px）、折叠 CSS 已注入；`target.html` 默认 `🌐 全部平台`、徽标「全部平台 · 302 条目标 + 191 条实际行 · 完成率(销量) 2%」；ad.html 无说明块（预期）。自检 **31 pass / 2 warn / 0 fail ✅**（「F 线上与本地一致」已转 PASS）。

- 2026-10-12（**第五轮：说明块折叠 + 目标看板默认「🌐 全部平台」**）：用户需求 ——「每个看板的这些解释的部分可以做折叠，然后面板的进去默认就展示所有的站点平台数据之和」
  - **① 说明块折叠**：7 个产物（daily/monthly/target/product/joybuy/woot/mapping）的说明区改成原生 `<details class="noteFold">`，默认收起、点摘要栏展开/收起（`▸` 旋转 + 「展开/收起」标签）。CSS **单独注入成 `<style>` 块插在 `</head>` 前** —— 不能塞进现有样式区，否则周看板注入链（`integrate_ads.py` / `integrate_profit.py`）的 `</style>` 锚点被打断，**后续所有注入全挂**。空内容折叠块自动隐藏（JoyBuy 的 `#filterNote`/`#footNote` 是运行时空占位）；⚠️ **必须挂 `MutationObserver`**，否则首屏判空设上的 `display:none` 不会因异步填充而撤销 ⇒ 说明块永久消失。ad 看板没有说明块（只有一行 footer），无需折叠。
  - **② target 默认平台改为「🌐 全部平台」**：审计发现 daily/monthly/product/ad/joybuy **本来就默认「全部」**（空 `Set` = 不过滤 / 日期取全窗口 / 月度 KPI 就是「N 个月合计」），**只有 target 写死 `selPlatform='amazon'`** ⇒ 进去只看到 Amazon。改法：新增 `🌐 全部平台` 置顶并设为默认，19 处补丁（`add_platform_all.py`，幂等）：
    - `PLAT_DATA.all.rows` **必须在「Woot 并入 AMZ_ROWS」之后**再 `AMZ_ROWS.concat(JBY_ROWS)`（写在 PLAT_DATA 字面量里会拿到**并入前快照** ⇒ Woot 数据在默认视图里静默消失）；月份同样取并集。`let ROWS/MONTHS` 的赋值因此从字面量后面**挪到** Woot 之后。
    - 新增 `platInScope(k){ return selPlatform==='all' || k===selPlatform }`，替换 **3 处** `tgtPlat(t) !== selPlatform` + 目标清单 `.filter(...)` 1 处。
    - **逐目标按其自身平台**解析/取数：`const tp = tgtPlat(t)` → `tp==='amazon' ? resolveTarget(t) : resolveTargetJby(t)`、`actualFor` / `actualForJby`。
    - 行渲染的地区列 / 流量副行改用**行级** `e.plat || tgtPlat(e.t)`（否则 JoyBuy 行被按 Amazon 渲染，少掉「地区 · 站点」与 PDP UV）。
    - JoyBuy 无目标 ⇒ 在「全部平台」下按**实际数据视图**并入（`dataOnlyEntries(true)`），并补月份过滤（原函数只筛国家/系列/品名）。
    - 合计行/徽标文案区分两类行：`302 条目标 + 191 条实际行`（否则把 JoyBuy 实际行也说成「目标」，数字对但语义错）。
    - **加载路径不走 `setPlatform()`** ⇒ 只在切换时做的 UI 收敛要补一份 `initPlatformUi()`，否则首屏 ASIN 筛选意外可见。
  - **改动文件**：`monthly_dashboard_template.html` / `target_dashboard_template.html` / `daily_dashboard_template.html` / `joybuy_template.html` / `woot.html` / `mapping.html` / `A/generate_filterable_report.py`（折叠 + 加固）；`target_dashboard_template.html`（+ 全部平台）。幂等脚本：`add_note_fold.py` / `fix_note_fold_css.py` / `harden_note_fold.py` / `add_platform_all.py`。备份在 `.bak_notefold/`。
  - **新增回归**：`test_note_fold.js`（**63 项**，折叠真值：默认收起 / 点击展开 / 再点收起 / 空块隐藏 / 无 JS 报错）、`test_panel_defaults.js`（**25 项**，通用不变式「每个 `.dd-summary` 默认都含『全部』」+ 各看板默认口径明细）。`test_target_platform.js` **33 → 47 项**（平台下拉 3 → 4 项、首项=🌐全部平台、默认=全部平台、新增「全部平台视图」段）。`test_target_channel.js` 补「显式钉住平台 = Amazon」（默认平台一变它整套挂 7 项）。
  - **实测**：折叠收起态 `details` 高度 **30px**（只有 summary），展开 152~580px；target 全部平台 = **302 目标 + 191 JoyBuy 实际行 = 494 行**，徽标「全部平台 · 302 条目标 + 191 条实际行 · 完成率(销量) 2%」。
  - **测试三坑（已写进技能 `supabase-html-board-verify` §3-G）**：①**认证守卫**会让 `file://` 打开跳 `login.html`（`details` 数恒为 0，看起来像"折叠没生效"）；②`<details>` 收起态是 `content-visibility:hidden`，子元素 `getBoundingClientRect()` **仍返回上次布局尺寸**（不是 0）、`checkVisibility({contentVisibilityAuto})` 对**离屏**内容也判 `false` ⇒ 真值只能用 **details 自身高度**；③**点击 summary 会触发重渲染替换掉 details 节点** ⇒ 绝不能在「点击的同一次 `evaluate` 里读 `open`」（读到脱落的旧节点，`open` 永远 true）。

- 2026-10-12（**第四轮：MCF 费率表接入 —— 官方费率卡 + 产品包装尺寸自动匹配分段**）：用户指令 ——「你这边能否直接搜索到亚马逊 MCF 的费率表，然后根据我们的产品尺寸你直接进行匹配，这个在计算器的创建工作里面是有完成的」
  - **先说结论：费率表本来就在本地，不用重新搜**。利润计算器目录 `2026-10-08-10-47-30/tools/mcf/` 早有一整套：`MCF-EU-2026.pdf`（21.6 MB 官方原件，来源 `static.amazon-supply-chain-assets.com/.../ext-mcf-rate-card-2026-eng-v2.pdf`）· `MCF-UK.pdf`（`supplychain.amazon.co.uk/docs/rate-card`）· `mcf-eu-uk.json`（PDF 提取结果）· `gen_mcf_embed.js`（带四道自检的嵌入生成器）。计算器 `profit-calculator.html` 里的 `MCF_RATES` 就是这套的最终产物，**尺寸分段匹配逻辑（`classifyTier` / `tierFee` / `mcfEuTiers`）也已实现**。
  - **① 费率卡搬过来（单一来源，不手抄）**：新建 `gen_mcf_rate_card.js` → **`mcf_rate_card.json`**。做法是从计算器 `MCF_RATES` 括号配对提取 + 自检（30 档 × 8 列齐全、分段门槛按小→大单调、**分段内**费率逐档非递减、US 8 个分段、燃油 1.5%），而不是把费率数字抄一遍 —— 抄错一个数就是静默错值。⚠️ 自检写法踩坑：**不能对 30 档平铺数组整体做单调检查**，`small_parcel` 末档（3900g）本来比 `std_parcel` 首档（150g）贵，跨分段必然下降 —— 必须分段内比。
  - **② 产品包装尺寸（解密抽取，只留尺寸不扩散成本）**：尺寸/重量在计算器的**加密成本表**里（`COST_BLOB`，AES-256-GCM / PBKDF2-SHA256 250k，口令在 `tools/.cost-key.json`）。解密后新建 **`product_dims.json`**（21 个产品 × `dimsCm` + `weightKg`，另存 `regionConsistent` 标记，实测三地区尺寸完全一致），**成本数值不进这个文件**。
  - **③ Python 等价实现**：新建 **`mcf_fee.py`**（`McfPricer`），逐条对齐计算器口径：分段顺序 = tierDefs 顺序、从最小到最大找第一个满足的、计费重 = max(毛重, 长×宽×高÷5000)、含燃油、超出所有档 → 标 `over`（宁高不低）不静默套小档。和计算器的**一处有意差异**：计算器 `classifyTier` 里的 `EU_SPECIAL` 判定是 FBA 13 分段表的门槛，MCF 的 EU 卡只有 6 分段且无 `special_os` 档，所以这里不做 special 判定。
  - **④ 接入利润链路**：`build_joybuy_profit.py` 的 MCF 分支改为按 SKU → 产品 → 尺寸 → 询价，`joybuy_cost_config.json` 新增 `countryOf`（site→国家，MCF 分区要的是**目的地国家**，`region`(EU) 粒度不够）与 `logistics.mcfFee.source: "rateCard"`；`default`/`bySku` 保留为**手动单价覆盖通道**（用于对账官方实际扣费）。
  - **结果**：MCF 那单（DE，材料包 33.2×32×4 cm / 1.47kg）→ **Standard Parcel**，计费重 1470g（档上限 1900g），基价 10.01 EUR + 燃油 1.5% = **€10.16** ⇒ 该单完整毛利 **€9.75**；9 月 DE 合计 `物流 €106.00 → €116.16`、`完整毛利 €370.85 → €380.59`。`missingMcf` 归零。
  - **⚠️ 本轮抓到的三个坑（都写进回归）**：
    1. **燃油附加在费率卡顶层 `euFuelPct`，不在 `eu` 子对象里**。Python 侧最初写成 `eu.get('fuelPct', 1.5)` —— 靠兜底默认值**碰巧算对**；官方一旦调到 2.0% 就会静默偏低且毫无提示。**这个坑是被 `test_mcf_fee.js` 的「双实现交叉比对」抓出来的**（JS 独立复算 → fee 为 null 暴露 fuelPct undefined）。现在显式读顶层并记录 `fuelPctSource`，测试断言它不是 `fallback(...)`。
    2. **官方 `cur` 表只有 DE/FR/IT/ES/UK，没有 NL**，但 NL 确实在 `deZoneOf` 里（ZONE 1）。按 `cur` 表查会把 NL 判成「不在费率卡覆盖范围」—— **静默漏站**。修法：币种由**取的是哪一列**推断（`DE`/`DE_Z*` → EUR、`UK` → GBP）。
    3. **UPO 口径**（联网复核官方公告确认）：费率卡只列 **1 UPO = 每单 1 件**的价格；官方明确「按件费用取决于每单件数（1/2/3+ UPO），**与尺寸分段无关**」⇒ 多件订单按 1 UPO 估会**偏高**。现在 `quote(upo=n)` 对 n>1 带 `upoWarning`，订单进 `selfCheck.mcfUpoApprox`。本期 MCF 单都是 1 件，正好用对表。
  - **联网复核结论**：官方费率卡仍是**当前有效版本**，无更新版。三项关键口径全部与本地一致 —— **2026-05-29 生效**（官方：「法国多渠道配送 2026 年费用更新……2026 年 5 月 29 日生效，每件平均提高 3.5%」）· **燃油 1.5%**（官方：「自 2026-05-02 起，MCF 的燃油和物流相关附加费在 UK/FR/DE/IT/ES 生效，按配送费计、不含售价」）· **跨境改按目的地分区**（官方：「对于跨境配送，将采用基于区域的运费」）。
  - **📌 产品可用性洞察（21 个产品全量跑了一遍，值得业务注意）**：
    - **小件 MCF 明显更省**（DE 站，对比成本表海外仓尾程）：激光头 `€9.02 vs €15.10`（省 6.08）· 滚轴 `€9.80 vs €15.10`（省 5.30）· 材料包 `€10.16 vs €15.10`（省 4.94）· 吸尘器 `€11.25 vs €15.10`（省 3.85）· 气泵 `€12.34 vs €15.40`（省 3.06）
    - **大件全部超出 MCF 欧英费率卡范围**（最大档 `45×34×26 cm / 11.9 kg`）：X1 主机类 `103×92.5×34`（47.6~54 kg）· X1L 增高底座 `94.6×52.6×39.8`（30.56 kg）· X1 系列蜂窝板 `78×58.7×7.2` · 净化器 `55.5×34×69` · E1 主机 `59×61×29` —— 这些**不能用欧英 MCF 卡计价**（代码会给 `over` 兜底值，但那不是可用费率，已在文案里写明）
  - **新增脚本与产物**：`gen_mcf_rate_card.js` · `mcf_rate_card.json` · `product_dims.json` · `mcf_fee.py` · **`test_mcf_fee.js`（33 项，全绿）**
  - **回归变化**：`test_joybuy_profit.js` **28 → 38 项**（新增 10 条 MCF 断言：按费率卡出费、带分段明细、fee = 基价×(1+燃油)、计费重 ≥ 毛重且 ≤ 档上限、材料包必落 Standard Parcel、费率卡信息进产物、口径可追溯、算不出必须进 `missingMcf`、超范围必须进 `mcfOverRange`、询价器无加载错误）
  - **测试设计要点**：`test_mcf_fee.js` 的核心是 **JS 侧按官方档表独立重写一遍匹配，再与 Python 产物逐条比对**（分段/基价/计费重/币种/超范围标记）—— 故意不复用 Python 代码，只共用 `mcf_rate_card.json` 这份官方数据；抄实现就失去交叉验证意义。另有边界（计费重 = 档上限落本档 / +1g 落下一档）、两条反向对照（同一件货 DE 与 FR 金额必须不同 ⇒ 证明按目的地取列承重；超范围货压回档内必须不再 over）、以及 NL 币种静默陷阱断言。
  - `check_data_integrity` 复核 **31 pass / 2 warn / 0 fail ✅**（本轮未动看板产物，只在 B 目录的 JoyBuy 链路内）
- 2026-10-12（**第三轮：周看板汇率改逐月 + JoyBuy 订单/账单/利润链路打通**）：用户两条指令 ——「①改逐月吧，数据要统一 ②JoyBuy 你能通过 API 看到订单信息吗？如果物流承运商是 Amazon Logistics 则物流费以 MCF 费用结算，如果是其他的则以海外仓尾程配送算，利润结构为货款−佣金−交易服务费−广告返点−增值税费−退款+退回佣金−退货服务费」
  - **① 周看板汇率改逐月（统一口径）**：原来 `rmbRate()` 全用**最新单月汇率表**统一折算，日/月看板却是逐月折算 ⇒ 同一笔 RMB 成本在不同看板折出不同本币值（实测差 196.51）。改法：
    - `generate_filterable_report.py` 新增 **`@@FX_WK_JSON@@` 占位符** → 注入 `FX_WK = { 周标签: {币种: CNY/单位} }`（按该周**周五**所在月取当月汇率，与周标签算法同源）
    - 模板侧新增 `FX_CUR_WK` 上下文 + `fxTbl()`：`fxv()` 有周上下文时用 `FX_WK[周]`，无上下文回退最新表（保证单 ASIN 筛选等调用点不炸）
    - `integrate_profit.py` 的 `rmbRate()` / `fxHeadCny()` 改为 `rmbRateOf(pw)` / 接受周标签；`calc()` 的 `perWeek[w]` 挂 `__wk` 标签，合计层逐周折算后累加（`tot.pRmb` 必须 == `Σ perWeek[].pRmb`）
    - **回归**：`test_week_fx.js`（13 项，新建）—— 断言每周用**该周所属月**汇率、总 RMB = 逐周累加、KPI 卡与合计行一致；含**反向对照**（把某一周汇率缩放 1.5× 后该周 RMB 必须同步变，证明周汇率是**承重**的而非摆设）
  - **② JoyBuy 订单 + 承运商：能拿**。`sp-order/v0/orders`（按站 shopId）+ **`sp-order/v0/waybill-traces`（承运商只在这一支里，订单列表/详情都没有）**。实测 DE 6 单 / FR 1 单，承运商出现 `GLS` / `GEL Express Logistik` / **`Amazon Logistics`** ⇒ MCF 分支被真实覆盖
    - ⚠️ 两个坑：站点 shopId 必须用 `listVenderShops(isEnableSiteCode:false)` 取（用开放平台 venderId 查订单**永远 0 条**，会误判「JoyBuy 没订单」）；**19 位 orderId 超 double 精度**，`JSON.parse` 会把 `…082650` 改成 `…082700`，拿被改的号查运单报「Order is not exist」⇒ 必须先把 ≥15 位整数加引号再 parse
  - **② 费用侧：开放平台没有，但商家后台有（本轮最大突破）**。开放平台文档站只有 5 组 44 个接口、**无 Finance**；唯一存在的 `BillingDetailQuery` 报 403（权限包「全流程控制」）。改走商家后台：
    - `POST sff.joybuy.com/api?api=dsm.jsp2.ledger.spi.bill.BillDetailReadProvider.queryBillOrderDetailShop`（汇总 `querySumBalAndCountShop`），页面入口 `partner.joybuy.com/finance-intl/homeOverview`（Payments → Account Overview），**用 `.joybuy.com` 的 cookie 直连即可，不需要浏览器**
    - 三个必修坑：**①必须切店铺**（`museaccount.joybuy.com/account/live/change?shopId&belongBizId` + 吸收 Set-Cookie；body 里传 `shopIdList` 不生效）——不切最阴的地方是**它会返回看起来正常的「上一站」数据**；**②`billOrderQuery` 15 个键缺一即 452**（值是 null 也得写）；**③不要用日期过滤**（`orderDateTimeS/E` 筛的是订单时间，会把跨期账单静默漏掉：同店不筛 5 条 / 筛 180 天只剩 3 条）。结果数组在 **`data.data`**（不是 `records`/`list`）
  - **② 费项词表（真实数据实测，与用户给的利润结构逐项对应）**：`Product Payment`(+1，货款) / `Commission`(−1，佣金) / `Transanction Fee`(−1，交易服务费，官方拼写就少个 s) / `Ads Credit`(−1，广告返点) / `VAT`(−1，增值税) / `Overseas Logistics and Warehousing Service Fee`(−1，海外物流仓储)。费率**全部以货款为基数**：佣金 **4% 或 10%（按类目）**、交易服务费 **2%**、广告返点 **1%**、VAT **≈15.97%（DE）**。`direction` 1=应收 / −1=应付，`bal` 恒正。**对账锚点**：`Product Payment` 合计 €1,803.89 = Data Compass 的 DE 9 月 GMV
  - **本轮新增产物与脚本**：`fetch_joybuy_orders.js`（→`joybuy_orders.json`）· `fetch_joybuy_bills.js`（→`joybuy_bills.json`）· `joybuy_cost_config.json`（SKU→成本表产品映射 + MCF 费率 + 费项映射/正则/符号规则）· `build_joybuy_profit.py`（→`joybuy_profit.json`）· **`test_joybuy_profit.js`（28 项，全绿）**
  - **利润模型口径**：`平台毛利 = 货款 + 佣金 + 交易服务费 + 广告返点 + VAT + 退款 + 退回佣金 + 退货服务费 + 海外物流仓储 + 其他`（费用项自带负号，直接相加）；`完整毛利 = 平台毛利 − 物流费 − 产品成本 − 头程`（后两项由 RMB ÷ 当月汇率折算本币）
  - **物流费按承运商判定**：承运商名匹配 `amazon(logistics|shipping|freight|transportation)?` → **MCF**；其它有承运商 → **海外仓尾程 = 成本表 `tailLocal[region]` × 件数**；无承运商（取消单）→ UNKNOWN
  - **⚠️ 两个静默错值陷阱（已写进回归，都会「看起来合理」）**：
    - **未成交/取消订单被扣产品成本** ⇒ 月度毛利凭空变负（实测 FR 那笔取消的 X1 会塞进 648 EUR 成本）。修法：`settled = (货款 ≠ 0) or (任一费项 ≠ 0)`，未 settled 的行 `costLocal/headLocal/grossProfit` 一律 `null` 且**不进月度汇总**
    - **账单里有、订单列表里没有的费项被整体丢弃**（如平台单号 `21xxxxxxxx` 的海外物流仓储费 1.83）⇒ 修法与亚马逊侧同款：以 `BILL_ONLY` 行补进模型，`orphanFee: true`
  - **⚠️ 仍缺一个输入（已显式报出，不静默按 0）**：**Amazon MCF 费率**。当前 `joybuy_cost_config.json` 的 `logistics.mcfFee.default = null` ⇒ 该单 `logisticsFee`/`grossProfit` 为 `null`，同时进 `selfCheck.missingMcf` 并由测试打印提醒。**补上费率即可出完整毛利**
  - **数据现状（2026-10-12）**：DE 站 2 个成交单走海外仓尾程（GLS / GEL Express），1 单走 Amazon Logistics（MCF，待补费率）；月合计（9 月）`货款 €1,803.89 · 平台毛利 €1,294.30 · 物流 €106.00 · 产品成本 €661.26 · 头程 €136.29 · 完整毛利 €370.85`（不含待补 MCF 那单）。UK / NL / FR 三站无账单（无成交）
  - **发布**：`product.html` 线上 == `_deploy/` == 根目录（**559,454**）；`check_data_integrity` **31 pass / 2 warn / 0 fail ✅**；线上特征串复核 `FX_WK` / `fxTbl` / `rmbRateOf` / `orphanProfit` / `profitRmb` / `pFbRet` / `refSales` 全部命中
  - **技能更新**：`joybuy-open-platform-api` → **2.3.0**，`references/fbj-fees.md` 新增 **§9.0b「商家后台账单明细」**（接口/三层结构/费用词表/5 个坑/落地实现），§9.0 结论由「拿不到实际费用」改写为「走 partner.joybuy.com」；§9.1 补 `feeCode ↔ feeName` 对照
- 2026-10-12（**第二轮：头程口径定性 + FBA 库存费拆 8 细项 + 退款进毛利 + 毛利(RMB) 列**）：用户四条指令 ——「①头程按预估值（更准）；FBA库存与入境服务费不在原口径里了，拆成 FBA退货处理费/其他FBA库存和入境服务费/超量费/合仓费/合作承运费/移除费用/FBA月仓租费/FBA长期仓租费；除仓储费与退货处理费外其余合并进「其他费用」分摊 ②多渠道销量损失单独成列，其头程也按成本表预估 ③毛利要减退款、加回促销折扣退款与销售佣金退款，并新增退款率列 ④毛利前一列加「毛利(RMB)」，汇率与看板同源；毛利列未筛地区时折算成美金，筛到单一币种地区时显示当地货币」
  - **口径定稿（两轮 AskUserQuestion 确认）**：①「FBA物流国际货运费（入境货运费）」= **不展示、也不计入毛利**，头程一律用成本表预估值（上一轮建的 `inbAbs`/`invxPct`/`pInb`/`pInvx` **全部下线**）；②8 个细项**各占一列**（不折叠成一组）；③入账规则 = `storage = fbMst + fbLst` 独立计入、`fbRet` 独立计入、其余 5 项（`fbOth/fbOvr/fbCon/fbCar/fbRem`）**并入「其他费用」**一起分摊；④退款率 = **退款件数 ÷ 利润报表销量**（数量口径，与易仓界面一致）
  - **新毛利公式（日/月/周三看板统一）**：
    ```
    毛利 = 销售额 + 促销折扣 + 销售佣金 + 配送费 + 商品成本 + 仓储分摊 + 其他费用分摊(含 5 项库存费)
           + FBA退货处理费
           + 退款各项(减退款金额与买家运费退款；加回促销折扣退款、销售佣金退款、配送费退款)
           − VAT(EU/UK) − 头程(成本表预估) + 其他渠道剔除加回 − 测评费 − 本看板广告花费
    ```
  - **① ERP 官方字段公式（权威来源 `customSummaryCalFormula`，写进 `fetch_profit_data.js` 注释）**：`fbaInventoryFeeTotal` = 退货处理费 + 其他FBA库存和入境服务费 + FBA物流国际货运费 + 超量费 + 合仓费 + 合作承运费 + 移除费用 + 仓储费用(交易报告) + 长期仓储费用。新增 `sumOf(r, ...names)` 容错取值（同一语义 ERP 会给多个候选字段名）
    - ⚠️ **「合作承运费」ERP 无独立返回字段**（317 个字段里实测缺）⇒ 用**倒挤**：`fbCar = fbTot − 已知 8 项`，保证「9 项之和 ≡ 汇总」；站点级与 ASIN 级两处都做倒挤
    - ⚠️ **日粒度只有 `fbMst`（FBA月仓租费）与 `stSite` 有值**，其余 7 项日粒度全 0；站点级（无 ASIN）行只有「入境货运费」⇒ 站点级费用不再参与分摊，改为 `payload.ignoredSiteFees` **审计输出**（本期 US：06 −1185.84 / 07 −375.84 / 08 −49.66 / 09 −1354.27）
  - **② 退款字段真名（原以为不存在，实测有）**：`refundFbaProductSalesTotal` + `fbmRefundFbmProductSales`（商品）、`refundPromotionalRebates`（促销折扣，正）、`refundSellingFees`（销售佣金）、`refundFbaFees`（配送费）、`refundShippingCredits`（买家运费）、`refundQuantityTotal`（件数）、`refundRate`。「退款净额」= 这几项按 ERP 原始符号相加后取绝对值
    - 本期实测：仅 2026-09 三天有退款 —— 09-08 US B0H75HMBF5（−2399 / 促销 +870 / 佣金 −5）、09-27 US B0H6QMYTWQ（−2199.99 / 佣金 −5）、09-29 US B0H6QNBPNF（−899.99 / 促销 +396.99 / 佣金 −5 / 运费 −6.99）；合计 `refSales −5498.98`、`refPromo +1266.99`、`refComm −15`、`refShip −6.99`、`refQty 3`、净额 **4253.98**
  - **③ 数据全量重抓**：`node fetch_profit_data.js --force`（134 天计划 / 89 天非空 / **1674 行** / 0 失败天）；`build_profit_metrics.py` 月度库存费分摊由「1 项」扩为 **8 细项**（`FB_KEYS`/`FB_OTHER` 两个常量收口），删除站点级入境费分摊段
    - ⚠️ **小范围 `--from/--to` 重抓会覆盖整个 `profit_data.json`**（只剩那几天）⇒ 误操作后从 `backups/profit_data.before_round2.json` 还原再 `--force` 全量
  - **④ 三看板新增 18 列**：`毛利(RMB)`（插在「毛利」**前**）+ 8 细项（`fbRetAbs`…`fbLstAbs`）+ 退款 5 列（`refAbs`/`refShipAbs`/`refPromo`/`refComm`/`refNetAbs`）+ `refRate`；同时删掉 `inbAbs`/`inbPct`。日看板毛利组 20 → 33 列（总 49），月/周同口径
    - **毛利(RMB) 汇率同源、各看板各用自己那份**：日看板 `cnyPerDisp(ym, cur) = hfCnyPerUsd(ym) × fxToUsd(ym, cur)`；月看板 `rmbOf(a) = profitOf(a) × (FX[ym][cur] || FX_FB[cur])`；周看板 `rmbRate() = FX[cur]`（周报自身那张交叉汇率表）。**月看板合计行必须逐月按各自月份汇率折算后累加**（跨月只用一个汇率会错）
    - **毛利列币种**：日看板走既有 `DISP_CUR`（未筛/多国混合 = USD，筛到单一币种国家 = 当地币）；月/周走既有 `curSym()`。目标看板**无毛利指标、不涉及**
    - **「取正数显示」约定**：8 细项与退款列一律显示绝对值（`-a.pFbRet` 这类），与既有 FBA/仓储/头程/其他费用一致 —— 写断言时别当成负数
  - **⑤ 本轮修掉的真 bug（3 个，全是「重建后静默显示错值」型）**：
    1. **月看板合计行与 KPI 卡不一致**：`renderTable()` 里**另有一份独立合计累加器**，加第二轮字段时只改了 `calcKpis()` ⇒ 合计行「毛利(RMB)/8 细项/退款」全显示 `—`，且「毛利」合计（−13,585.91）≠ KPI 卡（−17,839.89）。修法：**删掉 renderTable 的私有累加器，直接复用 `calcKpis().tot`**（从此只保留一份累加口径，新增字段只需改 `calcKpis`）
    2. **日看板整表渲染中断**：`aggRows()` 末尾新增的 `r.pCnyPer = cnyPerDisp(date.slice(0,7), …)` 是**无条件**执行的，而 `renderTable` 首行会传 `prevDate(d) === null`（DAYS 前 7 天没有上一周）⇒ `TypeError: Cannot read properties of null (reading 'slice')`，**110 行一行都不渲染**。修法：`date ? cnyPerDisp(...) : 1`
    3. **`$-0.00` 显示**：JS 里 `-0` 经 `toLocaleString` 会渲染成 `-0.00`（细项多为 0，一屏全是 `$-0.00`）。修法：三看板格式化层统一加 `nz(v) = Number(v) === 0 ? 0 : v`，包住 `fmtMoney`/`fmtRmb`/`fmtNum`/`fmtCell`/KPI 卡片与 `fmtKpi`
  - **⑥ 注入链锚点教训**：给 `generate_filterable_report.py` 的 `fmtCell` 加 `nz()` 后，`integrate_ads.py` 的「7.5 fmtCell 补丁」**整块锚点失配** ⇒ `AssertionError: fmtCell block not found`，链条中断、`integrate_profit.py` 接着报「METRICS: 毛利两列 未命中」。修法：改成**最小锚点**（只认 `if (m.pct) return v.toFixed(2) + '%';` 一行）并加幂等分支 ⇒ 以后再微调 fmtCell 不会连带打断整条注入链
  - **⑦ 自检/测试扩容**：
    - `check_data_integrity.js` **G11** 改写：`NEW_COLS` 换成本轮 18 列、`NEW_DATA_KEYS` 换成 `pFbRet/pFbLst/pFbMst/pRefSales/pRefPromo/pRefComm/pRefQty`、新增 `RMB_MARK`（三看板各自的折算助手）、**新增反向护栏「入境货运费字段复活即 FAIL」**、输出加「实数据抽样（月仓租 −421.21 · 退款 −5498.98(3件)）」
    - `test_daily_profit.js` **15 → 27 项**：加 8 细项/退款列存在性、毛利(RMB) 位置与 `≈ 毛利 × CNY/USD`、合计行细项取正数、退款净额恒等式、退款率 KPI、**新增「退款日对账」**（动态找有退款的一天做完整值对账 —— 原先只对 09-15，那天无退款 ⇒ 退款路径其实没被测到）
    - `test_monthly_profit.js` **12 → 16 项**：修 `profitRmb` 顺序断言、**修合计行取列的 off-by-one**（月表体每行是「1 个 frozen 月份 td + N 个指标 td」，而表头 row2 只有 N 个 th ⇒ 原来 `td[ci]` 实际读的是 `ci−1` 列，属"假通过"）、新增「合计行毛利 = KPI 毛利」「毛利(RMB) 为 ¥ 前缀且 ≈ ×汇率」
    - `test_product_profit.js` **13 → 21 项**：`expectWeek` 期望值补 `fbRet` + 退款各项 + VAT + mcAdj + review；新增毛利(RMB)/8 细项/退款列与退款率断言
      - ⚠️ **周看板测试断网（`ctx.route('**supabase.co/**', abort)`）⇒ 拿不到 asinMap ⇒ 页面 `headRmbOf()` 恒 0**（头程是**运行时**算的，不是注入值）⇒ 期望值**不能**减头程，否则假失败。头程口径由 `test_ratio_cols.js`（周报头程绝对值/占比）与日/月毛利测试覆盖
    - **顺手清掉 4 项既有假失败**：`test_joybuy_dashboard.js`（27/30 → **29/29**；根目录 `joybuy.html` 自 2026-10-05 起已接入数据，仍断言「尚未接入数据」空态 ⇒ 改为**自动区分空态/数据态**并各自断言）、`test_joybuy_portal.js`（16/17 → **17/17**；KPI 卡数写死 8，实际 5 ⇒ 改为从 DOM `data-slot` 反推期望张数）
  - **⑧ 回归**：全绿 —— 日毛利 **27** / 月毛利 **16** / 周毛利 **21** / 占比 41 / 月看板 60 / 目标平台 33 / 目标渠道 49 / 广告渠道 46 / 渠道 UI 巡检 76 / Woot 渠道 28 / Woot 毛利 22 / Woot 逐行采购价 55 / Woot 49 / 更新提示 65 / 财务录入 21 / 投放词 12 / 币种 20 / 日筛选 12 / 日币种 10 / 地区 15 / 映射 23+30 / 守卫 35 / 认证 21+13+14 / 周切换 10+17 / 自动同步 11 / 二次确认 78 / 搜索确认 22 / JoyBuy 29+17+22 / 结果集 live_sync「LIVE ALL PASS」；5 产物 `check_inline_js` 全过；自检 **30 pass / 2 warn / 1 fail**（唯一 FAIL = F「线上与本地一致」= **尚未发布**，属预期）
    - ⚠️ 环境依赖（非回归）：`test_joybuy_filter.js` / `test_joybuy_entry_e2e.js` 要真实浏览器 **CDP 9333**（`node joybuy_browser.js --keep`，默认 headless 无窗口），未起则 ECONNREFUSED；**跑完 `node joybuy_browser.js --stop`**（不关会驻留数天，用户关窗又被心跳自愈弹回来）
  - **⑨ 产物与同步**：`daily.html` **9,559,965 B** / `monthly.html` 217,182 / `target.html` 288,307 / `product.html` 505,259 → 521,545（= `filterable_dashboard.html`，A 目录产）→ 四份已 `cp` 进 `_deploy/`；同日临时探针（`_probe_r2`/`_probe_stack`/`_probe_week`/`_probe_mtot`/`_probe_w40`/`_chk_erp`/`_probe_fee_refund`）已删
  - **待发布**：`_deploy/` 已同步（daily/monthly/target/product），**等用户授权后** `workbuddy_sites_deploy` 发布（链接不变 `https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host`）
  - **已知口径差异（既有，非遗漏；用户已认可「按看板各取所需」）**：周看板毛利**只覆盖广告周报表的 ASIN×周范围**（`calc()` 遍历 `DATA.asin_list` ⇒ 本期 41 个 ASIN、W27~W40）⇒ 合计毛利 −15,937.62 比日/月看板（54 个 ASIN、至 10-11）**少 1,902.27**，其中一部分是「利润报表有行但不在周报表 ASIN 列表里的 13 个 ASIN（销售额 0、只有费用，如 B0HCVCX3RX 的月仓租 −45.62）」被静默丢弃。若要周看板也吃这些费用，需在合计层补「孤儿单元」累加 —— **本轮未改**（会改动周看板骨架口径，待用户确认）
    - ⚠️ **上面这段「少 1,902.27 / 13 个孤儿 ASIN」的口径在补记中已被证伪，见下条**（当时误与一个**过期构建**比对）
- 2026-10-12（**第二轮补记：孤儿单元补进合计 + 利润数据落盘同步 + 发布上线**）：接上条用户决策「**补进合计（不改行数）**」+「**立即发布**」
  - **① 周看板「孤儿单元补进合计」已落地**（`integrate_profit.py` 新增注入点「calc: 孤儿单元补进合计」，锚点 `  return { totals, perWeek };`）：
    - 语义：`PROFIT` 里**不属于 `DATA.asin_list`** 的 ASIN，其 (ASIN×周×站点) 利润字段**只累加进 `totals`/`perWeek`（即 KPI 卡与合计行），不产生表格行**（表格行数 = 周数，与本块无关）；同样受 `周/国家/系列/ASIN` 筛选约束（`selAsin.size > 0` 直接跳过 —— 筛选了具体 ASIN 时孤儿不在选集内）
    - ⚠️ **必须先聚合到本地对象 `o` 再一次性并入共享的 `pw`/`totals`**：若直接对共享的 `perWeek[w]` 累加，同一周的第 2 个孤儿单元会把前一个的数值**重复计入 totals**（一次注入两个孤儿会变成计 2 次）
  - **② 实测：今天的 8 个孤儿 ASIN 全是 0 值，补进合计后数值不变**（`B0HC2V2VMT`/`B0H9XZTM2D`/`B0HHXCQR8H`/`B0HHXVBHFZ`/`B0HHXLCCGD`/`B0HHXKYKVC`/`B0HFJYDFDC`/`B0HHXMLHN9` 在 `profit_metrics.json` 里的 `sales`/`qty`/各费用**全为 0**）。本块是**面向未来的正确性护栏**（将来某个孤儿有真实费用时会自动进合计），不是当期数值修正
    - **功能验证方式（合成数据）**：往 `const PROFIT = {` 后插两个假孤儿（`storage:-100` / `-50`，同属 W40）→ TOT 毛利精确 `−17,653.90 → −17,803.90`（恰好 −150，证明没有重复累加）、W40 行同步 `−7,754.12 → −7,904.12`、`pSales` 不变、表格行数恒为 **16**（15 周 + 合计）；再 `selAsin.add(第一个 ASIN)` → 单 ASIN 毛利与不带假孤儿的文件**完全一致**（证明孤儿被正确排除）。用完即删临时文件
  - **③ 真·口径差异已查清（取代上条的错误归因）**：以「日看板限周窗口（06-27~10-09）」为桥做同窗口对照，本期实测：
    | 口径 | 毛利 | 头程 | 件数 |
    |---|---|---|---|
    | 日/月看板（全窗口 06-23~10-12） | **−19,829.62** | 6,362.84 | 148 |
    | 日看板（限周窗口 06-27~10-09） | −17,715.12 | 6,199.37 | 145 |
    | 周看板（W27~W41 完整周） | **−17,518.61** | 6,220.90 | 145 |
    ⇒ 总差 **2,311.01** = **窗口差 2,114.49**（日/月多 7 天：06-23~06-26、10-10~10-12；周看板只认完整周）+ **汇率口径差 196.51**（周看板全用**最新单月**汇率表 `FX` 做所有折算，日/月看板按各自月份汇率逐月折算）。**孤儿 ASIN 贡献 = 0**
  - **④ 修掉一个真·数据同步缺口：`profit_metrics.json` 落盘落后于 `profit_data.json`**
    - `build_daily_dashboard.py` / `build_monthly_dashboards.py` 是 `import build_profit_metrics; build(verbose=False)` **在内存里重建**（**不落盘**），只有 `python build_profit_metrics.py` 才写文件 ⇒ 采集刷新后若只跑了日/月构建，`profit_metrics.json` 会静默落后（本期 14:10 vs 15:03），**以它为输入的两处**（`integrate_profit.py` 的周看板、所有读它的测试）全部偏旧
    - 症状：`test_daily_profit.js` 的退款率对不上（页面 148 台 vs 文件 144 台）；`_probe` 发现周看板 `pQty` 也偏小
    - 修法：**采集后补跑 `python build_profit_metrics.py`**（本期 1674 行 → **1680 行 / 90 天**），再跑 §C.4 周链；已把该顺序写进「刷新链路」认知（见 G11 判读）
  - **⑤ 修掉两个「静默失效」的测试**：
    - `test_daily_profit.js` 的退款率断言**硬编码 `2.08`** ⇒ 数据补齐后变 2.027 就假失败。改为**动态期望值**（页面 `DAYS` 内 `profit_metrics.json` 的 `ΣrefQty ÷ Σqty`，独立口径），并在注释里写明「退款率随数据增长而变，不许硬编码」
    - `test_week_toggle.js` **早就静默失效**（一直抛 `TimeoutError: element is not visible`）：它直接 `browser.newPage()` **没有桩鉴权** ⇒ 登录闸门挡在指标区之前，`#ddWeekList` 永远不可见。补上 `wb_auth` 桩 + mapping 路由后 **10/10 全绿**
  - **⑥ 发布上线（用户授权）**：`workbuddy_sites_deploy`（`_deploy/` 全目录、`static`、复用 sandboxId `3577d1e878e64dc5837e56f9471dcefc`）→ 链接不变 `https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host`
    - ⚠️ **发布前必须重新核对 `_deploy/` 与线上**：本期发现 15:00 的自动化**并发**重建/部署了 daily/monthly/target/**joybuy**，`_deploy/joybuy.html` 在我操作期间被另一个进程从 Oct-05 版换成 10-12 版并已上线 —— 逐文件比对（live `Content-Length` vs 本地字节）后确认无回滚风险才发布
    - 发布后逐文件核对：10 个页面/资源 live 字节 == 本地字节；版本特征串抽查（`product.html` 含 `orphanProfit`/`profitRmb`/`pFbRet`/`rmbRate`；`daily.html` 含 `cnyPerDisp`/`pCnyPer`/`refRate`；`monthly.html` 含 `rmbOf`/`pRmb`；`target.html` **确认无** `毛利`/`profitRmb`）
    - **线上冒烟**（真实云端映射 + 真实 Woot，非离线探针）：`product.html` 无 JS 错误、15 周 + 合计 **16 行**、`METRICS` **52 列**；合计行 `毛利(RMB) ¥-172,055.84` / `毛利 $-25,662.74` / `毛利率 -14.76%` / `退款率 2.07%` / `退款金额 $5,498.98` / `退款净额 $4,253.98` / `FBA月仓租费 $422.23` / `头程 $6,220.90` / `多渠道损失 $387.62`
      - ⚠️ **线上合计比离线探针大**（−25,662.74 vs −17,518.61）是**正常**的：离线探针把 `pc_woot` 桩成 `[]`，线上会加载云端 Woot 供货数据（合并看口径）
    - 发布后自检：**31 pass / 2 warn / 0 fail ✅ 可上线**（原唯一 FAIL「F 线上与本地一致」已转 PASS；2 warn = A2b 历史老周稀疏 + G8 近 7 天源延迟）
  - **⑦ 产物**：`daily.html` 9,842,353 / `monthly.html` 217,324 / `target.html` 288,449 / **`product.html` 555,086**（= A 目录 `filterable_dashboard.html`）；四份与 `_deploy/` 逐字节一致
    - ⚠️ 清掉两个**过期副本**：`B/product.html` 曾是 14:33 的旧构建（521,545，缺 15:09 刷新后的广告周报数据）—— 只 `_deploy` 同步而根目录不同步会让人量到错值（「少 1,902.27」的错误归因就是这么来的）；`profit_metrics.json` 已备份为 `_bak_profit_metrics_before_refresh.json`
  - **⑧ 发布后自查发现的真缺陷：孤儿块绕过了「渠道筛选」的包装层**（已修、已验证、已重新发布）
    - 根因：周看板的渠道是**包装式**实现的 —— `integrate_ads.py` 把 `asinWeekData` 整个换成 `_asinWeekDataAll + wootPartAcc` 的包装函数，`单看 Woot` 走 `return w`、`单看官方店铺` 走「逐键相减」。而孤儿块**直接读 `PROFIT`**，不经过这层包装 ⇒ 不护栏时**「单看 Woot」会凭空多出亚马逊侧费用**（表体无数据，合计/KPI 却有毛利）
    - 修法：孤儿块开头加 `if (typeof selChannel !== 'undefined' && selChannel.size && !selChannel.has('amazon')) return;`（孤儿 = 亚马逊利润报表行 ⇒ 只在亚马逊在视野内时并入）
    - **双向验证**（合成假孤儿 −100 + 真实云端 Woot 数据，测三种视图）：
      | 视图 | 无假孤儿 | 有假孤儿 | 结论 |
      |---|---|---|---|
      | 合并看（全部） | −25,662.74 | −25,762.74 | 含（−100）✓ |
      | 单看官方店铺 | −17,518.61 | −17,618.61 | 含（−100）✓ |
      | 单看 Woot | null | null | 排除 ✓ |
      **反向对照**：把护栏那行删掉后「单看 Woot」变成 **−8,244.13**（= Woot 的 −8,144.13 + 孤儿 −100）⇒ **证明护栏是承重的**，不是「恰好因为 Woot 视图为空才通过」。不做反向对照就会误判为"已验证"
    - ⚠️ **通用教训**：给看板「合计/累计层」补数据时，**必须检查该数据是否绕过了页面上的包装/筛选层**（`asinWeekData` 这类被替换的函数、渠道/店铺/地区等维度包装），否则补进去的数据会**无视筛选条件出现在所有视图里**
  - **⑨ 重新发布并复核**：`product.html` 555,086 → **555,594**（含渠道护栏），`_deploy/` + 线上同步；自检回到 **31 pass / 2 warn / 0 fail ✅ 可上线**；线上 `orphanProfit` / 渠道护栏 / `PK.forEach`（避免重复累加）/ `selAsin` 跳过串全部命中；渠道套装回归全绿（`test_woot_channel` 28 / `test_woot_rowprice` 55 / `test_woot_margin` 22 / `test_woot` 49 / `test_channel_ui_sweep` 76 / `test_update_notice` 65 / `test_target_channel` 49 / `test_ad_channel` 46）
- 2026-10-12（**入境货运费分摊 + 多渠道销量/损失 + 其他渠道剔除 + 测评费 + 头程正式入毛利**）：用户四条指令 ——「①FBA库存与入境服务费汇总是否计入，没有的话按国家站点给 SKU 分摊 ②统计多渠道销量（不产生收益但产生消耗：产品成本+头程+多渠道配送费），按产品分摊 ③多渠道配送有一部分来自非亚马逊渠道，我方按月上传其他渠道订单，据此把已产生的多渠道各项成本从亚马逊口径里月度剔除（能否实时） ④新增在线窗口导入测评费用（按月）」
  - **口径定稿（用户逐项确认）**：入境货运费**仅展示不入毛利**；头程与 ERP「FBA物流国际货运费」**二选一进毛利 → 用成本表预估头程**（ERP 那笔只作展示/对账）；**头程 2026-10-12 起正式计入毛利**；多渠道成本**从亚马逊毛利中剔除**（用户上传其他渠道订单后）；其他渠道订单粒度 = **月份 + ASIN + 数量**；测评费字段 = **月份 + 站点 + ASIN + 金额 + 币种 + 备注**
  - **新毛利公式（日/月/周三看板统一）**：`销售额 + 促销折扣 + 销售佣金 + 配送费 + 商品成本 + 仓储分摊 + 其他费用分摊 − VAT(EU/UK) − 头程(成本表预估) + 其他渠道剔除加回 − 测评费 − 本看板广告花费`
  - **① 入境货运费（`inb`/`invx`）**：ERP 只给**站点级月度行（无 ASIN）**且**日粒度为 0**，原采集脚本 `.filter(r => r.as)` 会把它整块丢掉 ⇒ 必须单独接出 `siteFees[ym][site]`，再按「站点×月销量占比」摊到每个 SKU 行（销量为 0 时退化为按销售额占比）。仅展示，**不进毛利**
  - **② 多渠道销量/损失（`mqty`/`mcost`/`mhead`/`mship`）**：ERP 公式里 `fbaFeesTotal` 含多渠道配送费、`productCostTotal` 含多渠道订单采购成本/头程 ⇒ **三项本来就含在 cost/fba 内，不重复扣**，三看板只**列示**（多渠道销量 / 多渠道损失 / 产品成本·头程·配送费）
  - **③ 其他渠道订单剔除（`mcAdj` 正数加回）**：新增 `finance_inputs.json`（云端权威源 = Supabase `mapping.data.finance`）。导入的 `(月, ASIN, 数量)` 先按该 ASIN 当月各站点**多渠道销量占比**分解到 `(月, ASIN, 站点)` 组，组内再按「该组多渠道损失占比」把 `−(mcost+mhead+mship)` 按比例加回 ⇒ 被其他渠道吃掉的那部分成本从亚马逊毛利里移出
    - ⚠️ **只能月度匹配，做不到实时剔除**：ERP 的多渠道配送记录**没有订单号/渠道标识**，无法逐单认领；用户按月上传后跑一次即生效（下一条是完整刷新链路）
  - **④ 测评费（`review`）**：`(月, 站点, ASIN)` → 折成站点币种后按行销量占比摊；ASIN 留空 = 全站
  - **⑤ 头程正式入毛利（本轮最大的数值变化）**：`profitOf` 新增 `− pHead`（成本表 `headRMB[US/EU/UK] × 销量 ÷ (CNY/USD)`）。周看板 TOT 毛利由 −6,646.90 变为 **−11,683.64**；三看板合计头程 **$6,163.57**
  - **⑥ 顺带修掉一个真 bug（Woot 运费重复扣，`test_woot_margin` 7 项失败暴露）**：头程进毛利后，Woot 行 `pCost` 里**已经含运费**（`wootProfitOf` 里扣过一次），而 `pHead` 又记了一次运费 ⇒ 每台虚减 `FREIGHT`。修法：把运费从 `pCost` **移到** `pHead`（`pCost` 只留产品成本），「成本」列=产品成本、「头程」列=运费、两者之和不变。三处同步：`daily_dashboard_template.html`、`monthly_dashboard_template.html`、`integrate_ads.py` 的 `wootPartAcc`
  - **⑦ 新增在线录入窗口 `finance_inputs.html`**（线上入口：`index.html` → 「🧾 财务录入（其他渠道/测评费）」按钮 → iframe）
    - 两个页签：`🔀 其他渠道订单`（月份/ASIN/数量/备注）、`🧪 测评费用`（月份/站点/ASIN/金额/币种/备注）；行内可编辑、删除、清空、统计卡片
    - 批量导入支持 JSON / CSV / TSV / XLS / XLSX（关键词识别表头 + 月份归一 `2026/10 → 2026-10` + 空 ASIN=全站 + 币种按站点兜底 + 同 `(月,ASIN)` 数量合并 + 非法行丢弃），可导出 CSV/JSON
    - ⚠️ **表头误判坑**：仅凭「含『月』字」判表头，会把备注「10月」命中的数据行整行当表头丢弃 ⇒ 改用「首个单元格不是合法月份/ASIN **且** 命中 ≥2 个列关键词」双硬信号（`looksData` 护栏，已进 G14）
    - ⚠️ **Supabase 单行共用**：`mapping` 表 `id=1` 的 `data` 被 **6 个页面共用**（`catalog`/`asinMap`/`woot`/`wootCfg`/`finance`）。**任一页面「只写自己的键」就会抹掉别人的** ⇒ 三处写回全部改为「读最新 → `Object.assign` 合并 → 整体 PATCH」：`finance_inputs.html`（新增）、`mapping.html`、`woot.html`（后两者是历史遗留的「只写自己键」，本轮修掉）
    - 构建期快照：`python sync_finance_inputs.py`（从云端拉取 → 归一 → 合并 → 写 `finance_inputs.json`）；`--show` 只看不写、`--file x.json` 离线灌入
    - **刷新链路**：`finance_inputs.html` 录入 → 保存(写云端) → `python sync_finance_inputs.py` → 重建看板（§A.3 日/月/目标 + §C.4 周报四步）
  - **⑧ 三看板新增 5 列（毛利组 15 → 20 列，总 34 → 39 列）**：入境货运费 / 多渠道销量 / 多渠道损失 / 其他渠道已剔除 / 测评费（键 `inbAbs`/`mcfQty`/`mcfLoss`/`mcfAdj`/`reviewAbs`），KPI 同步补 3 项
    - ⚠️ 周看板 `acc` 键数再 +8（生成器 10 + 广告 5 + 毛利 12 + 新增 8 = 35）：`integrate_profit.py` 的 `asinWeekData.acc`、`integrate_ads.py` 的 `wootPartAcc.acc` 与 `WT_PKEYS` **三处必须同步**，缺一 → 单看 Woot 的 KPI 变 NaN（10-10 / 10-12 两次同因，`test_woot_channel` 的形状护栏两次都抓到）
  - **⑨ 自检扩容**：G11 增 `新增财务列 5 项×3 看板` 断言；**新增 G14**（财务录入窗口 + index 入口 + 三页合并写回 + `finance_inputs.json` 结构）
  - **⑩ 期望值测试同步新口径**：`test_daily_profit.js` / `test_monthly_profit.js` 的独立复算加入 VAT/头程/剔除/测评费（头程由 `product_cost_table.json` + 云端 `asinMap` 独立算出，与 `test_ratio_cols.js` 同算法），并把「预注入映射 + 拦云端」改为标准姿势 —— **否则头程恒为 0、测试变成空跑**
  - **测试**：全绿 —— 日毛利 15 / 月毛利 12 / 周毛利 13 / 占比 41 / **财务录入 21**（含 index 入口 + 合并写回护栏）/ Woot 毛利 22（修前 7 fail）/ Woot 逐行采购价 55 / Woot 渠道 28 / Woot 49 / 渠道 UI 巡检 76 / 月看板 60 / 目标平台 33 / 目标渠道 49 / 投放词 12 / 币种 20 / 日筛选 12 / 映射 30+23 / 守卫 35；5 产物内联 JS 体检全过；自检 **30 pass / 2 warn**（唯一 FAIL = F「线上与本地一致」= **尚未发布**，属预期）
  - **待发布**：`_deploy/` 已同步（daily/monthly/target/product/mapping/woot/index/**finance_inputs.html+json**），等用户授权后 `workbuddy_sites_deploy` 发布
- 2026-10-12（**EU/UK VAT 扣减 + 三看板差异核查 + 发布上线**）：用户两条指令 ——「核对周/月/日看板数据差距根因」+「EU/UK 毛利扣 VAT，基数=销售价−优惠价」；两项确认后发布
  - **① 三看板差异根因（已查清，非数据错误）**：日看板 06-23~10-10（110 天）与月看板 06~10（同源）**KPI 完全一致**（销售额 $205,987.83 / 广告花费 $83,744.53 / 毛利 $-14,414.82 / VAT $1,086.60）；周看板只认**完整周**（W27~W40 = 06-27~10-02，14 周）⇒ 销售额 $170,546.80 / 广告 $64,676.98。差异三条：
    1. **覆盖窗口**（主因）：周看板不含 10-03~10-09（该周销售额约 $35,207、广告约 $18,177）+ 06-23~06-26（无销售）。用 `_reconcile2.py` 量化：窗口内 98 天 $161,280.70 / 窗口外 12 天 $35,207.22
    2. **广告覆盖 bug（真 bug，已修）**：`cdp_fetch_ad_weekly.js` 原写死「最近 7 周 + 整份覆盖 `ad_weekly_all.json`」⇒ 周看板广告只有 08-15~10-02。改为「从已存文件最早周起全窗口抓取 + **合并写入**」，并用日看板逐日广告明细回填（`backfill_ad_weekly.py`）→ 现在有花费的周全覆盖（首个有花费的日 2026-07-16，回填后最早周 07-11，回填值与周文件重叠周**完全一致**）
    3. **口径差（非错误）**：周看板销售额按**各国原币种**分别合计（不换汇）；日/月折 USD。ERP 利润报表按**结算日期**、业务报告按**下单日期** ⇒ 天然 5%~15% 差
  - **② VAT 结论**：ERP 利润报表**有**税费字段（`productSalesTax`/`promotionalRebatesTax`/`marketplaceWithheldTaxAndVat`/`salesTaxCollected`/`taxTotal`/`baseTaxExpense`），但**逐行核对「产品税 − 亚马逊代扣代缴税款」净额恒为 0** ⇒ ERP 毛利**没扣 VAT**，必须手动扣
    - 新建 `vat_rates.json`（**单一税率源**）：UK 20% / DE 19% / FR 20% / IT 22% / ES 21% / NL 21% / BE 21% / IE 23% / PL 23% / SE 25%，非欧站点 0
    - `build_profit_metrics.py` 逐行算 `vat = (sales + promo) × rate`（= 销售价 − 优惠价），行字段新增 `vat`；实测 UK 20.00% / DE 18.99%，与 Amazon 实际代扣吻合
    - 三看板新增两列 **VAT / VAT%**（键 `vatAbs`/`vatPct`），毛利公式统一改为 `… − VAT`：日看板 `profitOf`/`metricVals`、月看板 `profitOf`/`monthVal`/`aggMonth`、周报 `integrate_profit.py` 的 `profitOf`/`weekVal`。目标看板**无毛利指标，不涉及**
    - 实测：日/月 VAT $1,086.60（占销售额 0.62%）、周 $1,062.08；仅 UK($799.83 原币)/DE($3.19 原币) 有税额
    - ⚠️ `vat_rates.json` 的 `caveat` 已写明复核要点：ERP「产品税 = 销售额 × 税率」说明报表销售额本身是**不含税**的；若日后确认毛利已是不含税口径，把 `rates` 全改 0 重跑构建即回到原口径
  - **③ 顺带修掉一个真 bug（周看板 NaN，与 10-10 那次同类）**：加 `pVat` 时只改了 `integrate_profit.py` 注入的 `asinWeekData` acc，**漏了 `integrate_ads.py` 的 `wootPartAcc`** ⇒ 「只看 Woot店铺」时 `totals.pVat += undefined` → VAT/毛利变 NaN。修法：`wootPartAcc` 的 acc 补 `pVat:0`、`WT_PKEYS` 补 `'pVat'`、合并分支加 `rm.pVat = chNum(all.pVat) + chNum(w.pVat)`（Woot 无 EU/UK VAT，恒为 0）。**由 `test_woot_channel.js` 的「键集一致」形状护栏二次抓到** ⇒ 该护栏值得保留
  - **测试**：全量回归全绿 —— 占比 41 / 日毛利 15 / 月毛利 12 / 周毛利 13 / **Woot 渠道 28**（修前 3 fail）/ Woot 毛利 22 / Woot 49 / 月看板 60 / 渠道 UI 巡检 76 / 目标平台 33 / 投放词 12；5 产物内联 JS 体检全过（`check_inline_js.js`）
  - **发布**：`_deploy/` 全目录已上线 `https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host`（链接不变）；发布后自检 **30 pass / 2 warn / 0 fail**（F 线上一致两项转 PASS）
  - 新增诊断脚本 `_probe_kpi.js`（通用：读任意看板顶部 KPI 卡片 + 合计行，用来做三看板对账，勿入回归）
  - **线上冒烟（`_probe_live.js`，新增，勿入回归）**：带 `?cb=` 绕边缘缓存 + 注入 `wb_auth` 过登录守卫，逐个加载线上 6 个页面 → 6/6 HTTP 200、**无 pageerror、页面文本 NaN/undefined 均为 0**，且**线上合计行与本地逐字一致**（日 $205,987.83 / 月 $205,987.82 / 周 $170,546.80；广告 $83,744.53 / $64,676.98；毛利 $-14,414.82 / $-11,457.68；VAT $1,086.60 / $1,062.08）⇒ 线上确实是刚发布的这一版
- 2026-10-10（Woot 成本表接入）：用户提供 `Desktop/1.xlsx`（75 行 = 25 产品 × US/EU/UK），已写入云端 `wootCfg.cost`
  - **口径**：看板成本设置是 **$/台**；成本表「产品成本」「头程费用」是 **RMB**、「海外仓尾程配送」是**当地币**（US 行 = USD）⇒ `unit = 产品成本 ÷ 汇率`，`freight = 头程 ÷ 汇率 + 尾程`；汇率用当月 1 号 USD→CNY（与看板 FX 同源，2026-10 = **6.7045**）
  - **脚本 `_fill_woot_cost.py`**：按 `asinMap`（country=US）的 name ↔ 成本表「备注」精确匹配 → 算好 14 个 US ASIN → PATCH 云端（**写入必须带 `x-admin-key: wb-map-2026`**，publishable key 只读，裸 PATCH 返回 401）⇒ 成本表更新后重跑本脚本即可
  - 已配 14 个 US ASIN；**11 个产品编码暂无 US ASIN 映射**（E1 全系列 6 个、X1L60WRH/X1L40WRH/X1L20WRH、气泵、增高底座）——映射补上后重跑脚本
  - 验证：日/月/周三看板真实云端下 `wootUnitCost('B0H69JJZ1M')` = {unit:635.92, freight:180.41}（单台毛利 563.67，未扣广告费）；现有 16 条 Woot 记录（5 台）毛利即刻生效；自检 30 pass / 2 warn / 0 fail
  - 诊断脚本 `_live_cost_check.js`（真实云端、不拦 Supabase，一次性，勿入回归）
- 2026-10-10（补 W41 广告数据）：按 §B 链路补抓最新完整周，自检 D1 转 PASS
  - 链路：`fetch_ad_weekly_video.js`（13 国 8 周，新增 2026-10-03~2026-10-09；US W41 花费 $15,247.70 / 132 行，DE €1,071.22 / 34 行，UK £1,340.41 / 24 行）→ `fetch_ad_keywords.js`（40 活动 / 59 广告组 / 622 关键词）→ `build_ad_dashboard_data.py` + `build_dashboard_html.py` → `ad_dashboard.html`（883,370B，周数 W34–W41，592 记录 / 425 关键词且全部含 W41）→ `_deploy/ad.html`（cmp 一致）
  - 回归：关键词 12/12、广告渠道 46/46、更新提示 65/65；自检 28 pass / 2 warn / 2 fail（只剩 F 未发布 ×2）
  - **`test_ad_channel.js` 去硬编码**：原断言「官方记录数 = 528 / 合并 = 531」写死了数值，加一周数据就假失败 → 改为动态读 `ad_dashboard_data.json` 的 `records.length`（与 `test_target_platform.js` 同款约定）。**所有涉及记录数的断言都不要硬编码**
- 2026-10-10（采购价每行可填）：**Woot 毛利改为「按行取采购价」**，并修掉两个真 bug
  - 用户口径原文：① Woot 数据并入现有看板、只多「销售店铺」一个条件，Woot + 官方店铺 = 原看板数据（只是拆开看）② Aliencell官方店铺 = 去 Woot ③ **采购价以每行可填来进行，上传数据时一次性填好**
  - **数据模型**：每条 Woot 记录可带可选字段 `price`（USD/台，供货价）；**没填 → 回落默认采购价**（`wootCfg.price`，默认 1380）⇒ 旧数据零迁移、行为不变
  - **三看板**：`wootAllocByAsin` 增 `rev = Σ(采购价 × 订单量 × 分摊系数)`；等价利润字段改成 `pSales = rev`、`pCost = −(成本+运费)×订单量`；配置块（`WOOT_CFG`/`WOOT_PRICE`/`wootPriceOf`）**前移到分摊函数之前**（否则早期 IIFE 调用时 `var` 还没赋值 → NaN）
  - **`woot.html`**：表头识别列（采购价/供货价/供货单价/price…，并对「销售/零售/售价」加黑名单避免误吃零售价列）；记录列表加**逐行可编辑**「采购价」列 + 合计行显示「采购价收入」；导出 CSV 带该列（可原样回导）；手动添加加 `mPrice`；成本卡片文案改为「**默认采购价**（数据行未填时使用）」
  - **踩坑 1（真 bug，月看板）**：`pCost` 沿用了旧的「默认价口径毛利 − 收入」写法 → 在采购价 ≠ 默认价时让收入算两遍（测试里 2740 变 3480）。⚡ **这个 bug 在「采购价 = 默认价」时数值完全正确**，所以 `test_woot_margin`（22 项）全绿也测不出来 → 必须靠 `test_woot_rowprice.js` 的「同一 ASIN 同一周两个不同采购价」
  - **踩坑 2（真 bug，周看板）**：`acc.pCost = wRev − 成本`（应为 `−成本`）→ 单看 Woot 毛利 202.7 显示成 1582.7。**第一条断言就抓到了**，说明「先写测试再改」比肉眼可靠
  - **踩坑 3（真 bug，日/月/周提示条）**：`localSig` 有 4 段而 `cloudSig` 只有 3 段 → 两边**永不相等**，顶部「云端数据已更新」提示条**一直挂着点不掉**（刷新后又回来）。此前 12 项回归都不覆盖它，这次跑 `test_update_notice.js` 才暴露（62 pass / 3 fail → 修后 65 / 0）
  - **新增测试 `test_woot_rowprice.js`（55 项）**：三看板 ×（默认价兜底 / 逐行覆盖 / 改默认价只影响未填价的行 / 官方店铺不受影响 / 按 ASIN 过滤）×（毛利 / 收入 / 毛利率）+ `woot.html` 录入链路（表头识别 / 逐行改 / 清空回默认 / 导出 CSV / 导出→重导往返 / 手动添加 / 云端报文带 `wootCfg` 与每行 `price`）
  - **自检 G13 扩容**：三看板必须有 `wootPriceOf` 且分摊处读行内 `price`；`woot.html` 必须有 `key:'price'`、`onRowPrice`、「采购价」字样
  - **附带修的**：`test_live_sync.js` 里把地区数写死成 2（实际数据驱动为 3）→ 改为 `>= 2`，消除假失败
  - 重建并同步 `_deploy/`：`daily.html`(9,121,401) / `monthly.html`(149,258) / `product.html`(400,741) / `target.html`(235,725) / `ad.html`(862,111) / `woot.html`(53,019)
- 2026-10-10（收口）：**「销售店铺」筛选补齐到全部 5 个看板**（目标看板 + 广告看板），并加**跨看板一致性巡检**
  - 背景：用户口径是「在**各个**看板里增加销售店铺筛选」；此前只做了日/月/周三看板 → 这次补 `target.html`（目标看板）+ `ad.html`（广告看板）
  - **`target.html`**：`ddChannel` 插在筛选栏首位；`rowMatch` 加 channel 维（解构里放最前，5 个 scope 函数 + `actualFor` 的调用点全部传 `channel: selChannel`）；`setAll('channel')` / `buildChannelOptions()` / `renderAll()` 挂载 / 切平台时 `selChannel.clear()`（Woot 与 JoyBuy 不共存，避免切过去看到空表）
  - **`ad.html`**：Woot 广告原先**只能靠「广告类型 = Woot 广告」间接筛**，没有店铺维度。现加 `channelOk(r)` 并在 **9 处**记录遍历里加守卫（`recInScope` + 7 个候选范围函数 + `seriesScope`/`nameScope`）。⚠️ `setAll` 原来是一条三元链、`kind` 落空时**默认落到 `selType`** → channel 必须**前置分支 + return**，不能只往链尾加
  - **广告看板的联动效果（意外的额外收益）**：单看官方店铺时「Woot 广告」类型自动置灰(0 条)；单看 Woot 时 SP/SB/SD 全部置灰 —— 广告类型与店铺维度天然互洽
  - **跨看板一致性（`test_channel_ui_sweep.js` 新增，76 项）**：5 个看板逐个体检「下拉存在 / 位于筛选栏首位 / 选项文案 / 默认「全部（合并）」/ 单击 Woot 变「Woot店铺 单独看」/「合并看（全部）」恢复 / 零报错 / 无 reload 循环」，最后**收集 5 个按钮的实际 class 断言完全一致**（不写死期望值）
    - 第一次跑就抓出真问题：日/月/周用 `class="btn"`，我新做的 target/ad 用了 `btn primary` → **改新看板去对齐既有的朴素 `btn`**（而非重建三个线上大看板去统一成 primary，零风险）
  - ⚠️ **`target.html` 的 `EMBED_MAP` 是空的**（`catalog:0, asinMap:0`）—— 映射完全靠 `cloudMapSync` 拉云端 → 写 `pc_catalog`/`pc_asinmap` → `location.reload()`。**测试若只 stub 云端映射成空数组而不预注入 localStorage，所有目标行都会「映射中未找到」、实际值全 0**（我为此白排查了两轮）。修法：照 `test_target_official.js` 预取云端映射 → 写进 localStorage；新增 `_map_cache.json` 做离线回退，测试结论不再依赖网络
  - ⚠️ **`target.html` 表格末尾有 `.total-row`（合计行），它的「实际销量」格**本身又是总数** → 逐行列求和必须排除 `.total-row`，否则正好翻倍（实测 128 → 256）。测试容差写 `±1` 时 1 → 2 会被蒙混过关，所以顺带把容差收到 0.5 并单独断言合计行
  - 新增回归：**`test_target_channel.js`（49 项）** + **`test_ad_channel.js`（46 项）**（均含 additivity 对账：合并 = 官方 + Woot，逐指标：花费/点击/订单/曝光/销售额/记录数/广告组数）
  - 自检 **G13 扩容到 5 个看板**，并区分两个实现流派：行过滤式（日/月/目标/广告：`channelOf` + `channel:'woot'`）vs 逐键相减式（周看板：`channelMerged` + `wootParts`/`wootAdParts`）；毛利字段仍只要求日/月/周
  - 全量回归全绿：**渠道 UI 巡检 76 / 目标渠道 49 / 广告渠道 46 / 目标平台 33 / 月看板 60 / Woot 渠道 26 / Woot 毛利 22 / Woot 49 / 日毛利 15 / 月毛利 12 / 周毛利 13 / 日筛选 12 / 地区 15**；自检 27 pass / 2 warn / 3 fail（D1 缺 W41 + F 未发布 ×2，均预期）
- 2026-10-10（深夜·续）：**Woot 毛利口径接入三看板**（把框架闭环 —— 成本表一填即生效，无需再改代码）
  - **做法：给 Woot 造一组「等效利润字段」**，各看板既有的毛利计算逻辑（`profitOf` / `metricVals` / `aggMonth` / `monthVal`）**一行都不用改**：
    - `pSales = 采购价 × 订单量`（供货价 → 收入侧，同时充当毛利率分母）
    - `pCost = −(产品成本 + 运费) × 订单量`（与 ERP「费用为负」的记法一致）
    - `pN = 1` →「有没有利润数据」的开关，让单看 Woot 时不再显示 `—`
    - 广告费**不用**在这里减：`profitOf` 会自动减 `adCost` / `adSpend`（其中已含 Woot 广告费）
    - ⇒ 净额 = 采购价 × 订单量 − 产品成本 × 订单量 − 运费 × 订单量 − Woot 广告费（正是用户口径）
  - **三看板接入点**：日 = `aggRows` 的 biz 循环识别 `row.woot`、在利润聚合处入账；月 = `injectWootMonthly` 填 `ROWS` 行时带上等效字段；周 = `wootPartAcc` 造等效字段 + 合并分支叠加
  - ⚠️ **未配成本的 ASIN 一律不入账**（`wootProfitOf` 返回 `null`）：按 0 成本算会把 Woot 毛利显示成「采购价全额」，**虚高比留白更危险**。所以是**逐 ASIN** 判断 —— 某个 ASIN 没配，它就不参与毛利合计
  - ⚠️ **周看板「只看官方店铺」不能把毛利键一起相减**（`WT_PKEYS`）：Woot 的等效字段是「额外加进去的」，官方那侧的 `pSales` 本来就只含亚马逊利润报表，一起减会把官方毛利算成负数
  - ⚠️ 日看板 `WOOT_CFG` 段必须**排在 `WOOT_INJECTED` 的文案之前**（该文案要读配置状态）—— 原先是 `const` 提前引用（TDZ 报错）
  - 新增回归 **`test_woot_margin.js`（22 项）**：三看板 ×（未配成本 / 配成本）×（单看 Woot / 单看官方店铺 / 合并），期望值 Node 侧独立算；含「**未配成本时合并 = 官方店铺 − Woot 广告费**」这条过渡状态锁定（配成本后应变成「官方店铺 + Woot 毛利」）
  - 自检 **G13 扩容**：三看板须含 `wootProfitOf` + `pc_woot_cfg` 读取
  - 全量回归全绿：**Woot 毛利 22 / Woot 渠道 26 / 日 15 / 月毛利 12 / 周毛利 13 / Woot 49 / 地区 15 / 月看板 60**；自检 27 pass / 2 warn / 3 fail（均预期）
- 2026-10-10（深夜）：**Woot 拆出「销售店铺」渠道（日/月/周三看板）+ Woot 成本设置框架**
  - **渠道维度**：三看板新增「销售店铺」筛选（`Aliencell官方店铺` / `Woot店铺`），默认「全部（合并）」，也可单看。Woot 注入行带 `channel:'woot'`，**缺省视为 amazon**（旧数据零迁移）。日/月看板在 `filterRows` / `rowMatch` 层过滤；周看板因是「合并值」→ 用**逐键相减**（`合并 − Woot`）
  - **周看板实现要点**（`integrate_ads.py`）：用**包装**而非改写 `asinWeekData` / `setAll` / `syncAndRender` / `updateSummaries` —— 该文件后面还有一串「精确字符串替换 + assert」的补丁块，改写函数体会让它们失配；`wootPartAcc` 的骨架**必须与 `asinWeekData` 的 acc 同形状（24 键 = 生成器 10 + 广告 5 + 毛利 9）**，缺键会让 `calc()` 里的 `pw.x += d.x` 累加成 **NaN** 并污染整页 KPI（已加 NaN 体检断言）
  - **毛利归属**：Woot 没有利润报表行 → **毛利只归官方店铺**（单看 Woot 显示 `—`；官方店铺与合并的毛利一致）。⚠️「合并看」会因只扣了 Woot 广告费、没有对应收入而**偏低**（实测 W37 单看官方店铺 > 合并）——这是已知口径，等成本表接入后由 Woot 毛利补上
  - **新增回归 `test_woot_channel.js`（26 项）**：控件结构（含位于筛选栏首位）/ 单看 Woot 与原始记录对账 / 合并 = 官方店铺 + Woot（**10 项指标**）/ 流量只属官方店铺 / 毛利归属 / **NaN 体检** / UI 单击=单选与「合并看」恢复 / 零页面错误。候选 ASIN 与周**动态发现**，不写死
  - ⚠️ **踩坑（整页白屏，代价 1 小时）**：`woot_inject` 是 Python `'''...'''` 字符串，内部写 `\'` 会被 **Python 吃掉反斜杠** → JS 里 `onclick="toggleDD('ddChannel')"` 变裸标识符 → `SyntaxError` → **主脚本整体不执行**（`DATA`/`METRICS`/`calc` 全 undefined，表面上只是下拉没出现，实际全废）。要输出 JS 的 `\'` 必须写 **`\\'`**。新增扫描脚本 `_scan_escapes.py`
  - **Woot 成本设置框架（`woot.html`）**：新增「💵 Woot 成本设置」卡片 —— 采购价（默认 **1,380 USD/台** = Woot 付我们的**供货价**，属**收入侧**；报表里的「总销售额」是零售价 ≈1,899.98，**不能当收入**）+ 逐子 ASIN 的产品成本 / 运费（支持粘贴或导入 CSV/XLSX）。存 `localStorage pc_woot_cfg` + 云端 `mapping.data.wootCfg`；**三看板的 `cloudWootSync` 与 `localSig` 同步该键**（否则只有录入者本人看得到）
  - 毛利 = **采购价 × 订单量 − 产品成本 × 订单量 − 运费 × 订单量 − Woot 广告费**。**成本表未接入前 Woot 不参与毛利合计**（按 0 算会让毛利率虚高）；等用户成本表到位后启用
  - **自检新增 G13**：三看板含「销售店铺」筛选（`CHANNELS` + 两个渠道名）+ `woot.html` 含 `pc_woot_cfg` / 采购价默认 1380 / 云端保存带 `wootCfg`
  - 全量回归全绿：**周渠道 26 / 日 15 / Woot 49 / 周毛利 13 / 地区 15 / 月看板 60**；自检 **27 pass, 2 warn, 3 fail**（D1 缺 W41 + F 未发布 ×2，均预期）
- 2026-10-10（夜）：**日看板接入统一归因（补齐第四份 JS 副本）+ 修正「孤儿广告费」表述 + 清理两项既有失败**
  - **日看板 SB 归因补齐**：`daily_dashboard_template.html` 的 `extractAsin` 原来只有两级（自带 `Asin` + `SPECIAL_ASIN`），**筛单个 ASIN 时 SB 被 `filterRows` 整块丢掉**。现改为与 `ad_asin_rules.py` 完全一致的四级规则（含 `X1_FALLBACK` / `LITE_FALLBACK` / `X1\d` 挡板），**所有调用点传站点**。实测 2026-09-07 筛 `B0H69JJZ1M`：广告花费 14.28 → **293.69 USD**（SB 兜底 225.56 + Woot 注入 53.85）
  - 新增回归 ⑦/⑧（`test_daily_profit.js` 10 → **15 项**）：⑦ 锁「筛单 ASIN 时 SB 必须入账」（含反证断言 `got ≠ all − sb`，防止用例空转）、⑧ 锁「欧洲款 X1 按站点归 `B0HH8J6SSL` 而非错归美国款」，两个用例的日期与 ASIN 全部**动态发现**、期望值**从页面取广告条目**（`adItems()`），不写死
  - ⚠️ 踩坑：期望值不能读 `daily_data.json` —— 看板启动时会从 `pc_woot` 注入 Woot 广告行，只读源文件会恒差 53.85（`test_daily_profit` 已改为从页面取数）
  - **修正「孤儿广告费」表述（原判断有误）**：早先 `verify_sb_attribution.py` 的「看板侧」只累加 `pN` 为真的行，于是差额恒等于孤儿广告费，看起来像「该费用没进毛利」。实测月度 KPI **差额恒为 0.00** —— `aggMonth()` 对范围内**所有行**都累加 `adCost`，孤儿广告费**是被扣掉的**，只是它所在那一行的行级毛利显示 —。脚本已改成「所有行」口径并断言差额为 0；`build_monthly_dashboards.py` 注释、月度/周看板说明文案同步修正
  - **月度毛利数字修正**（USD，月度看板 KPI 口径；早先少扣了孤儿广告费）：

    | 月 | 报表销售额 | 广告花费 | 毛利 | 毛利率 |
    |---|---|---|---|---|
    | 2026-07 | 18,633.47 | 4,395.40 | 2,720.21 | 14.6% |
    | 2026-08 | 32,284.48 | 17,721.74 | -19,463.91 | -60.3% |
    | 2026-09 | 83,948.00 | **31,464.06** | **13,090.52** | **15.6%** |
    | 2026-10 | 33,428.01 | **22,019.21** | **-4,864.26** | **-14.6%** |

    （加粗项为修正值，原记录 31,062.89 / 13,491.68 / 21,327.86 / -4,172.92 均少扣了孤儿广告费 401.16 / 691.35）
  - **自检 G12 扩容**：除「三处构建必须共用 `ad_asin_rules.py`」外，新增校验**日看板 JS 镜像**（模板 + 已构建的 `daily.html` 都必须含四级兜底、`X1\d` 挡板、且无 `extractAsin(it)` 漏传站点）→ 防止「改了模板没重建」或镜像再次退化
  - **清理既有失败 `test_product_region.js`（5 FAIL → 15 PASS）**：断言写的是「5 个地区固定 + 范围外国家置灰」，但看板早已改成「只显示**有数据**的地区 + 选地区后**隐藏**范围外国家」。已重写为锁定真实语义并全部动态取值；其中「地区面板不随国家选择收窄」确认为**刻意设计**（选完 US 仍能直接跳 EU/UK），不是 bug
  - 本轮重建并同步 `_deploy/`：`daily.html` / `monthly.html` / `target.html` / `product.html`；回归全绿（日 15 / 周 13 / 月 12 / 归因 22 / 月看板 60 / 目标 33 / 关键词 12 / 地区 15 / Woot 49 / 广告币种 20）
- 2026-10-10（下午）：**品牌推广（SB）广告费归因修复 → 月/周看板毛利口径对齐**。用户答复「SB广告按照我们之前定的规则归因到具体的产品上去」。查明旧规则为什么归不到：SB 报表 `Asin` 与 `Sku` 都为空，而活动名里又**不含 ASIN 字面量**的有一批（`A-X1-40W-SBV-*`、`A-X1-SBV-Storefront`、`A-Lite-SB商品集`），三级旧规则必然失败。
  - 新增 **`ad_asin_rules.py`（唯一权威规则源）**：四级优先级（自带 Asin → 活动名 ASIN → SPECIAL → 系列兜底），系列兜底的 ASIN 由 **SP/SD 同名活动的 SKU→ASIN 反查**证据得出
  - 三处调用方全部改为引用该模块（删掉各自的三份副本）：`aggregate_ads.py`、`build_monthly_dashboards.py`、`build_ad_dashboard_data.py`；**调用时必须传站点**（同 SKU 在不同区域是不同 ASIN）
  - 运营指认结果：`Lite` 系列 → Lite 40W `B0H9YBM4H1`；`X1` 系列 → 北美 `B0H69JJZ1M` / 欧洲 `B0HH8J6SSL`（含 `A-X1-40W-SBV-*` 与泛 X1 的 Storefront、片段1）
  - 效果：修复前丢弃 **14,308.34 USD**（07/08/09/10 月分别为 241.33 / 3,692.14 / 6,970.99 / 3,403.88），修复后全量 72,684.38 USD **未归属为 0**；2026-07、2026-08 月合计与源数据/日看板**完全一致**
  - 新增回归 `test_ad_asin_rules.py`（22 项：四级优先级、站点差异、X140 挡板、未知不猜）+ `verify_sb_attribution.py`（源数据 vs 看板逐 (月×国家×ASIN) 对账 + 月合计对账）；自检新增 **G12**（三处构建必须共用该模块、不得再出现 `SPECIAL_ASIN` 副本）
  - 新增口径边界「**孤儿广告费**」：归到的 ASIN 在该站点无利润报表行时，广告费进「广告花费」但不进毛利（2026-09/10 月 UK `B0HH8J6SSL` 折 USD 401.16 / 691.35），构建期显式打印 + 两个看板说明文案已标注
  - 踩坑：① 兜底必须传国家（否则欧洲 X1 归到北美 ASIN）② `A-X140-Auto` 的 `PortfolioName` 恰好是 "X1"，只用 PortfolioName 判定系列会误归 → 加 `X1\d` 挡板 ③ `campaign_info_map` 里键名是小写 `name`，占位活动（已暂停且无广告记录）因此永远归不到，行为与旧代码一致、不影响毛利（这些活动花费为 0），不要误判成本次引入 ④ 周看板测试读 `_deploy/product.html`，重建后必须同步 `_deploy` 否则测试对着旧文件跑
- 2026-10-10（夜）：**费用占比与头程口径落地（日/月/周 三看板）**，源于用户四条口径。
  1. **尾程口径修正**：成本表「海外仓尾程配送」**只有 FBM 订单才计，FBA 不计** ⇒ `_fill_woot_cost.py` 改为 `freight = 头程(RMB)/汇率`（原来 `头程 + 尾程` 一起塞进 freight）。云端 14 个 US ASIN 的 `wootCfg.cost.freight` 已重写（X1L 主机类 180.41 → 77.41）。**易仓利润报表重复计入排查结论：无重复** —— 利润报表里配送费只有 `fba` 字段，没有「海外仓尾程配送」这一项（`svc`/`psvc` 实测合计仅 −15，`mst`/`lst` 月/长期仓储合计 −3.15），所以 FBA 订单不会被计两次尾程。
  2. **六项费用占比 + 五项绝对值**（除成本外都带绝对值）：`成本%`（只有占比）/ `FBA`+`FBA%` / `promotion`+`promotion%` / `仓储`+`仓储%` / `头程`+`头程%` / `其他费用`+`其他费用%`，共 11 个键，三看板**键名统一**（`costPct` / `fbaAbs` / `fbaPct` / `promoAbs` / `promoPct` / `storageAbs` / `storagePct` / `headAbs` / `headPct` / `otherAbs` / `otherPct`）。**分母统一 = 利润报表销售额 `pSales`**，占比 = −费用/pSales×100（头程为正数）。
  3. **RMB 汇率换算**：成本表「产品成本」「头程」是 **RMB**（尾程是当地币）。⚠️ **三看板汇率口径不同，极易写错**：日看板 `FX.months[ym][cur] = 1CUR→USD`（USD 基准，头程 = `RMB×销量 ÷ CNY→USD`，非 USD 显示再 ÷ `fxToUsd`）；月看板 `FX[ym][cur] = CNY/单位`（头程 = `RMB×销量 ÷ FX[ym][目标币]`）；周报 `FX[cur] = CNY/单位`（单套，无月份维度）。统一取**当月 1 号**汇率。
  4. **头程为预估值 → 单一数据源**：新建 `product_cost_table.json`（25 产品 × `costRMB` / `headRMB{US,EU,UK}` / `tailLocal`），**后续推移头程只改本文件再重跑构建**。日看板注入 `__HF_JSON__`（`{products, months, src}`）、月看板注入 `__HF_JSON__`（`{产品名:{US/EU/UK}}`）、周报由 `integrate_profit.py` 注入 `HEADRMB` 常量。
  - 落地位置：日看板 `hfCnyPerUsd/hfRegion/headRmbOf/usdToDisp/convHead` + `aggRows` 的 `pHead`（官方行用行内 `pr.qty`，Woot 行用 `freight×订单量` 再 `usdToDisp`）；月看板 `hfRegionOf/headRmbOf/fxHeadCny` + `aggMonth`（Woot 行 `pHead` 已是 USD 走 `fxv`，官方行走 `fxHeadCny(headRMB×pQty)`，故 profit 聚合新增 `pQty`）；周报 `integrate_profit.py` 的 `FIELDS` 新增 `'qty'`、13 列 METRICS、合计行 4 处 `rep()`（**本次共 21 个注入点，全部要求精确命中**）。
  - 新增回归 **`test_ratio_cols.js`（41 项）**：三看板 × 列存在性 + 数值正确性，期望值 Node 侧用 `profit_metrics.json` + `product_cost_table.json` + `fx_rates.json` 独立算。⚠️ 两个坑：**月/日看板样本不能按 `sales>0` 过滤**（零销售但有费用的利润行也进合计，否则成本%/头程会偏小）；周标签算法必须是 `off = (getUTCDay()+1)%7; dt - off + 6` 取该周周五的 ISO 周。
  - 自检 **G11 扩容**：新增 ⑤11 个占比键 ×3 看板 ⑥头程表**真实注入且非空**（只查键名不够 —— `const HEADRMB = {}` 空表也能通过，但看板会静默显示头程 = 0）。
  - ⚠️ **顺带修掉一个真 bug（周看板 NaN）**：`wootPartAcc` 的 acc 字面量与 `asinWeekData` 是两份独立硬编码的键列表，加 `pQty/pHead` 时只改了后者 → 单看 Woot 时 `totals.pQty += undefined` **变 NaN，整个 KPI 被污染**（合并看与单看官方店铺都正常，所以很隐蔽）。修法：两处 acc 同步 + `WT_PKEYS` 补 `'pQty','pHead'` + 合并分支叠加 Woot 头程（`fxv(wc.freight × 订单量, 'US')`，与月看板同款）。**由 `test_woot_channel.js` 的 NaN 体检抓到**，并为它加了「键集一致」形状护栏 + 反证断言（28 项）。
  - 另外修掉两个引入的小瑕疵：`woot.html` 表头被我改成了「头程头程运费」（重复字），以及 `test_product_profit.js` 的毛利组断言仍硬编码 `'profit,margin'`（新增 11 列后失效，改为「前两项是 profit/margin」）。
  - ⚠️ 测试环境坑（非产品 bug）：`test_monthly_dashboards.js` 拉真实云端 mapping 却只种 `pc_catalog/pc_asinmap/pc_woot` 三个键，Woot 成本上云后云端多了 `wootCfg` → 页面 `cloudWootSync` 判不等 → 每次加载 `location.reload()`，测试中途 `Element is not attached to the DOM` / 「系列单选生效」假 FAIL。修法见 §A.6「渠道筛选回归怎么跑」里的 `pc_woot_cfg` 种子规范化说明。修后 60/60 且可重复（连跑两次一致）。
  - `woot.html`：表头「运费（$/台）」→「头程运费（$/台）」，并加警示行「尾程只填头程：尾程仅 FBM 计，FBA 不计」。
- 2026-10-10：**毛利功能上线（日/周/月 三看板）**。数据源=易仓「财务-营收利润 → 利润报表-ASIN」（`datacenter.eccang.com/ratel/api/productAsin/queryPage`，**必须 Node 侧 `context.request.post`**，页面内 fetch 被 CORS 拦）。新增 `fetch_profit_data.js`（增量补缺 + 复核最近 6 天 + 月仓储月抓，产出 `profit_data.json`）与 `build_profit_metrics.py`（三看板共享的均摊计算：其他费用按日期×国家行数均摊、月仓储按 ASIN 月度值÷当月天数分摊，产出 `profit_metrics.json`）。三个看板各加「毛利/毛利率」列（分组表头第三组）+ 合计行 + KPI 两项 + 说明文案：日看板走 `__PROFIT_JSON__`、月度看板构建期并入 `DATA.rows`（缺行自动补建）、周看板由新增的 `integrate_profit.py` 后处理注入（排在 integrate_ads.py 之后）。新增回归 `test_daily_profit.js`(10)/`test_product_profit.js`(13)/`test_monthly_profit.js`(12)、自检 **G11**。
  踩坑记录：① **日期函数禁用 `toISOString()`**（GMT+8 回退 8 小时使 addDays 返回同一天 → 日期循环死循环 OOM 4GB / exit 134，`--max-old-space-size` 无效）② 利润报表 `site` 字段会漏空（实测 53/1631 行），须用店铺 `userAccount` 后缀反推站点，否则均摊分母与月仓储 key 全错 ③ 三看板**广告花费口径的差异根因**见 §A.0（已于同日下午修复；含 SB 空 ASIN 与孤儿广告费两个边界）④ Woot 手工数据（localStorage `pc_woot`）有销售额/广告费但无毛利口径，毛利会多扣其广告费（实测 2026-W40 多扣 2232 USD），测试需用 `addInitScript` 预设 `pc_woot=[]` + `route` 拦 `supabase.co` 才能独立复现 ⑤ 自检占位符检查要用**精确名单**，`__[A-Z_]+__` 泛匹配会把周看板的 JS 变量名 `__PC_MAP__` 误报成泄漏。
  （既有待办：自检 D1「广告看板含最新完整周」FAIL —— `ad_weekly_all.json` 未更新到 W41，需跑 §B 链路；`test_product_region.js` 5 项失败属既有、期望值过时，非本次引入。**已顺带修复**：`test_kw_dashboard.js` 原写死活动名 `X1-词组匹配`（该活动已改名，三个数据文件里 0 命中）→ 改为「按原名找，找不到就退化为找确实带投放词的活动」，12/12；`test_currency_ads.js` 重建 ad 数据后 20/20；`test_woot.js` 49/49 需 **http.server 从 `_deploy/` 启动**（当前 8899 站根不含 product.html → 会报 `asinWeekData is not defined`，属环境问题不是代码问题）。）
- 2026-10-09：**target.html 增加平台筛选（Amazon / JoyBuy / 速卖通）并把 JoyBuy 月度数据并入月度目标追踪**。新增 `build_joybuy_monthly.py`（Data Compass 日粒度趋势出站点月合计 + SKU 周报按跨月周天数分摊出产品维度，再按站点合计等比例校准 → `joybuy_monthly.json`），由 `build_monthly_dashboards.py` 在 §A.3 构建时自动调用并注入 `__JOYBUY_JSON__`。目标表新增可选 `platform` 字段（缺省 amazon，向后兼容）；无目标的平台自动显示「实际数据视图」，KPI 后两卡换成店铺流量/加购。新增回归测试 `test_target_platform.js`（33 项，三平台切换 + JoyBuy 数值核对）；自检新增 **G10**（平台筛选存在 + JoyBuy 数据非空 + 无占位符泄漏）。修复：模板文案里误写占位符名会被全局替换成整段 JSON（速卖通占位提示曾把 joybuy_monthly 内容印在页面上）；`test_monthly_dashboards.js` 预注入 `pc_woot`（缺它时页面 cloudWootSync 触发 reload → elementHandle 点击超时，既有 flaky）+ 导航项数断言改为「含 5 个核心入口」不再写死 5（JoyBuy 入口已增至 6）。
- 2026-09-26：由 3 个自动化平移合并建立（每日 1787105514880 / 广告周度 1787561869471 / 产品周报 1786956560592）。调度改为每日 15:00 单任务：非周一跑 §A，周一串行 §A→§B→§C；原两个周一任务的 CDP 9223 并发冲突与 _deploy 并发部署风险随之消除。JoyBuy 看板（automation 8dcc5b19）独立运行，不在本手册范围（其采集自 2026-10-02 起为**免登录纯 HTTP 模式**，细节见 `JoyBuy接入落地说明.md` §4.5）。
- 2026-10-02：用户反馈 9-29~10-01 三天日报未更新（自动化为 ACTIVE 但无产出，疑 WorkBuddy 端 15:00 未运行）→ 手动补跑 §A 全链路成功。同时修复 check_data_integrity.js 的 D1 周五边界误报：lastFriday() 原样把"今天"计入（周五当天期望一个尚未结束的新周 W40 → 必然 FAIL），改为从昨天起往回找周五，与采集管道口径一致。修复后自检 26 pass / 2 warn / 0 fail。
- 2026-10-02（JoyBuy 链路，不属本手册 §A~§D）：采集**免登录化** —— 优先 `joybuy_compass_session.json` + 纯 HTTP 直连，仅会话失效才起 CDP 9333，故本手册的 CDP 相关约定对 JoyBuy 不再强制；同时修复「切店铺靠 `Set-Cookie: b_belong`、纯 HTTP 丢弃响应头会**静默串站**（四站返回同一站数据、接口全 200）」并新增防串站自检。细节见 `JoyBuy接入落地说明.md` §4.5。
- 2026-09-28：Edge 升级到 154 后实测确认：**默认用户目录无法开启远程调试端口**（Chromium 136+ 安全策略，进程能启动但端口不监听）。本手册 auto_login_eccang.js 用独立 profile `edge-auto`（端口 9223）不受影响，为唯一正确启动方式；**不要**用默认 profile 手工起 Edge 再抓数据。另在 `C:/Users/paddy/.workbuddy/edge-cdp`（端口 9222，凭据文件 eccang_credentials.json）建立了备用调试实例，2026-08-17 目录的脚本亦可走 9223。当晚周一全链路（§A→§B→§C + JoyBuy）零人工跑通并部署，自检 26 pass / 0 fail。

---

## 待办与待确认（2026-10-10 毛利功能收尾）

> 毛利功能已本地完成并通过全部回归（日 **15** / 周 13 / 月 12 三个专项 + 归因单测 22 + 既有回归全绿 + 自检 G11/G12 PASS），`_deploy/` 已同步但**未发布线上**，等以下口径定稿后一起发。

1. ✅ **月度/周看板广告费口径（已解决）** —— 未改用「全量广告花费」，而是**把 SB 归因到具体产品**（用户 2026-10-10 指示）。
   2026-07 / 2026-08 月合计已与源数据、日看板完全一致；日看板也已补上同一套四级规则（原为第四份两级副本，筛单 ASIN 时丢 SB）。唯一残差是「有广告费但无利润报表行」的那几行（见 §A.0），已显式告警 —— 注意该费用**会被月 KPI 扣掉**，只是行级毛利显示 —。
2. **Woot 毛利落地（已确认口径，框架待做）** —— 用户 2026-10-10 答复：
   - 采购价 **1,380 USD/台 = Woot 付给我们的供货价**（即收入侧，不是我们的进货成本）；`Woot 毛利 = 采购价 × Woot订单量 − 产品成本 − 运费 − 广告费`
   - 产品的「产品成本/运费」**以用户后续提供的表格为准**（尚未收到）
   - Woot 数据要**统一计入 Amazon 各看板**，并新增「**销售店铺**」筛选（Woot店铺 / Aliencell官方店铺，**默认合并看**，也可单独筛）
   - 下一步：先做框架（woot.html 加「采购价」字段 + 三看板加「销售店铺」筛选），成本/运费留空位等表格
   参考：Woot 现有 16 条记录（2026-09-01~09-28，全为 B0H69JJZ1M），合计 5 台 / 报表销售额 9,499.91 USD（零售价，**不能当收入**）/ 广告花费 8,144.13 USD。
3. **8 月商品成本异常** —— 23,776 USD，占当月销售额 74%（其他月 16%~23%），使 8 月毛利 -60%。已提示用户去 ERP 商品成本配置核对（疑头程/备货集中入账）。
4. **既有失败（非本次引入）** —— 自检 D1（`ad_weekly_all.json` 未更新到 W41，需跑 §B 链路）。`test_product_region.js` 已于 2026-10-10 夜重写为锁定真实语义（15/15），不再是失败项。
   - 环境类坑（不是代码问题，别再排查代码）：`test_woot.js` / `test_daily_sales_campaign.js` / `test_currency_ads.js` 走 http 的话，**http.server 必须从 `_deploy/` 启动**并用 `BASE=http://127.0.0.1:<port>`；若站根不含 `ad.html`/`product.html`，页面会因 `DATA is not defined` / `asinWeekData is not defined` 之类报错，看起来像代码坏了。
5. **运营侧待办（影响归因，已告知用户）** —— 给 SB 广告标题加上对应 ASIN 码；加上后 `ad_asin_rules.py` 第 2 层自动生效，系列兜底自动让位，**无需改代码**。同时可顺手解决 UK 的孤儿广告费问题（UK 的 SB 标题带上 UK 在售 ASIN 即可）。
