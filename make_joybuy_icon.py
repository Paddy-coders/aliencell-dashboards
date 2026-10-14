# 生成 JoyBuy 开发者应用图标（512x512 PNG，纯标准库，无第三方依赖）
# 设计：深蓝->亮蓝渐变圆角方块 + 三根白色柱状（数据看板语义），2x 超采样抗锯齿
import zlib, struct

W = H = 512
CORNER = 104
S = 2  # 超采样倍数

TOP = (24, 52, 99)      # #183463 深蓝
BOT = (46, 123, 246)    # #2E7BF6 亮蓝
WHITE = (255, 255, 255)

# 三根柱：(x0, x1, y0, y1)，柱端圆角 = 半宽
BARS = [
    (126, 178, 306, 388),
    (230, 282, 236, 388),
    (334, 386, 166, 388),
]


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def in_round_rect(x, y, x0, y0, x1, y1, r):
    """点 (x,y) 是否落在圆角矩形内（坐标已放大）"""
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def coverage_round(x0, y0, x1, y1, r):
    """返回该圆角矩形在整幅图上的 (命中数矩阵) 的判定函数"""
    def f(x, y):
        return in_round_rect(x, y, x0 * S, y0 * S, x1 * S, y1 * S, r * S)
    return f


def main():
    rect = coverage_round(0, 0, W - 1, H - 1, CORNER)
    bars = [coverage_round(x0, y0, x1, y1, (x1 - x0) // 2) for (x0, x1, y0, y1) in
            [(_b[0], _b[1], _b[2], _b[3]) for _b in BARS]]

    raw = bytearray()
    for py in range(H):
        raw.append(0)  # filter type 0
        row = bytearray()
        for px in range(W):
            cov = 0
            acc_r = acc_g = acc_b = 0
            for sy in range(S):
                yy = py * S + sy
                for sx in range(S):
                    xx = px * S + sx
                    if not rect(xx, yy):
                        continue
                    cov += 1
                    if any(b(xx, yy) for b in bars):
                        c = WHITE
                    else:
                        c = lerp(TOP, BOT, yy / (H * S - 1))
                    acc_r += c[0]; acc_g += c[1]; acc_b += c[2]
            n = S * S
            if cov == 0:
                row += b'\x00\x00\x00\x00'
            else:
                row += bytes((acc_r // cov, acc_g // cov, acc_b // cov, cov * 255 // n))
        raw += row

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    out = 'joybuy_app_icon.png'
    open(out, 'wb').write(png)
    print('written', out, len(png), 'bytes', W, 'x', H)


main()
