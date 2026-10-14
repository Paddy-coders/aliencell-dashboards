# -*- coding: utf-8 -*-
"""把云端「财务录入」(Supabase mapping.data.finance) 拉成本地 finance_inputs.json

链路位置: finance_inputs.html 录入 → 云端 → **sync_finance_inputs.py** → finance_inputs.json
          → build_profit_metrics.py (load_finance) → profit_metrics.json → 日/月/周三看板

为什么不做成构建时直接读云端:
  - 构建脚本要保持「离线可重跑」(周一/每日自动化), 不能依赖网络
  - finance_inputs.json 是**构建期快照**, 看一眼就知道那次构建用的是哪份财务数据

用法:
  python sync_finance_inputs.py            # 拉云端并写 finance_inputs.json
  python sync_finance_inputs.py --show     # 只打印云端现状, 不写文件
  python sync_finance_inputs.py --file x.json   # 从本地 JSON 灌入(离线补救/首次迁移)

口径 (2026-10-12 与用户确认):
  otherOrders: ym(YYYY-MM) + asin + qty          —— 非亚马逊渠道订单(走亚马逊多渠道配送的那部分)
  reviewFees : ym + site + asin + amount + cur + note —— 测评费用; asin 可空(=该站点当月全 SKU)
"""
import argparse
import json
import os
import re
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.path.join(BASE_DIR, 'finance_inputs.json')

SB_URL = 'https://oovvqvgrjqwogjwswaxx.supabase.co'
SB_KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'
SB_SELECT = SB_URL + '/rest/v1/mapping?select=data,updated_at&id=eq.1'

SITE_CUR = {'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'UK': 'GBP', 'JP': 'JPY', 'AU': 'AUD',
            'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'BE': 'EUR',
            'IE': 'EUR', 'PL': 'PLN', 'SE': 'SEK'}

NOTE = ('财务手工录入(其他渠道订单 / 测评费用)。云端权威源 = Supabase mapping.data.finance；'
        '本文件是构建期快照，由 sync_finance_inputs.py 从云端拉取生成。')
HOWTO = ('在 finance_inputs.html 里录入或批量导入 → 保存(写入云端) → 跑 sync_finance_inputs.py '
         '刷新本文件 → 重建看板。')


def norm_ym(v):
    """各种写法 → YYYY-MM (2026-9 / 2026/09 / 2026年9月 / 202609 / 2026-09-15)"""
    s = str(v or '').strip()
    m = re.match(r'^(\d{4})[-/年.](\d{1,2})', s)
    if m:
        return '%s-%02d' % (m.group(1), int(m.group(2)))
    m = re.match(r'^(\d{4})(\d{2})$', s)
    if m:
        return '%s-%s' % (m.group(1), m.group(2))
    return ''


def norm_asin(v):
    return re.sub(r'\s|"', '', str(v or '')).upper()


def is_asin(s):
    return bool(re.match(r'^[A-Z0-9]{10}$', s or ''))


def num_of(v):
    s = re.sub(r'[,\s元]', '', str(v if v is not None else ''))
    s = s.replace('¥', '').replace('$', '').replace('€', '').replace('£', '')
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def clean(raw):
    """云端原始 finance → 规范化 + 校验; 返回 (otherOrders, reviewFees, 丢弃计数明细)"""
    oo, rf = [], []
    oo_drop = rf_drop = 0
    ym_drop = 0

    for x in ((raw or {}).get('otherOrders') or []):
        ym, asin, qty = norm_ym(x.get('ym')), norm_asin(x.get('asin')), num_of(x.get('qty'))
        if not ym or not is_asin(asin) or qty <= 0:
            oo_drop += 1
            if not ym:
                ym_drop += 1
            continue
        oo.append({'ym': ym, 'asin': asin, 'qty': round(qty, 4), 'note': str(x.get('note') or '').strip()})

    for x in ((raw or {}).get('reviewFees') or []):
        ym = norm_ym(x.get('ym'))
        site = str(x.get('site') or '').strip().upper()
        asin = norm_asin(x.get('asin'))
        amt = num_of(x.get('amount'))
        cur = str(x.get('cur') or '').strip().upper()
        if not ym or site not in SITE_CUR or not amt or (asin and not is_asin(asin)):
            rf_drop += 1
            if not ym:
                ym_drop += 1
            continue
        rf.append({'ym': ym, 'site': site, 'asin': asin, 'amount': round(amt, 4),
                   'cur': cur or SITE_CUR[site], 'note': str(x.get('note') or '').strip()})

    # 同 (ym, asin) 的订单合并数量(与页面端一致)
    merged = {}
    for o in oo:
        k = (o['ym'], o['asin'])
        if k in merged:
            merged[k]['qty'] = round(merged[k]['qty'] + o['qty'], 4)
            if o['note'] and o['note'] not in merged[k]['note']:
                merged[k]['note'] = (merged[k]['note'] + ' ' + o['note']).strip()
        else:
            merged[k] = dict(o)
    oo = [merged[k] for k in sorted(merged.keys())]

    rf.sort(key=lambda x: (x['ym'], x['site'], x['asin']))
    return oo, rf, {'ooDrop': oo_drop, 'rfDrop': rf_drop, 'ymDrop': ym_drop}


def fetch_cloud():
    req = urllib.request.Request(SB_SELECT, headers={
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        rows = json.loads(r.read().decode('utf-8'))
    if not rows:
        raise RuntimeError('云端 mapping 表 id=1 无数据')
    data = rows[0].get('data') or {}
    return data, (rows[0].get('updated_at') or '')


def summarize(oo, rf):
    qty = sum(x['qty'] for x in oo)
    by_cur = {}
    for x in rf:
        by_cur[x['cur']] = by_cur.get(x['cur'], 0.0) + x['amount']
    amt = ' · '.join('%s %s' % (round(by_cur[c], 2), c) for c in sorted(by_cur)) or '0'
    return qty, amt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', action='store_true', help='只打印云端现状, 不写文件')
    ap.add_argument('--file', help='改从本地 JSON 读取(离线补救)')
    args = ap.parse_args()

    if args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        raw = raw.get('finance') if isinstance(raw, dict) and 'finance' in raw else raw
        cloud_at = '(本地文件 %s)' % os.path.basename(args.file)
    else:
        data, updated_at = fetch_cloud()
        raw = data.get('finance') or {}
        cloud_at = updated_at
        print('云端 mapping.data.finance: %s' % (updated_at or '(无 updated_at)'))
        print('云端全部键: %s' % ', '.join(sorted([k for k in data.keys()])))

    oo, rf, drop = clean(raw)
    qty, amt = summarize(oo, rf)
    print('其他渠道订单 %d 条 · 合计 %g 台' % (len(oo), qty))
    for o in oo[:20]:
        print('    %s  %s  x%g  %s' % (o['ym'], o['asin'], o['qty'], o['note']))
    if len(oo) > 20:
        print('    ...(共 %d 条)' % len(oo))
    print('测评费用 %d 条 · %s' % (len(rf), amt))
    for x in rf[:20]:
        print('    %s  %s  %s  %g %s  %s' % (x['ym'], x['site'], x['asin'] or '(全站)', x['amount'], x['cur'], x['note']))
    if len(rf) > 20:
        print('    ...(共 %d 条)' % len(rf))
    if drop['ooDrop'] or drop['rfDrop']:
        print('⚠️  丢弃格式不符: 其他渠道订单 %d 条 / 测评费 %d 条 (其中月份不可解析 %d 条)'
              % (drop['ooDrop'], drop['rfDrop'], drop['ymDrop']))
    if not oo and not rf:
        print('(云端暂无财务录入数据 —— 看板的剔除/测评费列将为 0, 属正常)')

    if args.show:
        return

    payload = {
        'note': NOTE,
        'howto': HOWTO,
        'updatedAt': cloud_at,
        'otherOrders': oo,
        'reviewFees': rf,
    }
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print('已写 %s (%d bytes)' % (OUT_FILE, os.path.getsize(OUT_FILE)))
    print('下一步: 重建看板 (日 §A.3 / 月 build_monthly_dashboards.py / 周 integrate_profit.py 四步)')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('同步失败: %s' % e, file=sys.stderr)
        sys.exit(1)
