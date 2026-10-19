# Aliencell 数据看板系统 — 完整交接文档

> **本文档是系统的唯一权威交接入口。** 新 session / 新接手人只需读完本文件即可开展工作，无需检索历史对话。
> 最后更新：2026-08-26

---

## 1. 系统一句话总览

从易仓 ERP（网页自动化）采集亚马逊 13 国「业务报告 + 广告」数据 → 本地 Python/Node 脚本构建自包含 HTML 看板 → 部署到 CloudStudio 云端固定链接 → 团队通过 Supabase 账号密码登录访问。

## 2. 三层架构

```
┌─ 第1层：云端看板（与 WorkBuddy 完全解耦，浏览器即用）────────────┐
│  CloudStudio 静态站: https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host │
│  Supabase: 账号认证(Auth) + 产品映射存储(REST+RLS)               │
└──────────────────────────────────────────────────────────────────┘
┌─ 第2层：本地数据链路（Node.js + Python 脚本，可整体迁移）─────────┐
│  Edge CDP(9223) 自动登录易仓 → fetch_*.js 采集 → build_*.py 构建  │
│  → 产物 .html + .json → 复制进 _deploy/ → 重新部署               │
└──────────────────────────────────────────────────────────────────┘
┌─ 第3层：调度（WorkBuddy automation，迁移后需用任务计划替代）──────┐
│  每日 15:00 数据刷新；每周一 15:00 广告/产品/投放词三任务         │
└──────────────────────────────────────────────────────────────────┘
```

## 3. 工作目录与访问入口

| 项 | 值 |
|---|---|
| 主目录（广告/每日/月度/目标看板） | `C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38` |
| 产品报表目录（周度汇总+广告注入） | `C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33` |
| 部署目录 | 主目录下 `_deploy/` |
| 云端固定链接 | https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host |
| CloudStudio sandboxId | `3577d1e878e64dc5837e56f9471dcefc`（重复部署复用，链接不变） |
| 登录方式 | login.html → Supabase Auth（邮箱+密码）；注册白名单仅 @aliencell.com |
| 管理入口 | Supabase Dashboard → 项目 `oovvqvgrjqwogjwswaxx` |
| Supabase publishable key | `sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s`（前端公开，非机密） |

**看板结构**：`index.html` 壳 + iframe 五看板（`ad` 广告周度 / `product` 周度汇总 / `daily` 每日 / `monthly` 月度数据 / `target` 月度目标追踪），默认广告看板，支持 `#ad` 等 hash 直达。导航底部「产品关系管理」→ `mapping.html`（iframe 加载，postMessage `wb-nav-back` / `wb-map-changed` 通信）。

## 4. 生产文件清单（核心资产）

> 目录里有大量 `cdp_*.js`、`verify_*.js`、`extract_*.js`、`diag_*.js`、`*.png` —— 全部是逆向易仓接口时的**一次性探索脚本/截图，不参与生产链路**，可忽略、可归档删除。`amz_*.js` 是亚马逊广告后台的前端代码留档（分析用），同样非自有代码。

### 主目录生产文件

| 文件 | 作用 |
|---|---|
| `auto_login_eccang.js` | Edge CDP 9223 端口自动登录易仓（凭据 `eccang_creds.json`） |
| `fetch_daily_data.js` | 每日数据采集：业务报告(/traffic/list) + 广告(ProductAd.GetFlatViewList)，逐天 13 国，北京时间 → `daily_data.json` |
| `fetch_ad_weekly_video.js` | 广告周度采集（含视频指标）→ `ad_weekly_all_video.json` |
| `fetch_ad_keywords.js` | 广告投放词采集 → `ad_keywords_all.json` |
| `build_daily_dashboard.py` | `daily_data.json` + 模板 → `daily.html` |
| `build_monthly_dashboards.py` | `daily_data.json` 按自然月聚合 → `monthly.html` + `target.html` |
| `build_ad_dashboard_data.py` | 合并 `ad_weekly_all_video.json` + `ad_keywords_all.json` → `ad_dashboard_data.json`，再套 `ad_dashboard_template.html` → `ad_dashboard.html` |
| `convert_target_xlsx.py` | 目标 Excel → `monthly_targets.json`（收入=销售额¥，广告=占比%） |
| `daily_dashboard_template.html` / `ad_dashboard_template.html` | 看板模板（占位符 `__DATA_JSON__` 等） |
| `eccang_creds.json` | 易仓登录凭据（敏感） |
| `fx_rates.json` | 每月 1 号汇率（frankfurter.dev=ECB，**增量更新勿删**） |
| `monthly_targets.json` / `product_map.json` | 目标数据 / 产品映射（与 Supabase 同步源） |
| `cloud_update_watch.js` | **云端更新提示片段（唯一源）**：看板顶部「云端数据已更新 / 立即刷新」提示条。改这里 → 跑 `inject_update_watch.py --apply` → 重建看板 |
| `inject_update_watch.py` | 把上面片段注入 4 个模板 + `integrate_ads.py` + product 产物（**幂等、可升级**：先摘旧片段再写新版） |
| `verify_update_watch.py` | 改动纯净性验收：两侧都摘掉片段后必须逐字节一致（防重建夹带数据/逻辑变化） |
| `test_*.js` | 回归测试（见 §9） |

### 产品报表目录生产文件（仅 4 个）

| 文件 | 作用 |
|---|---|
| `generate_filterable_report.py` | 产品周报生成器（读主目录 `daily_data.json`，含货币换算 `@@FX_JSON@@`）→ `product.html` |
| `integrate_ads.py` | 把广告数据注入 product.html（按精确字符串替换 4 个 scope 函数） |
| `update_weekly_all_data.js` | 周度数据采集（CDP） |
| `aggregate_ads.py` | 广告聚合 |

### `_deploy/` 部署目录（云端内容）

`index.html`（壳+登录守卫，**固定不随数据更新**）、`login.html`（登录+注册页）、`mapping.html`（产品关系管理，静态页）、`ad.html`、`product.html`、`daily.html`、`monthly.html`、`target.html`（五个数据看板，随刷新更新）、`daily_data.json`、`product_map.json`、`monthly_targets.json`、`woot.html`（Woot 数据管理页，静态页）、`xlsx.full.min.js`（SheetJS 0.20.3，mapping.html / woot.html 用）。
**认证守卫（2026-09-23）**：`index.html` 有守卫，`woot/daily/product/ad/monthly/target/mapping` **七个数据页也各有一份子页面守卫**（无 `wb_auth` → 跳 `login.html`），`login.html` **刻意不加**（否则死循环）。守卫片段在 `<body>` 之后，源码位置=各模板/单文件；重建后由自检 **G4** 兜底校验。
**注意：`fx_rates.json` 不复制进 _deploy**（汇率经 `__FX_JSON__` 内嵌进 HTML）。
**废弃地址墓碑页（2026-09-23）**：`_deploy/ad_dashboard.html`（1133 字节，`wb-tombstone` 标记 + meta refresh → `ad.html`）**不是看板**，是为了覆盖云端那份 9/20 旧副本（部署工具只增不删，本地删了线上仍在）。生成脚本 `make_tombstones.py`；自检 **G6/G7** 兜底。别把它当页面去改。

**云端更新提示（2026-09-23）**：`daily/monthly/target/ad/product` **五个看板各含 1 份** `cloudUpdateWatch`（静默轮询 + 顶部提示条，详见 §5 末节），由 `inject_update_watch.py` 从 `cloud_update_watch.js` 统一注入，**必须恰好 1 份** —— 重建后由自检 **G5** 兜底校验（重复 = `integrate_ads.py` 往已注入的 html 又注了一遍）。

## 5. 数据流与刷新链路

### 每日链路（15:00 自动，automation-1787105514880）
```
auto_login_eccang.js（确保 Edge 9223 已登录）
  → node fetch_daily_data.js        # 三层采集：热区全量14天 + 空缺复查 + 温区轮转校准（见下）
                                    #   BACKFILL_FROM=YYYY-MM-DD 补历史；FULL_BACKFILL=1 全量回填
  → python build_daily_dashboard.py  # → daily.html
  → python build_monthly_dashboards.py  # → monthly.html + target.html
  → 复制 daily/monthly/target.html + daily_data.json 进 _deploy/
  → 重新部署 _deploy/
```
**复查口径：复查 = 补空缺 + 重新校准（2026-09-24，用户指出后修订）**

用户原话：「进行复查是因为数据有时候会发生变化，不止是空缺的要复查，有数据的也要重新校准」。
实测证实（`probe_calib_drift.js` / `compare_ads_drift.py` / `probe_ads_scope.js`）：
- **广告数据会被上游改**：花费因无效流量扣减下调、销售额因归因回填后补。
  实测 08-19 花费 481.99→478.92、08-27 896.02→870.6、09-07 1092.38→1084.8、**09-09（46 天前）746.17→737.31（-1.2%）**；
  8/30 的 US 销售额曾从 0 补成 3497.99。**60 天前的样本（54/60/74/90 天）金额完全一致** → 修正集中在 60 天内。
- **业务报告也会变（但极少）**：9/21 的 US ASIN `B0H75HMBF5` 订单被撤销 → 订单 1→0、销售额 1599→0；
  而抽样 16~61 天的业务日期（sessions/订单/销售额）**完全一致**。
- **广告历史条数有覆盖缺口**：早期日期只采到部分国家（44/66 条 vs 现在 192 条）；
  但探针证明**多出来的都是当时零消耗的实体，花费/点击/订单/销售额完全一致** → 历史 ACOS 未被低估，不需要为补条数全量重拉。

因此 `fetch_daily_data.js` 分三层（常量可调，见文件头 §6）：
| 层 | 范围 | 行为 |
|---|---|---|
| ① 热区 | 近 `HOT_DAYS`=14 天 | **每次运行全量重拉**（即用户原口径「每天往前倒推 14 天复查覆盖」） |
| ② 空缺日 | 近 `CALIB_DAYS`=60 天内被标 incomplete / 全天无数据 | **无条件复查**，不占轮转名额 |
| ③ 温区 | 15~60 天 | **轮转校准**：每次取「最久未被校准（`lastChecked` 升序）」的 `CALIB_PER_RUN`=6 天，约 8 天覆盖一轮 |

- 每天写 `days[d].lastChecked`（轮转依据）；顶层写 `calibration`：
  `{at, hotDays, warmDays[], pendingRechecked[], checked, changed[], staleRemoved[], window{hot,calib,perRun}}`
- `calibration.changed` 记录**本次重算后数值确实变了**的日期与逐项 A→B（`rows/sessions/orders/sales/adItems/adCost/adSales`），
  由改动前/后的「数值指纹」对比得出 → **上游改数这件事可见，不会悄悄改掉用户昨天看到的数字**
- **旧行清理**：某行在连续 `STALE_STRIKES`=3 次权威响应中都不返回 → 判定源已删除并移除
  （否则 `mergeOldInto` 会把源已删的行永久补回，使合计偏高）。
  **安全阀**：只在该日「数据完整」且为确认日时累计 —— 源同步延迟（整站缺失）期间不推进，避免误删
- 看板头部（daily/monthly/target 三块）显示 `data_note()` 的完整性提示 + `calib_note()` 的
  「🔁 已校准 N 天，其中 M 天的数值被上游修正」（鼠标悬停看逐日明细）
- 自检 **G8**（近 7 天完整性 WARN）+ **G9**（校准新鲜度：60 天窗口内每天都应有 `lastChecked`，
  近 14 天缺 `lastChecked` 判 FAIL = 采集脚本没跑或被降级）
- 每日自动化 prompt 已同步：步骤 2 要求如实汇报校准台账、步骤 7 新增**必报项「重新校准台账」**
- 只读探针：`probe_biz_scope.js`（某天某账号有没有数据）、`probe_calib_drift.js`（历史日期重拉是否变）、
  `probe_ads_scope.js`（老日期广告条数/金额是否变）；对比工具 `compare_snapshots.py` / `compare_ads_drift.py` / `diff_day.py`
- 探针踩坑：`/traffic/list` 的 `user_account` 页面原生发的是**JSON 字符串**（`"[\"Aliencell_Direct_BE\"]"`），
  传单元素数组/字符串会返回 0 行（筛选失效）；**13 账号数组**可用（现网脚本即此形态，已验证返回全账号）
- 探针踩坑：广告行指标在 **`Report` 嵌套对象**里（`item.Report.Cost`），写成 `item['Report.Cost']` 会全部取到 0，
  会得出「金额没变」的错误结论（曾据此差点误判）
- 探针踩坑：广告接口对**任何历史日期**都返回**当前**广告结构（06-23 也返回 192 条），
  所以「条数变多」不等于「当年数据被少采」
**上线记录（2026-09-24）**：已上线（链接/sandboxId 不变，仍为 `3577d1e878e64dc5837e56f9471dcefc`）。
- 上线前同步核对：8/8 一致（主目录 5 个同名页 + `ad_dashboard.html` + 产品报表目录 `filterable_dashboard.html` + `daily_data.json`）
- 线上核验（一律带 `?cb=` 绕 CDN）：10/10 文件字节与本地全一致（含 `daily_data.json`、`index.html`、`login.html`）
- 线上渲染核验（`BASE=<线上> shot_data_note.js`）：daily/monthly/target 三看板 #dataNote 均显示
  「⚠️ 数据完整至 2026-09-22；09-23、09-24 源数据未同步 | 🔁 已校准 30 天，其中 16 天的数值被上游修正」，
  悬停 title 含逐日明细、提示条宽 1449/1458/1459px（视口 1500，未溢出）、**无 JS 错误**
- 线上回归：`check_data_integrity` **25 pass / 3 warn / 0 fail**（warn = A2b 老周稀疏 / G8 源延迟 / G9 一天未轮到温区）、
  `test_auth_guard` **35/35**、`test_update_notice` **65/65**、`test_woot` **49/49**
- 本地回归：`test_monthly_dashboards` **60/60**
- 教训（本轮踩到）：`curl -o /tmp/x` 在本机 Git Bash 下**静默不落盘**，`cmp` 因此全部报 DIFF，
  差点误判成「线上没更新」；线上比对副本要落到工作目录（本次用 `_online_check/`，验完已删）

### 每周链路（周一 15:00，三个 automation）
```
① 广告周度: fetch_ad_weekly_video.js → build_ad_dashboard_data.py → ad.html → 复制 → 部署
② 周度汇总(产品报表目录): update_weekly_all_data.js → generate_filterable_report.py
   → integrate_ads.py → product.html（输出到主目录）→ 复制 → 部署
③ 广告词看板: fetch_ad_keywords.js → build_ad_dashboard_data.py（与①合并输出）
```

### 运行环境命令（重要）
```bash
# Node 脚本（需 Playwright，NODE_PATH 指向 managed workspace）
NODE_PATH="C:\Users\paddy\.workbuddy\binaries\node\workspace\node_modules" \
  "C:\Users\paddy\.workbuddy\binaries\node\versions\22.22.2\node.exe" fetch_daily_data.js

# Python 脚本
"C:\Users\paddy\.workbuddy\binaries\python\versions\3.13.12\python.exe" build_daily_dashboard.py
```
依赖：Node 22 + playwright ^1.62.1（`package.json`）；Python 3.13（标准库即可）。

### 云端更新提示（2026-09-23，五套看板）

**背景**：看板原本只在「页面加载时」拉云端数据。别人上传 Woot 或改产品映射后，**已经开着页面**的人不会知道（没有轮询、没有跨页广播），只能靠手动 F5。

**实现**（`cloud_update_watch.js` → 注入五套看板）：
- 时机：加载后 **5s 首检**，之后**每 60s**，以及**切回前台**(`visibilitychange`)时各查一次
- 三路比对，缺一不可（只比云端会漏掉同浏览器场景）：
  - `BASE_SIG` = 本页渲染时所依据的本机缓存快照
  - `localSig` = 此刻本机缓存 → 本浏览器别的标签页（如 Woot 上传页）写入后立刻不同
  - `cloudSig` = 云端最新 → 别人在别的电脑上传/改映射后不同
- **只提示不自动刷新**：看板筛选（国家/ASIN/系列/产品名）是内存态，自动 reload 会清空用户正在看的筛选
- 点「立即刷新」的策略：**本机缓存没被别的标签页动过** → 用云端值回写本机再 reload；**本机已被更新过**（同浏览器上传）→ 只 reload，**不用云端值回写**（防云端旧值把本机新数据覆盖掉）；「×」= 本次不再提示（按 云端sig+本机sig 组合记忆，之后真变了还会再提示）
- 文案：`云端数据已更新` + `立即刷新`（按钮 tooltip 写明会重置筛选），条 id = `wbUpdateBar`

**各场景实际体验**：
| 场景 | 结果 |
|---|---|
| 自己上传 Woot 后点「返回看板」 | 壳页重建 iframe → 看板重载 → 直接看到新数据（提示条也会在渲染快照落后时补一条） |
| 自己另外开着 ad.html 标签页不动 | 60s 内（或切回该页时）弹提示条 |
| 同事浏览器一直挂着看板 | 同上，弹提示条；他不动就一直摆着，不会打断 |
| 同事新打开 / F5 | 加载时 `cloudWootSync` 自动拉最新，无需任何操作 |

**维护**：改 `cloud_update_watch.js` → `python inject_update_watch.py --apply` → 重建五套看板（daily/monthly+target/ad + product 产物）→ `python verify_update_watch.py`（必须 ALL PASS）→ 复制 `_deploy` → 部署。

**上线记录（2026-09-23）**：已上线，链接与 sandboxId 不变（`3577d1e878e64dc5837e56f9471dcefc`）。核验：线上 9 页字节与本地全一致（`?cb=` 绕缓存）；五套看板各含 1 份 `cloudUpdateWatch`；线上跑 `test_update_notice` **65/65**、`test_auth_guard` **35/35**、`test_woot` **49/49**；`check_data_integrity` **25 pass / 1 warn / 0 fail**；旧地址 `/ad_dashboard.html` 已由 727KB 旧副本改为 1133 字节墓碑跳转页。

## 6. 日常运维手册

### 手动触发刷新
按 §5 链路逐条执行命令即可（自动化 prompt 里就是这些步骤）。

### 部署
把 `_deploy/` 目录交给 `workbuddy_cloudstudio_deploy` 工具（CloudStudio skill）。sandboxId 复用 `3577d1e878e64dc5837e56f9471dcefc`，链接永远不变。
**若脱离 WorkBuddy**：`_deploy/` 是纯静态站，可部署到任何静态托管（Vercel/Netlify/OSS/内网 nginx）。

**⚠️ 部署工具「只增不删」（2026-09-23 实测）**：从 `_deploy` 删掉的文件**不会**从云端消失，旧 URL 仍 200 返回老内容（实测：删掉 `_deploy/ad_dashboard.html` 重新部署，线上仍是 727KB 的 9/20 旧副本）。所以**要下线一个已上线过的地址，必须用同名的小跳转页覆盖它**：
1. 把该文件名 + 目标页写进 `make_tombstones.py` 的 `TOMBSTONES`
2. `python make_tombstones.py`（写入 <2KB 的 `wb-tombstone` 跳转页到 `_deploy`）
3. 部署 → 自检 `G6`（墓碑必须小且只跳转）/ `G7`（线上该 URL 必须是墓碑或 404）会兜底
4. 废弃地址清单同步加进 `check_data_integrity.js` 的 `LEGACY_URLS`

### 修改看板功能
1. 改模板：`*_template.html`（daily/monthly/target/ad）
2. **改 `generate_filterable_report.py` 的被替换函数（asinWeekData/renderKpis/fmtCell/scope 函数）时，必须同步 `integrate_ads.py` 的 `old_*` 精确字符串块**，否则 assert 失败
3. 重跑对应 build 脚本 → 复制进 `_deploy/` → 重新部署

### 上传 Woot 店铺数据（2026-09-23 起，无需人工整理表格）
1. 从 Woot 后台导出/下载 **「产品每日总表现」** 报表（xlsx 或 csv，**保持原样，不要删列改表头**）
2. 打开云端看板 → 左侧导航「🛒 Woot 数据管理」→ 「选择文件」
3. 核对预览（行数 / ASIN / 日期 / 金额）→ 「✅ 确认导入」→ 自动写入 Supabase（`mapping` 表 id=1 行 `data.woot`）
4. 回到任何看板刷新即可看到（daily/monthly/target/product/ad 五处均按子 ASIN 并入 US）
- **重复上传同一批日期 = 覆盖**，不会重复累加；想清历史数据可用「导出 CSV 备份」后「清空全部」
- 上传页保留「手动添加」用于补录（支持 单日/周汇总/月汇总 三种粒度），旧的周/月汇总记录仍兼容（会落到伪 ASIN `WOOT-STORE`）
- 回归：`test_woot.js`（样本 `woot_official_sample.xlsx`）

### 修改目标数据
改目标 Excel → `python convert_target_xlsx.py` → `monthly_targets.json` → 重跑 `build_monthly_dashboards.py`。

### 修改产品映射
在线：看板「产品关系管理」页直接编辑（Supabase 云同步，debounce 400ms）。
离线：改 `product_map.json`（模型 `{"catalog":[{series,name}],"asinMap":[{asin,series,name,country}]}`，唯一键 asin+country，欧盟统一 EU）。

### Supabase 账号管理
Dashboard → Authentication → Users。角色：SQL Editor 查 `public.profiles`（trigger 自动建档，默认 viewer；`UPDATE public.profiles SET role='admin' WHERE email='...'`）。
**已知问题（2026-08-25 用户反馈）**：邮箱验证链接指向 `http://localhost:3000` 点开报错但不影响登录使用。已在前端 login.html 做容错（hash 里 access_token 自动登录 + otp_expired 中文提示）。**根治需在 Supabase Dashboard → Authentication → URL Configuration 把 Site URL 改为云端固定链接**，用户尚未操作。

## 7. 关键业务约定

| 约定 | 内容 |
|---|---|
| 周口径 | 周六-周五为一周；周数=周五所在周的 ISO 周数；**周标签勿硬编码**，用动态 `week_label()` |
| 广告归类 | SP/SD 按广告组投放 ASIN；SB 按活动名 |
| 每日指标 | 流量=Sessions；订单量=total_order_items；转换率=订单件数÷流量；自然流量=流量−广告点击；ACOS=花费÷销售额 |
| 地区映射 | US/CA/MX→NA；DE/FR/IT/ES/NL/BE/IE/PL/SE→EU；UK/JP/AU 独立；顺序 [NA,EU,UK,JP,AU] |
| 货币 | `CUR_OF` 国家→币种；`targetCur()`：单币种→该币种、单地区→地区主导货币（NA 统一 USD）、混合→USD；FX 存 CNY 基准交叉汇率，`A→B = v*FX[A]/FX[B]`；换算注入点=聚合时逐国 `fxv()`；比率指标（ACOS）分子分母同汇率自动免疫 |
| 每日看板币种（2026-09-16） | daily.html：默认（未选国家/多国混合）销售额·广告花费·广告销售额·CPC 统一 **USD**，按每月 1 号 ECB 汇率折算（`__FX_JSON__` 内嵌 USD 基准 `months{ym:{CUR:1CUR=?USD}}`，由 fx_rates.json 的 CNY 基准交叉推导；build_daily_dashboard.py 增量补抓缺失 月×币种，MXN 2026-06/07 曾兜底已手修）；选中国家同币种→原币种原值；`dispCur()/convAmt()/fxToUsd()`，徽章显示当前币种，缺失标 ⚠汇率 |
| 下拉隐藏口径 | 国家下拉隐藏无数据国家+地区范围外；地区下拉只显示有数据地区（当前 NA+EU）；已选项始终保留；跨地区多选经地区面板 Ctrl |
| 地区国家双向同步 | 选地区→自动选中该地区有数据国家；选国家→地区自动同步；单击唯一已选项→双向清空 |
| 周筛选联动重置（2026-08-31） | 产品筛选(子ASIN/系列/产品名)与所选周**零交集**时自动重置周筛选(保留产品)；下拉中范围外选项置灰标注"(所选周无数据)"仍可点击作为入口。靠 `lastFilterDim` 追踪最近操作维度实现，双看板(product/ad)同步。测试 `test_week_reset_verify.js` 17/17 |
| 产品映射页 CSV 导出（2026-09-20） | `mapping.html` 产品目录卡片「⬇️ 导出 CSV」→ `产品目录_YYYYMMDD.csv`（表头 `产品系列,产品名`）；ASIN 匹配卡片「⬇️ 导出 CSV」→ `ASIN映射_YYYYMMDD.csv`（表头 `ASIN,产品系列,产品名,国家`），「⬇️ 导出未匹配」→ 只含 series/name=「无」的 `ASIN未匹配_YYYYMMDD.csv`。**导出表头与导入识别词对齐 → 导出文件可直接再导入**（Excel 改完存 CSV 导回即批量更新）。CSV 按 RFC4180 转义（含逗号/引号/换行字段加引号、`""` 转义）+ UTF-8 BOM（Excel 中文不乱码）；排序：目录 系列→产品名，ASIN 国家→系列→ASIN。导入解析 `parseCsvRows()` 已升级为 RFC4180 兼容并剥 BOM，无引号行行为与旧版一致。回归 `test_mapping_csv.js` 30/30 |
| Woot 店铺数据并入（2026-09-23 重构为**按子 ASIN + 逐日**） | 数据源 = **Woot 官方「产品每日总表现」报表**（`test_woot.js` 用 `woot_official_sample.xlsx` 作样本），在 `woot.html` 上传（壳页面导航「🛒 Woot 数据管理」），**原始表格不用改任何一列**。表结构：第 1 行标题 `产品每日总表现`、第 2 行英文表头（Date/childAsin/Woot Orders/Ads Spend/Clicks/Ads Orders/Impressions/Ads Sales/M8）、第 3 行中文表头（报告日期/子Asin/Woot订单数量/广告花费/点击数量/广告订单数量/展示数量/广告销售额/总销售额）、第 4 行起数据。解析后规范化为 `{start,end,type,asin,name,metrics:{orders,sales,adCost,adClicks,adOrders,adImpr,adSales}}`，存 **Supabase mapping 表 id=1 行 `data.woot`**（表有 `mapping_id_check` 约束只能 id=1）+ 本机 `localStorage pc_woot`。并入口径：**按 `asin` 归到对应真实 ASIN 的 US 数据**（不再产生 WOOT-STORE 汇总行；仅当条目没识别出子 ASIN 时才落到伪 ASIN `WOOT-STORE`，兼容旧数据）—— daily=当天真实值（`units_ordered`/`total_order_items`=订单量、`ordered_product_sales_amount`=总销售额、day.ads.US 推 Woot 广告行）；monthly/target=按自然月插入 `ROWS`（asin 行）；product=累加进 `DATA.asins[asin].weeks[label].US` + `ADS[asin].weeks[label].US`（注入逻辑在 `integrate_ads.py` 的 ads_inject 内）；**ad.html=注入 `type=wootAds` 的 records + campaign `woot-<asin>` + `DATA.types` 新增「Woot 广告」**（2026-09-23 新增，此前广告周度看板不含 Woot）。因此**筛选某 ASIN/系列/产品名时数字已含 Woot**。W## 换算：以周五 ISO 周数为准（weekRangeFromISO）；逐日记录落在所属周/月内不再均摊。**口径要点（2026-09-23 用户澄清）**：**Session 是 ASIN 维度、全平台口径** —— 同一 ASIN 在主店 / Woot 店查到的会话值完全相同，统计的是该 ASIN 在亚马逊**所有店铺**的合计，所以主店报表报出的会话**已含 Woot 带来的流量，不能再补**（补了翻倍）；而**订单 / 销售额 / 广告指标是店铺维度**，主店报表只含主店成交，Woot 店铺的必须由本表补。因此表头映射里**根本没有 sessions 字段**（官方表若新增 Session 列也会被忽略），并入行 `sessions=0` 只表示"该行不贡献会话增量"，聚合（sum）后流量列 = 主店原值不变；转化率 = 订单量 ÷ Sessions 的分子补上 Woot 订单后才是**完整口径**（此前不加时是偏低，不是加上后偏高）。mapping.html 的 cloudSave 写回前先 GET 云端保留 woot 键（防互踩）。**重复上传语义（2026-09-23 用户要求「覆盖」）**：默认 **覆盖同步（sync）** —— 按本次上传涉及的每个 ASIN 的日期范围清理旧记录后重写（同键如「同一天 + 同 ASIN」直接覆盖取最新；旧整店汇总/旧周汇总与新数据区间重叠的会被清理，避免重复计算；某天在新表中变全 0（行被跳过）则该天旧记录被清掉，不留虚高），另提供 **仅追加（append）** 模式只覆盖完全同键记录。预览区会列出「新增/覆盖/清理」统计，绝不报错。回归 `test_woot.js` **49/49**（本地+线上双跑） |
| 匹配列表国家筛选（2026-09-22） | `mapping.html`「匹配列表」标题栏新增国家筛选下拉（`#asinCountryFilter`，位于按系列/按国家切换旁）：选项 = `全部国家（N 条）` + EU/UK/US/CA/JP/AU 各带条数（无数据显示「无数据」），条数随数据变化自动刷新（`renderAll` → `initAsinCountryFilter`，签名比对避免重建闪烁）。筛选与两种分组方式叠加生效：过滤数据源 `filteredAsinMap()` 供 `renderAsinTable`/`toggleAllAsin` 使用，组头计数/全部展开折叠/空态均跟随；筛选激活时表格顶部显示蓝色提示条（共 N 条 + 一键「清除筛选」）；选择持久化 `localStorage pc_asin_country`，刷新保持。**筛选下把某行国家改成别的国家，该行立即移出当前视图**（rowCountryChange 重渲染，属预期）。回归 `test_mapping_country_filter.js` 23/23（假后端隔离，含变异验证） |

## 8. 高频坑清单（改代码前必读）

16. **率值类指标（BuyBox%）的分母必须是"行数"，不是"国家数"**（2026-09-14，用户反馈"BuyBox 率超 100%"）：product.html 的 `asinWeekData()` 分子 `d.bb` 是**该国家该周各天 bb 的求和**（Python 侧 `cur['bb'] += bb` 累加、`bb_cnt` 是行数），分母却写成 `acc.bbCount++`（每国家只加 1）→ 某 ASIN 一周 7 天各 100% 会被渲染成 **700%**（133 个 ASIN×周组合中 101 个 >100%，最高 700%，合计行 7799%）。修复：`acc.bbCount += (d.bb_cnt || 1)`；generate_filterable_report.py 与 integrate_ads.py 的 `old_awd`/`new_awd` 两处同步，说明文案也改为"各 ASIN 的日均值"。**同类隐患**：任何"分子是求和、分母是计数"的聚合都要核对两侧口径一致（转化率=合计订单÷合计 Sessions 属同一类）。monthly 看板本来正确（bucket 按行计数），无需改。回归：`test_buybox.js` 8/8（渲染层 + `calc()` 逐周 + 逐 ASIN 单选路径 + product/monthly 口径同量级）；自检 `check_data_integrity.js` 新增 H1（源行 bb∈0~100）/ H2（product.html 分母含 `bb_cnt`，出现 `acc.bbCount++` 即 FAIL）/ H3（载荷逐 ASIN×周模拟 ≤100%）。**测试注意**：该看板表头是双行（分组行+指标行），扫描列位置必须按 `nbody - hcells.length` 算偏移，否则会取到隔壁"广告点击数"。

1. **regionInScope 不得用 effectiveAsins()/effectiveWeeks()**——pruneSelections 按国家修剪后 US/DE ASIN 集合不相交，选国家后其他地区会误判无数据 disabled。只遍历全部 ASIN×全部周（仅 asinMetaOk 过滤）。
2. **generate ↔ integrate_ads 同步**：前者 4 个函数被后者按精确字符串替换注入广告逻辑，改一处必须同步另一处的 `old_*` 块。
3. **Chart.js 必须内联**（201KB，`</script>`→`<\/script>` 转义）；iframe 隔离 CSS/JS。
4. **易仓「版本更新」tab 遮挡**：页面加载后该 tab 激活会覆盖「销售」tab，Playwright click 被 Timeout 拦截。修复：先关弹窗（找"知道了"按钮），再用 `pg.evaluate` JS 直接点击 tab。
5. **易仓登录按钮**是 `a.ec-login-submit`（`.home-ant-btn-primary` 只剩 ERP1.0 登录，误点要求客户代码）。
6. **易仓广告接口**：AdGroup.GetList Attributes 最小集 ['CampaignID','AdGroupID','Name']（多字段报 1004）；AdGroupBidKw.GetList 必须完整 46+ 字段；Report.GetAdvPerformanceList 每关键词单独调用、L5+ViewFormat=0 按天拉+本地按周六-周五重聚合（接口周=周日~周六）；`Number(r.Cost)||0` 防字符串拼接。
7. **Supabase PostgREST 头注入**：新版用 JSON 对象方式传 `x-admin-key`（旧 GUC 方式失效）；admin API 需 service_role key（前端用 publishable key 会 401），改角色走 SQL Editor。
8. **汇率源**：frankfurter.dev（旧域名 api.frankfurter.app 已 301 不可用），非工作日回退。
9. **测试坑**：node https fetch 要 Buffer 累积后一次 `toString('utf8')`；下拉点选项后面板保持展开，点击前先查 `.dd.open`；月份选项文本是"2026年7月"；Git Bash heredoc 含 `${...}` 会 Bad substitution（写 JS 用 Write 工具落文件）；**ASIN/地区数量断言勿硬编码**（用 `asinCandidates().length` 动态算）；**file:// 直开看板测试必须 `page.route` abort Supabase**（云映射与本地不一致会 `location.reload()` 销毁执行上下文，属竞态——时好时坏）；**测壳页面 index.html 须先 `addInitScript` 注入 wb_auth stub 并 route 拦截 `**/auth/v1/user` 返回 200**（认证守卫 2026-08-25 上线后无凭证会被重定向 login.html，btnBack 为 null）。
10. **CDP 残留多个 /login 标签页时优先选非 login 页**。
15. **看板 HTML 必须带禁缓存 meta，壳页面 iframe 必须带版本号**（2026-09-14）：多个看板都没有任何缓存控制标记，壳 index.html 又用 iframe 无参数加载 → 同事浏览器命中旧缓存，出现"明明部署了却显示没更新"的误报（月度/广告看板均遇到过）。已修：四个构建脚本（build_daily_dashboard.py / build_monthly_dashboards.py / build_dashboard_html.py / generate_filterable_report.py）统一注入 `inject_no_cache()`（Cache-Control/Pragma/Expires 三条 meta，幂等）；_deploy/index.html 加同样的 meta，并给 iframe src 加 `?v=<小时级时间戳>`（cacheBust()，覆盖 TABS 五个看板 + mapping.html），保证每次数据更新后打开都是新版本。check_data_integrity.js 增加 G0 项校验 **7 个文件均含禁缓存 meta（2026-09-20 起含 mapping.html）**，回归 verify_filters3 的 mapping 断言已兼容 `?v=` 参数。注意：admin_users.html 未加（静态少变）。
16. **广告活动是跨 ASIN 投放的，"选了系列活动还在"不是 bug**（2026-09-16）：ad 看板活动下拉本就随全部前置筛选联动收窄（实测 选ASIN 40→22、再选周→10、选状态 enabled→30/paused→8），但一个活动可同时投多个 ASIN/系列——按"记录命中"判定它属于候选是对的。用户看到的"不匹配却没隐藏"来自副标题只显示**活动元数据的单一 ASIN**（可能属于未选中的系列）。已修：产品筛选（ASIN/系列/产品名）启用时，副标题改为显示该活动在当前范围内**实际投放的 ASIN**（`campaignScopeAsins()`，多个时显示"第一个 等N个ASIN"）。排查此类问题用矩阵法：对每个维度逐一 `selXxx.add(值)` 后数 `campaignCandidates()`，别只靠 UI 点击（置灰项会干扰自动化点击）。
    **补充（2026-09-14 晚）**：**CDN 对裸 URL 有独立缓存，且会慢于源站** —— 实测部署成功后（工具返回 verified:true）裸 URL 仍返回上一版（旧 300836B），加 `?chk=<时间戳>` 才拿到源站新文件（300923B），约 15s~数分钟后裸 URL 才跟上。故：① 自检 F 项已改为带 cache-buster 校验"源站真相"；② 部署后人工核验也要带随机参数（`curl ".../product.html?cb=$(date +%s)"`），否则会误判"部署没生效"；③ 用户侧走壳 index.html 时 iframe 带 `?v=<小时时间戳>`，本身就是绕缓存 URL，实际拿到的是新版。**云端域名已从 `*.app.workbuddy.link` 变为 `*.app.workbuddy.host`**（sandboxId 不变），自检 LIVE 常量与文档已更新。
14. **数据完整性自检已成为自动化必做步骤**（2026-09-14）：`check_data_integrity.js`（主目录，node 运行）覆盖 A 周度周数/非零基线、B 周度vs每日源销售额交叉(>25% FAIL)、C 广告源国家覆盖+US/DE/UK花费、D 最新完整周入板、E 本地与_deploy一致、F 线上与本地一致(防漏部署)、G 每日数据新鲜度；退出码非0=有FAIL。三个自动化(1787105514880/1786956560592/1787561869471) prompt 均已加「【必做】数据完整性自检」步骤：FAIL 必须在汇报最前面显著标出并按预案修复，禁止静默上线。update_weekly_all_data.js 写盘前自动备份到 backups/(保留6份)。
13. **周度采集合并必须有防降级护栏**（2026-09-14）：update_weekly_all_data.js 走易仓 UI CDP 抓取，当天曾出现部分抓取（4 周中 08-22 周 18 行/0 销售额、09-05 周 0 行 vs 真实 80 行/$14,888、140 行/$20,620），合并逻辑无条件覆盖 → 周度汇总看板各周数据归零。已加护栏：新抓周比已有数据明显缩水（行数<80% 且 销售额<50%，或旧有销售而新抓为 0）时保留旧数据并打 [护栏] 警告。**兜底修复手段**：weekly_all_data.json 与 daily_data.json 同源（/traffic/list），可从 daily_data.json 按周六~周五完整重建（字段兼容，行=date 粒度），重建后修剪为已结束周（end<=今天）。
12. **广告周度采集禁止 State:"enabled" 过滤**（2026-09-07）：欧洲(德/法/意等)花费全部来自**已暂停(paused)**的 A-X140 系列广告活动，cdp_fetch_ad_weekly.js 曾在周查询 Filter 里带 `State:"enabled"` → EU 条目 Report 全 0 → aggregate_ads.py 按"无活动"过滤 → 周度汇总看板欧洲广告数据消失（US/UK 花费来自 enabled 活动所以幸存）。周查询已去掉 State 过滤（与 fetch_ad_weekly_video.js 对齐），仅无日期的 mapping 查询保留。注意 EU 广告主力 ASIN 是 B0HCXVRB21(在产品报表内)，US 花费含暂停活动历史花费(约$9.4k 属正常修正)。另：inline_product_dashboard.py 已过时（生成器已内联 Chart.js），直接 cp filterable_dashboard.html → _deploy/product.html。
11. **筛选初始化必须"空集=全部"，禁止初始全选**（2026-09-07）：pruneSelections 每次筛选变更都会**永久删除**范围外选中项且不恢复。若 init 时把国家/周/ASIN/类型显式全选，用户切到覆盖窄的周（如 W33 仅 US×2 ASIN）再切回，被删的项不会回来——同一周显示的销售额前后不一致（用户反馈 W36→W35→W36 数据变化）。空集=全部时 prune 无项可删，切换往返完全确定。产品/广告双看板 init 已改；`setAll(kind,true)` 全选按钮与 monthly 的地区↔国家显式同步属用户主动行为不受此限。

18. **注入同一段代码到多个产物：必须用"唯一锚点 + 幂等脚本"，且注意 CRLF 边界**（2026-09-23）：云端更新提示片段要进 5 个看板（4 模板 + `integrate_ads.py` 的 woot_inject，后者又产出 product 产物）。若靠手改 5 处必然漂移。做法：片段落一个文件（`cloud_update_watch.js`），`inject_update_watch.py` 用**唯一锚点**（cloudWootSync 段结尾的 `setItem('pc_woot'...)` … `})();`）注入，并支持 `--apply` 覆盖升级。踩过的两个坑：① **锚点不唯一** —— 页面上"云端映射同步"和"云端 Woot 同步"两段的结尾长得一样，必须用含 `pc_woot` 的那段，不能只用 `})();`；② **CRLF 边界** —— 摘除旧片段时用 `find('\n// ===== …')` 会留下一个孤立 `\r`（CRLF 文件的 `\r\n` 里只有 `\n` 被匹配），重建后比旧版多一个换行，`verify_update_watch.py` 立刻报 DIFF。正确做法：定位 marker 后**向前吃掉所有连续换行**、向后吃到片段结尾整行，再**补一个主行尾**恢复成锚点。另注意 **`integrate_ads.py` 会往"已注入过的 html"再注一遍** —— 重跑它之前必须先用 `generate_filterable_report.py` 产出干净的 `filterable_dashboard.html`，否则页面里会出现两份 `const WOOT_ASIN`/`cloudUpdateWatch`（顶层 const 重复声明 = 整页 JS 挂掉）。G5 就是拦这个的。

    **⚠️ 2026-10-14 更新：上文那个「唯一锚点」已失效，脚本改为「按片段标记原地替换」。** 各看板的载入同步块后来被统一成「一次性 dirty 同步」（结尾变成 `if (dirty) location.reload();`），于是锚点 `cloudWootSync 结尾`**命中 0 次**，`inject_update_watch.py` 只会打印 FAIL/静默不注入。现逻辑：定位片段自身的起止标记（`// ===== 云端更新提示` 起、`})();` 止），前后吃掉连续换行后**在原位置插回**新片段并补一个空行保持排版；dry-run 不改盘。**改完仍必须跑 `verify_update_watch.py`（应 ALL PASS）**。同轮还发现并修掉一个「签名比对」的坑：`localSig/cloudSig` 直接 `JSON.stringify` 比较时，**键顺序不同**就会被判成「有更新」（云端 `wootCfg` 是 `{cost,price}`、看板写本机时规范化成 `{price,cost}` ⇒ 提示条常驻点不掉）——已改用 key 排序的稳定序列化 + 同款规范化函数。详见 RUNBOOK「第十三轮」。
19. **"上传后别人能看到吗"类问题要分场景验，只比云端会漏**（2026-09-23）：判断"数据更新了页面会不会变"必须同时考虑 ① 页面是否已打开 ② 本机缓存是否已被**本浏览器**别的标签页更新（`localStorage` 同源共享！）。只比对"云端 vs 本机"会把同浏览器上传场景判成"无变化"而**不提示**，但该页面渲染的还是旧数据 —— 用户看到的就是"没更新"。所以轮询判据要三路：渲染快照 / 此刻本机 / 云端。测试也必须 mock 出这条路径（本文件 `test_update_notice.js` 第 6 组）。

20. **「删掉本地文件」≠「线上下线」——部署工具只增不删**（2026-09-23）：清理 `_deploy` 时发现 `ad_dashboard.html`（9/20 构建产物的旧名，已被 `ad.html` 取代、**零引用**）还挂在线上，任何人用旧 URL 打开看到的就是 9/20 的旧数字（727KB）。把它从 `_deploy` 删掉、重新部署后 **线上依然 200 返回原文件** —— 部署是增量推送，不比对删除。正解：**同名墓碑页覆盖**（`make_tombstones.py`，<2KB，`wb-tombstone` 标记 + `meta refresh` 跳正式页），并把这个地址登记进自检 `LEGACY_URLS`。自检新增 **G6**（部署目录里未被任何页面引用的 `.html` 要么不存在、要么必须是合规墓碑 → 防再把废弃副本塞回来）/ **G7**（线上每个遗留地址必须 <2KB 且含标记，或 404）。顺带确认：`monthly_targets.json` 虽也无人 fetch（targets 已内嵌进 HTML），但它是构建输入的快照、内容与内嵌一致，**留着无风险**，不必墓碑。

21. **易仓业务报告按店铺同步，「半截数据」会被静默当成正常结果入板**（2026-09-24，用户反馈「日数据不对」）：实测 9/22 易仓只同步了 EU 店铺（UK/DE/NL/ES/IT/SE 共 15 行），**US 整段缺失**（正常每天 11~19 行）；9/23~9/24 全空。旧逻辑只要响应里有目标日期就「确认」，半截结果直接入板，看板照常渲染 → 用户看到 9/22 骤降、9/23 起全「—」，却不知道为什么。修复三层：① 采集端**主力店铺中位数判据**（中位 ≥5 行的站点缺席 → `incomplete` 标记；阈值不能太敏感，UK/DE 偶尔 0 行属正常）；② **复查窗口**（incomplete 日期每次运行都重查，防超过 14 天窗口后永久缺数；**2026-09-24 晚已重设计为三层：热区14天全量 + 空缺日无条件复查 + 温区15~60天轮转校准，见 §5**）；③ **可见性**（看板头部琥珀提示 + 自检 G8）。**排障工具**：`probe_biz_scope.js` 只读探针直接问源头（注意 user_account 参数格式坑，见 §5）。判「采集 bug 还是源延迟」的方法：直接重跑采集脚本看同一结果 → 源问题；对照历史站点分布（US 每天都在，突然 0 = 异常）。
22. **对照数据文件改动必须做「无回退」校验**（2026-09-24）：改采集/合并逻辑后重跑，逐日期对比改动前备份的 行数/广告items/sessions 合计，任何一项**变小**都要查清。本次 14 天重跑验证 94 天无一回退（合并策略是「新值覆盖同键 + 旧键补缺」，天然只增不减）。

23. **完整性基线不能跨期套用，否则给历史日期造出假告警**（2026-09-24，本次自查发现）：主力店铺中位行数是用**近 14 个"好日子"**算的（9 月 US 中位 16 行），但业务量是逐月长起来的 —— 6/23~7/19 每天仅 1~2 行、8 月 US 每天 4~8 行、9 月才 11~19 行。温区首次校准到 08-13（本来就只有 4 行 US）时被误标「缺 US」，于是它进了 pending 列表、天天被复查、看板还提示"源数据未同步"。修复：**基线只对近端日期（`hotDays` 内且 age ≤ HOT_DAYS）生效**；历史日期只在「此前有数据、这次源却返回 0 行」时才判可疑（那是源侧删除，而非本来就稀疏）。回归后 08-13 假告警自动消失。**同类提醒**：任何"用近期统计量做异常判据"的逻辑，都要显式限定适用范围，别让长期趋势被当成异常。

24. **探针的取数口径写错，会得出与事实相反的结论**（2026-09-24）：两个真实踩坑 ——
    ① **广告指标在嵌套对象里**：`item.Report.Cost` 才是花费，写成 `item['Report.Cost']` 一律取到 0 →
       对比两份快照时算出"花费完全没变"，差点据此判定**历史金额无需校准**（实际 08-09 花费 746.17→737.31）。
       凡是"逐项求和=0"或"处处相等"的过于干净的结论，先怀疑取值路径。
    ② **广告接口对任何历史日期都返回"当前"广告结构**：查 06-23 也返回 192 条（US 127），而当年只存了 44 条。
       → 「条数变多」**不代表**当年少采；判断要不要补拉必须比**金额类指标**（花费/点击/订单/销售额），
       实测多出来的都是当时零消耗实体，金额完全一致，故历史 ACOS 未被低估、无需全量重拉。
    探针自身也要**打印原始响应/原始请求体**（`probe_biz_scope.js` 就靠这个才发现 `user_account` 是 JSON 字符串）。

25. **`curl -o /tmp/x` 在本机 Git Bash 下静默不落盘 → 线上比对全部报 DIFF**（2026-09-24 部署时踩到）：
    部署后按惯例 `curl -s "$B/$f.html?cb=..." -o /tmp/on_$f.html` 再 `cmp`，结果 8 个文件**全是 BYTES DIFF**，
    差点误判成"线上还是旧版 / 部署没生效"。实际是 `/tmp` 下文件根本没生成，`cmp` 找不到文件就报差异（且不显示错误）。
    **正确做法**：比对副本落到工作目录（`_online_check/`），并且**先看响应头 `Content-Length` 与本地 `ls -l` 是否一致**做交叉印证，
    再用浏览器实测线上 DOM（`BASE=<线上> node shot_data_note.js`）作为最终判据。验完记得删掉副本目录（17MB）。
    另：`curl -sI` 看头时**不要手写 `Accept-Encoding: br`**（解不开 brotli 会返回空 body），也别用裸 URL（CDN 按编码变体缓存）。

## 9. 回归测试

| 脚本 | 覆盖 | 通过标准 |
|---|---|---|
| `test_confirm_bar.js` | 筛选确认栏 | 78/78 |
| `test_monthly_dashboards.js` | monthly+target | 60/60 （2026-09-22 修复：壳段补 wb_auth stub + auth mock；「进行中」断言改当前月动态；iframe 断言兼容 ?v=，此前因 8-25 上线认证守卫已长期失效） |
| `test_autosync.js` | 地区国家自动同步（monthly.html + `_deploy/product.html`） | 22/22 （2026-09-23 修复 Test 5 硬编码「EU 只剩德国」的过期断言 → 动态计算 EU 区有数据国家，见坑 17f） |
| `verify_filters3.js` | 四看板筛选+壳页面（**http.server 8899 必须从 `_deploy/` 启动**；壳页面段已内置 wb_auth stub + auth 拦截） | 32/32 |
| `test_currency_ads.js` | 货币+广告注入 | 20/20 |
| `test_kw_dashboard.js` | 投放词看板 | 12/12 |
| `test_week_reset_verify.js` | 周筛选联动重置（product+ad 双看板，file:// 直开，已内置 Supabase 拦截） | 17/17 |
| `test_week_toggle.js` | 周维度切换确定性（ad 看板，W36↔W35↔W33 往返数值与选择集不变；file:// 直开） | 10/10 |
| `test_buybox.js` | BuyBox 率口径（product + monthly 渲染值、`calc()` 逐周、逐 ASIN 单选路径均 ∈0~100%，双看板口径同量级；http.server 8899） | 8/8 |
| `test_daily_sales_campaign.js` | 每日看板销售额列（表头/当日值=源数据按看板币种口径折算/合计行/列选择面板）+ 广告看板活动副标题（产品筛选下副标题 ASIN ∈ 所选系列；无筛选时为元数据 ASIN） | 7/7 |
| `test_daily_currency.js` | 每日看板币种口径（默认=各站按每月1号汇率折算 USD 合计；单选 US/DE/UK=原币种原值与符号；多选混合币种回退 USD；页面内全期折算可算；支持 BASE 线上/本地双跑） | 10/10 |
| `test_search_confirm.js` | 三看板(daily/ad/product)×三搜索下拉(ASIN/系列/产品名)：输入过滤→点击非置灰选项→摘要变化→表格渲染→全程无页面错误。**含 wb_auth stub**（线上守卫跳转会打断测试致偶发 fail）。置灰(无数据)选项点击不选中属设计行为 | 22/22 |
| `test_mapping_csv.js` | 产品关系管理(mapping.html) CSV 导出：按钮存在／文件名+UTF-8 BOM／表头与列数／含逗号·引号·换行字段的 RFC4180 转义／**导出→导入回环无损**／未匹配导出只含「无」／空数据不产生下载／旧粘贴格式(逗号·制表符·中文逗号·单引号·BOM·无表头)向后兼容。**测试内 route abort Supabase，绝不读写云端映射**；支持 `BASE=` 线上/本地双跑 | 30/30 |
| `test_woot.js` | Woot 上传/并入（2026-09-23 重写）：woot.html **直传官方 xlsx**（标题行+英文表头+中文表头，9 个有数据日、5 个全 0 日静默跳过、09-14 精确值断言）→ 粘贴双行表头 CSV（同日同 ASIN 两行聚合、`展示数量` 不被 `Viewable展示数量`/`千次展示花费` 误匹配）→ 旧周汇总格式仍兼容 → 预览确认 → 云端 PATCH 含 woot 键。每日看板：**09-10 真实当日值（不再均摊）**、相邻日不变、**筛选具体 ASIN 已含 Woot**、**Woot 不产生 Sessions（流量不变，含"官方表带 Session 列也不采集/不误匹配"断言）**；旧纪录仍落 WOOT-STORE（7000）；monthly/target 生成 asin 行；product W37 该 ASIN +1899.99/+518.8；ad.html 注入 wootAds 记录。样本文件 `woot_official_sample.xlsx`。**重复上传覆盖语义**：同周期重传→记录数不变且值取最新、旧整店汇总被清理（不多算）、某天变全 0→该天旧记录被清（不留虚高）、「仅追加」模式不清理。**跨浏览器可见性**（2026-09-23 新增）：全新 context（`pc_woot` 为空 = 其他同事首次打开）+ 云端有 woot → ad.html 仍显示 Woot 广告且回写本机缓存（缺 `cloudWootSync` 时该用例失败，已用缺陷副本反向验证：0 条 vs 1 条）。**假后端隔离（route mock Supabase）** | 49/49 |
| `test_mapping_country_filter.js` | 产品关系管理(mapping.html) 匹配列表国家筛选：下拉存在/默认全部/选项含条数与「无数据」标注／按系列+筛选 US → 组与行数正确／组头计数跟随／提示条+清除筛选／全部展开折叠只作用于过滤后数据／localStorage 刷新保持／按国家分组叠加筛选／空态提示／筛选下改行国家立即移出视图。**假后端（GET 返 fixture、PATCH 计数）零云端写入**；含变异验证（改坏过滤逻辑 9 项 FAIL） | 23/23 |
| `test_auth_login.js` | 认证/角色/退出。**刻意不注入登录态**（专测「未登录应被重定向」） | 21/21 |
| `test_auth_signup.js` | 注册白名单。**刻意不注入登录态** | 14/14 |
| `test_auth_redirect.js` | 登录跳转链路。**刻意不注入登录态** | 13/13 |
| `test_auth_guard.js` | **子页面认证守卫（2026-09-23）**：7 个子页面未登录 → 必须跳 login.html；已登录 → 不被误伤（URL 未跳转 + 标题正确 + 无 JS 错误）；index.html 守卫仍在；login.html 不含守卫（否则跳自己死循环）；iframe 内未登录 → **顶层窗口**跳转（壳页场景）。**URL 必须带 cache-buster**（裸 URL 会被 CDN 喂旧版，导致结论完全反）；用 `noAuth:true` 测未登录路径。**刚部署完立刻跑可能整组失败（7 个子页面全红）**：CDN 尚未收敛/网络抖动导致等不到跳转超时 —— 重跑即绿（2026-09-23 实测：首次 22/7 → 连跑两次 31/31），别据此判定守卫失效。**含 4 条遗留地址墓碑断言（2026-09-23 追加）**：未登录旧地址 → 墓碑→ad.html→守卫→login.html；已登录 → 落到 ad.html 且渲染广告看板；跳转后无 JS 错误；墓碑本身 <2KB + `wb-tombstone` + refresh。**反向验证过**：把旧 727KB 副本换回该文件名后，其中 3 条如期转红 | 35/35 |
| `test_update_notice.js` | **云端更新提示条（2026-09-23）**：五套看板各 13 项 —— 自动首检确实发出云端请求；云端旧结构(无 woot 键)不误报；云端与本机一致**不**提示；云端更新 → 弹条 + 文案正确；点 × 隐藏且同一状态不再重复提示；新一轮更新再提示 → 点「立即刷新」后本机缓存 = 云端新数据、刷新后不再提示；**同浏览器上传场景**（别的标签页写 pc_woot + 云端同步）也要提示；**本机已最新时不被云端旧值覆盖**；全程无 JS 报错。用 `route` 拦截 Supabase 喂假数据，**不触碰生产数据** | 65/65 |
| `check_data_integrity.js` | 静态自检（node 运行，退出码非0=有FAIL）：A 周度基线 / B 周度vs每日源交叉 / C 广告源覆盖 / D 最新周入板 / E 本地一致性 / F 线上一致性 / G0 禁缓存 / G1-G2 新鲜度 / G3 Woot云同步 / G4 认证守卫 / G5 提示条 exactly-1 / **G6 无孤儿页面副本（2026-09-23）** / **G7 遗留地址须为墓碑（2026-09-23）** / **G8 近7天日数据完整性（2026-09-24）** / **G9 重新校准新鲜度（2026-09-24）** / H1-H3 BuyBox 口径 | **25 pass / 3 warn / 0 fail**（warn=A2b 老周源稀疏(已知) + G8 源数据延迟(自动复查) + G9 个别日期尚未轮到校准(轮转会补)；未部署时 F 项会 FAIL 属预期） |
| `check_cloud_perms.js` | **云端权限只读探针（2026-09-23）**：确认匿名**不可写** `mapping`（期望 42501）、`profiles` 匿名读不到、`mapping` 匿名可读（设计允许）、探针零数据改动。用「id=1 必冲突的 INSERT」撞 RLS，避免 204 误判（坑 17j） | 5 pass/0 fail |
| `test_live_sync.js` | 云端实测 | — |

product 渲染函数叫 `syncAndRender()`，monthly 叫 `renderAll()`（测试兼容写法 `((typeof syncAndRender==='function')?syncAndRender():renderAll())`）。

## 10. 自动化任务清单（WorkBuddy）

| ID | 名称 | 计划 |
|---|---|---|
| automation-1787105514880 | **亚马逊看板统一更新**（每日链路必跑；周一串行追加广告周报+产品周报） | 每日 15:00 |
| 8dcc5b19-2da3-42d6-b1f0-d4937dcb28e6 | JoyBuy 数据看板每周更新（独立链路，**采集自 2026-10-02 起免登录**：优先 `joybuy_compass_session.json` + 纯 HTTP。CDP 9333 只在两处需要：① 会话失效后人工登录续期；② **页面级回归测试**（headless 无窗口，跑完 `--stop`）） | 周一 15:30 |

- **2026-09-26 合并**：原「产品周报 1786956560592」「广告周度 1787561869471」两个周一 15:00 任务已**平移删除**，内容原样并入主目录 **`RUNBOOK.md`**（§A 每日 / §B 广告周度 / §C 产品周报 / §D 合并汇报）。统一任务 prompt 只保留调度逻辑（非周一跑 §A；周一串行 §A→§B→§C）与 6 条全局红线，细节一律维护在 RUNBOOK.md —— **以后优化链路只改 RUNBOOK.md，不改 prompt**。
- 合并的附带收益：原两个周一任务**同时 15:00 触发**，存在 CDP 9223 并发导致广告接口全 0、以及同时部署同一 `_deploy/` 的并发覆盖风险；串行后从根上消除。
- ⚠️ 残留时序重叠：周一统一任务从 15:00 串行跑三条链路，可能与 JoyBuy 任务（15:30）的部署窗口重叠（两者部署同一 `_deploy/`）。两者 CDP 端口不同（9223 vs 9333）无采集冲突，**JoyBuy 采集自 2026-10-02 起也不启 CDP**（免登录纯 HTTP；9333 只在会话续期与页面测试时用，且默认 headless 无窗口），但**部署存在并发上传理论风险**；若观察到互相踩踏，把 JoyBuy 挪到 16:30 即可。

**迁移到其他环境时**：以上用 Windows 任务计划程序（Task Scheduler）跑 §5 的命令序列替代（批处理脚本注意编码，勿在 .bat/.ps1 里写非 ASCII 路径）；合并后的链路命令以 `RUNBOOK.md` 为准（本文件 §5 每周链路一节仍可参考）。

## 11. 云端配置详情

### Supabase（oovvqvgrjqwogjwswaxx.supabase.co）
- **Auth**：Email Provider 已启用；注册白名单在前端 `login.html` 的 `ALLOWED_DOMAINS=['aliencell.com']`（改域名改这里）；session 存 localStorage `wb_auth`（access_token/refresh_token/expires_at/user/role）
- **profiles 表**：user_id/email/role/created_at；RLS 仅认证用户可读；新用户 trigger 自动建档默认 viewer
- **mapping 表**：单行 JSONB(id=1)；RLS 公开读；写需头 `{"x-admin-key":"wb-map-2026"}`；三看板注入 cloudMapSync 优先读云端
- **认证流程**：index.html body 顶部同步守卫（无 wb_auth → login.html）→ 异步 GET /auth/v1/user 校验 → 401 走 refresh_token → 仍失败跳 login?reason=invalid
- **待办**：Site URL 仍是 localhost:3000（邮箱验证链接点击报错，见 §6）

### CloudStudio
- 纯静态站部署，sandboxId `3577d1e878e64dc5837e56f9471dcefc` 固定复用
- 每次部署 = 上传 `_deploy/` 全量文件，链接不变

17. **易仓字段类型会变，前端字段访问必须做类型兜底**（2026-09-17，用户反馈"带搜索框的筛选栏都无法确认"）：业务报告 `seller_sku` 从字符串变成了**数组**（如 `['','ACD-X1-40W-NA']`），daily.html 的 `buildAsinOptions()` 把它当字符串调 `.toLowerCase()` → 一旦在 ASIN 搜索框输入过文字，`renderAll` 每次都在 `buildAsinOptions` 抛 TypeError 中断（空搜索词时因 `a.includes('')` 短路不触发，所以首屏正常、一搜索就炸），表格冻结、所有下拉无法确认。修复：新增 `skuText()`（数组→`filter(非空).join(' / ')`，其他→`String()`），过滤与显示两处统一走它。**教训**：(1) 对接口字段做 `.toLowerCase()/.trim()` 等字符串操作前一律先 `String()`/类型判断；(2) 单个下拉的渲染异常会经 `renderAll` 连坐整个看板——下拉渲染函数各自 try 包裹或统一类型兜底；(3) 回归 `test_search_confirm.js` 22/22 覆盖三看板×三搜索下拉的"输入→点击→确认"全链路（含 wb_auth stub，否则线上守卫跳转会打断测试）。

17b. **解析第三方报表：表头匹配必须「精确优先 + 黑名单」，且要容忍多行表头**（2026-09-23，Woot 官方报表）：Woot 的「产品每日总表现」是 **标题行 + 英文表头行 + 中文表头行 + 数据**，共 23 列。旧版 `mapHeaders` 只扫前 5 行、格子按 `includes` 匹配 → 会出现三类误匹配：`Viewable展示数量`(col20) 抢走 `展示数量`(col11)、`千次展示花费` 也含「展示」、`单个广告订单的费用` 含「广告订单」、`广告销售额` 含「销售额」。修法：① `detectHeader()` 先在**多行表头块**（`looksHeaderRow` = 非空≥3 且命中≥2 字段且不含可解析日期）里定位，英文行+中文行合并成同一列的多文本一起匹配；② `matchFields()` 两轮——先全等匹配、再包含匹配，并对每个字段配 `not` 黑名单（如 impressions 排除 `viewable/千次/vcpm`）；③ **全 0 行静默跳过**（官方报表里无活动的日期很常见，若算作"未识别"会让预览显示一堆吓人的报错）；④ 同一批上传里 **同日同 ASIN 多行要聚合求和**（报表可能按订单/广告组拆行）。另：单元格里的日期可能带时间后缀，`dparse` 正则要允许 `[ T]` 尾巴。
17c. **Woot 并入的两个维度：Session 是 ASIN 维度、订单是店铺维度**（2026-09-23 用户澄清，勿再按旧说法"转化率偏高"理解）：**Session/sessions 是 ASIN 维度、全平台口径** —— 同一个 ASIN 在主店和 Woot 店看到的值一样，统计范围是亚马逊所有店铺，所以主店报表的会话**已包含 Woot 带来的流量，Woot 侧绝不能补**（补了会翻倍）。实现上：表头映射 `FIELDS` 里**没有 sessions 字段**（官方表若新增 Session 列也会被忽略），并入行一律 `sessions=0`/`mob=0`/`brw=0`，各看板聚合都是 sum → 流量列恒等于主店原值。**订单 / 销售额 / 广告指标是店铺维度** —— 主店报表只含主店成交，Woot 店铺的销售必须由 Woot 报表补进来，所以 `units_ordered`/`total_order_items`/`ordered_product_sales_amount` 与广告四件套都要加；补后「转化率 = 订单量 ÷ Sessions」分子才完整（**不补时偏低，不是补后偏高**）。不要为了"数字看起来一致"把 Woot 订单从分子里扣掉（订单量列会漏数），也不要给 Woot 行编造会话数。另外**广告周度看板 ad.html 此前完全没有 Woot 注入**（2026-09-23 才补），改这块时记得 ad.html 用的是**扁平 `records`**（`{country,week,start,end,asin,campaignId,campaign,type,state,impressions,clicks,cost,orders,sales}`）+ `DATA.campaigns` + `DATA.types`，注入要给 `TYPE_NAME/TYPE_SHORT/TYPE_CLS` 加 `wootAds` 并新增 `.tag-woot` 样式，否则类型标签会渲染成 `undefined`。

17d. **Woot 重传必须是"覆盖"而不是"追加"**（2026-09-23 用户要求）：Woot 的订单与广告数据有延迟，用户每次都会重传历史时间段做修正。若只按「起止日期 + ASIN」同键覆盖，会有两个静默错误：①某天数据被后台改成全 0（新表该行被跳过、不产生记录）→ 旧记录残留 → 看板虚高；②用户从"整店周汇总"切到"官方逐日明细"后两种记录共存 → 同一笔数据被算两遍。所以 `woot.html` 用 `planImport(list, mode)` 做**范围替换**：`sync`（默认）先算出本次上传每个 ASIN 的日期范围，把该范围内同 ASIN 的旧记录 + 与新范围重叠的**无 ASIN 整店汇总**清理掉再写入（同键记录直接覆盖取最新值）；`append` 只覆盖完全同键记录。要点：**清理判定用「区间重叠」而非「日期相等」**（`old.end >= r.min && old.start <= r.max`），因为旧记录可能是跨多天的 range/month 类型；预览区必须把「新增/覆盖/清理」统计与将被清理的记录列出来让用户确认，否则"静默删数据"不可接受。回归断言见 `test_woot.js`（同周期重传值替换、旧整店汇总被清、某天变全 0 后旧记录被清、仅追加不清）。

17e. **上线前必须逐个核对 `_deploy/` 与源文件的同步清单**（2026-09-23 实炸）：`_deploy/` 是手工 `cp` 同步的，任何一次漏 cp 都会让线上**静默缺功能**。本次差点出事：`mapping.html` 在主目录已加了「`cloudSave` 写回前先 GET 云端保留 `woot` 键」（防与 Woot 数据互踩），但没同步到 `_deploy/` —— 若这样上线，用户在产品关系管理页点一次保存就会把整份 Woot 数据**抹掉**，且没有任何报错。铁律：上线前跑
`for f in index login mapping woot daily monthly target ad product; do cmp -s $f.html _deploy/$f.html || echo "DIFF $f"; done`
（`ad.html`←`ad_dashboard.html`、`product.html`←`2026-08-17-14-21-33/filterable_dashboard.html` 是改名拷贝，要单独比），有 DIFF 先查谁新再同步。注意 `_deploy/ad_dashboard.html` 是**无引用的旧副本**（别被它误导，线上真用的是 `ad.html`）。

17f. **测试断言禁止硬编码"某地区只有某国有数据"**（2026-09-23 修）：`test_autosync.js` 的 Test 5 写死「选 EU 后国家列表只剩德国」——这是 8 月的假设（当时 EU 区只有德国有数据）。现在 EU 有数据国家是 DE/FR/IT/ES/NL/PL/SE（monthly，7 个）与 DE/FR/IT/NL（product，4 个），断言长期 fail 且被当成"功能坏了"排查。改成从页面数据动态算期望：
`codes.filter(c => regionOf(c) === 'EU')` 再断言数量相等 + 每个 code 都出现 + 不含美国。注意 `monthly.html`/`target.html` 只有 `ROWS`（无 `DATA`），evaluate 里取数据要写 `typeof ROWS !== 'undefined' ? … : DATA.countries…`，且比对用**国家 code**（选项文本是「德国 DE」）而不是中文名，否则 monthly 会抛 `Cannot read properties of undefined`。

17g. **Woot 数据"别人能不能看到"取决于看板有没有 `cloudWootSync`**（2026-09-23 修）：Woot 数据真身在 Supabase `mapping` 表 id=1 行 `data.woot`，但看板运行时**从 `localStorage.pc_woot` 读**，靠页面开头的 `cloudWootSync` IIFE「拉云端 → 与本地比对 → 不同则写入本机并 `location.reload()`」把云端数据搬进来。**五个并入 Woot 的看板（daily/monthly/target/ad/product）缺一不可**——`ad_dashboard_template.html` 曾漏这段，导致 Woot 广告只有上传者本机看得到、其他同事打开广告看板完全没有（无报错、静默少数据）。已补，并加自检 **G3**（`check_data_integrity.js`：这五个文件必须含 `cloudWootSync`，否则 FAIL）。另两个易误解点：① 已打开的页面不会自动刷新，需 F5 或重进看板（非实时推送）；② 必须点「✅ 确认导入」才触发 `cloudSave` 写云端，云端失败会提示"云端保存失败（已保存在本机）"（此时别人看不到）。

17h. **子页面认证守卫（2026-09-23 已实施）**：原先只有壳页 `index.html` 检查 `localStorage.wb_auth`，`woot/daily/ad/product/monthly/target/mapping` 七个数据页拿到直链即可打开（实测线上直链返回 HTTP 200 + 完整数据）。现已给这 7 页都加上守卫，插入位置=各文件 `<body>` 之后（模板里加，重建后生效；`login.html` **必须不加**，否则跳自己死循环）。
**设计取舍（重要，别"优化"掉）**：子页面**只做「有无登录态」的同步检查，不做 token 异步校验与刷新**。原因是 Supabase 的 `refresh_token` **单次有效**（刷新后会轮换），壳页已经在异步刷新；若子页面也去刷新，两边会拿同一个旧 refresh_token 互相作废 → **把已登录用户误登出**。所以刷新统一由壳页负责。未登录时的跳转要**先试 `window.top.location.replace`**（壳页 iframe 场景，同源可行），失败再 `location.replace`，否则会在 iframe 框内跳出登录页。
**残留风险（2026-09-23 已实测澄清，别再照抄旧结论）**：Supabase 读取仍用**公开 anon key**（硬编码在源码里）→ **匿名可以读** `mapping.data`（当前 26 个系列 / 43 个 ASIN / 0 条 woot）；写入的 `x-admin-key` 也在源码里。**但匿名写入是被 RLS 拦住的**（探针实测 `42501 new row violates row-level security policy`，见 `check_cloud_perms.js`），用户表 `profiles` 匿名也读不到内容。所以准确说法是「**匿名可读、不可写**」，不是"可篡改"（2026-09-23 一度误判为可篡改，根因见坑 17j）。
页面守卫的作用范围要说清：它只挡「随手点开直链的人」；**看板内嵌的业务数据本身是公开的**（`curl <链接>/daily.html` 不做任何 JS 就能拿到 55 个 ASIN、4.4MB 数据；`daily_data.json` 6.3MB、`monthly_targets.json` 53KB 也是 200 直取）——**这是静态托管的固有限制，RLS 管不到**。若要真正限制数据可见性，需要把数据改为经服务端鉴权的接口获取（换托管形态或加一层 API），属独立项目。
**测试侧配套**：新增 `playwright-auth.js`（包装 `chromium.launch`，自动为 `newContext()/newPage()` 注入 `wb_auth`），48 个加载看板的测试脚本把 `require('playwright')` 换成 `require('./playwright-auth')` 即可，无需逐个 call site 改；**`test_auth_login/signup/redirect` 三个文件刻意不改**（它们专测未登录重定向）。自检 **G4** 断言 7 页含守卫且 login.html 不含。

17i. **线上裸 URL 会拿到「上一版」，浏览器冒烟测试必须带 cache-buster**（2026-09-23 踩到）：这次部署后用**裸 URL** 跑 `test_auth_guard`，线上 7 个页面里有 5 个「未登录却没跳登录」，看着像守卫漏部署；改用带 `?cb=` 的 URL 立即变 31/31 全绿。用真实浏览器实测确认根因：**CDN 对裸 URL 缓存了旧变体**（`fetch('/woot.html')` 裸 URL 返回 35628 字符且**不含守卫**，加 `?cb=` 返回 35645 且含守卫，差值正好是守卫片段）。所以：
  ① **判断线上版本一律加 cache-buster**（curl 也要，且**别同时手写 `Accept-Encoding: br`** —— curl 解不开 brotli 会返回**空 body**，会让你误判成"内容缺失"；只写 `gzip` 或干脆不写）；
  ② 用户正常使用**不受影响**，因为壳页 `index.html` 的 `cacheBust()` 给每个 iframe 拼了 `?v=<小时时间戳>`，天然绕开旧缓存 —— 这也解释了为什么"裸直链/书签"可能看到旧版而壳页里永远是新版；
  ③ 怀疑"线上没生效"时，先带 `?cb=` 复测再下结论，否则会去修一个不存在的 bug（本次差点如此）。

17j. **判断「匿名能不能写云端」时，PostgREST 返回 204 不等于有权限**（2026-09-23 误判过一次）：RLS 的 `USING` 会把不满足条件的行**过滤成 0 行**，而「0 行受影响」和「有权限地改成功」**都返回 204**。用 204 当判据会得出完全相反的结论（本次先错判成"任何人都能改/删数据"，实际 RLS 是拦住的）。
**正确做法：拿一个必然不可能落库的写操作去撞 RLS，看报错码是谁先出现**：
- `42501 / 401 / 403` → **RLS 拦住了写入（安全）**
- `23505 / 23514` → RLS 没拦，只是被主键/约束挡住了（**不安全，要补策略**）
现成工具：`node check_cloud_perms.js`（**只读探针，零数据改动**）——用 `id=1` 做 INSERT（主键必然冲突，即使 RLS 失效也绝不可能落库），并在结尾复核 `updated_at` 未变。它同时确认 `profiles` 匿名读不到内容。
**当前实测结论**：匿名可读 `mapping.data`（设计允许）、**不可写**、`profiles` 读不到 → 准确表述是「匿名可读、不可写」。另注意页面守卫**管不到**看板内嵌数据（`curl` 直取即可，见坑 17h）。

## 12. 易仓 OpenAPI（已验证签名，待授权，备选直连方案）

AppKey `b70be345c2174684` / SecretKey `b85b5ea499b3acdf` / serviceId `EDT7P8`；网关 `http://openapi-web.eccang.com/openApi/api/unity`；签名=字段字母序拼接+AES-128-CBC/PKCS7/IV=1234500000054321→Base64（timestamp 毫秒）；工具库 `eccang_openapi.js`。基础接口 0032 未授权、广告接口 0077 需升级套餐。**授权后可免登录直连，替代 CDP 网页采集**。
