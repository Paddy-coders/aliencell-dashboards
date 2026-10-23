# -*- coding: utf-8 -*-
"""商品成本取数: 「产品关系管理」映射 + 用户成本表

★ 2026-10-13 用户口径变更:
    「产品成本也是商品成本的取数全部取我给你的表格里面进行匹配，不要从易仓进行取数」

  变更前: 商品成本 = 易仓利润报表 productCostTotal (ERP 记账值)
  变更后: 商品成本 = 产品成本表 costRMB × 件数 ÷ 当月汇率(CNY per 1 站点币种)

  件数 = qty(亚马逊销量) + mqty(多渠道销量) —— 两个渠道都是真实发出的货, 都要算成本
  ASIN → 产品名 走「产品关系管理」(云端 Supabase mapping.data.asinMap), 与看板同源
      ASIN 在成本表里没有对应产品名 ⇒ 成本 = 0 且 miss=1 (**不回退易仓**)
      这类行由自检 G18 报出, 请补「产品关系管理」映射或补成本表

汇率: 与看板头程(成本表 headRMB)同一套「当月汇率」, 见 fx_rates.json
      US→USD / UK→GBP / DE·FR·IT·ES→EUR, 逐月取值, 缺月回退最近可比月

为什么放在构建期(而不是页面端):
  1) 三个看板(日/月/周)共用 build_profit_metrics.py 的产出 ⇒ 一处改, 三处同口径
  2) 页面端解析要读 EMBED_MAP(内嵌映射), 而内嵌映射可能为空、首屏要等云端同步
     ⇒ 构建期落库可避免「首屏毛利与刷新后不一致」, 也没有加载期 TDZ 风险

用法:
  python cost_from_table.py            # 打印覆盖率 / 未匹配清单 / 与易仓单台成本偏差
  from cost_from_table import Resolver
  r = Resolver(refresh=True)           # 拉云端映射(失败回退本地缓存)
  r.cost_rmb('B0H69JJZ1M')             # -> 4263.5  (None = 未匹配)
  r.name('B0H69JJZ1M')                 # -> 'X1主机+40W蓝光头+气泵'
"""
import io
import json
import os
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COST_FILE = os.path.join(BASE_DIR, 'product_cost_table.json')
COST_CACHE = os.path.join(BASE_DIR, '_cost_cache.json')   # 云端 costTable 本地快照
MAP_FILE = os.path.join(BASE_DIR, 'product_map.json')       # 构建期内嵌用 (catalog + asinMap)
CACHE_FILE = os.path.join(BASE_DIR, '_map_cache.json')      # 云端映射本地快照

SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?select=data&id=eq.1'
SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'


def _read_json(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _fetch_cloud_data(timeout=12):
    """拉云端 mapping 表 id=1 的 data(整份); 失败抛异常"""
    req = urllib.request.Request(SB_URL, headers={
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        rows = json.loads(resp.read().decode('utf-8'))
    data = (rows[0] or {}).get('data') if rows else None
    if not isinstance(data, dict):
        raise ValueError('云端 mapping 结构异常')
    return data


def fetch_cloud_map(timeout=12):
    """拉云端「产品关系管理」映射; 失败抛异常(调用方回退本地)"""
    data = _fetch_cloud_data(timeout)
    if not isinstance(data.get('asinMap'), list):
        raise ValueError('云端映射结构异常')
    return data


def fetch_cloud_cost_table(timeout=12):
    """拉云端 mapping.data.costTable → {products, source, updatedAt}; 无该键返回 None"""
    ct = _fetch_cloud_data(timeout).get('costTable') or {}
    prods = ct.get('products')
    if not isinstance(prods, dict) or not prods:
        return None
    return {'products': prods, 'source': ct.get('source', ''), 'updatedAt': ct.get('updatedAt', '')}


_MEMO = {'doc': None, 'ts': 0.0}


def cost_table_doc(refresh=True, max_age_hours=6, verbose=False):
    """产品成本表整份文档 —— **云端 mapping.data.costTable 优先**, 本地文件兜底

    2026-10-21 起成本表上云: 所有应用(看板构建 / 运营工具 / 运费推演 …)读同一份,
    再靠「本地文件 mtime 比缓存新 ⇒ 用本地」防止「本地改了但忘了上传」导致的静默不生效。

    → {products:{产品名:{costRMB, headRMB, tailLocal}}, source, updatedAt, from}
      from ∈ cloud / cache / local / local-newer
    """
    local_doc = _read_json(COST_FILE) or {}
    local = local_doc.get('products') or {}
    out_local = {'products': local, 'source': local_doc.get('source', ''),
                 'updatedAt': local_doc.get('updatedAt', ''), 'from': 'local'}
    if not refresh:
        return out_local

    now = time.time()
    if _MEMO['doc'] and now - _MEMO['ts'] < 60:
        return _MEMO['doc']

    cache = _read_json(COST_CACHE) or {}
    try:
        local_mtime = os.path.getmtime(COST_FILE) if local else 0
        cache_mtime = os.path.getmtime(COST_CACHE) if cache.get('products') else 0
    except OSError:
        local_mtime = cache_mtime = 0

    # ① 本地文件比云端快照新 ⇒ 本地刚改过还没上传, 以本地为准(否则改了不生效且无提示)
    if local and cache.get('products') and local_mtime > cache_mtime + 1:
        if verbose:
            print('  ⚠️ 成本表: 本地文件比云端快照新 → 用本地；记得 python upload_cost_table.py 同步上云')
        _MEMO.update(doc=out_local, ts=now)
        return out_local

    # ② 快照新鲜 ⇒ 直接用(避免每次构建都等一次 HTTP)
    if cache.get('products') and max_age_hours > 0 and cache_mtime:
        age = (now - cache_mtime) / 3600.0
        if age < max_age_hours:
            doc = {'products': cache['products'], 'source': cache.get('source', ''),
                   'updatedAt': cache.get('updatedAt', ''), 'from': 'cache'}
            _MEMO.update(doc=doc, ts=now)
            return doc

    # ③ 拉云端
    try:
        doc = fetch_cloud_cost_table()
        if doc:
            doc['from'] = 'cloud'
            _write_cost_cache(doc)
            if verbose:
                print('  成本表已从云端同步: %d 个产品' % len(doc['products']))
            _MEMO.update(doc=doc, ts=now)
            return doc
    except Exception as e:
        if verbose:
            print('  ⚠️ 成本表云端拉取失败(%s), 用本地文件' % str(e)[:60])
    _MEMO.update(doc=out_local, ts=now)
    return out_local


def _write_cost_cache(doc):
    try:
        io.open(COST_CACHE, 'w', encoding='utf-8', newline='\n').write(json.dumps(
            {'products': doc.get('products') or {}, 'source': doc.get('source', ''),
             'updatedAt': doc.get('updatedAt', ''),
             'fetchedAt': time.strftime('%Y-%m-%d %H:%M:%S')},
            ensure_ascii=False, separators=(',', ':')))
    except Exception:
        pass


def load_cost_table():
    """产品成本表: {产品名: {costRMB, headRMB:{US,EU,UK}, tailLocal:{...}}}（云端优先）"""
    return cost_table_doc()['products']


def _effective_map_path():
    """返回「真正生效」的映射文件 —— 必须与 load_map_prefer_local() 的选择一致

    ⚠️ 两者分叉会静默出错: Resolver 走 _map_cache.json(可能被测试等外部流程刷新),
    而构建期内嵌的是 product_map.json ⇒ 出现「商品成本已按成本表解析、页面头程却按 0 算」。
    """
    c = _read_json(CACHE_FILE) or {}
    if c.get('asinMap'):
        return CACHE_FILE
    m = _read_json(MAP_FILE) or {}
    if m.get('asinMap'):
        return MAP_FILE
    return None


def _sync_baked(eff_path, verbose=False):
    """把「生效映射」镜像到 product_map.json(构建期内嵌用), 消除两文件分叉

    → 返回是否真的改写了文件(幂等: 内容相同则不动)。
    """
    if not eff_path or eff_path == MAP_FILE:
        return False
    src = _read_json(eff_path) or {}
    am = src.get('asinMap') or []
    if not am:
        return False
    cur = (_read_json(MAP_FILE) or {}).get('asinMap') or []
    if len(cur) == len(am) and [x.get('asin') for x in cur] == [x.get('asin') for x in am]:
        return False
    payload = {'catalog': src.get('catalog') or [], 'asinMap': am}
    with io.open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    if verbose:
        print('  内嵌映射已与生效映射(%s)对齐: asinMap %d 条(原 %d 条)'
              % (os.path.basename(eff_path), len(am), len(cur)))
    return True


def refresh_map(verbose=True, max_age_hours=6, force=False):
    """拉云端映射并写 product_map.json(内嵌用) + _map_cache.json(本地快照)

    写 product_map.json 的目的: 让已构建页面内嵌 `EMBED_MAP` 非空 ⇒ 头程与 Woot 成本
    在**首屏/离线**也能解析, 不必等云端同步 + location.reload()。
    注意: 构建期拉取失败时**不覆盖**已有文件(保留上次快照), 只是返回 False。

    max_age_hours: 快照新鲜度阈值 —— 日构建链一天会跑多次, 6 小时内直接复用,
                   避免每次构建都等一次 HTTP (每日链路的采集间隔远大于 6 小时)。
                   阈值按**生效映射**的 mtime 判定, 并在跳过时把内嵌映射对齐过去。
    """
    if not force and max_age_hours > 0:
        eff = _effective_map_path()
        if eff:
            try:
                age = (time.time() - os.path.getmtime(eff)) / 3600.0
                if age < max_age_hours:
                    _sync_baked(eff, verbose)
                    if verbose:
                        print('  映射快照 %.1f 小时前(< %gh, 源 %s), 跳过刷新'
                              % (age, max_age_hours, os.path.basename(eff)))
                    return True
            except Exception:
                pass
    try:
        data = fetch_cloud_map()
    except Exception as e:
        if verbose:
            print('  ⚠️ 云端映射拉取失败(%s), 沿用本地快照' % str(e)[:80])
        return False
    am = data.get('asinMap') or []
    cat = data.get('catalog') or []
    payload = {'catalog': cat, 'asinMap': am}
    with io.open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    data.setdefault('catalog', cat)
    with io.open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if verbose:
        print('  映射已刷新: asinMap %d 条 · catalog %d 条 → product_map.json / _map_cache.json'
              % (len(am), len(cat)))
    return True



def load_map_prefer_local():
    """本地映射(不联网): 优先 _map_cache.json, 回退 product_map.json"""
    for p in (CACHE_FILE, MAP_FILE):
        d = _read_json(p) or {}
        if (d.get('asinMap') or []):
            return {'asinMap': d.get('asinMap') or [], 'catalog': d.get('catalog') or [],
                    'source': os.path.basename(p)}
    return {'asinMap': [], 'catalog': [], 'source': 'empty'}


class Resolver(object):
    """ASIN → 产品名 → 成本表 costRMB"""

    def __init__(self, refresh=True, verbose=False, table=None, mp=None,
                 force=False, max_age_hours=6):
        self.table = table if table is not None else load_cost_table()
        self.refreshed = False
        if mp is not None:
            self.mp = mp
        else:
            if refresh:
                self.refreshed = refresh_map(verbose=verbose, max_age_hours=max_age_hours, force=force)
            # 无论刷新成功与否都从本地文件读(刷新成功时刚写过, 保证与内嵌产物一致)
            self.mp = load_map_prefer_local()
        self._name = {}
        for x in (self.mp.get('asinMap') or []):
            if isinstance(x, dict) and x.get('asin'):
                self._name.setdefault(str(x['asin']).strip().upper(), x.get('name'))

    # ---- 查询 ----
    def name(self, asin):
        return self._name.get(str(asin or '').strip().upper())

    def resolve(self, asin):
        """→ {'asin','name','costRMB','headRMB','tailLocal','src'} ; 未匹配 → None"""
        a = str(asin or '').strip().upper()
        n = self._name.get(a)
        if not n:
            return None
        p = self.table.get(n)
        if not p:
            return None
        return {'asin': a, 'name': n, 'costRMB': float(p.get('costRMB') or 0),
                'headRMB': p.get('headRMB') or {}, 'tailLocal': p.get('tailLocal') or {},
                'src': 'table'}

    def cost_rmb(self, asin):
        r = self.resolve(asin)
        c = r['costRMB'] if r else 0.0
        return c if c > 0 else None

    def amount(self, asin, units, rate):
        """→ (站点币种金额(负数, 与易仓「费用为负」的符号约定一致), 是否成本缺失)

        rate = CNY per 1 站点币种 (当月)
        未匹配 ⇒ 金额 0 且「缺失」为真 —— 但**只有真发了货(units≠0)才算缺失**,
        否则「成本为 0 的商品只发了 0 件」会满屏误报。
        """
        c = self.cost_rmb(asin)
        if not c or not rate:
            return 0.0, bool(units)
        return -round(c * float(units) / float(rate), 4), False

    # ---- 报表 ----
    def coverage(self, days, rate_fn=None, cur_of=None):
        """按 (asin, site) 汇总件数/易仓成本/表成本 —— 供自检与人工核对

        rate_fn(ym, cur) 给出 CNY per 1 站点币种 ⇒ 表成本可折成站点币种, 与易仓同币种比较。
        rate_fn 为空时表成本不折算(只给件数/命中情况)。
        """
        from collections import defaultdict
        agg = defaultdict(lambda: {'q': 0, 'tbl': 0.0, 'erp': 0.0, 'sales': 0.0, 'n': 0, 'cur': ''})
        CUR = cur_of or {}
        for d in days:
            ym = d[:7]
            for r in days[d]:
                a = str(r.get('as') or '').upper()
                s = (r.get('site') or '').strip().upper() or '(空)'
                u = float(r.get('qty') or 0) + float(r.get('mqty') or 0)
                cur = str(r.get('cur') or '').upper() or CUR.get(s, '')
                k = (a, s)
                o = agg[k]
                o['q'] += u
                o['erp'] += float(r.get('cost') or 0)
                o['sales'] += float(r.get('sales') or 0)
                o['n'] += 1
                if cur:
                    o['cur'] = cur
                c = self.cost_rmb(a)
                if c:
                    rate = float(rate_fn(ym, cur) or 0) if (rate_fn and cur) else 0
                    if rate:
                        o['tbl'] += -c * u / rate
        return agg


SITE_CUR = {'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'UK': 'GBP', 'JP': 'JPY', 'AU': 'AUD',
            'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'BE': 'EUR',
            'IE': 'EUR', 'PL': 'PLN', 'SE': 'SEK'}


def make_rate_fn():
    """读 fx_rates.json, 返回 rate_fn(ym, cur) = CNY per 1 单位币种 (缺月回退最近可比月)"""
    fx = (_read_json(os.path.join(BASE_DIR, 'fx_rates.json')) or {}).get('rates') or {}

    def fn(ym, cur):
        if not cur or cur == 'CNY':
            return 1.0
        m = fx.get(ym) or {}
        if m.get(cur):
            return float(m[cur])
        best = None
        for k in sorted(fx):
            if k <= ym and (fx[k] or {}).get(cur):
                best = k
        if not best:
            for k in sorted(fx):
                if (fx[k] or {}).get(cur):
                    best = k
                    break
        return float((fx[best] or {})[cur]) if best else 0.0
    return fn


def _main():
    r = Resolver(refresh=True, verbose=True)
    tbl = r.table
    print('成本表: %d 个产品 · 映射: asinMap %d 条 (%s)'
          % (len(tbl), len(r.mp.get('asinMap') or []), r.mp.get('source')))
    pd = _read_json(os.path.join(BASE_DIR, 'profit_data.json')) or {}
    days = pd.get('days') or {}
    if not days:
        return
    rate_fn = make_rate_fn()
    cov = r.coverage(days, rate_fn=rate_fn, cur_of=SITE_CUR)
    matched = [(k, v) for k, v in cov.items() if v['q'] > 0 and r.cost_rmb(k[0])]
    unmatched = [(k, v) for k, v in cov.items() if v['q'] > 0 and not r.cost_rmb(k[0])]
    qm = sum(v['q'] for _, v in matched)
    qt = qm + sum(v['q'] for _, v in unmatched)
    print('\n有销量的 ASIN×站点: %d 组 / %g 件 → 命中成本表 %g 件 (%.1f%%)'
          % (len(matched) + len(unmatched), qt, qm, (qm / qt * 100) if qt else 0))
    if unmatched:
        print('⚠️ 未命中成本表(成本按 0 ⇒ 毛利虚高, 请补「产品关系管理」映射或补成本表):')
        for (a, s), v in sorted(unmatched, key=lambda x: -x[1]['q']):
            print('   %-12s %-5s %3g 件  sales=%.2f  产品名=%s'
                  % (a, s, v['q'], v['sales'], r.name(a) or '（映射里也没有）'))
    print('\n命中品: 表成本 / 易仓成本(已折成站点币种, 按 组 汇总)')
    tt = sum(v['tbl'] for _, v in matched)
    te = sum(v['erp'] for _, v in matched)
    print('   表 %.2f  易仓 %.2f  差 %+.2f' % (tt, te, tt - te))
    print('\n单台成本偏差(易仓有值且有销量, 同币种比较):')
    devs = []
    for (a, s), v in matched:
        if v['erp'] and v['q']:
            devs.append((abs(v['tbl'] / v['q'] - v['erp'] / v['q']) / abs(v['erp'] / v['q']), a, s, v))
    for dv, a, s, v in sorted(devs, reverse=True):
        print('   %-12s %-5s %3g 件  表 %9.2f/台  易仓 %9.2f/台  偏 %+8.1f%%  %s'
              % (a, s, v['q'], v['tbl'] / v['q'], v['erp'] / v['q'],
                 (v['tbl'] - v['erp']) / v['erp'] * 100, r.name(a)))


if __name__ == '__main__':
    _main()
