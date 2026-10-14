# -*- coding: utf-8 -*-
"""add_woot_cost_map.py —— Woot 产品成本/运费改为「经产品关系管理解析」(2026-10-13)

背景
  Woot 毛利 = 采购价 × 订单量 − 产品成本 × 订单量 − 运费 × 订单量 − Woot 广告费。
  原先「产品成本/运费」只认「Woot 数据管理 → 💵 Woot 成本设置」里逐 ASIN 手工录入的
  `pc_woot_cfg.cost`。该配置为空 ⇒ wootUnitCost() 返回 null ⇒ 看板上 Woot 行毛利一直是 —。

用户口径 (2026-10-13)
  「woot 的销售额和采购价是对的，两者是独立存在的计算方式。woot 的产品是 X1 40W 产品，
    你可以通过产品关系管理里面进行匹配。」
  ⇒ Woot 行本来就带 asin(B0H69JJZ1M)，而该 ASIN 已在「产品关系管理」匹配到
    「X1主机+40W蓝光头+气泵」。所以产品成本应**从产品关系管理解析**，而不是让用户再手工录一遍。

做法 (回退链，手工配置优先级更高)
  ① WOOT_CFG.cost[asin]                       —— 手工配置优先(保持既有行为，可覆盖)
  ② 产品关系管理 asinMap → 产品名 → 产品成本表 costRMB / headRMB.US ÷ (CNY/USD) → USD/台
  ③ 都没有 → null(该 ASIN 不入毛利，不按 0 成本虚高 —— 保持既有护栏)

改动面
  build_daily_dashboard.py    : 注入 __COST_JSON__ = {产品名: costRMB}
  build_monthly_dashboards.py : 同上(仅 MONTHLY 模板)
  daily_dashboard_template.html   : const COSTRMB / wootCostFromMap / wootUnitCost / 提示文案
  monthly_dashboard_template.html : 同上

幂等: 以 `COSTRMB` 为标记，重复执行直接跳过。
用法: python add_woot_cost_map.py [--check]
"""
import io
import os
import shutil
import sys
import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
MARKER = 'COSTRMB'
STAMP = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
BAK = os.path.join(BASE, '_bak_woot_cost')

FILES = [
    'build_daily_dashboard.py',
    'build_monthly_dashboards.py',
    'daily_dashboard_template.html',
    'monthly_dashboard_template.html',
]

# ============================ Woot 成本解析 JS 片段 ============================

JS_COSTRMB = """// Woot 成本表 (2026-10-13): {产品名: 采购成本RMB/台} —— Woot 行经「产品关系管理」匹配到产品名后取此表
const COSTRMB = __COST_JSON__;
"""

JS_WOOT_UNIT_OLD = (
    "function wootUnitCost(asin){ const c = (WOOT_CFG.cost || {})[asin]; "
    "return c ? { unit: Number(c.unit) || 0, freight: Number(c.freight) || 0 } : null; }"
)

JS_WOOT_UNIT_NEW_DAILY = """// Woot 成本解析 (2026-10-13): ①「Woot 成本设置」逐 ASIN 手工配置优先
//   ② 未配置 → 回退「产品关系管理」: asinMap 匹配到的产品名 → 成本表 costRMB(采购成本) 与
//      headRMB.US(头程运费), 再 ÷ (CNY/USD, 取最新可用月份) 折成 USD/台
//   两处都没有 → null(该 ASIN 不入毛利 —— 不按 0 成本算, 否则毛利虚高)
function wootCostFromMap(asin){
  const meta = (typeof asinMetaOf === 'function') ? asinMetaOf(asin) : null;
  const name = meta && meta.name;
  const costRmb = (name && COSTRMB && Number(COSTRMB[name])) ? Number(COSTRMB[name]) : 0;
  if (!(costRmb > 0)) return null;
  const ks = Object.keys((HF && HF.months) || {}).sort();
  const rate = ks.length ? (Number(HF.months[ks[ks.length - 1]]) || 0) : 0;
  if (!rate) return null;
  const headRmb = (typeof headRmbOf === 'function') ? headRmbOf(asin, 'US') : 0;
  return { unit: costRmb / rate, freight: headRmb > 0 ? headRmb / rate : 0, src: 'map' };
}
function wootUnitCost(asin){
  const c = (WOOT_CFG.cost || {})[asin];
  if (c) return { unit: Number(c.unit) || 0, freight: Number(c.freight) || 0, src: 'cfg' };
  return wootCostFromMap(asin);
}"""

# 月看板的汇率表口径不同: FX = {ym: {币种: CNY/单位}}, 另有 FX_FB 兜底
JS_WOOT_UNIT_NEW_MONTHLY = """// Woot 成本解析 (2026-10-13): ①「Woot 成本设置」逐 ASIN 手工配置优先
//   ② 未配置 → 回退「产品关系管理」: asinMap 匹配到的产品名 → 成本表 costRMB(采购成本) 与
//      headRMB.US(头程运费), 再 ÷ (CNY/USD, 取最新可用月份) 折成 USD/台
//   两处都没有 → null(该 ASIN 不入毛利 —— 不按 0 成本算, 否则毛利虚高)
function wootCnyPerUsd(){
  const ks = Object.keys(FX || {}).sort();
  const ym = ks.length ? ks[ks.length - 1] : null;
  const r = (ym && FX[ym] && Number(FX[ym].USD)) || (typeof FX_FB !== 'undefined' ? Number(FX_FB.USD) : 0);
  return r > 0 ? r : 0;
}
function wootCostFromMap(asin){
  const meta = (typeof asinMetaOf === 'function') ? asinMetaOf(asin) : null;
  const name = meta && meta.name;
  const costRmb = (name && COSTRMB && Number(COSTRMB[name])) ? Number(COSTRMB[name]) : 0;
  if (!(costRmb > 0)) return null;
  const rate = wootCnyPerUsd();
  if (!rate) return null;
  const headRmb = (typeof headRmbOf === 'function') ? headRmbOf(asin, 'US') : 0;
  return { unit: costRmb / rate, freight: headRmb > 0 ? headRmb / rate : 0, src: 'map' };
}
function wootUnitCost(asin){
  const c = (WOOT_CFG.cost || {})[asin];
  if (c) return { unit: Number(c.unit) || 0, freight: Number(c.freight) || 0, src: 'cfg' };
  return wootCostFromMap(asin);
}"""

# 月看板 Woot 行: 必须给全 profitOf() 直接相加的字段, 否则 NaN
WMAR_OLD = """      const wmar = (!wc || od <= 0) ? {} : { pSales: wRev, pCost: -(wc.unit) * od, pN: 1,
        pQty: od, pHead: wc.freight * od };"""
WMAR_NEW = """      // ⚠️ 必须给全 profitOf() **直接相加**的字段(promo/comm/fba/storage/other) —— 缺一个就是 NaN。
      //    此前 pN 恒 0 时 profitOf() 会提前 return null, 把这层缺字段掩盖了;
      //    2026-10-13 启用「产品关系管理」成本回退后 Woot 行首次真正入账, 缺字段立刻表现为
      //    「合并视图 / 单看 Woot 的毛利 = NaN」。(aggMonth 内部都有 ||0, 所以只有 profitOf 这条路径炸)
      const wmar = (!wc || od <= 0) ? {} : { pSales: wRev, pPromo: 0, pComm: 0, pFba: 0,
        pCost: -(wc.unit) * od, pStorage: 0, pOther: 0, pN: 1, pQty: od, pHead: wc.freight * od };"""

# 说明块里的 Woot 口径句(日/月两处同文)
NOTE_OLD = 'Woot 毛利口径（采购价 × Woot订单量 − 产品成本 − 头程 − Woot广告费）；产品成本/头程已接入（「Woot 数据管理 → 💵 Woot 成本设置」）。'
NOTE_NEW = ('Woot 毛利口径（采购价 × Woot订单量 − 产品成本 − 头程 − Woot广告费）；成本与头程优先取「Woot 数据管理 → 💵 Woot 成本设置」'
            '里逐 ASIN 的手工配置，<b>未配置时自动回退「产品关系管理」</b>——按 ASIN 匹配到的产品名取产品成本表的采购成本与 US 头程，'
            '÷ 当月 CNY/USD 折成 USD/台；两处都取不到则该 ASIN 不入毛利（显示 —，避免按 0 成本算虚高）。')

# 日看板页脚提示
FOOT_OLD = """  const note = WOOT_CFG_N
    ? `<b style="color:#059669">Woot 毛利已启用（已配置 ${WOOT_CFG_N} 个子 ASIN 成本）</b>`
    : `<b>Woot 毛利率待产品成本/运费表接入</b>（去「Woot 数据管理 → 💵 Woot 成本设置」填成本表）`;"""
FOOT_NEW = """  const wNMap = (function(){ const s = new Set();
    try { wootEntriesLocal().forEach(function(e){ if (e && e.asin && wootCostFromMap(e.asin)) s.add(e.asin); }); } catch (err) {}
    return s.size; })();
  const note = (WOOT_CFG_N || wNMap)
    ? `<b style="color:#059669">Woot 毛利已启用（成本来源：手工配置 ${WOOT_CFG_N} 个子 ASIN${wNMap ? ' + 产品关系管理回退 ' + wNMap + ' 个' : ''}）</b>`
    : `<b>Woot 毛利率待产品成本接入</b>（去「Woot 数据管理 → 💵 Woot 成本设置」填成本表，或先在「产品关系管理」把该 ASIN 匹配到产品名）`;"""

# 日看板注释(690 行附近)措辞
CMT_DAILY_OLD = "//    待用户「产品成本/运费」表格到位后再按 `采购价 × 订单量 − 产品成本 − 运费 − 广告费` 算(见 §Woot 毛利)。"
CMT_DAILY_NEW = ("//    成本来源(2026-10-13): 手工「Woot 成本设置」优先, 否则按「产品关系管理」匹配到的产品名取成本表。\n"
                 "//    口径: `采购价 × 订单量 − 产品成本 × 订单量 − 运费 × 订单量 − 广告费`(见 §Woot 毛利)。")

# 月看板注释
CMT_MONTHLY_OLD = "// ⚠️ 利润报表只有亚马逊店铺行 → 单看 Woot 时毛利显示 —（正确行为，Woot 毛利口径待成本表接入）。"
CMT_MONTHLY_NEW = ("// ⚠️ 利润报表只有亚马逊店铺行 → 单看 Woot 时毛利显示 —；Woot 毛利改由「产品关系管理」匹配产品成本后计算\n"
                   "//    （2026-10-13：手工配置优先，未配置则按 asinMap → 成本表 costRMB/headRMB 回退）。")


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def backup(name):
    os.makedirs(BAK, exist_ok=True)
    dst = os.path.join(BAK, name.replace('/', '_') + '.' + STAMP)
    shutil.copy2(os.path.join(BASE, name), dst)
    return dst


def sub_once(text, old, new, label):
    n = text.count(old)
    assert n == 1, '%s: 锚点命中 %d 次(应为 1)' % (label, n)
    return text.replace(old, new, 1)


def main():
    check_only = '--check' in sys.argv
    changed = []

    for name in FILES:
        p = os.path.join(BASE, name)
        if not os.path.exists(p):
            raise SystemExit('缺文件: ' + p)

    # 幂等: 模板里已出现 COSTRMB 就整体跳过
    tpl_daily = read(os.path.join(BASE, 'daily_dashboard_template.html'))
    tpl_month = read(os.path.join(BASE, 'monthly_dashboard_template.html'))
    if MARKER in tpl_daily and MARKER in tpl_month:
        print('已打过补丁(检测到 %s)，跳过。' % MARKER)
        return 0

    if check_only:
        print('--check 模式: 锚点校验')
    else:
        for n in FILES:
            print('备份 ->', os.path.relpath(backup(n), BASE))

    # ---------- 1. build_daily_dashboard.py ----------
    bd = read(os.path.join(BASE, 'build_daily_dashboard.py'))
    old = ("        hf_json = json.dumps(hf, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        print('头程表: %d 个产品 · %d 个月汇率' % (len(hf['products']), len(hf['months'])))\n"
           "    except Exception as e:\n"
           "        print('警告: 头程表构建失败(头程列将显示 0):', e)\n"
           "        hf_json = '{\"products\":{},\"months\":{}}'")
    new = ("        hf_json = json.dumps(hf, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        # Woot 成本表 (2026-10-13): {产品名: 采购成本RMB/台} —— Woot 行经「产品关系管理」匹配产品名后取此表\n"
           "        cost_json = json.dumps({n: (p.get('costRMB') or 0) for n, p in (tbl.get('products') or {}).items()},\n"
           "                               ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        print('头程表: %d 个产品 · %d 个月汇率 · Woot 成本表 %d 个产品'\n"
           "              % (len(hf['products']), len(hf['months']), len(tbl.get('products') or {})))\n"
           "    except Exception as e:\n"
           "        print('警告: 头程表构建失败(头程列将显示 0):', e)\n"
           "        hf_json = '{\"products\":{},\"months\":{}}'\n"
           "        cost_json = '{}'")
    bd = sub_once(bd, old, new, 'build_daily_dashboard: hf_json 块')
    bd = sub_once(bd, "    html = html.replace('__HF_JSON__', hf_json)",
                  "    html = html.replace('__HF_JSON__', hf_json)\n"
                  "    html = html.replace('__COST_JSON__', cost_json)", 'build_daily_dashboard: 占位符替换')
    if not check_only:
        write(os.path.join(BASE, 'build_daily_dashboard.py'), bd)
        changed.append('build_daily_dashboard.py')

    # ---------- 2. build_monthly_dashboards.py ----------
    bm = read(os.path.join(BASE, 'build_monthly_dashboards.py'))
    old = ("        hf_json = json.dumps({n: (p.get('headRMB') or {}) for n, p in (_tbl.get('products') or {}).items()},\n"
           "                             ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        print('头程表: %d 个产品' % len(_tbl.get('products') or {}))\n"
           "    except Exception as e:\n"
           "        print('警告: 头程表构建失败(头程列将显示 —):', e)\n"
           "        hf_json = '{}'")
    new = ("        hf_json = json.dumps({n: (p.get('headRMB') or {}) for n, p in (_tbl.get('products') or {}).items()},\n"
           "                             ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        # Woot 成本表 (2026-10-13): {产品名: 采购成本RMB/台} —— 仅月度看板用(Woot 成本回退)\n"
           "        cost_json = json.dumps({n: (p.get('costRMB') or 0) for n, p in (_tbl.get('products') or {}).items()},\n"
           "                               ensure_ascii=False, separators=(',', ':')).replace('</', '<\\\\/')\n"
           "        print('头程表: %d 个产品 · Woot 成本表 %d 个产品'\n"
           "              % (len(_tbl.get('products') or {}), len(_tbl.get('products') or {})))\n"
           "    except Exception as e:\n"
           "        print('警告: 头程表构建失败(头程列将显示 —):', e)\n"
           "        hf_json = '{}'\n"
           "        cost_json = '{}'")
    bm = sub_once(bm, old, new, 'build_monthly_dashboards: hf_json 块')
    bm = sub_once(bm, "'__DATA_NOTE__': data_note(data), '__HF_JSON__': hf_json}),",
                  "'__DATA_NOTE__': data_note(data), '__HF_JSON__': hf_json, '__COST_JSON__': cost_json}),",
                  'build_monthly: MONTHLY 渲染字典')
    if not check_only:
        write(os.path.join(BASE, 'build_monthly_dashboards.py'), bm)
        changed.append('build_monthly_dashboards.py')

    # ---------- 3. daily_dashboard_template.html ----------
    d = tpl_daily
    d = sub_once(d, 'const HF = __HF_JSON__;\n', 'const HF = __HF_JSON__;\n' + JS_COSTRMB, 'daily: COSTRMB 常量')
    d = sub_once(d, JS_WOOT_UNIT_OLD, JS_WOOT_UNIT_NEW_DAILY, 'daily: wootUnitCost')
    d = sub_once(d, NOTE_OLD, NOTE_NEW, 'daily: 说明块 Woot 口径句')
    d = sub_once(d, FOOT_OLD, FOOT_NEW, 'daily: 页脚提示')
    d = sub_once(d, CMT_DAILY_OLD, CMT_DAILY_NEW, 'daily: 注释措辞')
    if not check_only:
        write(os.path.join(BASE, 'daily_dashboard_template.html'), d)
        changed.append('daily_dashboard_template.html')

    # ---------- 4. monthly_dashboard_template.html ----------
    m = tpl_month
    m = sub_once(m, 'const HF = __HF_JSON__;\n', 'const HF = __HF_JSON__;\n' + JS_COSTRMB, 'monthly: COSTRMB 常量')
    m = sub_once(m, JS_WOOT_UNIT_OLD, JS_WOOT_UNIT_NEW_MONTHLY, 'monthly: wootUnitCost')
    m = sub_once(m, NOTE_OLD, NOTE_NEW, 'monthly: 说明块 Woot 口径句')
    m = sub_once(m, WMAR_OLD, WMAR_NEW, 'monthly: Woot 行等效利润字段补全')
    m = sub_once(m, CMT_MONTHLY_OLD, CMT_MONTHLY_NEW, 'monthly: 注释措辞')
    if not check_only:
        write(os.path.join(BASE, 'monthly_dashboard_template.html'), m)
        changed.append('monthly_dashboard_template.html')

    print('\n完成，改动文件:')
    for c in changed:
        print('  -', c)
    print('\n下一步: 重建 daily.html / monthly.html / target.html，再跑 check_data_integrity.js')
    return 0


if __name__ == '__main__':
    sys.exit(main())
