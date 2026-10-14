# -*- coding: utf-8 -*-
"""
make_tombstones.py —— 为「曾经部署过、现已废弃」的地址生成跳转墓碑页

背景（2026-09-23 实测）：
  staging 部署工具 **只增不删** —— 本地把 _deploy/ad_dashboard.html 删掉再重新部署，
  线上 /ad_dashboard.html 依然返回 200 和那份 727KB 的 9/20 旧副本（陈旧数据可被书签直接打开）。
  唯一可行手段：在 _deploy 下放一个**同名的小跳转页**覆盖它。

所以：任何废弃页面名都写进 TOMBSTONES，跑本脚本生成 → 重新部署 → 旧地址变成"已迁移"提示。

用法： python make_tombstones.py
校验： check_data_integrity.js 的 G6（墓碑必须带 wb-tombstone 标记且 < 2KB）
"""
import os

BASE = r'C:\Users\paddy\WorkBuddy\2026-08-18-14-43-38'
DEPLOY = os.path.join(BASE, '_deploy')

# 废弃地址 → 应该跳去哪
TOMBSTONES = {
    'ad_dashboard.html': 'ad.html',   # 广告看板的旧构建产物名（正式产物流向 _deploy/ad.html）
}

TPL = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="refresh" content="0; url={target}">
<title>页面已迁移 · Aliencell 数据看板</title>
<!-- wb-tombstone 旧地址墓碑页：此名曾是构建产物，现已并入 {target}。
     保留此文件仅为覆盖 staging 上的历史副本（部署工具只增不删），防止旧数据被书签打开。 -->
<style>
  body{{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f5f7fa;color:#1f2329}}
  .box{{background:#fff;border:1px solid #e5e6eb;border-radius:10px;padding:24px 28px;text-align:center;
       box-shadow:0 2px 12px rgba(0,0,0,.06)}}
  a{{color:#2f6fed;text-decoration:none;font-weight:600}}
</style>
</head>
<body>
  <div class="box">
    <p>该地址已迁移，正在跳转到 <a href="{target}">数据看板</a>…</p>
    <p style="color:#86909c;font-size:13px">若未自动跳转请点击上面的链接。</p>
  </div>
</body>
</html>
'''

def main():
    if not os.path.isdir(DEPLOY):
        print('FAIL  部署目录不存在:', DEPLOY)
        return 1
    rc = 0
    for name, target in TOMBSTONES.items():
        path = os.path.join(DEPLOY, name)
        body = TPL.format(target=target)
        before = None
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                before = f.read()
        if before == body:
            print('SAME  %-24s 已是墓碑页(未改)' % name)
        else:
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(body)
            print('WRITE %-24s → 跳转 %s (%d 字节)' % (name, target, len(body.encode('utf-8'))))
        size = os.path.getsize(path)
        if size >= 2048 or 'wb-tombstone' not in body:
            print('FAIL  %-24s 墓碑页不合规(>=2KB 或缺标记)' % name)
            rc = 1
    return rc

if __name__ == '__main__':
    raise SystemExit(main())
