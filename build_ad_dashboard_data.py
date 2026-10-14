# -*- coding: utf-8 -*-
"""
构建广告周度分析看板数据: ad_weekly_all_video.json -> ad_dashboard_data.json
- 周度维度: 周六~周五, 标注一年中的周数 (W27~W33)
- ASIN归属: Asin字段优先 -> 特殊映射 -> 活动名正则 B0[A-Z0-9]{8}
  (商品推广SP/展示型推广SD按广告组Asin字段归类; 品牌推广SB按活动名归类)
- 保留广告组粒度, 支持按 国家/周数/ASIN/广告形式/广告活动 筛选与下钻
- 含视频指标: 完播次数 VideoCompleteViews / 播放至一半 VideoMidpointViews
- 新增: Campaign.GetList 活动状态映射 (已启用/已暂停/已归档), 已暂停活动添加占位记录
"""
import json, re, datetime, sys, os

SRC = r'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_weekly_all_video.json'
OUT = r'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_dashboard_data.json'
KW_SRC = r'C:/Users/paddy/WorkBuddy/2026-08-18-14-43-38/ad_keywords_all.json'

COUNTRIES = [
    {'code': 'DE', 'name': '德国', 'currency': 'EUR'},
    {'code': 'US', 'name': '美国', 'currency': 'USD'},
    {'code': 'BE', 'name': '比利时', 'currency': 'EUR'},
    {'code': 'CA', 'name': '加拿大', 'currency': 'CAD'},
    {'code': 'ES', 'name': '西班牙', 'currency': 'EUR'},
    {'code': 'FR', 'name': '法国', 'currency': 'EUR'},
    {'code': 'IE', 'name': '爱尔兰', 'currency': 'EUR'},
    {'code': 'IT', 'name': '意大利', 'currency': 'EUR'},
    {'code': 'MX', 'name': '墨西哥', 'currency': 'MXN'},
    {'code': 'NL', 'name': '荷兰', 'currency': 'EUR'},
    {'code': 'PL', 'name': '波兰', 'currency': 'PLN'},
    {'code': 'SE', 'name': '瑞典', 'currency': 'SEK'},
    {'code': 'UK', 'name': '英国', 'currency': 'GBP'},
]
COUNTRY_NAME = {c['code']: c['name'] for c in COUNTRIES}
COUNTRY_CUR = {c['code']: c['currency'] for c in COUNTRIES}

TYPE_CN = {
    'sponsoredProducts': '商品推广',
    'sponsoredBrands': '品牌推广',
    'sponsoredDisplay': '展示型推广',
}

STATE_CN = {
    'enabled': '已启用',
    'paused': '已暂停',
    'archived': '已归档',
    'disabled': '已归档',
}

# 广告条目 -> ASIN 归属：统一走 ad_asin_rules（唯一权威规则源，2026-10-10 收敛）
# ⚠️ 不要在本文件里再写一份 SPECIAL_ASIN / 正则副本。SB 品牌推广的兜底规则必须
#    按站点区分（同一个 SKU 在 US 与欧洲是不同 ASIN），副本必然漂移。
#    调用时必须把站点传进去，否则欧洲的 X1 会被归到北美 ASIN。
from ad_asin_rules import attribute as extract_asin


def week_label(start_str):
    """周六-周五为1周, 周数=该周周一的ISO周数"""
    d = datetime.date.fromisoformat(start_str) + datetime.timedelta(days=2)
    iso = d.isocalendar()
    return f'W{iso[1]:02d}'


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    output = d['output']
    campaigns_raw = d.get('campaigns', {})

    # 建立 CampaignID / CampaignName -> State 映射
    campaign_state_map = {}
    campaign_info_map = {}
    for country, camp_items in campaigns_raw.items():
        for it in camp_items:
            cid = str(it.get('CampaignID') or it.get('CampaignID_Str') or '')
            cname = (it.get('Name') or it.get('CampaignName') or '').strip()
            state = it.get('State') or 'enabled'
            if cid:
                campaign_state_map[cid] = state
            if cname:
                campaign_state_map[cname] = state
            campaign_info_map[cid] = {
                'id': cid, 'name': cname, 'type': it.get('CampaignType') or '',
                'state': state, 'country': country,
                'sponsoredType': it.get('SponsoredType') or '',
            }

    print(f'Campaign state map: {len(campaign_state_map)} entries')
    state_dist = {}
    for s in campaign_state_map.values():
        state_dist[s] = state_dist.get(s, 0) + 1
    print(f'  状态分布: {state_dist}')

    records = []
    week_set = {}
    asin_set = set()
    country_data = {}
    type_set = set()
    campaign_set = {}
    state_set = set()
    no_asin = []

    for country, cdata in output.items():
        if country not in COUNTRY_NAME:
            continue
        country_data[country] = False
        for wk_key, items in cdata['weeks'].items():
            start, end = wk_key.split('_')
            label = week_label(start)
            for it in items:
                rep = it.get('Report') or {}
                impressions = rep.get('Impressions') or 0
                clicks = rep.get('Clicks') or 0
                cost = rep.get('Cost') or 0
                orders = rep.get('Orders') or 0
                sales = rep.get('SalesAmount') or 0
                if impressions == 0 and clicks == 0 and cost == 0 and orders == 0 and sales == 0:
                    continue  # 无活动周跳过
                asin = extract_asin(it, country)
                if not asin:
                    no_asin.append((country, label, it.get('CampaignName')))
                    continue
                # 该周确认有有效记录后才登记周信息, 避免"幽灵周"
                week_set[label] = {'label': label, 'start': start, 'end': end}
                ctype = it.get('CampaignType') or ''
                type_set.add(ctype)
                asin_set.add(asin)
                country_data[country] = True
                cid = str(it.get('CampaignID') or it.get('CampaignID_Str') or '')
                cname = (it.get('CampaignName') or '').strip()
                # 使用 Campaign.GetList 映射的活动状态
                state_raw = campaign_state_map.get(cid) or campaign_state_map.get(cname) or it.get('State') or 'enabled'
                state_set.add(state_raw)
                gid = str(it.get('AdGroupID') or '')
                gname = (it.get('AdGroupName') or '').strip()
                if cid:
                    campaign_set[cid] = {'id': cid, 'name': cname, 'type': ctype,
                                         'asin': asin, 'country': country,
                                         'sku': it.get('Sku') or '',
                                         'portfolio': it.get('PortfolioName') or '',
                                         'state': state_raw}
                records.append({
                    'country': country, 'week': label, 'start': start, 'end': end,
                    'asin': asin, 'sku': it.get('Sku') or '',
                    'campaignId': cid, 'campaign': cname,
                    'adGroupId': gid, 'adGroup': gname, 'type': ctype,
                    'state': state_raw,
                    'impressions': impressions, 'clicks': clicks, 'cost': round(cost, 2),
                    'orders': orders, 'sales': round(sales, 2),
                    'videoComplete': rep.get('VideoCompleteViews') or 0,
                    'videoMidpoint': rep.get('VideoMidpointViews') or 0,
                })

    # 为已暂停/已归档但无广告记录的活动添加占位记录
    # 使用最新一周作为占位周
    latest_week = max(week_set.keys(), key=lambda x: int(x[1:])) if week_set else None
    latest_wk_info = week_set.get(latest_week) if latest_week else None

    placeholder_count = 0
    for cid, cinfo in campaign_info_map.items():
        if cinfo['state'] == 'enabled':
            continue  # 已启用的活动已有广告记录
        if cid in campaign_set:
            # 该活动已有记录（可能是已暂停但之前周有数据），不需要占位
            continue
        if not latest_wk_info:
            continue
        # 尝试提取ASIN
        asin = extract_asin(cinfo, cinfo.get('country'))
        if not asin:
            # 无ASIN的已暂停活动也加入 campaign_set（供广告活动筛选器显示）
            campaign_set[cid] = {
                'id': cid, 'name': cinfo['name'], 'type': cinfo['type'],
                'asin': '', 'country': cinfo['country'],
                'sku': '', 'portfolio': '', 'state': cinfo['state']
            }
            no_asin.append((cinfo['country'], latest_wk_info['label'], cinfo['name']))
            continue
        asin_set.add(asin)
        country_data[cinfo['country']] = True
        type_set.add(cinfo['type'])
        state_set.add(cinfo['state'])
        campaign_set[cid] = {
            'id': cid, 'name': cinfo['name'], 'type': cinfo['type'],
            'asin': asin, 'country': cinfo['country'],
            'sku': '', 'portfolio': '', 'state': cinfo['state']
        }
        records.append({
            'country': cinfo['country'], 'week': latest_wk_info['label'],
            'start': latest_wk_info['start'], 'end': latest_wk_info['end'],
            'asin': asin, 'sku': '',
            'campaignId': cid, 'campaign': cinfo['name'],
            'adGroupId': '', 'adGroup': '', 'type': cinfo['type'],
            'state': cinfo['state'],
            'impressions': 0, 'clicks': 0, 'cost': 0,
            'orders': 0, 'sales': 0,
            'videoComplete': 0, 'videoMidpoint': 0,
            'isPlaceholder': True,
        })
        placeholder_count += 1

    weeks = [week_set[k] for k in sorted(week_set.keys(), key=lambda x: int(x[1:]))]
    countries = []
    for c in COUNTRIES:
        cc = dict(c)
        cc['hasData'] = country_data.get(c['code'], False)
        countries.append(cc)

    print(f'周数: {[w["label"] for w in weeks]}')
    print(f'ASIN: {sorted(asin_set)}')
    print(f'广告形式: {sorted(type_set)}')
    print(f'状态分布: {sorted(state_set)}')
    print(f'国家有数据: {[c for c in countries if c["hasData"]]}')
    print(f'广告活动数: {len(campaign_set)}')
    print(f'记录数: {len(records)} (含 {placeholder_count} 个占位记录)')
    print(f'无法归类ASIN: {len(no_asin)}')
    for x in no_asin[:5]:
        print('  ', x)

    # states: 已启用/已暂停/已归档三态, hasData 根据实际数据标记
    ALL_STATES = ['enabled', 'paused', 'archived']
    state_has_data = {s: False for s in ALL_STATES}
    for s in state_set:
        state_has_data[s] = True
    states = [{'code': s, 'name': STATE_CN.get(s, s), 'hasData': state_has_data.get(s, True)} for s in ALL_STATES]

    # ---- 加载投放词(关键词)数据 ----
    keywords_flat = []
    try:
        kw_data = json.load(open(KW_SRC, encoding='utf-8'))
        kw_weeks_set = set(w['label'] for w in weeks)
        for country, cdata in kw_data.get('countries', {}).items():
            if country not in COUNTRY_NAME:
                continue
            for cid, camp in cdata.get('campaigns', {}).items():
                for agid, ag in camp.get('adGroups', {}).items():
                    for kw in ag.get('keywords', []):
                        # 只保留看板周范围内的周数据
                        filtered_weeks = {}
                        for wk_label, wk_data in (kw.get('weeks') or {}).items():
                            if wk_label in kw_weeks_set:
                                filtered_weeks[wk_label] = {
                                    'impressions': wk_data.get('impressions', 0),
                                    'clicks': wk_data.get('clicks', 0),
                                    'cost': round(wk_data.get('cost', 0), 2),
                                    'orders': wk_data.get('orders', 0),
                                    'sales': round(wk_data.get('sales', 0), 2),
                                }
                        # 至少有一周有数据才保留
                        has_data = any(d['impressions'] or d['clicks'] or d['cost'] or d['orders'] or d['sales'] for d in filtered_weeks.values())
                        if not has_data:
                            continue
                        keywords_flat.append({
                            'country': country,
                            'campaignId': str(cid),
                            'adGroupId': str(agid),
                            'adGroupName': ag.get('name', ''),
                            'keywordId': str(kw.get('keywordId', '')),
                            'keywordText': kw.get('keywordText', ''),
                            'matchType': kw.get('matchType', ''),
                            'state': kw.get('state', ''),
                            'bid': kw.get('bid', 0),
                            'weeks': filtered_weeks,
                        })
        print(f'投放词数据: {len(keywords_flat)} 个关键词 (有数据的)')
    except Exception as e:
        print(f'Warning: 投放词数据未加载: {e}')

    result = {
        'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'countries': countries,
        'weeks': weeks,
        'asins': sorted(asin_set),
        'types': [{'code': t, 'name': TYPE_CN.get(t, t)} for t in sorted(type_set)],
        'states': states,
        'campaigns': [campaign_set[k] for k in sorted(campaign_set.keys())],
        'records': records,
        'keywords': keywords_flat,
    }
    json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'Saved {OUT} ({os.path.getsize(OUT)} bytes)')


if __name__ == '__main__':
    main()
