# -*- coding: utf-8 -*-
"""构建器：新增「商品上架日」与「SKU 明细起点周」，并纠正站点覆盖警告的措辞。

背景（2026-09-26 实测取证）
------------------------
SKU 级明细各站起点差很多（UK W27 / DE W32 / NL W33 / FR W32），而按周调 detail 接口
18/18 周全部 success、无 err —— 说明更早周次接口只是**不返回行**。
用站点级 `productTrend.popOnSaleProducts`（在售商品数）首日>0 的日期做交叉验证：

    UK 07-01 ↔ W27(06-27~07-03)   DE 08-05 ↔ W32(08-01~08-07)
    NL 08-10 ↔ W33(08-08~08-14)   FR 08-07 ↔ W32(08-01~08-07)

四站全部吻合到周内 ⇒ 更早周次商品指标为 0 是**真实的 0（商品尚未上架）**，
不是数据缺失。所以**不能**把它们标成「无数据」，而是要把「上架时间」讲出来。
"""
import io

P = 'build_joybuy_dashboard.py'
s = io.open(P, encoding='utf-8').read()
orig = s
n = 0


def rep(old, new, cnt=1, tag=''):
    global s, n
    c = s.count(old)
    assert c == cnt, '锚点[%s] 期望 %d 处，实际 %d' % (tag or old[:40], cnt, c)
    s = s.replace(old, new)
    n += 1


# ---------- 1) 新增 listed_since / sku_first_week ----------
rep("""def parse_shop(code, s):""",
    """def listed_since(s):
    \"\"\"商品上架日 = productTrend 里 popOnSaleProducts 首次 > 0 的日期。
    这是解释「为什么早期周次商品指标全是 0」的关键证据（见文件头）。\"\"\"
    rows = (s.get('productTrend') or {}).get('currentData') or []
    best = ''
    for r in rows:
        iso = d2iso(r.get('dt'))
        if iso and num(r.get('popOnSaleProducts')) > 0:
            if not best or iso < best:
                best = iso
    return best


def parse_shop(code, s):""",
    tag='listed_since')

# ---------- 2) data[code] 带 listedSince ----------
rep("""        _ds = sorted(days.keys())
        data[code] = dict(""",
    """        _ds = sorted(days.keys())
        _sw_weeks = sorted(set(c.get('week') or '' for c in (shops_raw[code].get('skuWeekly') or {}).get('cells') or []))
        data[code] = dict(
            listedSince=listed_since(shops_raw[code]),
            skuFirstWeek=(_sw_weeks[0] if _sw_weeks else ''),
            skuLastWeek=(_sw_weeks[-1] if _sw_weeks else ''),""",
    tag='data cover')

# ---------- 3) 改写覆盖警告（措辞纠正 + 补上架信息） ----------
rep("""    # 站点数据覆盖起止不一致时明确提示（后台趋势接口会裁掉开头的全 0 天）
    if days_all:
        w0 = days_all[0]
        late = [(c, data[c]['cover']) for c in sorted(data) if data[c]['cover']['start'] > w0]
        for c, cv in late:
            warnings.append('%s 站数据自 %s 起（全局窗口自 %s）—— 更早周次该站为「无数据」而非 0，'
                            '不要当成流量下滑' % (c, cv['start'], w0))""",
    """    # 站点数据覆盖起止不一致时明确提示。
    # ⚠️ 措辞要点：后台趋势接口会裁掉开头的全 0 天，所以「接口没返回」多半等于「当时本来就是 0」，
    #    **不能说成「无数据」** —— 那会让人以为漏采了真实流量（上一版就是这么写错的）。
    #    再叠加「商品上架日」交叉验证，就能把「早期商品指标为 0」解释到位。
    if days_all:
        w0 = days_all[0]
        for c in sorted(data):
            cv, d = data[c]['cover'], data[c]
            bits = []
            if cv['start'] > w0:
                bits.append('店铺流量记录自 %s 起（接口未返回更早日期，推测当时本就为 0）' % cv['start'])
            if d['listedSince'] and d['listedSince'] > w0:
                bits.append('**商品自 %s 上架**' % d['listedSince'])
            if bits:
                warnings.append('%s 站：' % c + '；'.join(bits) +
                                ' —— 早于上架日的周次，商品 UV/加购/订单/销售额为 0 属正常，不是数据缺失')""",
    tag='覆盖警告改写')

# ---------- 4) 终端打印带 上架/明细起点 ----------
rep("""        print('  [%s] 周数 %d ｜ 日数 %d (%s~%s) ｜ 订单 %g ｜ 件数 %g ｜ 店铺UV %g ｜ PDP UV %g ｜ 加购 %g ｜ 收藏 %g'
              % (code, len(d['weeks']), d['cover']['nDays'], d['cover']['start'], d['cover']['end'],
                 t['orders'], t['units'], t['uv'], t['pdpUv'], t['addToCart'], t['favorites']))""",
    """        print('  [%s] 周数 %d ｜ 日数 %d (%s~%s) ｜ 上架 %s ｜ SKU 明细 %s~%s ｜ 订单 %g ｜ 件数 %g ｜ 店铺UV %g ｜ PDP UV %g ｜ 加购 %g ｜ 收藏 %g'
              % (code, len(d['weeks']), d['cover']['nDays'], d['cover']['start'], d['cover']['end'],
                 d['listedSince'] or '—', d['skuFirstWeek'] or '—', d['skuLastWeek'] or '—',
                 t['orders'], t['units'], t['uv'], t['pdpUv'], t['addToCart'], t['favorites']))""",
    tag='终端打印')

assert s != orig
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('完成 %d 处修正' % n)
