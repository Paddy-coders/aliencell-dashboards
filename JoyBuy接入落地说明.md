# JoyBuy 开放平台接入落地说明

> 上游指引：`C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33\JoyBuy接入指引.md`（抓取自 open-portal.joybuy.com 官方文档）
> 本文档记录**接入落地**：代码、凭证、命令、看板、口径与测试。
> 代码目录：`C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38`（与亚马逊看板同目录，共用云端链接）
> 更新时间：2026-10-02（新增 ⑭：Data Compass 采集免登录化 + 防串站自检）

---

## 一、五步流程与当前状态

**品牌：Aliencell**（与 iVANKY 无关，独立业务线，仅共用云端入口与登录）。

| 步骤 | 内容 | 状态 |
|---|---|---|
| ① | 注册开发者账号 + 提交主体/业务信息 | ✅ 完成 |
| ② | 创建应用 → 拿 **appKey / appSecret** | ✅ 完成 |
| ③ | 添加服务对象 → 一键授权 → 拿 **access_token / refresh_token** | ✅ 完成 |
| ④ | 签名调用脚本（SDK + 采集 + token 自动刷新） | ✅ 完成，签名自检 **9/9** |
| ⑤ | `joybuy.html` 看板 + 并入统一入口共用云端链接 | ✅ 完成，回归 **30/30 + 17/17** |
| ⑥ | **商家后台 Data Compass 采集（流量/加购/收藏/渠道/搜索词）** | ✅ 完成，4 站点 × 120 天全自动 |
| ⑦ | 发布上线（复用 sandboxId，链接不变） | ✅ 完成，线上与本地逐字节一致 |
| ⑧ | **六维筛选（国家 / 产品系列 / 产品名 / 套装 / SKU / 周数）+ SKU→产品名映射** | ✅ 完成并已发布 |
| ⑨ | **KPI 改固定 5 张（可下拉替换指标）· 指标全中文化 · 无数据候选项直接隐藏** | ✅ 完成，筛选回归 **64/64**、入口 e2e **19/19** |
| ⑩ | **窗口从「首个有数据的周」开始（早期连续全 0 的周整体移除；单站再按该站起点收窄）** | ✅ 完成，筛选回归 **71/71**、入口 e2e **19/19** |
| ⑪ | **每周一定时自动更新（采集→映射体检→构建→双回归→发布）** | ✅ 已配置，任务 `8dcc5b19`，每周一 15:30 |
| ⑫ | **周筛选真正驱动图表 X 轴 / 周度表 / 日明细（`visibleWeeks()`）+「窗口」标签跟随筛选** | ✅ 完成**并已发布**，筛选回归 **80/80**、入口 e2e **19/19**（本地 + 线上双跑） |
| ⑬ | **回归断言去硬编码**（期望值改为从构建产物内嵌 `PAYLOAD` 自算）+ **修掉「窗口」标签把进行中的半周算进覆盖期** | ✅ 完成**并已发布**，筛选回归 **86/86**（80→86）、线上验收 **22/22**（2026-09-28） |
| ⑭ | **Data Compass 采集免登录化**：会话文件 + 纯 HTTP 直连（日常零浏览器零登录），并修掉「切店铺靠 `Set-Cookie: b_belong`、忽略响应头会静默串站」这颗雷 + 新增防串站自检 | ✅ 完成（2026-10-02）：两模式**逐项等价**（同参数 UK 30 天全一致）；双站切换自检 `UK:9 ｜ FR:19` 通过 |

> **🟢 整条链路闭环**：注册 → 建应用 → 一键授权 → SP-API 采集 → Data Compass 采集 → 看板 → 线上。
> 线上链接：`https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host`（统一入口 `index.html` → 侧边栏 JoyBuy 分组）
> 调试浏览器：独立 profile `C:/Users/paddy/.workbuddy/edge-joybuy`，CDP 端口 **9333**。
>
> **已知数据现状**（非链路问题）：该店为新建店铺、订单量极少，
> 开放平台 SP-API 近 120 天 0 订单，订单真实值走商家后台口径（DE 站 3 单 / €1,803.89）。

---

## 二、步骤①~③ 操作路径（留档，重装/换主体时照做）

**登录入口**（实测跳转链）：
```
https://account.joybuy.com/seller/login?productCode=b2c&appCode=b2cseller&tc=root&source=seller
  &returnUrl=https://openplatform.joybuy.com/
```

| 步骤 | 路径 | 产出 / 注意事项 |
|---|---|---|
| ① 注册开发者 | 开放平台 → 右上角 **Console** → 按 Beginner's Guide 走 | 填 **主体信息**（Entity Information）+ **业务信息**（Business Information）→ 提交，审核 2~5 工作日 |
| ② 创建应用 | Console → **Application Center → Application List → Create App** | 应用类型：POP 第三方店铺 → `ISV Applications`；自营供应商 → `Merchant In-house Applications`。审核 1~3 工作日，通过后生成 **appKey**，appSecret 在应用详情页 |
| ③ 添加服务对象 | Application Center → **Authorization Management → Add Service Object** | 同主体账号**实时自动通过**；其他关系需证明材料，人工审核约 1 个工作日 |
| ③ 一键授权 | 绑定状态 = `Successfully Bound` 后点 **One-Click Authorization** | 弹窗给出授权链接 → 用**店铺账号**登录授权工具页完成授权 → 拿到 `access_token` / `refresh_token` / `xid` |
| ⑤ 发布应用 | 应用列表 → **Publish** | 上线应用 |

⚠️ **改商家账号密码会使 token 失效**，需重新授权。

### 可用辅助工具（Console 内）
`Self-developed Merchant Authorization Tool`（授权）· `Token Validity Query Tool`（token 有效期）·
`API Debugging Tool`（在线调试）· **`Signature Tool`（签名计算，用来校验本地实现的签名）** ·
`API Permission Query Tool` · `API Log Investigation Tool` · `Message Log Investigation Tool`

---

## 三、凭证填写与签名调用

### 3.1 填写凭证

编辑 `joybuy_config.json`：

```json
{
  "appKey": "<应用 appKey>",
  "appSecret": "<应用 appSecret>",
  "accessToken": "",
  "refreshToken": "",
  "xid": "",
  "signMethod": "md5",
  "signQuoteQueryValues": false
}
```

拿到 token 后写入（会自动记录过期时间，token 有效期约 1 年 / 31536000 秒）：

```bash
node joybuy_api.js token --set <access_token> --refresh <refresh_token> --xid <xid>
```

- **自研商家（in-house）**：走「一键授权」，直接把返回的 token 写进去即可，**不需要回调地址**。
- **ISV / 软件服务商**：需在应用里配置 `redirectUri`，用授权码换 token：
  ```bash
  # 1) 引导商家登录授权（浏览器打开）
  #    http://jos-oauth.joybuy.com/oauth2/to_login?appKey=<appKey>&responseType=code&redirectUri=<redirectUri>&state=100&scope=snsapi_base
  #    登录后回调 URL 里取 code
  # 2) 换 token
  node joybuy_api.js exchange --code <authorizationCode>
  ```
- **自动刷新**：SDK 在每次调用前检查，剩余有效期不足 24 小时（`refreshAheadSeconds`）就自动调
  `https://jos-oauth.joybuy.com/oauth2/refresh_token`，刷新后回写 `joybuy_config.json`。

### 3.2 SDK 用法

```bash
# 签名自检（与官方文档示例逐字符比对，不联网）
node joybuy_api.js selftest

# 直接调接口
node joybuy_api.js call GET /sp-order/v0/orders --query '{"page":1,"pageSize":10}'
node joybuy_api.js call PUT /sp-order/v0/orders/300695175502/remarks --body '{"product":"Widget"}'
```

作为模块：

```js
const jb = require('./joybuy_api');
const r = await jb.call('GET', '/sp-product/v0/products', { query: { page: 1, pageSize: 100 } });
if (r.ok) console.log(r.data); else console.error(r.errors);
```

**签名规则**（已实现，3 种任选）：

| 方式 | 计算 | 附加请求头 |
|---|---|---|
| `md5`（默认） | `MD5(AppSecret + 拼接串 + AppSecret)` → 大写 | — |
| `hmacsha256` | 以 AppSecret 为 key 的 HmacSHA256 | `X-JOS-Sign-Method: hmacsha256` |
| `hmacmd5` | 以 AppSecret 为 key 的 HmacMD5 | `X-JOS-Sign-Method: hmacmd5` |

拼接串 = **路径参数 + query 参数 + body（紧凑 JSON）+ 3 个固定头**，按参数名 ASCII 升序（大写在小写前）依次拼 `名+值`。
固定头：`X-JOS-App-Key` / `X-JOS-Access-Token` / `X-JOS-Timestamp`（毫秒）。

> **一个取值分歧已做成开关**：官方文档里 MD5 示例的 query 值带双引号、HMAC 示例不带。
> 默认按「不带引号」实现；若平台 **Signature Tool** 校验不通过，把 `joybuy_config.json` 的
> `signQuoteQueryValues` 改成 `true` 即可（自检会同时校验两种形态）。

**响应格式**：
```json
{ "success": true,  "data": { } }
{ "success": false, "errorList": [{ "code": "99900130002", "message": "...", "details": "..." }] }
```
SDK 已归一成 `{ ok, status, data, errors, raw }`；`ok=false` 时 CLI 退出码为 1。

---

## 四、数据采集

### 4.1 开放平台 SP-API 能拿到什么

实测 `dsm.jdo.open.cms.api4home.listApiGroup` 返回**仅 5 个分组**，共 44 个接口：

| 分组 | 代表接口 | 用途 |
|---|---|---|
| **Order** | `listOrders` / `getOrder` / `listOrderOaidAddresses` / `sellerCancelOrder` / `uploadSelfInvoice` | 订单、取消、发票、运单 |
| **Product** | `listProducts` / `getProduct` / `listSkus` / `listSkuStocks` / `batchPutSkuStock` / `listProductApplies` | 商品、SKU、库存 |
| **Vender** | `listVenderShops` / `listVenderBrands` / `listVenderCategories` | 店铺、品牌、类目 |
| **Aftersales** | `listAfsOrders` / `getAfsOrder` / `patchAfsOrder` / `listAfsOrderLogs` | 售后单 |
| **Supply Chain** | 上述分组的聚合视图 | — |

网关：`https://api-cn.jd.com/rest/{路径}`（完整路径清单见 `joybuy_apipaths.json`，44 条）

### 4.2 ⚠️ 关键限制：**没有流量 / 加购 / 收藏接口**

开放平台的 5 个分组里**不存在**流量（UV/PV）、加购、商品收藏、转化分析类接口 ——
这是实测确认的事实（不是权限问题）。这三类指标只能来自 **JoyBuy 商家后台（partner.joybuy.com）的 Data Compass 报表**。

因此看板采用**双数据源**架构：

```
① 开放平台 SP-API   ──fetch_joybuy_api.js──▶   joybuy_api_data.json
                                                 （订单 / 商品 / SKU / 库存 / 售后）
                                                                        ├─▶ build_joybuy_dashboard.py ─▶ joybuy.html
② 商家后台 Data Compass ──joybuy_compass_fetch.js──▶ joybuy_compass_data.json
                                                 （流量 / 加购 / 收藏 / 渠道 / 搜索词）
```

看板顶部的「数据源」徽章会分别显示两路是否已接入，缺哪一路会给出提示。

**② 已实现全自动采集**（不再需要人工导报表）。
`joybuy_compass_fetch.js` 走商家后台的 DSM 网关直取数据，覆盖 **UK / DE / NL / FR 四站点**、默认近 120 天：

| 采集项 | 接口 | 覆盖指标 |
|---|---|---|
| `trafficTrend` | `dsm.compass.pop.traffic.queryTrend` | 店铺/商品 UV·PV、加购、会话时长、各转化率、人均浏览量 |
| `transactionTrend` | `dsm.compass.pop.transactions.queryTrend` | GMV、订单量、销售件数、客单价、取消率 |
| `productTrend` | `dsm.compass.pop.products.queryTrend` | 在售/有访/收藏/加购/活跃/缺货商品数 |
| `channels` | `…trafficAnalytics.detail`（`groupBy: searchChannels`） | 获客渠道来源 |
| `searchTerms` | `…trafficAnalytics.detail`（`groupBy: keywords`） | 客户实际搜索词 |
| `skuDetail` | `…productsAnalytics.detail`（`groupBy: skuIds`） | SKU 维度全套指标 |

> ⚠️ 三个必须知道的坑（详见技能 `joybuy-open-platform-api` §4）：
> ① 网关强制要求 `dsm-platform` / `dsm-site` 请求头，缺了返回 `code 312`，而这两个头**非 CORS 标准头，抓包看不到**；
> ② 单次查询跨度上限 **30 天**，超了报 `Parameter Error`，必须分段拉取后合并；
> ③ 明细接口口径是**混合**的 —— 流量类（含搜索词 `popKeywordPdpUv`）是**每日均值**需 ×天数，
> 交易类（订单/GMV/件数）**本身就是区间合计**不能乘，比率类按天数加权。

**兜底**：若接口路径失效，仍可退回人工导报表 —— `import_joybuy_traffic.js <报表.xlsx> --merge`
（解析规则见 4.3 末）。

### 4.3 采集命令

```bash
# ① 开放平台 SP-API
# 1) 试调每个接口一次，原始响应落到 joybuy_raw/（用来校准字段名）
node fetch_joybuy_api.js probe

# 2) 打印原始数据的字段结构（若与内置别名表不符，按输出调整 fetch_joybuy_api.js 的 ALIAS）
node fetch_joybuy_api.js fields

# 3) 正式采集（订单默认近 90 天）
node fetch_joybuy_api.js collect --days 90

# ② 商家后台 Data Compass（流量 / 加购 / 收藏 / 渠道 / 搜索词）
#    ✅ 正常情况【不需要浏览器、不需要登录】：先探活确认走哪条路
node joybuy_compass_fetch.js --probe
#      · 打印「✓ 会话有效 → 纯 HTTP 模式」→ 直接采集，别再启浏览器（会话文件长期有效）
#      · 打印「✗ 会话已失效 / 未找到会话文件」→ 才需要下面的保活 + 重新导出会话
node joybuy_browser.js --keep            # 仅上一种情况需要；人工登录一次后：
node joybuy_compass_fetch.js --save-session   # 导出会话（此后又回到纯 HTTP）
node joybuy_compass_fetch.js --shops UK,DE,NL,FR --days 120
#    单站点：--shops DE    探路/调参：--probe    验证不覆盖正式数据：--out _bak/x.json
#    ⚠️ 收尾必看「防串站自检」：各站 SKU 数应互不相同；失败说明切店铺没生效（退出码 4）

# ③ 兜底：人工导入商家后台流量报表（xlsx / csv 原样即可，无需改表头）
node import_joybuy_traffic.js <报表.xlsx> --merge
#    先拿模板对照列名：node import_joybuy_traffic.js --template
```

`joybuy_compass_fetch.js` 产出的 JSON 自带口径自检信息（`agg` / `segs` / `days`），
收尾必查三组等式：`Σ(SKU 订单) == 交易汇总订单`、`Σ(SKU GMV) == 交易汇总 GMV`、
`Σ(关键词 UV) ÷ Σ(站点 PDP UV)` 落在 **20%~40%**（长尾截断的合理区间），
**以及「防串站自检」**（见下节 4.5）。

`import_joybuy_traffic.js` 的表头识别规则（沿用本项目踩坑经验）：
多行表头容错（标题行 + 英文表头 + 中文表头）· **精确匹配优先、再包含匹配** · 每字段带**黑名单**
（`加购件数` 不会被 `加购转化率` 抢走、`收藏数` 不被 `收藏率` 抢走、`浏览量` 不被 `曝光量` 抢走、
`销售额` 不被 `退款金额` 抢走）· 全 0 行静默跳过 · 千分位与 `2026/09/06`、`2026-09-01 00:00:00` 等日期格式兼容。
`--merge` 为**同键（日期+SKU）覆盖取最新、其余保留**，可反复重传修正历史。

### 4.5 采集的两种取数模式（2026-10-02 起：优先免登录）

Data Compass 确实只能借道商家后台会话，但**不必每次都用浏览器** —— 它对本机的依赖其实只剩
「把 Cookie 带过去」这一层：那两个「抓包看不到、要钩 XHR 才能挖出」的自定义头
（`dsm-platform` / `dsm-site`）早已硬编码，不再需要浏览器探测。

| 模式 | 触发条件 | 需要浏览器/登录 | 说明 |
|---|---|---|---|
| `http-session` | `joybuy_compass_session.json` 存在且探活通过 | **不需要** | Node 原生 https 直连 DSM 网关 + cookie jar，日常默认走这条 |
| `cdp-browser` | 无会话文件 / 会话失效 / 显式 `--cdp` | 需要 | 借道已登录调试浏览器，页面上下文 fetch |

两种模式实测**逐项等价**（同参数 UK 30 天：三个趋势接口逐日全一致、`skuDetail` 均 9 条且 SKU 集合一致、
`skuWeekly` 31 格逐格一致、三个 summary 全一致）。走哪条路只要一条命令就能判定：

```bash
node joybuy_compass_fetch.js --probe     # 打印「✓ 会话有效 → 纯 HTTP 模式」即全程无需浏览器与登录
```

会话是一次性准备的，之后长期复用：

```bash
node joybuy_browser.js --keep                  # 人工登录一次
node joybuy_compass_fetch.js --save-session    # 导出 .joybuy.com 域 cookie（实测 12 条）
```

登录票据是长效的（`pin` 至 2027-10 / `__jda` 至 2027-03），所以正常每周采集都不需要登录。

**❗防串站自检 —— 因为这颗雷不报错，只出错数据**

`allShops:"0"`（当前店铺）存放在**服务端会话**里，由切店铺接口通过 **`Set-Cookie: b_belong`** 下发。
纯 HTTP 模式若用一成不变的 Cookie 头、不接收这个响应头，切换就**不生效**：
每个接口仍然 200、每站看起来都「有数据」、`trafficSummary` 之类汇总也正常，
**但四个站返回的是同一个站的数据**（实测 UK 请求拿到了 19 个 FR 的 SKU）。

因此采集收尾会打印各站 SKU 数并做两两比对，任意两站集合完全相同即判定串站 →
打印警告并以**退出码 4** 结束（宁可不出数，也不出错的数）。排查顺序：
① 纯 HTTP 模式是否收到了 `b_belong`；② 浏览器保活实例是否被并发会话杀掉。

> `joybuy_compass_session.json` 等同登录凭证（含 `pin` / `mfs_session` 等），**不要外传、不要放进 `_deploy/`**。

---

## 五、看板构建与发布

```bash
# 由两路 JSON 生成自包含 joybuy.html（Chart.js 内联，无外部依赖）
python build_joybuy_dashboard.py

# 指定输入输出（--compass=商家后台数据，--api=开放平台数据）
python build_joybuy_dashboard.py --compass joybuy_compass_data.json --api joybuy_api_data.json --out _deploy/joybuy.html

# 版式预览（用示例数据，页面顶部会有醒目红色「示例数据」横幅）
python _gen_joybuy_demo.py
python build_joybuy_dashboard.py --api _demo_joybuy_api.json --out _demo_joybuy.html --demo
```

**发布**：把 `_deploy/` 目录交给「发布为应用」工具，复用原 sandboxId，**链接不变**。

- 统一入口：`_deploy/index.html` 侧边栏新增 **JoyBuy** 分组 + 「JoyBuy 数据看板」导航项，
  `TABS` 增加 `joybuy: 'joybuy.html'`，支持 `#joybuy` hash 直达。
- 登录态、认证守卫、`cacheBust()` 版本号规则与亚马逊看板**完全一致**（`login.html` → `index.html`，无需改动认证链路）。

> **⚠️ 第一层：发布后有几十秒的不一致窗口**
> 这段时间内 `curl` 到的是旧副本，单开页面跑 e2e 也可能读到旧版（实测发布后立刻跑线上 e2e，
> trend 仍显示旧的 18 行 / 日明细 120 行；隔一分钟再跑才是新版的正确值）。
> 逐字节一致才算发布生效；若 `cmp` 不等，先等 30~60 秒重取，仍不等才是真问题。
>
> **⚠️⚠️ 第二层（更隐蔽）：CDN 是按「完整 URL」缓存的**（2026-09-28 踩到）
> 裸 `joybuy.html`、入口真正用的 `joybuy.html?v=<小时数>`、你临时加的 `joybuy.html?cb=<随机>`
> 是**三个互不相干的缓存条目**。而 `cacheBust()` 用 `Math.floor(Date.now()/3600000)`，
> **同一小时内重新发布不会换 URL** → 边缘照旧给旧版。
> 实测症状：源站明明已是新版（`?cb=` 取到 943,790 B），裸 URL 与 `?v=497390` 却双双返 899,950 B
> 旧版 —— 极易被误判成「发布没生效」然后去改正确的代码。所以验字节**必须带唯一 `?cb=`**：
> ```bash
> L=https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host
> curl -s -o _online.html "$L/joybuy.html?cb=$RANDOM$RANDOM" && cmp -s _online.html joybuy.html && echo SAME
> ```
> 浏览器侧还要**关掉磁盘缓存**：`Network.setCacheDisabled` + iframe 也改走 `?cb=` 导航，
> 否则读到的是磁盘里的旧 `?v=` 变体（B 段曾因此二次误判）。
> `test_joybuy_online.js` 这两处都已内置，改完必须重跑到 **22/22** 才算验收通过。

### 看板内容（7 个标签页 × 六维筛选）

**窗口口径：从「首个有数据的周」开始**

采集窗口是滚动 120 天（2026-09-28 构建的 `fetchRange` 为 2026-05-31 起），但商品 7 月才上架 ——
前面若干周四个站点**全部为 0**。这类「开头连续全 0」的周只会拉长趋势图 X 轴、
还容易被读成「流量一直为零」，因此构建时整体移除：

> ⚠️ 下表是 **2026-09-28 构建**的实测值，**每周重采都会往后挪**。
> 唯一权威来源是产物里的 `payload.trimmedWeeks` / `payload.weeks` / `payload.range`，**不要照抄本表**。

| 站点 | 从窗口内移除 | 起点变为 | 窗口内周数 |
|---|---|---|---|
| UK | W23~W26（4 周） | 2026-06-27（W27） | 14 |
| DE | W23~W31（9 周） | 2026-08-01（W32） | 9 |
| FR | W23~W31（9 周） | 2026-08-01（W32） | 9 |
| NL | W31~W32（2 周） | 2026-08-08（W33） | 8 |

- **只裁开头连续的那一段**：中间 / 尾部为 0 的周是真实的「这周没人来」，属于业务信息，必须保留。
- 后端 `trim_leading_empty_days()` 按站裁；`payload.weeks` = 各站裁剪后的**并集**
  （2026-09-28 构建为 **14 周，W27~W40**）；`payload.range` 对外只暴露裁剪后的实际窗口，
  原始采集范围另放 `payload.fetchRange`，裁剪明细放 `payload.trimmedWeeks`。
- 前端 `activeWeeks()` 再做一次**动态**收窄：以「除周数以外的全部筛选」为准，从第一个有数据的周开始。
  所以选 DE 时周筛选从 W32 起，选 UK 时从 W27 起，选「全部站点」才是全部 14 周。
  ⚠️ 它返回的是**从首个命中周直到窗口末尾的连续后缀**（不是离散集合），
  因此候选数 = 总周数 − 起点下标；下拉里还会再隐掉「该筛选下连 SKU 明细都没有」的周
  （`renderDD` 里 `uvMap[v] === undefined`），所以**下拉可见周数 ≤ 后缀周数**，两者别混着算。
- ⚠️ **`activeWeeks()` 是「排除周筛选」算的**，这是**故意的** —— 周数下拉的候选必须不受自身影响，
  否则选完一周后候选里就只剩那一周，没法继续多选。代价是它**不能**直接拿去画图。
- **画图/列表统一走 `visibleWeeks()` = `activeWeeks()` ∩「周数」筛选选中项**：
  趋势图 X 轴、周度汇总表、每日明细都改用它，做到「在周数下拉里选了哪几周，就只画哪几周」
  （未选周时 `visibleWeeks()` ≡ `activeWeeks()`，默认视图行为不变）。
  顶部的**「窗口」标签也跟着走**（`renderWinBadge()`），未筛选时仍是数据源全量窗口 ——
  否则会出现「图表已从 W32 起、顶部却写着 06-27」的自相矛盾。
- ⚠️ **`renderWinBadge()` 必须把首尾周的 `start/end` 再夹一次到 `PAYLOAD.range.startDate/endDate`**
  （2026-09-28 修）：周桶是周六~周五，**最后一个桶几乎总是在进行中**（自动化每周一 15:30 跑，
  当周才过到周一），它的 `end` 落在**未来** → 会写出「窗口 … ~ 2026-10-02」这种把覆盖期说长的标签，
  而数据其实只到 09-27。上一版恰好落在完整周（W39 止于 09-25）所以一直没暴露，
  **不修则每周一跑必然复现**；`test_joybuy_filter.js` 8g 段现在就是这条的回归哨兵。
- ⚠️ **「起点晚」提示改用 `rawCoverStart`（接口实际返回的第一天）判断**，不能用裁剪后的 `cover.start`：
  后者是裁剪边界（各站都落在某个周六），拿它比较会把 DE/FR 误报成「接口不返回更早日期」，
  而事实是接口返回了、那段全是 0 被裁掉了。现在只有 NL 会触发该提示
  （2026-09-28 构建是 07-30 起；**日期每周会挪，以 `payload.data.<站>.rawCoverStart` 为准**）。

**筛选面板（与亚马逊看板同款级联下拉）**：`国家` · `产品系列` · `产品名` · `套装` · `SKU` · `周数`

- **交互**：普通单击 = 单选替换；`Ctrl/⌘+单击` = 多选追加/取消；唯一选中项再点一次 = 取消回「全部」。
- **候选联动**：每个下拉的候选 = 满足**其余维度**的行里出现过的值；
  当前筛选下**已无数据的候选直接从列表隐藏**（不再只置灰）—— 置灰只是视觉弱化，选项里仍混着
  一堆点不动的空项，维度一多下拉就长得没法用。
- **隐藏计数**：被隐藏时面板底部标「已按当前筛选隐藏 N 项」，否则候选数莫名变少会被当成 bug。
- **附带收益**：候选收窄后**UI 上已经选不出「两个维度无交集」的组合**（如先选 UK，再想选只在 DE/FR/NL 卖的
  「激光模块」——它已经不在候选里了），因此不会出现「刚选的项被系统悄悄取消」。
  `pruneOther()` 与「自动取消 N 个已选项」提示保留作兜底（数据重采后商品下架、旧链接带失效值等）。
- **空数组语义**：`STORE = { site: [], series: [], name: [], bundle: [], sku: [], week: [] }` —— **空 = 全部**，不写 `'ALL'`。
- 后端**不再预计算 `ALL`**，多站点由前端 `mergeSites()` 合并（否则会出现「预计算 ALL」与「部分站点合并」两套口径）。

**指标分层（务必分清，页面已用「站点级」标签标注）**

| 层级 | 指标 | 受哪些筛选影响 |
|---|---|---|
| **SKU 级** | 商品访客数/浏览量 · 加购访客数/件数 · 订单量 · 件数 · 销售额 · 加购率 · 转化率 | 国家 / 系列 / 产品名 / 套装 / SKU / 周数 **全部** |
| **站点级** | 店铺访客数 / 浏览量 · 收藏商品数 · 加购商品数 | **只受** 国家 / 周数 |

> ⚠️ 「商品访客数 / 浏览量」是**各商品相加**，同一访客浏览多个商品会**重复计数**，
> 因此它比站点级的店铺访客数大（实测约 1.11~1.19 倍），换算出的加购率/转化率天然偏低。

> ⚠️ 下面几行里的**具体数字都是「2026-09-28 构建」的实测值**，每周重采会变；
> 判据请看产物（`payload`）而不是本文。表内数字只用来让人有个量级概念。

| 标签页 | 指标 |
|---|---|
| **概览趋势** | 订单量(柱) + 销售额(线) 双轴；流量/加购/收藏 四线；逐周明细（2026-09-28 构建为 14 周 W27~W40；单站会再按该站起点收窄，选周后只画选中的那几周） |
| **店铺流量** | 站点级：店铺访客数 / 浏览量趋势 + 周明细（人均浏览、转化率） |
| **商品 · 产品名** | 三层汇总：**8 个系列** / **21 个产品名** / **69 个 SKU**，各含商品访客数·浏览量、加购、订单、销售额、加购率、转化率 |
| **加购 · 收藏** | 加购率 = 加购访客数 ÷ 商品访客数；收藏率；加购+收藏转化 |
| **渠道来源** | 获客渠道商品访客数占比（区间合计）+ 渠道转化率 |
| **搜索词** | 客户实际搜索词 → 商品访客数（区间合计）+ 词均转化率；跨站点合并后 276 词 |
| **每日明细** | 逐日 店铺访客数 / 浏览量 · 加购 · 收藏 · 订单 · 销售额（全部站点 93 天 = 06-27~09-27；只列有效周内的日期） |

> **⚠️ 两个必须分清的「起点晚」**
>
> | 类型 | 含义 | 页面表现 |
> |---|---|---|
> | **商品上架日** | 早于此的商品 UV/加购/订单/销售额是**真实的 0**（商品还没上架） | 警示条「商品上架时间：…」+ 页脚 |
> | **店铺流量记录起点** | trend 接口会裁掉开头的全 0 天 → 「接口没返回」，推测当时本就为 0 | 警示条「店铺流量记录起点晚于窗口：…」 |
>
> **取证方式**：SKU 级明细各站起点差很多（UK W27 / DE W32 / NL W33 / FR W32），
> 而按周调 detail 接口 **18/18 周全部 success、无 err** —— 说明更早周次接口只是不返回行。
> 拿站点级 `productTrend.popOnSaleProducts`（在售商品数）首日 > 0 的日期交叉验证：
> **UK 07-01↔W27 / DE 08-05↔W32 / NL 08-10↔W33 / FR 08-07↔W32，四站全部吻合到周内**
> ⇒ 判定为「商品未上架的真实 0」。构建时写入 `data[code].listedSince` 与 `skuFirstWeek`。
>
> ❗ **不能说成「无数据」** —— 那会让人以为漏采了真实流量（本项目第一版就是这么写错的，已纠正）。

**KPI 卡（固定 5 张 · 可下拉替换指标）**

原来把 12 个指标全平铺，首屏被占满、重点反而看不出来。现在**只显示 5 张**，
点卡片标题即可从 13 个指标里换任意一个；已被其他卡片占用的标「已显示」并置灰（避免重复），
面板底部有「恢复默认 5 项」。槽位状态在会话内保留，筛选变化不会重置。

默认 5 项：`订单量` · `销售额` · `销售件数` · `商品访客数` · `商品浏览量`

可替换的完整指标集（`kpiCatalog()`）：
订单量 · 销售额 · 销售件数 · 商品访客数 · 商品浏览量 · 加购访客数 · 加购件数 · 加购率 ·
转化率 · SKU 数 · 产品名数 · 收藏商品数 · 店铺访客数

**指标中文化口径**（页面不出现英文缩写）：

| 原写法 | 现写法 | 说明 |
|---|---|---|
| `UV` | 访客数 | 去重的「人」 |
| `PV` | 浏览量 | 含同一人重复浏览 |
| `PDP UV` | 商品访客数 | 各商品相加，同一访客看多商品会重复计数 |
| `PDP PV` | 商品浏览量 | 同上 |
| `店铺 UV / PV` | 店铺访客数 / 浏览量 | 站点级，不受产品维度筛选 |
| `加购 UV` | 加购访客数 | 与「加购件数」区分：一个是人，一个是件 |

**筛选**：六维级联下拉（国家/产品系列/产品名/套装/SKU/周数）+ 面板内关键字搜索 + 一键重置，KPI 与图表全部实时联动。

**周口径**：**周六 ~ 周五**为一周，周号取该周**周五**所在 ISO 周 —— 与亚马逊看板一致。

> ⚠️ **多站点多币种**：全部站点视图**不混算销售额**（UK 为 GBP、DE/NL/FR 为 EUR），
> 只汇总无币种的量（UV/PV/加购/收藏/订单数/件数），金额按币种分行展示。
> 渠道与搜索词的转化率跨站点合并时按 **PDP UV 加权**（`Σ(crᵢ×uvᵢ)/Σuvᵢ`），不取 max。

---

## 六、文件清单

| 文件 | 作用 |
|---|---|
| `joybuy_config.json` | 凭证与运行配置（appKey/appSecret/token/签名方式） |
| `joybuy_api.js` | **签名 SDK**：3 种签名、4 个固定头、token 自动刷新、API 调用封装、`selftest` |
| `fetch_joybuy_api.js` | 数据采集：`probe` / `fields` / `collect`，输出 `joybuy_api_data.json` |
| **`joybuy_compass_fetch.js`** | **商家后台 Data Compass 采集**（DSM 网关直取）：流量/加购/收藏/渠道/搜索词，4 站点 × 120 天 → `joybuy_compass_data.json`；**优先纯 HTTP（免登录），会话失效才回退浏览器**；内置三等式 + 防串站自检 |
| `joybuy_compass_session.json` | **会话文件（等同登录凭证，勿外传）**：`.joybuy.com` 域 cookie，由 `--save-session` 从调试浏览器导出，供纯 HTTP 模式复用 |
| `joybuy_compass_data.json` | Data Compass 产出（约 1.2 MB，含 `skuWeekly` 明细，不再另有 `ALL` 预计算） |
| `import_joybuy_traffic.js` | **兜底**：商家后台流量报表导入（xlsx/csv）→ `joybuy_traffic_data.json` |
| `build_joybuy_dashboard.py` | 合并两路数据 → `joybuy.html`（`--compass` / `--api` / `--out`） |
| `joybuy_template.html` | 看板模板（7 标签页 × 六维筛选 · KPI 5 槽位可替换 · 指标中文；占位符 `__PAYLOAD__` / `__CHARTJS__`） |
| `joybuy.html` | 构建产物（部署到 `_deploy/`） |
| `joybuy_browser.js` | JoyBuy 调试浏览器（独立 profile，CDP 9333）；**仅会话失效时才需要** |
| `joybuy_apipaths.json` | 实测导出的 44 个 API 路径清单 |
| `joybuy_apilist.txt` | 各分组的接口名 + 路径 + 简述 |
| `_gen_joybuy_demo.py` | 生成示例数据（仅版式预览，不进生产链路） |
| `test_joybuy_traffic.js` | 流量导入器回归（**22/22**） |
| `test_joybuy_dashboard.js` | 看板渲染回归（**30/30**，demo 版 + 骨架版） |
| **`build_joybuy_sku_map.py`** | **SKU → 产品系列 / 产品名 规则映射器**（`--check` 体检 / `--review` 导出待确认清单） |
| `joybuy_sku_map.json` | 映射产出：69 SKU → 8 系列 → 21 产品名 + `bundleOrder` 套装维度（含 `overrides` 人工覆盖位） |
| `_sku_review.csv` | 待人工确认的 SKU（当前为空 —— X1L 已按业务确认并入 X1 Lite） |
| `test_joybuy_portal.js` | 统一入口集成回归（**17/17**） |
| **`test_joybuy_filter.js`** | **六维筛选逻辑回归（86/86）**：下拉可点开、级联收窄、套装维度、KPI 5 槽位可替换、指标中文化、无数据项隐藏、周筛选、**窗口起点收紧（8f）**、**周筛选驱动图表 X 轴 / 周度表 / 日明细 +「窗口」标签跟随（8g）**、空集兜底、重置、Ctrl 多选、口径警示条。**断言全部「数据感知」—— 期望值从产物内嵌 `PAYLOAD` 自算，不写死业务数字**（见下） |
| **`test_joybuy_entry_e2e.js`** | 统一入口**端到端**回归（外壳→页签→iframe，**19/19**，含 5 张 KPI 卡片与 7 页签内容扫描） |
| **`test_joybuy_online.js`** | **线上发布验收（22/22）**：A 段线上 `joybuy.html` 与本地**逐字节比对**（含缓存窗口重试 4×15s）；B 段走真实入口验功能值，并断言 **图表 X 轴周数 == 周度表行数 == 周数候选数**、日明细 ≈ 周数×7、零 JS 报错。退出码非 0 表示未验收通过 |

---

## 七、回归测试

```bash
# 签名实现（不联网）
node joybuy_api.js selftest                       # 9/9

# 流量报表导入器
node test_joybuy_traffic.js                       # 22/22

# 看板渲染（需先构建 demo 版与骨架版）
node test_joybuy_dashboard.js                     # 30/30
BASE=https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host node test_joybuy_dashboard.js   # 线上双跑

# 统一入口集成
node test_joybuy_portal.js                        # 17/17
BASE=<线上地址> node test_joybuy_portal.js

# 统一入口端到端（外壳 index.html → JoyBuy 页签 → iframe 内看板，浏览器真跑一遍）
# 需两个前置：cd _deploy && python -m http.server 8917 --bind 127.0.0.1
#             node joybuy_browser.js --keep   （CDP 9333）
# 注：页面级测试（entry_e2e / filter / online）要真实浏览器渲染，所以仍需 CDP 9333；
#     这与「采集可用纯 HTTP 免登录」是两回事 —— 别因为采集不用登录就省掉这一步。
#     ❗所谓「常驻」保活实例也会死（2026-10-12 实测：9333 无监听、无 msedge 进程，来自 09-28 的实例已消失）
#     → 跑任何 JoyBuy 测试前先 `netstat -ano | grep 9333`，不通就先 `--keep` 重起、**等约 20s 确认 LISTENING** 再跑；
#       否则报 `connect ECONNREFUSED 127.0.0.1:9333`，别误判成代码坏了。
node test_joybuy_entry_e2e.js                     # 19/19
# 只桩掉 Supabase 会话校验（外壳会异步校验，无真实登录态会跳登录页），其余走真实文件
node test_joybuy_entry_e2e.js https://3577d1e878e64dc5837e56f9471dcefc.app.workbuddy.host/

# 六维筛选逻辑（需 joybuy_browser.js 保活；真实点 .dd-btn，能暴露内联 onclick 作用域问题）
node test_joybuy_filter.js                       # 86/86（原 _jb_f_test.js，已并入 test_joybuy_* 家族）
# ⚠️ 预期项数 = 86，但**期望值不是写死的**：脚本会先解出 joybuy.html 内嵌的 PAYLOAD，
#    再按复刻的前端口径自算（周数/SKU 数/订单/销售额/窗口日期…）。数据重采后**不该再红**。
# 覆盖 8f：窗口从首个有数据的周开始（== payload 复算的可见周；选 DE 起点必须后移、起点前的周必须消失）

# 线上发布验收（发布后必跑；需 joybuy_browser.js 保活）
node test_joybuy_online.js                       # 22/22
node test_joybuy_online.js --skip-bytes          # 只验功能值，跳过字节比对
# ⚠️ 两层缓存：① 发布后有几十秒 CDN 不一致窗口（读到旧版，A 段已内置重试）；
#    ② CDN 按「完整 URL」缓存 —— 裸 URL / 入口用的 ?v=<小时数> / 你加的 ?cb= 是三个变体，
#       且同一小时内重发不换 URL。所以 A 段**必须带唯一 ?cb=**、B 段必须 setCacheDisabled + iframe 走 ?cb=。
#       别拿裸 URL 下结论，更别把缓存当成 bug 去改代码。

# 亚马逊看板未被破坏（需 http.server 8899 从 _deploy 启动）
node verify_filters3.js                           # 全 PASS
```

---

## 七点五、SKU → 产品系列 / 产品名 / 套装 映射

`build_joybuy_sku_map.py` 按 **SKU 名称 + 规格色** 用规则推导，产出 `joybuy_sku_map.json`：

```
69 个 SKU  →  8 个产品系列  →  21 个产品名  ×  3 种套装
```
> ⚠️ 本节所有**具体数字均为「2026-09-28 构建」实测值**，新增/下架 SKU 就会变；
> 权威来源是产物（`payload.skuMap` / `payload.seriesOrder` / `payload.catalogSeries`）与 `joybuy_sku_map.json`。

**产品名 = 系列 + 功率/关键配置**（滤芯型号也进名字，因为它是不同商品）；
**套装/配件组合不进产品名**，单独抽成 `bundle` 维度 —— 这样同一功率的单机与套装能干净汇总。

| 产品系列 | 产品名数 | SKU 数 | 覆盖站点 |
|---|---|---|---|
| X1 | 3（20W / 40W / 60W） | 12 | UK / DE / NL / FR |
| X1 Lite | 4（X1 Lite / 20W / 40W / 60W；含原 X1L 并入） | 13 | UK / DE / NL / FR |
| E1 | 2（10W / 20W） | 6 | DE / NL / FR |
| Air Purifier | 6（主机 + 5 种滤芯） | 19 | UK / DE / NL / FR |
| Honeycomb Table | 1 | 3 | UK / DE / FR |
| Laser Module | 3（20W / 40W / 60W） | 9 | DE / NL / FR |
| Starter Kit | 1（材料包） | 4 | UK / DE / NL / FR |
| Vacuum Cleaner | 1 | 3 | DE / NL / FR |
| **合计** | **21** | **69** | — |

**套装维度 `BUNDLE_ORDER`**（payload 里的 `bundleOrder` 给出固定顺序）：

| 套装 | (SKU×站点) 对数 | 说明 |
|---|---|---|
| `标配` | 64 | 后台规格未区分套装（**不代表不含 Air Assist**，页脚已写明） |
| `Air Assist` | 3 | DE 站 |
| `Air Assist+蜂窝板+旋转轴` | 2 | DE 站 |

> ⚠️ 套装是**挂在 (SKU, 站点) 对**上的（`payload.data.<站>.skuWeeks[].bundle`），
> **不是** `skuMap` 的字段 —— 拿 `joybuy_sku_map.json` 去统计套装会得到「全部是标配」的错结论。

> ⚠️ **套装只认后台的 `color`（规格/变体名）**，不看商品名 ——
> 商品名里几乎每台都写 `with Air Assist`，拿 name 判会让所有机器都变成 Air Assist，维度就失去区分度。
> 只有 `color` 没带信息时才退回 name，且只认「真配件」（蜂窝板 / 旋转轴）。

### 人工结论（2026-09-26 业务确认）

**DE 站 `Aliencell X1L closed diode laser engraver ... 26 × 21 inch` 并入 X1 Lite 系列。**

> 佐证：X1 Lite 自己的文案就不一致 —— UK 写 `26 * 21" Bed Size`、DE/FR 写 `610 × 465 mm working area`，
> 所以 `26 × 21 in` 并非 X1L 独有；两条 listing 的配件描述也互相混用。
> X1L 的原始系列名仍记在每条 SKU 的 `srcSeries` 字段里，随时可回溯。
> 注意 X1L 的 listing 写的是 `20 W/40 W/60 W`（含 60W），合并后 **X1 Lite 因此多出 60W 一档**。

**判定优先级**：`材料套装` → `空气净化器`（主机/滤芯）→ `蜂窝台` → `吸尘器` → `激光模块` → `整机`（E1 → X1 Lite → X1）。

> ⚠️ **踩过的坑**：判 X1L **不能**用 `'x1 l' in name` —— UK 的 X1 商品名是
> `Aliencell X1 Laser Engraver...`，小写后含 `x1 l`（来自 `X1 Laser`），
> 会把 3 个 UK 的 X1 SKU 误判成 X1L。必须用**词边界** `re.search(r'\bx1l\b', n)`。

**人工覆盖**：`overrides` 按 `skuId → {series, name, bundle}` 优先于规则，改完重跑脚本即可（规则会保留 overrides）。

---

## 八、排障

| 现象 | 原因 / 处理 |
|---|---|
| `token 不可用且无 refreshToken` | 还没完成一键授权。先把 token 写进 `joybuy_config.json`（见 §3.1） |
| `99900130002 Invalid signature` | 签名不匹配。用 Console 的 **Signature Tool** 对同一组参数比对；若平台侧带引号，把 `signQuoteQueryValues` 改为 `true` |
| `42501` / 权限相关错误 | appKey 未申请对应 API 权限包，或应用未发布。去 Console 的 `API Permission Query Tool` 查 |
| 采集回来 `orders` 为空 | 字段名与内置别名表不一致 → 先 `probe`，再 `fields`，按输出调整 `fetch_joybuy_api.js` 的 `ALIAS` |
| 看板流量/加购/收藏全 0 | 这两路数据来自商家后台报表，需 `import_joybuy_traffic.js` 导入；开放平台没有这些接口 |
| 表格显示「当前筛选无数据」 | 周筛选与 SKU 搜索条件无交集，点「重置筛选」 |
| 线上看到的还是旧版 | CDN 边缘缓存，**且按「完整 URL」分变体缓存**：裸 `joybuy.html`、入口用的 `joybuy.html?v=<小时数>`、临时 `?cb=` 是**三个条目**；`cacheBust()` 按小时取值 → **同一小时内重发不换 URL**，边缘照旧给旧版。核验**必须带唯一 `?cb=`**（浏览器侧再 `setCacheDisabled`），别拿裸 URL 下结论、更别去改代码 |
| **四个站的数据一模一样（尤其 SKU 集合）** | 「切店铺」没生效。`allShops:"0"`（当前店铺）存在**服务端会话**里，由 museaccount 切店铺接口用 **`Set-Cookie: b_belong`** 下发；纯 HTTP 模式若用固定 Cookie 头、丢弃响应头就会命中 —— 接口全 200、每站都"有数据"、summary 也正常，**只有 SKU 集合能暴露它**（实测 UK 请求拿到 19 个 FR 的 SKU）。已内置**防串站自检**（各站 SKU 集合不得相同，失败以退出码 4 结束）。排查：① 纯 HTTP 是否收到 `b_belong`；② 浏览器保活实例是否被并发会话杀掉 |
| 线上「窗口」标签比数据多说了一周（如 `~ 2026-10-02` 而数据只到 09-27） | 末周是**进行中的半周**，`renderWinBadge()` 直接取了末桶的 `end`。已修为夹到 `PAYLOAD.range.startDate/endDate`；若复发先查该夹取是否被改掉 |
| **下拉点了没反应** | 模板逻辑全在 IIFE + `'use strict'` 内，内联 `onclick/oninput` 只能访问**全局名**。新增交互函数必须 `window.xxx = xxx` 显式挂载（症状：`toggleDD is not defined`，且搜索框静默失效） |
| **表头出现 `<span ...>` 字面量** | `tableHtml()` 对列名统一 `esc()`。需要内嵌标签的列必须标 `raw: 1` |
| **某站早期周次全是 0** | 现在已不会出现：构建时 `trim_leading_empty_days()` 会把开头**连续全 0** 的周整体移除（2026-09-28 构建：UK 去 4 周 / DE·FR 各去 9 周 / NL 去 2 周 —— **数值每周会变，以 `payload.trimmedWeeks` 为准**），窗口起点后移到首个有数据的周；单站视图再由前端 `activeWeeks()` 按该站自己的起点收窄。若重采后又冒出来，检查 `week_has_data()` 的判定键是否覆盖了新加的指标。判定口径分两种，**都不能说成「无数据」**：① **商品上架日**（UK 07-01 / DE 08-05 / FR 08-07 / NL 08-10）之前 —— 商品指标是**真实的 0**（商品还没上架）；② **店铺流量记录起点**（2026-09-28 构建为 NL 自 07-30；取 `payload.data.<站>.rawCoverStart`）—— 只是「接口没返回」，推测本就为 0。页面已分两条警示条标出 |

---

## 九、日常更新流程（已跑通，照抄即可）

```bash
# 0) 先探活，决定要不要浏览器（正常情况都不用）
node joybuy_compass_fetch.js --probe
#    · ✓ 会话有效 → 纯 HTTP 模式，直接跳到第 1 步（零浏览器、零登录）
#    · ✗ 会话失效 / 未找到会话文件 → 才需要保活 + 人工登录一次 + 重新导出会话：
#        node joybuy_browser.js --keep            # 另开终端/后台任务，否则 Edge 被回收后 CDP 端口 ECONNREFUSED
#        node joybuy_compass_fetch.js --save-session

# 1) 开放平台 SP-API：订单 / 商品 / SKU / 库存 / 售后
node fetch_joybuy_api.js collect --days 90

# 2) 商家后台 Data Compass：流量 / 加购 / 收藏 / 渠道 / 搜索词
node joybuy_compass_fetch.js --shops UK,DE,NL,FR --days 120
#    ⚠️ 看收尾的「防串站自检」：各站 SKU 数应互不相同，失败=切店铺没生效（退出码 4）

# 3) 收尾自检（必做，防口径错）
#    Σ(SKU 订单) == 交易汇总订单 · Σ(SKU GMV) == 交易汇总 GMV
#    Σ(关键词 UV) ÷ Σ(站点 PDP UV) 落在 20%~40%

# 4) 重建看板（窗口起点会自动后移到「首个有数据的周」，不用手工改日期）
python build_joybuy_dashboard.py

# 4.5) 新增/变更 SKU 时，先刷新 SKU → 产品名映射（否则新 SKU 会落到「未分类」）
python build_joybuy_sku_map.py --check     # 只体检、不写文件
python build_joybuy_sku_map.py             # 重写 joybuy_sku_map.json + _sku_review.csv
#    ⚠️ --check 只报「规则未命中」，漏掉的新 SKU 查不出来 —— 必须再按 **(skuId, 站点) 对**核对覆盖率
#       （已连续三次 09-28 / 10-05 / 10-12 实测漏报）正确姿势：把 skuMap[].site[] 展开、去重成
#        (skuId, 站点) 对集合，再与每站 skuDetail.data[].skuId 逐对比；
#        **不能只看 skuMap 条目数** —— 同一 skuId 铺多站点只算 1 条条目，条目数相等也可能漏站点。

# 4.8) 本地双回归（发布前先跑，别把回归留到线上才发现）
node test_joybuy_filter.js                         # 86/86（期望值从产物自算，数据变了也**不用改断言**）
node test_joybuy_entry_e2e.js                      # 19/19
#    ⚠️ filter 的 86 项是写死的**数量**、期望值是**算**的 —— 数量对不上才是真回归

# 5) 同步到部署目录并发布（复用 sandboxId，链接不变）
cp joybuy.html _deploy/joybuy.html
#    → 用「发布为应用」发布 _deploy 目录
#    ⚠️ 自动化会话里这个工具**可用性不稳定**：2026-09-28 实测 not available，但 **10-05 / 10-12 连续两次可用**
#       → 到这一步**先 ToolSearch 试一次**（查到 schema 再用 DeferExecuteTool 调用），成功即发布；
#         确实拿不到才交交互会话补做，并在汇报里如实写「线上发布待人工确认」，不要预先跳过。

# 6) 线上发布验收（必做 ——「发布成功」≠「线上已是新版」）
node test_joybuy_online.js                        # 22/22；A 段比字节，B 段验功能值
#    ⚠️ A 段内部已带唯一 ?cb= 取字节、B 段已 setCacheDisabled + iframe 走 ?cb=，别手动改成裸 URL
```

**Token 失效时**重新授权写入：`node joybuy_api.js token --set <access_token> --refresh <refresh_token> --xid <xid>`

### 定时自动化（已上线）

| 项 | 值 |
|---|---|
| 任务名 | JoyBuy 数据看板每周自动更新（采集→构建→发布·周一15:30） |
| 任务 ID | `8dcc5b19-2da3-42d6-b1f0-d4937dcb28e6` |
| 频率 | 每周一 15:30（**错开**同日的广告周度 / 产品周汇总两个 15:00 任务，避免三者同时跑采集+构建抢资源） |
| 覆盖步骤 | **探活 `--probe`（✓ 则免登录纯 HTTP；✗ 才保活 CDP 9333 并 `--save-session` 续期）** → SP-API 采集 → Data Compass 采集（**查防串站自检**）→ SKU 映射体检 → 重建看板 → 双回归（**filter 86/86 + entry_e2e 19/19**）→ 同步 `_deploy` → 发布（复用 sandboxId，链接不变）→ **线上验收 `test_joybuy_online.js`（22/22，含字节比对）** |
| ⚠️ 已知卡点 | **自动化会话里 `workbuddy_sites_deploy` 可用性不稳定**：09-28 报 not available，**10-05 / 10-12 连续两次可用且发布成功**（复用同一 sandboxId，链接不变）→ 到步骤 7 **先 ToolSearch 试一次**，成功即发；确实不可用才交交互会话补做，补做后务必跑一次 `test_joybuy_online.js` |
| ⚠️ 测试前置 | `test_joybuy_filter.js` / `entry_e2e` / `online` **都依赖 CDP 9333**，且该「常驻」实例会随机器/会话结束而死（10-12 实测）→ **跑前先 `netstat \| grep 9333`**，不通就先后台 `node joybuy_browser.js --keep; sleep 5400` 并等约 20s 确认 LISTENING |
| 失败约定 | 登录态失效 / SP-API token 失效**不自动重试**，直接汇报要求人工介入；口径等式偏离先重跑一次采集，仍偏则在汇报首行标「【⚠更新失败】」 |

> 想改时间或暂停：直接说「把 JoyBuy 定时任务改到 X 点」/「暂停 JoyBuy 定时任务」即可，不必手改配置。

### 尚未做（需要时再提）

- **单站点视图大小写归类**：同一站点会返回 `laser` 与 `Laser` 两行（多数为大写那条 UV=0），
  目前**保留后台原始分组**；若要合并，改 `build_joybuy_dashboard.py` 的 `norm_keywords()` 按小写归并即可。
- **历史归档**：每次采集覆盖 `joybuy_compass_data.json`，如需留痕可加日期后缀另存。

### 附：技能与目录约定（2026-09-26 整理）

- **技能 `joybuy-open-platform-api` 已拆为分册**（当前 **v2.0.2**；v2.0.0 起主文件从 75 KB 降到 20 KB，按场景加载）：
  - `SKILL.md` —— 入口导航 + **6 条最高频红线** + 回归清单 + 定时自动化
  - `references/setup.md` —— §0–§2：接入开通 / X-JOS 签名 / token 刷新（约 23 KB，已接好就不用读）
  - `references/collect.md` —— §3–§4h：Data Compass 采集 / 按周分段 / 累加器播种坑 / 报表兜底（约 14 KB）
  - `references/dashboard.md` —— §5–§5c：统一入口 / SKU→产品名映射 / 六维筛选看板（约 20 KB）
  - **章节号（§0 / §4-d3 / §5c…）跨文件全局唯一**，正文里的「见 §4-d3」这类引用照旧可查。
  - 版本增量：v2.0.1 补 §7「双会话互杀浏览器」（排查 3 步 + 处置 2 种）；
    **v2.0.2 补 §6「『数据感知』≠『把当前值写死』」方法论 + §7「CDN 按完整 URL 缓存」「窗口标签半周陷阱」**。
- **项目根目录只留正式脚本**：`test_joybuy_*.js`、`verify_filters3.js` 及各采集 / 构建脚本。
  历史一次性探路脚本（**67 个 `_jb_*.js`**）已整体移入 `_archive/`，需要时可直接翻；
  技能重构前的单文件版本备份为 `_archive/skill_joybuy_v1.8.4_pre-split.md`。
- 自动化从 4 条减到 **3 条**（删掉已过审的「JoyBuy 应用审核状态巡检」PAUSED 任务）。
