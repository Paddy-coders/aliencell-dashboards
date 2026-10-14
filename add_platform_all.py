# -*- coding: utf-8 -*-
"""给 target_dashboard_template.html 增加「🌐 全部平台」并设为默认视图（幂等，可重跑）。

需求（用户 2026-10-12）：面板进去默认就展示所有的站点平台数据之和。
审计发现：daily/monthly/product/ad/joybuy 已全部默认「全部」，
只有 target 的平台下拉写死 selPlatform='amazon' ⇒ 进去只看到 Amazon。

口径：
  全部平台 = Amazon（含 Woot 并入后的 AMZ_ROWS）+ JoyBuy 行集；月份取并集。
  Amazon 行有目标 ⇒ 显示目标与完成率；JoyBuy 无目标 ⇒ 按「实际数据视图」并入（与单看 JoyBuy 一致）。
"""
import io
import sys

F = 'target_dashboard_template.html'
s = io.open(F, encoding='utf-8').read()
orig_len = len(s)
edits = []


def rep(old, new, name, count=1):
    global s
    n = s.count(old)
    if n == 0:
        if old in s:
            return
        raise SystemExit('❌ 锚点未命中: ' + name)
    if n != count:
        raise SystemExit('❌ 锚点 %s 命中 %d 次（期望 %d）' % (name, n, count))
    s = s.replace(old, new, count)
    edits.append(name)


# ---------- ① 平台枚举：新增「全部平台」置顶 ----------
rep("""const PLATFORMS = [
  { key:'amazon',     icon:'🅰️', label:'Amazon',  desc:'亚马逊 13 国' },""",
    """const PLATFORMS = [
  // 🌐 全部平台 = 所有站点/平台数据之和（默认视图，2026-10-12 新增）
  { key:'all',        icon:'🌐', label:'全部平台', desc:'Amazon（含 Woot）+ JoyBuy 合计' },
  { key:'amazon',     icon:'🅰️', label:'Amazon',  desc:'亚马逊 13 国' },""",
    '① PLATFORMS 增加 all')

rep("const PLATFORM_TX = { amazon:'Amazon', joybuy:'JoyBuy', aliexpress:'速卖通' };",
    "const PLATFORM_TX = { all:'全部平台', amazon:'Amazon', joybuy:'JoyBuy', aliexpress:'速卖通' };",
    '① PLATFORM_TX 增加 all')

rep("let selPlatform = 'amazon';",
    "let selPlatform = 'all';      // 默认=全部平台（所有站点平台数据之和）",
    '① 默认平台改为 all')

# ---------- ② PLAT_DATA 增加 all 占位（rows 在 Woot 并入后重建） ----------
rep("""const PLAT_DATA = {
  amazon:     { rows: AMZ_ROWS, months: AMZ_MONTHS, hasAds: true,  hasData: true, note: '' },""",
    """const PLAT_DATA = {
  // 🌐 全部平台：rows/months 必须等 Woot 并入 AMZ_ROWS 之后再拼（见 buildAllPlatform）
  all:        { rows: [], months: [], hasAds: true, hasData: true,
                note: '「全部平台」= 所有站点/平台数据之和：Amazon（含 Woot 并入）+ JoyBuy。Amazon 行显示目标与完成率；JoyBuy 暂无目标，按实际数据视图并入。' },
  amazon:     { rows: AMZ_ROWS, months: AMZ_MONTHS, hasAds: true,  hasData: true, note: '' },""",
    '② PLAT_DATA 增加 all')

rep("""let ROWS = PLAT_DATA.amazon.rows;
let MONTHS = PLAT_DATA.amazon.months;""",
    """let ROWS = [];      // 见下方 buildAllPlatform()（默认「全部平台」）
let MONTHS = [];""",
    '② ROWS/MONTHS 延后赋值')

# ---------- ③ Woot 并入后重建「全部平台」行集 ----------
rep("""
let monthBy = {}, regionSet = new Set(), allRegions = [], asinList = [], seriesList = [];""",
    """
// 「全部平台」行集/月份 = Amazon（Woot 已并入 AMZ_ROWS）+ JoyBuy 并集
(function buildAllPlatform(){
  PLAT_DATA.all.rows = AMZ_ROWS.concat(JBY_ROWS);
  const m = new Map();
  AMZ_MONTHS.forEach(x => m.set(x.ym, x));
  (JOYBUY.months || []).forEach(x => m.set(x.ym, x));
  PLAT_DATA.all.months = [...m.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1));
  ROWS = PLAT_DATA.all.rows; MONTHS = PLAT_DATA.all.months;
})();

let monthBy = {}, regionSet = new Set(), allRegions = [], asinList = [], seriesList = [];""",
    '③ buildAllPlatform')

# ---------- ④ platInScope 作用域判定 ----------
rep("""let monthBy = {}, regionSet = new Set(), allRegions = [], asinList = [], seriesList = [];""",
    """let monthBy = {}, regionSet = new Set(), allRegions = [], asinList = [], seriesList = [];
// 平台作用域：'all' 含全部平台；否则精确匹配
function platInScope(k) { return selPlatform === 'all' || k === selPlatform; }""",
    '④ platInScope')

# ---------- ⑤ 三处目标平台过滤改用 platInScope ----------
rep("if (tgtPlat(t) !== selPlatform) return;", "if (!platInScope(tgtPlat(t))) return;", '⑤ 目标过滤 ×3', count=3)

# ---------- ⑥ 平台下拉：目标数统计与副标题按 all 处理 ----------
rep("""    const nTgt = (TARGETS.targets || []).filter(t => tgtPlat(t) === p.key).length;
    const sub = p.key === 'amazon' ? (nTgt + ' 条目标')
      : (pd.hasData ? '数据 ' + pd.rows.length + ' 行' + (nTgt ? ' · 目标 ' + nTgt + ' 条' : ' · 暂无目标') : '待接入');""",
    """    const allT = (TARGETS.targets || []);
    const nTgt = allT.filter(t => p.key === 'all' ? true : tgtPlat(t) === p.key).length;
    const sub = p.key === 'all'
      ? (nTgt + ' 条目标 · Amazon + JoyBuy 合计')
      : p.key === 'amazon' ? (nTgt + ' 条目标')
      : (pd.hasData ? '数据 ' + pd.rows.length + ' 行' + (nTgt ? ' · 目标 ' + nTgt + ' 条' : ' · 暂无目标') : '待接入');""",
    '⑥ 平台下拉副标题')

# ---------- ⑦ renderTable：目标清单按作用域 ----------
rep("  const list = (TARGETS.targets || []).filter(t => tgtPlat(t) === selPlatform);",
    "  const list = (TARGETS.targets || []).filter(t => platInScope(tgtPlat(t)));",
    '⑦ 目标清单作用域')

# ---------- ⑧ 逐目标按其所属平台解析/取数 ----------
rep("""    const res = (selPlatform === 'amazon') ? resolveTarget(t) : resolveTargetJby(t);""",
    """    const tp = tgtPlat(t);                              // 逐目标所属平台（all 视图下混合）
    const res = (tp === 'amazon') ? resolveTarget(t) : resolveTargetJby(t);""",
    '⑧ 逐目标平台①')

rep("""    if (selPlatform === 'amazon') {
      if (selAsin.size || selSeries.size || selName.size) {""",
    """    if (tp === 'amazon') {
      if (selAsin.size || selSeries.size || selName.size) {""",
    '⑧ 逐目标平台②')

rep("""    const act = res.matched
      ? (selPlatform === 'amazon' ? actualFor(res, ym) : actualForJby(res, ym))""",
    """    const act = res.matched
      ? (tp === 'amazon' ? actualFor(res, ym) : actualForJby(res, ym))""",
    '⑧ 逐目标平台③')

rep("""    entries.push({ t, ym, mo, res, act });
  }
  }""",
    """    entries.push({ t, ym, mo, res, act, plat: tp });
  }
  if (selPlatform === 'all') {
    // JoyBuy 无目标行 ⇒ 在「全部平台」下按实际数据视图并入（口径与单看 JoyBuy 一致）
    for (const e of dataOnlyEntries(true)) {
      if (selMonth.size && !selMonth.has(e.ym)) continue;
      entries.push(e);
    }
  }
  }""",
    '⑧ entries 带 plat + 并入 JoyBuy 实际行')

# ---------- ⑨ dataOnlyEntries 支持只取 JoyBuy + 标注平台 ----------
rep("""function dataOnlyEntries() {
  const groups = new Map();
  for (const r of ROWS) {
    const m = rowMeta(r);""",
    """function dataOnlyEntries(onlyJby) {
  const groups = new Map();
  for (const r of ROWS) {
    if (onlyJby && !r.jby) continue;              // 「全部平台」下只并入 JoyBuy（Amazon 走目标行）
    const m = rowMeta(r);""",
    '⑨ dataOnlyEntries 入参')

rep("""      res: { product: g.name, ccs: new Set([regionOf(g.cc)]), matched: true, matchType: '实际数据',
             asins: new Set(), keys: new Set(), series: g.series, name: g.name, dataOnly: true },
      act: g,""",
    """      res: { product: g.name, ccs: new Set([regionOf(g.cc)]), matched: true, matchType: '实际数据',
             asins: new Set(), keys: new Set(), series: g.series, name: g.name, dataOnly: true },
      act: g,
      plat: onlyJby ? 'joybuy' : selPlatform,""",
    '⑨ dataOnlyEntries 标注平台')

# ---------- ⑩ 行渲染：地区列/流量副行按「该行所属平台」而非全局 ----------
rep("""    const ccRaw = (e.t.country || 'ALL').toUpperCase();
    const rc = regionOf(ccRaw);""",
    """    const ccRaw = (e.t.country || 'ALL').toUpperCase();
    const rc = regionOf(ccRaw);
    const ep = e.plat || tgtPlat(e.t);        // 该行所属平台（全部平台视图下行级混合）""",
    '⑩ 行级平台变量')

rep("""     : (selPlatform === 'amazon') ? (REGION_CN[rc] || rc) + ' ' + rc
      : (REGION_CN[rc] || rc) + ' · ' + ccRaw;""",
    """     : (ep === 'amazon') ? (REGION_CN[rc] || rc) + ' ' + rc
      : (REGION_CN[rc] || rc) + ' · ' + ccRaw;""",
    '⑩ 地区列按行平台')

rep("""    const uvSub = (selPlatform === 'amazon') ? ''""",
    """    const uvSub = (ep === 'amazon') ? ''""",
    '⑩ 流量副行按行平台')

io.open(F, 'w', encoding='utf-8', newline='').write(s)
print('✅ 补丁应用完成，共 %d 处：%s' % (len(edits), ', '.join(edits)))
print('   字符数 %d → %d' % (orig_len, len(s)))
