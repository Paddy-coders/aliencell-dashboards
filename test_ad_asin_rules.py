# -*- coding: utf-8 -*-
"""ad_asin_rules 归因规则单测

规则本身是「数据正确性」的源头：归错产品 = 毛利挂到别的产品上，
而且看板里看不出来。所以这里把四级优先级 + 站点差异 + 误判挡板逐条钉住。

用法：cd 2026-08-18-14-43-38 && python test_ad_asin_rules.py
"""
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ad_asin_rules as R

PASS = 0
FAIL = 0


def chk(title, got, want):
    global PASS, FAIL
    if got == want:
        PASS += 1
        print('  PASS %s' % title)
    else:
        FAIL += 1
        print('  FAIL %s  {"got": %r, "want": %r}' % (title, got, want))


def case(**kw):
    return kw


print('=== 第 1 层：条目自带 Asin 优先 ===')
chk('有 Asin 直接用',
    R.attribute(case(Asin='B0ABCDEFGH', CampaignName='任意活动名'), 'US'), 'B0ABCDEFGH')
chk('有 Asin 时忽略活动名里的其它 ASIN',
    R.attribute(case(Asin='B0ABCDEFGH', CampaignName='A-X1-B0H75HMBF5'), 'US'), 'B0ABCDEFGH')

print('=== 第 2 层：活动名里的 ASIN 字面量（运营加 ASIN 码后走这层）===')
chk('活动名含 ASIN（历史活动）',
    R.attribute(case(CampaignName='X1-SB-词组-定投旗舰店首页-CPC-B0H69JJZ1M'), 'US'), 'B0H69JJZ1M')
chk('活动名含 ASIN 时不再走兜底（未来 SB 标题带码）',
    R.attribute(case(CampaignName='A-X1-40W-SB-视频-B0H9YBM4H1', PortfolioName='X1'), 'US'), 'B0H9YBM4H1')
chk('活动名 ASIN 覆盖 SPECIAL 表（优先级更高）',
    R.attribute(case(CampaignName='X1-SBV-片段2-B0H9Y5QJX5'), 'US'), 'B0H9Y5QJX5')

print('=== 第 3 层：SPECIAL 精确名映射 ===')
for name in ('X1-SBV-片段2', 'X1-SB-定投旗舰店-LC-B2B', 'X1-SB-定投旗舰店首页-B2B'):
    chk('SPECIAL %s' % name, R.attribute(case(CampaignName=name), 'US'), 'B0H69JJZ1M')

print('=== 第 4 层：系列兜底（2026-10-10 运营指认）===')
chk('Lite 商品集 → Lite 40W',
    R.attribute(case(CampaignName='A-Lite-SB商品集', PortfolioName='X1-Lite'), 'US'), 'B0H9YBM4H1')
chk('Lite 系列其它 SB → Lite 40W',
    R.attribute(case(CampaignName='A-Lite-SB-新活动', PortfolioName='X1-Lite'), 'US'), 'B0H9YBM4H1')
chk('X1 40W（US）→ 北美 40W',
    R.attribute(case(CampaignName='A-X1-40W-SBV-片段1-Broad', PortfolioName='X1'), 'US'), 'B0H69JJZ1M')
chk('X1 40W（DE）→ 欧洲 40W（同 SKU 不同 ASIN）',
    R.attribute(case(CampaignName='A-X1-40W-SBV-片段1-Broad', PortfolioName='X1'), 'DE'), 'B0HH8J6SSL')
chk('泛 X1（US）→ 北美 40W',
    R.attribute(case(CampaignName='A-X1-SBV-VCPM-Storefront', PortfolioName='X1'), 'US'), 'B0H69JJZ1M')
chk('泛 X1（UK）→ 欧洲 40W',
    R.attribute(case(CampaignName='A-X1-SBV-片段1-广泛', PortfolioName='X1'), 'UK'), 'B0HH8J6SSL')
chk('站点缺失时按欧洲款兜底（宁可保守）',
    R.attribute(case(CampaignName='A-X1-SBV-片段1-词组', PortfolioName='X1')), 'B0HH8J6SSL')
chk('小写 cc 也能识别',
    R.attribute(case(CampaignName='A-X1-SBV-Storefront', PortfolioName='X1'), 'us'), 'B0H69JJZ1M')
chk('X1-Lite 同时含 Lite 与 X1 时 Lite 优先',
    R.attribute(case(CampaignName='A-X1-Lite-SB', PortfolioName='X1-Lite'), 'US'), 'B0H9YBM4H1')

print('=== 误判挡板 ===')
chk('X140 不吃 X1 兜底（PortfolioName 恰好也叫 X1）',
    R.attribute(case(CampaignName='A-X140-Auto', PortfolioName='X1'), 'DE'), None)
chk('LC&EM 这类无系列线索的活动不猜',
    R.attribute(case(CampaignName='LC&EM-EC-B-0728'), 'US'), None)
chk('空活动名不猜', R.attribute(case(CampaignName=''), 'US'), None)
chk('整条为空不猜', R.attribute({}, 'US'), None)

print('=== 向后兼容别名 ===')
chk('extract_asin(item) 等价', R.extract_asin(case(Asin='B0ABCDEFGH')), 'B0ABCDEFGH')

print('\n结果: %d pass, %d fail' % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
