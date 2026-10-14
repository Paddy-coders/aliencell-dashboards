# _fill_woot_cost.py — 把用户成本表(Desktop/1.xlsx, US 行)按 asinMap 映射写入云端 wootCfg.cost
# 口径(2026-10-10 用户确认):
#   unit($/台)   = 产品成本(RMB) / 6.7045(2026-10 月初 USD→CNY, 与看板同口径)
#   freight($/台) = 头程(RMB) / 6.7045     ← 尾程是「海外仓尾程」, 只有 FBM 订单才计;
#                                          Woot/官方都走 FBA(ERP 利润报表已含 FBA 配送费), 不计尾程
#   ※ 头程目前是预估值, 后续用户会给推移后的实际头程 → 改 COST 表重跑本脚本即可
# 数据来自 sheetagent MCP 已读取的 25 个 US 行; 只配置 asinMap 里存在的 US ASIN。
import json, urllib.request

FX = 6.7045
SB = 'https://oovvqvgrjqwogjwswaxx.supabase.co/rest/v1/mapping?id=eq.1'
KEY = 'sb_publishable_OOmvEVK2RnetfT_tWKHGgA_epmNnz0s'
HDRS = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
        'x-admin-key': 'wb-map-2026'}  # 写入需管理头(与 woot.html 一致)

# 产品名(=asinMap.name=成本表备注) -> (头程RMB, 尾程USD, 产品成本RMB)   [US 行]
COST = {
  '滚轴': (20, 16.7, 286.21),
  'X1L/X1通用增高底座': (327, 37.7, 1020.64),
  '材料包': (20, 12.7, 24.7787610619469),
  '吸尘器': (29, 7.7, 266.371681415929),
  'X1系列蜂窝板': (58, 17.4, 216.814159292035),
  '净化器': (240, 37, 1238.93805309735),
  '气泵': (29, 11, 495.575221238938),
  'X1L主机+60W蓝光头+气泵+滚轴+X1系列蜂窝板': (528, 109, 5197.81415929204),
  'X1L主机+60W蓝光头+气泵': (519, 103, 4694),
  'X1主机+60W蓝光头+气泵': (519, 103, 4911.05),
  'X1系列60W蓝光激光头': (20, 7.7, 2713.27433628319),
  'X1L主机+40W蓝光头+气泵+滚轴+X1系列蜂窝板': (528, 109, 4737.62831858407),
  'X1L主机+40W蓝光头+气泵': (519, 103, 4018),
  'X1主机+40W蓝光头+气泵': (519, 103, 4263.5),
  'X1系列40W蓝光激光头': (10, 7.7, 1858.40707964602),
  'X1L主机+20W蓝光头+气泵+滚轴+X1系列蜂窝板': (528, 109, 3851.81415929204),
  'X1L主机+20W蓝光头+气泵': (519, 103, 3349),
  'X1主机+20W蓝光头+气泵': (519, 103, 3631),
  'X1系列20W蓝光激光头': (10, 7.7, 1003.53982300885),
  'E1主机+20W蓝光头+滚轴+E1系列蜂窝板': (279, 37.7, 2671.11),
  'E1主机+20W蓝光头+滚轴': (221, 37, 2563.24),
  'E1主机+20W蓝光头': (202, 27, 2227.64),
  'E1主机+10W蓝光头+滚轴+E1系列蜂窝板': (279, 37.7, 2278.82),
  'E1主机+10W蓝光头+滚轴': (221, 37, 2170.98),
  'E1主机+10W蓝光头': (202, 27, 1832.38),
}

req = urllib.request.Request(SB.replace('id=eq.1', 'select=data&id=eq.1'), headers=HDRS)
data = json.load(urllib.request.urlopen(req, timeout=20))[0]['data']

cost = {}
miss = []
for r in data['asinMap']:
    if r.get('country') != 'US':
        continue
    name = r.get('name')
    if name in COST:
        tou_cheng, wei_cheng, chan_pin = COST[name]
        unit = round(chan_pin / FX, 2)
        freight = round(tou_cheng / FX, 2)   # FBA 订单不计尾程(wei_cheng)
        cost[r['asin']] = {'unit': unit, 'freight': freight}
        print('%-12s %-42s unit=%8.2f freight=%8.2f' % (r['asin'], name, unit, freight))
    else:
        miss.append((r['asin'], name))

cfg = data.get('wootCfg') or {}
price = cfg.get('price') if isinstance(cfg, dict) else None
data['wootCfg'] = {
    'price': price if isinstance(price, (int, float)) and price > 0 else 1380,
    'cost': cost,
}
body = json.dumps({'data': data, 'updated_at': __import__('datetime').datetime.now().isoformat()},
                  ensure_ascii=False).encode('utf-8')
req = urllib.request.Request(SB, data=body, headers={**HDRS, 'Prefer': 'return=minimal'}, method='PATCH')
urllib.request.urlopen(req, timeout=30)
print()
print('PATCH OK · 配置 ASIN 数 =', len(cost), '· 未匹配:', miss)
