# -*- coding: utf-8 -*-
"""需求②：UV / PV / PDP 等英文缩写全部改中文。
   需求③：筛选后本项无数据的候选 → 直接隐藏（原来是置灰）。
"""
import io, re
P = 'joybuy_template.html'
s = io.open(P, encoding='utf-8').read()
n = 0


def rep1(old, new, tag):
    """唯一锚点替换"""
    global s, n
    c = s.count(old)
    assert c == 1, '[%s] 锚点出现 %d 次（期望 1）' % (tag, c)
    s = s.replace(old, new)
    n += 1


def repall(old, new, tag):
    """全局替换，返回替换次数"""
    global s, n
    c = s.count(old)
    if c:
        s = s.replace(old, new)
        n += c
    print('   %-34s × %d' % (tag, c))
    return c


# ============ 需求③：无数据项直接隐藏 ============
rep1(
    """        if (kw && String(v).toLowerCase().indexOf(kw) < 0 && String(label).toLowerCase().indexOf(kw) < 0) return '';
        // 无数据（且未被选中）→ 置灰
        var dimmed = uvMap[v] === undefined && !selSet[v];
        var on = sel.length === 0 || selSet[v];
        return '<label class="dd-opt' + (on ? ' sel' : '') + (dimmed ? ' dim' : '') + '" onclick="pick(event,\\'' + dim + '\\',\\'' + esc(v) + '\\')">' +
          '<input type="checkbox"' + (on ? ' checked' : '') + (dimmed ? ' disabled' : '') + '>' +
          '<span class="opt-name">' + esc(label) + '</span>' +
          (sub ? '<span class="opt-sub">' + esc(sub) + '</span>' : '') + '</label>';
      }).join('');
      $(DIMS[dim].list).innerHTML = html || '<div class="note" style="padding:8px">无匹配项</div>';""",
    """        if (kw && String(v).toLowerCase().indexOf(kw) < 0 && String(label).toLowerCase().indexOf(kw) < 0) return '';
        // 当前（其余维度）筛选下本项已无数据 → **直接隐藏**，不再只置灰。
        // 原因：置灰只是视觉弱化，候选里仍混着一大堆选不动的空项，越筛越长。
        // 例外：本项已被选中时必须保留显示，否则用户没法点它取消
        //       （正常情况 pruneOther 会先把它清掉，这里只是兜底）。
        if (uvMap[v] === undefined && !selSet[v]) { hiddenN++; return ''; }
        var on = sel.length === 0 || selSet[v];
        return '<label class="dd-opt' + (on ? ' sel' : '') + '" onclick="pick(event,\\'' + dim + '\\',\\'' + esc(v) + '\\')">' +
          '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
          '<span class="opt-name">' + esc(label) + '</span>' +
          (sub ? '<span class="opt-sub">' + esc(sub) + '</span>' : '') + '</label>';
      }).join('');
      // 隐藏了就说一声，否则候选数突然变少会被当成 bug
      if (hiddenN) html += '<div class="dd-foot info">已按当前筛选隐藏 ' + hiddenN + ' 项（无数据）</div>';
      $(DIMS[dim].list).innerHTML = html || '<div class="note" style="padding:8px">无匹配项</div>';""",
    '隐藏无数据项')

rep1(
    """      var html = all.map(function (v) {
        var label = v, sub = '';""",
    """      var hiddenN = 0;
      var html = all.map(function (v) {
        var label = v, sub = '';""",
    'hiddenN 计数器')

# .dd-foot 的 info 变体（不可点的纯提示）
rep1(
    """  .dd-foot:hover{background:#f1f5f9;border-radius:6px}""",
    """  .dd-foot:hover{background:#f1f5f9;border-radius:6px}
  .dd-foot.info{cursor:default;color:var(--muted)}
  .dd-foot.info:hover{background:none}""",
    '.dd-foot.info')

# ============ 需求②：英文缩写 → 中文 ============
print('英文缩写替换（长串优先，避免子串互相吃掉）：')
# 顺序很关键：长串必须先替换，否则 `PDP UV` 会先把 `商品 PDP UV` 啃成 `商品 商品访客数`
repall('PDP UV / PV · 来自所选产品维度', '商品访客数 / 浏览量 · 来自所选产品维度', '图表副标题·商品流量')
repall('加购件数 / 加购 UV · 随筛选联动', '加购件数 / 加购访客数 · 随筛选联动', '图表副标题·加购趋势')
repall('PDP UV 占比 · 仅受「国家」影响', '商品访客数占比 · 仅受「国家」影响', '图表副标题·渠道')
repall('客户实际搜索词 → PDP UV · 仅受「国家」影响', '客户实际搜索词 → 商品访客数 · 仅受「国家」影响', '图表副标题·搜索词')
repall('PDP PV → 订单转化率', '浏览量 → 订单转化率', '表格列·关键词转化率')
repall('商品 PDP UV/PV', '商品访客数/浏览量', '页脚·商品指标')
repall('店铺 UV/PV、收藏商品数', '店铺访客数/浏览量、收藏商品数', '页脚/说明·站点级')
repall('商品 PDP UV', '商品访客数', '表格列/KPI·商品访客')
repall('商品 PDP PV', '商品浏览量', '表格列·商品浏览')
repall('店铺 UV', '店铺访客数', '表格列/图表·店铺访客')
repall('店铺 PV', '店铺浏览量', '表格列·店铺浏览')
repall('加购 UV', '加购访客数', '表格列/KPI·加购访客')
repall('PDP UV', '商品访客数', '其余 PDP UV')
repall('PDP PV', '商品浏览量', '其余 PDP PV')

# 兜底：确认没有漏网的 UV / PV 字面量
left = re.findall(r"['\"][^'\"]*\b(?:UV|PV|PDP)\b[^'\"]*['\"]", s)
left = [x for x in left if 'wb_' not in x]
if left:
    print('\n★ 仍有残留（需人工确认）：')
    for x in sorted(set(left)):
        print('   ', x)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('\n合计改动 %d 处' % n)
