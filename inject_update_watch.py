# -*- coding: utf-8 -*-
"""把 cloud_update_watch.js 片段注入五套看板的源文件(4 个模板 + integrate_ads.py)。

统一注入以保证五处代码逐字节一致。幂等：已含 cloudUpdateWatch 的文件跳过。
用法：
    python inject_update_watch.py          # 只检查锚点
    python inject_update_watch.py --apply  # 实际写入
"""
import os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
PROD = r'C:\Users\paddy\WorkBuddy\2026-08-17-14-21-33'

TARGETS = [
    os.path.join(BASE, 'daily_dashboard_template.html'),   # → daily.html
    os.path.join(BASE, 'ad_dashboard_template.html'),      # → ad.html
    os.path.join(BASE, 'monthly_dashboard_template.html'), # → monthly.html
    os.path.join(BASE, 'target_dashboard_template.html'),  # → target.html
    os.path.join(PROD, 'integrate_ads.py'),                # → product.html
    # 产物：integrate_ads.py 的输出即部署用的 product.html（生成链路重跑时由 integrate 自动带上片段）
    os.path.join(PROD, 'filterable_dashboard.html'),
]

ANCHOR_LF = ("    localStorage.setItem('pc_woot', JSON.stringify(cloud));\n"
             "    location.reload();\n"
             "  } catch (e) {}\n"
             "})();\n")


def main():
    apply = '--apply' in sys.argv
    frag_path = os.path.join(BASE, 'cloud_update_watch.js')
    with open(frag_path, encoding='utf-8') as f:
        frag = f.read()
    assert 'cloudUpdateWatch' in frag and frag.startswith('\n'), 'fragment 异常'

    for path in TARGETS:
        name = os.path.basename(path)
        if not os.path.exists(path):
            print('MISSING  %s' % path)
            continue
        with open(path, encoding='utf-8', newline='') as f:
            src = f.read()
        crlf = src.count('\r\n')
        anchor = ANCHOR_LF.replace('\n', '\r\n') if crlf else ANCHOR_LF
        eol = '\r\n' if crlf else '\n'
        frag_txt = frag.replace('\n', eol) if crlf else frag
        mode = 'INSERT'
        at = None
        i = src.find('// ===== 云端更新提示')
        if i >= 0:
            # 已注入：原地替换。⚠️ 不再依赖「前一段的结尾」当锚点 —— 各看板的载入同步块
            # (cloudWootSync/统一 dirty 同步)后续被改写过，老锚点会命中 0 次(2026-10-14)。
            j = src.find('})();', i)
            if j < 0:
                print('FAIL     %-34s 片段结尾标记缺失' % name)
                continue
            while i > 0 and src[i - 1] in '\r\n':
                i -= 1
            k = j + len('})();')
            while k < len(src) and src[k] in '\r\n':
                k += 1
            at = i
            src = src[:i] + src[k:]
            mode = 'REPLACE'
            print('OLD OFF  %-34s 摘除旧片段(原地替换)' % name)
        else:
            n = src.count(anchor)
            if n != 1:
                print('FAIL     %-34s 锚点命中 %d 次(应为 1)' % (name, n))
                continue
        if not apply:
            print('READY    %-34s %s · 行尾 %s' % (name, mode, 'CRLF' if crlf else 'LF'))
            continue
        if mode == 'REPLACE':
            # 摘除时吃掉了前后换行，这里补回一个空行分隔(与首次注入的排版一致)
            out = src[:at] + eol + frag_txt + src[at:]
        else:
            out = src.replace(anchor, anchor + frag_txt, 1)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('INJECTED %-34s %s +%d 字节' % (name, mode, len(out) - len(src) - (len(frag_txt) if mode == 'REPLACE' else 0)))


if __name__ == '__main__':
    main()
