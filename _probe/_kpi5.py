# -*- coding: utf-8 -*-
"""需求①：KPI 卡片从 12 张平铺 → 固定 5 张，每张可下拉替换指标。
   需求②：顺带把 KPI 里的英文缩写改成中文。
"""
import io, sys
P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
n = 0


def rep(old, new, tag):
    global s, n
    c = s.count(old)
    assert c == 1, '[%s] 锚点出现 %d 次（期望 1）' % (tag, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) CSS：KPI 改 5 列固定栅格 + 卡片内下拉面板样式 ----------
rep(
    """  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin-bottom:12px}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);padding:11px 13px}
  .kpi .k{font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}""",
    """  /* KPI 固定 5 张（不再平铺全部指标）—— 每张的行内下拉可换成别的指标。
     窄屏逐级降列，避免卡片被压得看不清数值。 */
  .kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px;position:relative}
  @media(max-width:1080px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:640px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);padding:11px 13px;position:relative}
  .kpi.open{z-index:70}
  .kpi .k{font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* 卡片标题做成下拉触发按钮：看起来像标签，hover 才提示可点 */
  .kpi-head{display:flex;align-items:center;gap:4px;width:100%;background:none;border:0;padding:0 0 3px;
    font:inherit;cursor:pointer;text-align:left;color:inherit}
  .kpi-head:hover .k{color:var(--primary)}
  .kpi-head .k{flex:1;min-width:0}
  .kpi-head .caret{font-size:9px;color:var(--muted);flex:0 0 auto;transition:transform .15s}
  .kpi.open .kpi-head .caret{transform:rotate(180deg)}
  .kpi .dd-panel{min-width:100%;max-width:300px;max-height:290px;overflow-y:auto}
  .kpi:last-child .dd-panel{left:auto;right:0}
  .kpi.open .dd-panel{display:block}
  .dd-foot{margin-top:6px;padding:6px 8px;border-top:1px solid var(--border);font-size:11.5px;
    color:var(--primary);cursor:pointer;text-align:center}
  .dd-foot:hover{background:#f1f5f9;border-radius:6px}""",
    'CSS')

# ---------- 2) renderKpis：改指标注册表 + 5 槽位 ----------
old_kpi = """  /* ---------------- KPI ---------------- */
  function renderKpis() {
    var rows = curRows();
    var t = aggRows(rows);
    var sw = siteWeeksMerged();
    var wset = STORE.week.length ? STORE.week : null;
    var st = { favorites: 0, uv: 0, pv: 0 };
    sw.forEach(function (w) { if (!wset || wset.indexOf(w.key) >= 0) { st.favorites += w.favorites || 0; st.uv += w.uv || 0; st.pv += w.pv || 0; } });

    var wks = t.weeks.length;
    var defs = [
      { k: '订单量', v: fmtNum(t.orders), d: wks + ' 周 · ' + t.skuCount + ' SKU' },
      { k: '销售额', v: t.salesText, d: isMultiCur(t.byCur) ? '分币种，不混算' : (firstCur(t.byCur) || '—') },
      { k: '销售件数', v: fmtNum(t.units), d: t.aov ? ('客单价 ' + curSym(firstCur(t.byCur)) + fmtNum(t.aov, 2)) : '—' },
      { k: '商品 PDP UV', v: fmtNum(t.pdpUv), d: '各商品访客之和' },
      { k: '商品 PDP PV', v: fmtNum(t.pdpPv), d: '各商品浏览之和' },
      { k: '加购件数', v: fmtNum(t.addToCart), d: '加购 UV ' + fmtNum(t.atcUv) },
      { k: '加购率', v: pctTxt(t.atcRate), d: '加购 UV ÷ PDP UV' },
      { k: '转化率', v: pctTxt(t.convRate), d: '订单 ÷ PDP UV' },
      { k: 'SKU 数', v: fmtNum(t.skuCount), d: '筛选后命中' },
      { k: '产品名数', v: fmtNum(t.nameCount), d: t.seriesCount + ' 个系列' },
      { k: '收藏商品数', v: fmtNum(st.favorites), d: '站点级 · 不受产品维度筛选', cls: '', scoped: 1 },
      { k: '店铺 UV', v: fmtNum(st.uv), d: '站点级 · 不受产品维度筛选', scoped: 1 }
    ];
    $('kpis').innerHTML = defs.map(function (d) {
      return '<div class="kpi' + (d.scoped ? ' scoped' : '') + '"><div class="k">' + esc(d.k) + '</div>' +
        '<div class="v">' + d.v + '</div><div class="d ' + (d.cls || '') + '">' + esc(d.d) + '</div></div>';
    }).join('');
  }"""

new_kpi = """  /* ---------------- KPI（固定 5 张 · 可下拉替换指标） ----------------
     原来 12 张平铺会把首屏占满、重点指标被淹没。现在只显示 5 张，
     每张标题点开可换成任意其他指标。槽位状态在会话内保留（筛选变化不影响）。 */
  // 指标注册表：所有能放进 KPI 卡片的指标都在这里。以后加指标只改这个数组。
  function kpiCatalog(t, st) {
    return [
      { id: 'orders',    k: '订单量',     v: fmtNum(t.orders),    d: t.weeks.length + ' 周 · ' + t.skuCount + ' SKU' },
      { id: 'sales',     k: '销售额',     v: t.salesText,         d: isMultiCur(t.byCur) ? '分币种，不混算' : (firstCur(t.byCur) || '—') },
      { id: 'units',     k: '销售件数',   v: fmtNum(t.units),     d: t.aov ? ('客单价 ' + curSym(firstCur(t.byCur)) + fmtNum(t.aov, 2)) : '按当前筛选' },
      { id: 'pdpUv',     k: '商品访客数', v: fmtNum(t.pdpUv),     d: '各商品访客之和' },
      { id: 'pdpPv',     k: '商品浏览量', v: fmtNum(t.pdpPv),     d: '各商品浏览之和' },
      { id: 'atcUv',     k: '加购访客数', v: fmtNum(t.atcUv),     d: '看过商品并加购的访客' },
      { id: 'addToCart', k: '加购件数',   v: fmtNum(t.addToCart), d: '加购访客数 ' + fmtNum(t.atcUv) },
      { id: 'atcRate',   k: '加购率',     v: pctTxt(t.atcRate),   d: '加购访客数 ÷ 商品访客数' },
      { id: 'convRate',  k: '转化率',     v: pctTxt(t.convRate),  d: '订单量 ÷ 商品访客数' },
      { id: 'skuCount',  k: 'SKU 数',     v: fmtNum(t.skuCount),  d: '筛选后命中' },
      { id: 'nameCount', k: '产品名数',   v: fmtNum(t.nameCount), d: t.seriesCount + ' 个系列' },
      { id: 'favorites', k: '收藏商品数', v: fmtNum(st.favorites), d: '站点级 · 不受产品维度筛选', scoped: 1 },
      { id: 'shopUv',    k: '店铺访客数', v: fmtNum(st.uv),       d: '站点级 · 不受产品维度筛选', scoped: 1 }
    ];
  }

  var KPI_DEFAULT = ['orders', 'sales', 'units', 'pdpUv', 'pdpPv'];
  var KPI_SLOTS = KPI_DEFAULT.slice();

  function renderKpis() {
    var rows = curRows();
    var t = aggRows(rows);
    var sw = siteWeeksMerged();
    var wset = STORE.week.length ? STORE.week : null;
    var st = { favorites: 0, uv: 0, pv: 0 };
    sw.forEach(function (w) { if (!wset || wset.indexOf(w.key) >= 0) { st.favorites += w.favorites || 0; st.uv += w.uv || 0; st.pv += w.pv || 0; } });

    var cat = kpiCatalog(t, st);
    var byId = {};
    cat.forEach(function (m) { byId[m.id] = m; });
    var used = {};
    KPI_SLOTS.forEach(function (id) { used[id] = 1; });

    $('kpis').innerHTML = KPI_SLOTS.map(function (id, i) {
      var m = byId[id] || cat[0];
      // 面板列出全部指标；已被别的卡片占用的置灰（两张卡片显示同一指标没有意义）
      var opts = cat.map(function (x) {
        var busy = used[x.id] && x.id !== id;
        return '<label class="dd-opt' + (x.id === id ? ' sel' : '') + (busy ? ' dim' : '') + '"' +
          (busy ? '' : ' onclick="pickKpi(' + i + ',\\'' + x.id + '\\')"') + '>' +
          '<input type="checkbox"' + (x.id === id ? ' checked' : '') + (busy ? ' disabled' : '') + '>' +
          '<span class="opt-name">' + esc(x.k) + '</span>' +
          (busy ? '<span class="opt-sub">已显示</span>' : '') + '</label>';
      }).join('') + '<div class="dd-foot" onclick="resetKpi()">恢复默认 5 项</div>';

      return '<div class="kpi' + (m.scoped ? ' scoped' : '') + '" data-slot="' + i + '">' +
        '<button class="kpi-head" onclick="toggleKpiDD(' + i + ')">' +
        '<span class="k">' + esc(m.k) + '</span><i class="caret">▼</i></button>' +
        '<div class="v">' + m.v + '</div>' +
        '<div class="d">' + esc(m.d) + '</div>' +
        '<div class="dd-panel">' + opts + '</div>' +
        '</div>';
    }).join('');
  }

  /** 打开/关闭某张 KPI 卡片的指标选择面板 */
  window.toggleKpiDD = function (i) {
    var el = document.querySelector('.kpi[data-slot="' + i + '"]');
    if (!el) return;
    var was = el.classList.contains('open');
    closeKpiDD();
    if (!was) el.classList.add('open');
  };
  function closeKpiDD() {
    Array.prototype.forEach.call(document.querySelectorAll('.kpi.open'), function (x) { x.classList.remove('open'); });
  }
  /** 把第 i 张卡片换成指标 id */
  window.pickKpi = function (i, id) {
    var other = KPI_SLOTS.indexOf(id);
    if (other >= 0 && other !== i) return;   // 已被别的卡片占用
    KPI_SLOTS[i] = id;
    renderKpis();
  };
  window.resetKpi = function () {
    KPI_SLOTS = KPI_DEFAULT.slice();
    renderKpis();
  };"""
rep(old_kpi, new_kpi, 'renderKpis')

# ---------- 3) 点击空白处也要关掉 KPI 面板 ----------
rep(
    """  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.dd')) return;
    Object.keys(DIMS).forEach(function (d) { $(DIMS[d].el).classList.remove('open'); });
  });""",
    """  document.addEventListener('click', function (e) {
    if (!(e.target.closest && e.target.closest('.dd'))) {
      Object.keys(DIMS).forEach(function (d) { $(DIMS[d].el).classList.remove('open'); });
    }
    if (!(e.target.closest && e.target.closest('.kpi'))) closeKpiDD();
  });""",
    '外部点击关闭')

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('KPI 5 槽位改造完成，共 %d 处' % n)
