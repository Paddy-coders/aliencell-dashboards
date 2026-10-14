#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 JoyBuy 看板的示例数据（仅用于版式预览，不参与生产链路）。

输出：
  _demo_joybuy_api.json      模拟开放平台 API 采集结果（订单 + SKU/库存）
  _demo_joybuy_traffic.json  模拟商家后台流量报表（流量/加购/收藏）
"""
import io
import json
import os
import random
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(20260926)

SKUS = [
    ('JB-UltraDock-8in1', 'Ultra Dock 8-in-1 Docking Station'),
    ('JB-M4Dock-Pro', 'M4 & M4 Pro Dock for Mac Mini'),
    ('JB-Hub-7in1-USB', '7-in-1 USB-C Hub'),
    ('JB-Cable-240W', '240W USB-C Charging Cable'),
]
DAYS = 84  # 12 周

end = datetime.now().date()
start = end - timedelta(days=DAYS - 1)

orders = []
traffic_rows = []

for i in range(DAYS):
    d = start + timedelta(days=i)
    ds = d.strftime('%Y-%m-%d')
    dow = (d.weekday() + 1) % 7  # 周六=6
    weekend_boost = 1.25 if d.weekday() >= 5 else 1.0
    growth = 1.0 + i / float(DAYS) * 0.45
    for sku, name in SKUS:
        base = {'JB-UltraDock-8in1': 26, 'JB-M4Dock-Pro': 18, 'JB-Hub-7in1-USB': 12, 'JB-Cable-240W': 9}[sku]
        pv = int(base * 22 * weekend_boost * growth * random.uniform(0.82, 1.2))
        uv = int(pv * random.uniform(0.24, 0.34))
        atc = int(pv * random.uniform(0.018, 0.038))
        fav = int(pv * random.uniform(0.008, 0.020))
        o = int(uv * random.uniform(0.030, 0.062))
        price = {'JB-UltraDock-8in1': 289.0, 'JB-M4Dock-Pro': 199.0,
                 'JB-Hub-7in1-USB': 89.0, 'JB-Cable-240W': 39.9}[sku]
        sales = round(o * price * random.uniform(0.92, 1.08), 2)
        traffic_rows.append(dict(date=ds, sku=sku, name=name, uv=uv, pv=pv,
                                 addToCart=atc, favorites=fav, orders=o, sales=sales))
        for _ in range(o):
            orders.append({
                'orderId': 'JB%s%04d' % (d.strftime('%y%m%d'), random.randint(1, 9999)),
                'createTime': ds + ' 1%d:%02d:00' % (random.randint(0, 9), random.randint(0, 59)),
                'orderItems': [{'sku': sku, 'productName': name,
                                'quantity': random.choice([1, 1, 1, 2]),
                                'amount': round(price * random.uniform(0.95, 1.05), 2)}],
            })

api_payload = {
    'generatedAt': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
    'source': 'joybuy-openapi',
    'shops': [{'shopId': '1000012345', 'shopName': 'iVANKY JoyBuy 旗舰店'}],
    'products': [{'sku': s, 'productName': n} for s, n in SKUS],
    'skus': [{'sku': s, 'productName': n, 'state': 'onSale'} for s, n in SKUS],
    'stocks': [{'sku': s, 'stock': random.randint(30, 480)} for s, n in SKUS],
    'orders': orders,
    'aftersales': [],
    'warnings': [],
}

traffic_payload = {
    'generatedAt': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
    'granularity': 'day',
    'sourceFile': '_demo_traffic.xlsx',
    'currency': 'CNY',
    'rows': traffic_rows,
}

io.open(os.path.join(HERE, '_demo_joybuy_api.json'), 'w', encoding='utf-8', newline='\n').write(
    json.dumps(api_payload, ensure_ascii=False, indent=2))
io.open(os.path.join(HERE, '_demo_joybuy_traffic.json'), 'w', encoding='utf-8', newline='\n').write(
    json.dumps(traffic_payload, ensure_ascii=False, indent=2))

print('示例数据已生成：%d 天 / %d 个 SKU / %d 条订单 / %d 行流量' %
      (DAYS, len(SKUS), len(orders), len(traffic_rows)))
