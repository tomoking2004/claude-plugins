"""baton のアイコンを描き，../.claude-plugin/icon.png に書き出す．

リレーのバトン（中が空の筒）を1本，斜めに置く．背景は透かし，影は薄く落とす．
色は fox のキツネに合わせる：筒は毛の橙，握りの帯は耳の先と足先の焦げ茶，中は縁取りの茶，口の縁は胸のクリーム．
走らせ方：python plugins/baton/art/icon.py（Pillow が要る）
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ICON = Path(__file__).resolve().parent.parent / ".claude-plugin" / "icon.png"
SIZE = 512
SCALE = 4  # 縁を滑らかにするため，大きく描いてから縮める
TILT = 35  # 右上がりの角度（度）

# 筒の寸法（書き出しの512ドットでの値）
LENGTH = 360
WIDTH = 92
LIP = 30  # 端の楕円の幅

# 色．FUR と GRIP は（明るい面，暗い面）の組．
FUR = ((250, 188, 100), (206, 120, 40))
GRIP = ((112, 84, 74), (56, 40, 36))
INSIDE = (122, 52, 16)
RIM = (250, 226, 180)

Shades = tuple[tuple[int, int, int], tuple[int, int, int]]


def shade(t: float, shades: Shades) -> tuple[int, int, int, int]:
    """筒の上端（t=0）から下端（t=1）への面の色．上から1/4あたりが最も明るい．"""
    light = 1 - abs(t - 0.25) / 0.75
    (lr, lg, lb), (dr, dg, db) = shades
    return (round(dr + (lr - dr) * light), round(dg + (lg - dg) * light), round(db + (lb - db) * light), 255)


def baton() -> Image.Image:
    """横に寝かせた筒を描く（右の端が手前に開く）．"""
    s = SCALE
    w, h, lip = LENGTH * s, WIDTH * s, LIP * s
    img = Image.new("RGBA", (w + lip, h), (0, 0, 0, 0))

    body = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paint = ImageDraw.Draw(body)
    left, right = round(w * 0.44), round(w * 0.56)  # 握りの帯
    for y in range(h):
        t = y / (h - 1)
        # 帯の縁は筒を巻く輪なので，手前の口と同じ楕円の弧を描き，手前の口から離れる向き
        # （奥の端と同じ左）へふくらむ
        bulge = round(lip / 2 * (1 - (2 * t - 1) ** 2) ** 0.5)
        paint.line([(0, y), (w, y)], fill=shade(t, FUR))
        paint.line([(left - bulge, y), (right - bulge, y)], fill=shade(t, GRIP))
    mask = Image.new("L", img.size, 0)
    m = ImageDraw.Draw(mask)
    m.rectangle([lip // 2, 0, w, h - 1], fill=255)
    m.ellipse([0, 0, lip, h - 1], fill=255)  # 奥の端の丸み
    img.paste(body, (0, 0), mask)

    # 手前の端：縁と，空の中
    draw = ImageDraw.Draw(img)
    draw.ellipse([w - lip // 2, 0, w + lip // 2, h - 1], fill=RIM)
    inset = round(h * 0.11)
    draw.ellipse([w - lip // 2 + inset // 3, inset, w + lip // 2 - inset // 3, h - 1 - inset], fill=INSIDE)
    return img


def main() -> None:
    """筒を傾けて影を落とし，真ん中に置いて ICON に書き出す．"""
    s = SCALE
    canvas = Image.new("RGBA", (SIZE * s, SIZE * s), (0, 0, 0, 0))

    tube = baton().rotate(TILT, resample=Image.BICUBIC, expand=True)
    x = (canvas.width - tube.width) // 2
    y = (canvas.height - tube.height) // 2 - 12 * s

    # 影：筒の形をぼかし，下へずらす
    alpha = tube.getchannel("A").point(lambda a: a * 0.22)
    shadow = Image.new("RGBA", tube.size, (60, 30, 20, 0))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(10 * s))
    canvas.alpha_composite(shadow, (x, y + 26 * s))
    canvas.alpha_composite(tube, (x, y))

    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(ICON)
    print("icon:", ICON)


if __name__ == "__main__":
    main()
