#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
add_monthly_platform.py — 给「月度数据看板」加「🌐 平台」筛选（2026-10-13）

需求（用户 2026-10-13）：月度数据面板里引入了 JoyBuy 平台的数据，是否可以增加平台的筛选条件。

设计（刻意对齐 target.html 的平台维度 + 本看板已有的「销售店铺」实现）：
  · 平台是**行级字段** `plat`：'amazon' | 'joybuy'，**缺省 = amazon**（Amazon 行零迁移）。
  · 筛选器是**多选 Set**（与 销售店铺/地区/国家/ASIN/系列/品名 同一套 handleOptClick 机制），
    空集 = 全部平台；摘要文字「全部平台」（满足看板通用不变式：默认必须表达「全部」）。
  · JoyBuy 行由 `build_monthly_dashboards.py` 并入（带 plat:'joybuy' + 自带 series/name）。

⚠️ 三个会静默出错的点（都已在脚本里处理）：
  1. `rowMatch()` 的每个调用点都必须传 `plat: selPlatform` —— 漏传不会报错，只会让
     地区/国家/ASIN/系列/品名 的候选列表按「全部平台」算（选项多出/少掉）。
     本脚本一次性替换全部调用点（含 setAll / regionOptClick 里的两处）。
  2. `asinList` 必须 `filter(Boolean)`：JoyBuy 行没有 ASIN，否则下拉里会多一个空选项。
  3. `seriesList` 目前只由 Amazon ASIN 的映射派生 ⇒ 必须并入 JoyBuy 行自带的系列，
     否则 JoyBuy 产品在「产品系列」里根本选不到（同名系列如 X1 会自动合并）。

幂等：已打过补丁（含 MARKER）则跳过；备份在 .bak_platform/。
用法：python add_monthly_platform.py [模板文件]
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'monthly_dashboard_template.html')
MARKER = 'id="ddPlatform"'
BAK_DIR = os.path.join(HERE, '.bak_platform')


def must(html, anchor, name):
    if anchor not in html:
        raise SystemExit('❌ 锚点未命中[%s]：模板结构可能已变，请人工核对后再跑\n---\n%s' % (name, anchor[:200]))
    return True


def main():
    with open(TPL, 'r', encoding='utf-8') as f:
        html = f.read()

    if MARKER in html:
        print('已存在平台筛选（幂等跳过）：%s' % TPL)
        return

    os.makedirs(BAK_DIR, exist_ok=True)
    shutil.copy2(TPL, os.path.join(BAK_DIR, os.path.basename(TPL) + '.before_platform'))
    n = 0

    # ---------- ① 筛选栏：在「销售店铺」后插入「🌐 平台」 ----------
    a1 = '''      </div>
    </div>
    <div class="dd" id="ddMonth">'''
    must(html, a1, '①筛选栏插入点')
    platform_dd = '''      </div>
    </div>
    <div class="dd" id="ddPlatform">
      <button class="dd-btn" onclick="toggleDD('ddPlatform')">
        <span class="dd-label">🌐 平台</span>
        <span class="dd-summary" id="ddPlatformSummary">全部平台</span>
        <span class="dd-arrow">▼</span>
      </button>
      <div class="dd-panel">
        <div class="dd-tools">
          <button class="btn" onclick="setAll('platform',false)">看全部平台</button>
          <span class="dd-hint">单击=单选 · Ctrl=多选</span>
        </div>
        <div class="dd-list" id="ddPlatformList"></div>
      </div>
    </div>
    <div class="dd" id="ddMonth">'''
    html = html.replace(a1, platform_dd, 1); n += 1

    # ---------- ② 顶部副标题：点明口径含两平台 ----------
    a2 = '<div class="sub">业务报告 + 广告数据 · 自然月维度 · 更新:'
    must(html, a2, '②副标题')
    html = html.replace(
        a2, '<div class="sub">业务报告 + 广告数据 · 自然月维度 · 平台: Amazon + JoyBuy · 更新:', 1); n += 1

    # ---------- ③ 常量与取值函数（紧跟 channelOf 之后） ----------
    a3 = """function channelOf(r) { return (r && r.channel === 'woot') ? 'woot' : 'amazon'; }
let selChannel = new Set();"""
    must(html, a3, '③渠道常量')
    a3_new = """function channelOf(r) { return (r && r.channel === 'woot') ? 'woot' : 'amazon'; }
let selChannel = new Set();
// 平台(数据来源): 空集 = 全部平台。amazon = 亚马逊(易仓业务报告+广告+利润报表);
// joybuy = JoyBuy 站点(UK/DE/NL/FR, Data Compass 月度聚合; 无广告数据、无利润报表行 → 相关列显示 —)。
const PLATFORMS = [
  { id: 'amazon', label: '🅰️ Amazon' },
  { id: 'joybuy', label: '🛒 JoyBuy' },
];
const PLAT_CN = { amazon: '🅰️ Amazon', joybuy: '🛒 JoyBuy' };
function platOf(r) { return (r && r.plat === 'joybuy') ? 'joybuy' : 'amazon'; }
let selPlatform = new Set();"""
    must(html, a3, '③渠道常量')
    html = html.replace(a3, a3_new, 1); n += 1

    # ---------- ④ rowMatch 增加 plat 判定 ----------
    a4 = """  const { channel, region, country, asin, series, name } = opt || {};
  if (channel !== null && channel !== undefined) { if (channel.size && !channel.has(channelOf(r))) return false; }"""
    must(html, a4, '④rowMatch')
    a4_new = """  const { channel, plat, region, country, asin, series, name } = opt || {};
  if (channel !== null && channel !== undefined) { if (channel.size && !channel.has(channelOf(r))) return false; }
  if (plat !== null && plat !== undefined) { if (plat.size && !plat.has(platOf(r))) return false; }"""
    html = html.replace(a4, a4_new, 1); n += 1

    # ---------- ⑤ 所有 rowMatch 调用点补 plat（漏传 = 候选列表静默按全部平台算） ----------
    c_old = 'rowMatch(r, { channel: selChannel,'
    c_new = 'rowMatch(r, { channel: selChannel, plat: selPlatform,'
    cnt = html.count(c_old)
    if cnt < 8:
        raise SystemExit('❌ 预期至少 8 处 rowMatch 调用点，实际 %d 处 —— 结构已变，请人工核对' % cnt)
    html = html.replace(c_old, c_new); n += 1
    calls = cnt

    # ---------- ⑥ rowMeta: JoyBuy 行用自带系列/品名（否则落到「无」） ----------
    a6 = """function rowMeta(r) {
  if (r.asin === WOOT_ASIN) return { series: 'Woot', name: 'Woot 店铺活动' };
  if (!r.asin) return { series: '无', name: '无' };"""
    must(html, a6, '⑥rowMeta')
    a6_new = """function rowMeta(r) {
  if (r.asin === WOOT_ASIN) return { series: 'Woot', name: 'Woot 店铺活动' };
  // JoyBuy 行没有 ASIN，用行内自带的 系列/品名（映射表里查不到）
  if (platOf(r) === 'joybuy') return { series: r.series || '无', name: r.name || '无' };
  if (!r.asin) return { series: '无', name: '无' };"""
    html = html.replace(a6, a6_new, 1); n += 1

    # ---------- ⑦ asinList 去掉空 ASIN（JoyBuy 行无 ASIN，否则下拉多一个空选项） ----------
    a7 = 'const asinList = [...new Set(ROWS.map(r => r.asin))].sort();'
    must(html, a7, '⑦asinList')
    html = html.replace(a7, 'const asinList = [...new Set(ROWS.map(r => r.asin).filter(Boolean))].sort();', 1); n += 1

    # ---------- ⑧ seriesList 并入 JoyBuy 系列（否则 JoyBuy 产品在系列筛选里选不到） ----------
    a8 = "const seriesList = [...new Set(asinList.map(a => asinMetaOf(a).series))]"
    must(html, a8, '⑧seriesList')
    a8_new = ("const seriesList = [...new Set([...asinList.map(a => asinMetaOf(a).series),"
              " ...ROWS.filter(r => platOf(r) === 'joybuy').map(r => r.series || '无')])]")
    html = html.replace(a8, a8_new, 1); n += 1

    # ---------- ⑧b asinScope 跳过无 ASIN 行（JoyBuy），否则 Set 里混进 null ----------
    a8b = "  for (const r of ROWS) if (rowMatch(r, { channel: selChannel, plat: selPlatform, region: selRegion, country: selCountry, asin: null, series: selSeries, name: selName })) out.add(r.asin);"
    must(html, a8b, '⑧b asinScope')
    html = html.replace(
        a8b,
        "  // JoyBuy 行没有 ASIN ⇒ 跳过，否则 Set 里会混进 null/undefined\n"
        "  for (const r of ROWS) if (r.asin && rowMatch(r, { channel: selChannel, plat: selPlatform, region: selRegion, country: selCountry, asin: null, series: selSeries, name: selName })) out.add(r.asin);",
        1); n += 1

    # ---------- ⑨ setAll 支持 platform ----------    a9 = """function setAll(kind, v) {
  if (kind === 'channel') {
    selChannel.clear();
    if (v) CHANNELS.forEach(c => selChannel.add(c.id));
    renderAll();
    return;
  }"""
    must(html, a9, '⑨setAll')
    a9_new = a9 + """
  if (kind === 'platform') {
    selPlatform.clear();
    if (v) PLATFORMS.forEach(p => selPlatform.add(p.id));
    renderAll();
    return;
  }"""
    html = html.replace(a9, a9_new, 1); n += 1

    # ---------- ⑩ buildPlatformOptions + 挂进 renderAll ----------
    a10 = 'function handleOptClick(e, set, key) {'
    must(html, a10, '⑩buildPlatformOptions 插入点')
    platform_fn = """function buildPlatformOptions() {
  const list = document.getElementById('ddPlatformList');
  if (!list) return;
  const jbRows = ROWS.filter(r => platOf(r) === 'joybuy').length;
  const has = { amazon: true, joybuy: jbRows > 0 };
  list.innerHTML = PLATFORMS.map(p => {
    const sel = selPlatform.has(p.id) ? ' sel' : '';
    const ok = has[p.id];
    const oc = ok ? `handleOptClick(event, selPlatform, '${p.id}')` : 'void 0';
    const tag = ok ? (p.id === 'joybuy' ? `(${jbRows} 行)` : '') : '(当前无数据)';
    return `<div class="dd-opt${sel}${ok ? '' : ' dim'}" onclick="${oc}">
      <input type="checkbox" ${sel?'checked':''} ${ok?'':'disabled'} style="pointer-events:none">
      <span class="opt-name">${p.label}</span><span class="opt-sub">${tag}</span>
    </div>`;
  }).join('');
  const el = document.getElementById('ddPlatformSummary');
  if (el) el.textContent = (selPlatform.size === 0 || selPlatform.size === PLATFORMS.length)
    ? '全部平台' : [...selPlatform].map(x => PLAT_CN[x] || x).join(' + ');
}
"""
    html = html.replace(a10, platform_fn + a10, 1); n += 1

    a11 = """function renderAll() {
  pruneSelections();
  buildChannelOptions();"""
    must(html, a11, '⑪renderAll')
    html = html.replace(a11, """function renderAll() {
  pruneSelections();
  buildPlatformOptions();
  buildChannelOptions();""", 1); n += 1

    # ---------- ⑪b 广告占比在无广告数据时显示 —（与其它广告列一致） ----------
    # 原式只判 bizOk：单看 JoyBuy（有销售额、无广告）会显示 0.00%，而广告花费/ROAS/ACOS 都是 —
    # ⇒ 同一行自相矛盾，且与说明块「无广告数据时相关列显示 —」的承诺不符。
    a11b = "    case 'ad_share': return bizOk && a.sales > 0 ? a.adCost / a.sales * 100 : null;"
    must(html, a11b, '⑪b ad_share')
    html = html.replace(
        a11b,
        "    case 'ad_share': return adOk && a.sales > 0 ? a.adCost / a.sales * 100 : null;   // 2026-10-13: 加 adOk —— 无广告数据时该列应与其它广告列一致显示 —（原写 bizOk 会让 JoyBuy/无广告月显示 0.00%）",
        1); n += 1

    # ---------- ⑫ 说明块补 JoyBuy 平台口径 ----------    a12 = '''</details>
</div>

<div class="footer">Aliencell 月度数据看板'''
    must(html, a12, '⑫说明块')
    jb_note = '''<div class="note" style="margin-top:10px;border-top:1px dashed #e2e8f0;padding-top:8px"><b>🌐 平台筛选</b>（2026-10-13 新增）：<b>🅰️ Amazon</b> = 亚马逊 13 国（易仓业务报告 + 广告报表 + 利润报表）；<b>🛒 JoyBuy</b> = 京东欧洲四站（UK / DE / NL / FR，由 Data Compass 按自然月聚合，含站点流量、GMV、订单/件数）。默认「全部平台」= 两平台之和；«看全部平台» 按钮清空选择。<br>⚠️ <b>JoyBuy 没有广告数据、也没有利润报表行</b> ⇒ 「广告指标」「毛利指标」两组列以及费用占比列<b>只反映 Amazon</b>：单看 JoyBuy 时这些列显示 —；「全部平台」时它们等于 Amazon 的值（<b>不会被 JoyBuy 摊薄</b>），而<b>销售额 / 流量 / 订单 / 转化率</b>为两平台之和。另：JoyBuy 的「Sessions」口径是<b>商品页 UV（PDP UV）</b>，与 Amazon 的 Sessions 不完全等价，跨平台比转化率请留意；JoyBuy 产品行按「周与自然月重叠天数」等比分摊并校准到站点月合计 ⇒ 订单/件数可能带小数。<br>⚠️ <b>产品系列 / 产品名</b> 筛选：JoyBuy 行没有 ASIN，用的是其自带系列与品名（如 X1 / Laser Module / Air Purifier）；同名系列（如 X1）会与 Amazon 自动合并，因此选「X1」时两平台该系列的月份会一起汇总。选任一个 <b>ASIN</b> 时 JoyBuy 行会被排除（它没有 ASIN）。</div>
</details>
</div>

<div class="footer">Aliencell 月度数据看板'''
    html = html.replace(a12, jb_note, 1); n += 1

    with open(TPL, 'w', encoding='utf-8') as f:
        f.write(html)
    print('✅ 已给月度看板加平台筛选：%d 组改动 · rowMatch 调用点补 plat %d 处' % (n, calls))
    print('   备份：%s' % os.path.join(BAK_DIR, os.path.basename(TPL) + '.before_platform'))
    print('   ⚠️ 改的是模板 → 必须重跑 build_monthly_dashboards.py 重建 monthly.html')


if __name__ == '__main__':
    main()
