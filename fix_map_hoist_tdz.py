# -*- coding: utf-8 -*-
"""fix_map_hoist_tdz.py —— 上移「ASIN→产品 映射块」，消除装配期 TDZ（2026-10-13）

现象
  启用「Woot 成本经产品关系管理解析」后，月看板整段脚本在加载期抛
      ReferenceError: Cannot access 'EMBED_MAP' before initialization
  后果：该 script 标签后面的代码全不执行（let selChannel 未定义）→
        test_woot_margin ③ 直接 FATAL、点「销售店铺」筛选报错。

根因
  `wootCostFromMap()` 需要产品名 → `asinMetaOf()` → 读 `const EMBED_MAP`。
  而「Woot 毛利接入口」里有个**加载期执行的 IIFE**（月：injectWootMonthly；
  日：页脚 WOOT_INJECTED 状态块）会调用它，此时 `EMBED_MAP` / `localMeta` /
  `embeddedMeta` 这几个 const 还没执行到 → TDZ 报错。
  以前 Woot 行成本恒为 null（pN=0），`wootUnitCost()` 提前返回，这条路径根本没被走到，
  把顺序问题一直藏着。

修法
  把「产品映射块」（EMBED_MAP + localMeta/embeddedMeta(或 embeddedMetaOf) + asinMetaOf
  (+ rowMeta)）整体上移到装配期代码之前。函数与常量只是提前定义，行为不变。

  - 月看板: 上移到 `// ---------- Woot 店铺数据并入` 之前
            （块 = `// ASIN -> 产品系列/产品名` … rowMeta 结束）
  - 日看板: 上移到 `// ---------- Woot 毛利率状态提示 ----------` 之前
            （块 = `// ---------- 产品映射 (ASIN → 产品系列/产品名)` … asinMetaOf 结束）
            ⚠️ 日看板这里原本**不报错**：调用被 try/catch 吞了 → 页脚「产品关系管理回退 N 个」
               恒为 0（静默错数）。上移后计数才正确。

幂等: 以 `MAPHOIST` 为标记，重复执行直接跳过。
用法: python fix_map_hoist_tdz.py [--check]

注意: 本脚本与 add_woot_cost_map.py 相互独立（后者以 COSTRMB 为标记，一旦打过就整体跳过）。
      若从原始模板重建，执行顺序: add_woot_cost_map.py → fix_map_hoist_tdz.py。
"""
import io
import os
import shutil
import sys
import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
MARKER = 'MAPHOIST'
STAMP = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
BAK = os.path.join(BASE, '_bak_maphoist')

# ---------------------------------------------------------------- 月看板
M_BLOCK_HEAD = '// ASIN -> 产品系列/产品名 (云端映射同步前先用内嵌, 同步后刷新)\n'
M_BLOCK_TAIL = """function rowMeta(r) {
  if (r.asin === WOOT_ASIN) return { series: 'Woot', name: 'Woot 店铺活动' };
  // JoyBuy 行没有 ASIN，用行内自带的 系列/品名（映射表里查不到）
  if (platOf(r) === 'joybuy') return { series: r.series || '无', name: r.name || '无' };
  if (!r.asin) return { series: '无', name: '无' };
  try {
    const raw = localStorage.getItem('pc_asinmap');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        let hit = null, anyHit = null;
        for (const x of arr) {
          if (!x || x.asin !== r.asin) continue;
          anyHit = anyHit || x;
          if ((x.country || 'EU') === r.cc) { hit = x; break; }
        }
        const m = hit || anyHit;
        if (m) return { series: m.series || '无', name: m.name || '无' };
      }
    }
  } catch (e) {}
  return embeddedMetaOf(r.asin);
}
"""
M_ANCHOR = '// ---------- Woot 店铺数据并入 (并入 US, 美元; 按子 ASIN 归到对应产品) ----------\n'
M_LEFTOVER = ('// (ASIN→产品 映射块已于 2026-10-13 上移到「Woot 店铺数据并入」之前 MAPHOIST ——\n'
              '//  Woot 成本回退在**装配期**就要按 ASIN 解析产品名, 留在原处会踩 const 的 TDZ)\n')

# ---------------------------------------------------------------- 日看板
D_BLOCK_HEAD = '// ---------- 产品映射 (ASIN → 产品系列/产品名) ----------\n'
D_BLOCK_TAIL = """function asinMetaOf(a) {
  if (a === WOOT_ASIN) return { series: 'Woot', name: 'Woot 店铺活动' };
  if (!a) return { series: '无', name: '无' };
  if (localMeta && localMeta[a]) return localMeta[a];
  if (embeddedMeta[a]) return embeddedMeta[a];
  return { series: '无', name: '无' };
}
"""
D_ANCHOR = '// ---------- Woot 毛利率状态提示 ----------\n'
D_LEFTOVER = ('// (产品映射块已于 2026-10-13 上移到「Woot 毛利率状态提示」之前 MAPHOIST ——\n'
              '//  该状态块在装配期就会调 wootCostFromMap→asinMetaOf, 留在原处会踩 localMeta 的 TDZ)\n')


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def backup(name):
    os.makedirs(BAK, exist_ok=True)
    dst = os.path.join(BAK, name + '.' + STAMP)
    shutil.copy2(os.path.join(BASE, name), dst)
    return dst


def slice_block(text, head, tail, label):
    """截取 head..tail(含 tail) 的整块文本"""
    i = text.find(head)
    assert i >= 0, '%s: 找不到块首' % label
    j = text.find(tail, i)
    assert j >= 0, '%s: 找不到块尾' % label
    return text[i:j + len(tail)]


def hoist(text, label, head, tail, anchor, leftover):
    if MARKER in text:
        print('  %s: 已上移(检测到 %s)，跳过' % (label, MARKER))
        return text, False
    block = slice_block(text, head, tail, label)
    # 块内不得含锚点，且锚点/块各只出现一次
    assert anchor not in block, '%s: 锚点落在块内' % label
    assert text.count(block) == 1, '%s: 块命中 %d 次' % (label, text.count(block))
    assert text.count(anchor) == 1, '%s: 锚点命中 %d 次' % (label, text.count(anchor))
    text = text.replace(block, leftover, 1)
    assert text.count(anchor) == 1
    text = text.replace(anchor, block + anchor, 1)
    return text, True


def main():
    check_only = '--check' in sys.argv
    print('--check 模式: 只做锚点/块校验，不写文件' if check_only else '开始上移映射块…')

    changed = []
    for name, label, head, tail, anchor, leftover in [
        ('monthly_dashboard_template.html', 'monthly', M_BLOCK_HEAD, M_BLOCK_TAIL, M_ANCHOR, M_LEFTOVER),
        ('daily_dashboard_template.html', 'daily', D_BLOCK_HEAD, D_BLOCK_TAIL, D_ANCHOR, D_LEFTOVER),
    ]:
        p = os.path.join(BASE, name)
        if not os.path.exists(p):
            raise SystemExit('缺文件: ' + p)
        src = read(p)
        out, did = hoist(src, label, head, tail, anchor, leftover)
        if not did:
            continue
        if check_only:
            print('  %s: 校验通过(可上移)' % label)
        else:
            print('  备份 ->', os.path.relpath(backup(name), BASE))
            write(p, out)
            changed.append(name)

    if check_only:
        print('\n--check 完成。')
        return 0
    if not changed:
        print('\n无改动(可能已打过补丁)。')
        return 0
    print('\n完成，改动文件:')
    for c in changed:
        print('  -', c)
    print('\n下一步: python build_monthly_dashboards.py && python build_daily_dashboard.py')
    print('        再跑 node check_data_integrity.js / node test_woot_margin.js')
    return 0


if __name__ == '__main__':
    sys.exit(main())
