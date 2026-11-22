"""キツネの絵を書き出す．

使い方：python build.py [確かめ用.gif]

- ../sprites/：パネルが流すアニメーション SVG（役割ごと．本体は眠気の段階ごと）と，
  個体ごとの表紙の色の一覧 index.json．必ず作り直す．
- ../.claude-plugin/icon.png：プラグインの一覧に出るアイコン．必ず作り直す．
- ../preview.gif：README に載せる，本体の働く6つの役割を並べた1枚（透過）．
  必ず作り直す．
- 確かめ用.gif：全役割を並べた1枚（黒背景）．絵を目で確かめるためのもので，
  パスを渡したときだけ作る．

Pillow が要る．
"""
import colorsys
import json
import sys
from pathlib import Path

from PIL import Image

import draw
from draw import Color, Point

Cells = dict[Point, Color]                    # 1枚の絵：(x, y) → 色
Ticks = tuple[int, ...]                       # ドットを見せる刻み
Dot = tuple[Ticks, Point, Color]

SPRITES = draw.ART.parent / "sprites"
ICON = draw.ART.parent / ".claude-plugin" / "icon.png"
README_PREVIEW = draw.ART.parent / "preview.gif"
LIMIT = 131072          # パネルが受け取る SVG の上限（文字数）
PERIOD = draw.N * draw.TICK / 1000


# ── アニメーション SVG ────────────────────────────────

def hexa(color: tuple[int, ...]) -> str:
    """色を，CSS の16進表記（#rrggbb）にする．"""
    return "#%02x%02x%02x" % color[:3]


def percent(tick: int) -> str:
    """刻みを，1周に占める位置（キーフレームの百分率）にする．"""
    return ("%.4f" % (tick * 100 / draw.N)).rstrip("0").rstrip(".") + "%"


ALWAYS: Ticks = tuple(range(draw.N))
FROZEN = 0   # アニメーションを外して描かれるとき（動きを減らす設定）に見せる刻み
# 分け方の目安：(1ドット, 1つの状態) が費やす文字数
COSTS = [(6, 60), (6, 120), (4, 60), (6, 200)]
LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"   # 色のクラス名


def cells(im: Image.Image) -> Cells:
    """1枚の絵を {(x, y): 色} にする（透明なドットは除く）．"""
    out = {}
    for y in range(64):
        for x in range(64):
            p = im.getpixel((x, y))
            assert p[3] in (0, 255), "半透明のドットがある"
            if p[3]:
                out[x, y] = p
    return out


def blocks(
    pictures: list[Cells], cost: tuple[int, int],
    x0: int = 0, y0: int = 0, size: int = 64,
) -> tuple[list[Dot], int]:
    """区画のドットを (見せる刻み, (x, y), 色) に分け，その費用の目安と並べて返す．

    区画が48刻みの間に取る状態（絵柄）ごとに，その状態の刻みの間だけ見せる．全刻みで
    変わらないドットは常に見せる．区画を4つに割ったほうが安ければ割る——動く部分だけが
    細かく割れ，動かない部分は大きな区画のまま1度だけ描かれる．
    """
    keys = [(x, y) for y in range(y0, y0 + size) for x in range(x0, x0 + size)]
    states = {}
    for t, cell in enumerate(pictures):
        states.setdefault(tuple(cell.get(k) for k in keys), []).append(t)
    still = [len({state[i] for state in states}) == 1
             for i in range(len(keys))]
    whole = [(ALWAYS if still[i] else tuple(ticks), k, state[i])
             for n, (state, ticks) in enumerate(states.items())
             for i, k in enumerate(keys)
             if state[i] and (n == 0 or not still[i])]
    total = cost[0] * len(whole) + cost[1] * (len(states) > 1) * len(states)
    if len(states) == 1 or size == 1:
        return whole, total

    half = size // 2
    parts = [blocks(pictures, cost, x, y, half)
             for y in (y0, y0 + half) for x in (x0, x0 + half)]
    split = sum(c for _, c in parts)
    if split < total:
        return [dot for dots, _ in parts for dot in dots], split
    return whole, total


def paths(pixels: Cells, classes: dict[Color, str]) -> str:
    """{(x, y): 色} を，色ごとの横線の集まり（<path>）にする．

    線は左上から順に，前の線の終わりからの相対位置でつなぐ（絶対位置より短い）．
    """
    runs = {}
    rows = sorted(pixels.items(), key=lambda item: (item[0][1], item[0][0]))
    for (x, y), color in rows:
        row = runs.setdefault(color, [])
        if row and row[-1][1] == y and row[-1][0] + row[-1][2] == x:
            row[-1][2] += 1
        else:
            row.append([x, y, 1])
    out = []
    for color, row in sorted(runs.items()):
        d, pen = [], (0, 0)
        for x, y, w in row:
            d.append("m%d %dh%d" % (x - pen[0], y - pen[1], w))
            pen = (x + w, y)
        out.append('<path class="%s" d="%s"/>' % (classes[color], "".join(d)))
    return "".join(out)


def encode(dots: list[Dot]) -> str:
    """(見せる刻み, (x, y), 色) の集まりを SVG の文字列にする．

    見せる刻みが同じドットを1つの層にまとめ，層ごとに，見せる・隠すの切り替えを
    CSS のアニメーションで持つ．アニメーションを外すと刻み FROZEN の絵になるよう，
    その刻みに見せない層だけを，素の状態で隠しておく（off）．
    """
    layers = {}
    for ticks, key, color in dots:
        layers.setdefault(ticks, {})[key] = color
    colors = sorted({color for _, _, color in dots})
    assert len(colors) <= len(LETTERS), len(colors)
    classes = dict(zip(colors, LETTERS))

    css = [".%s{stroke:%s}" % (classes[color], hexa(color))
           for color in colors]
    groups = []
    for i, (ticks, pixels) in enumerate(sorted(layers.items())):
        if ticks == ALWAYS:
            groups.append(paths(pixels, classes))
            continue
        on = set(ticks)
        steps = ["%s{opacity:%d}" % (percent(t), t in on)
                 for t in range(draw.N)
                 if t == 0 or (t in on) != (t - 1 in on)]
        css.append("@keyframes k%d{%s}" % (i, "".join(steps)))
        off = "" if FROZEN in on else " off"
        groups.append('<g class="layer%s" style="animation-name:k%d">%s</g>'
                      % (off, i, paths(pixels, classes)))

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"'
        ' shape-rendering="crispEdges">'
        "<style>.layer{animation-duration:%gs;"
        "animation-timing-function:step-end;"
        "animation-iteration-count:infinite;animation-delay:0s}"
        ".off{opacity:0}%s</style>"
        '<g fill="none" stroke-width="1" transform="translate(0 .5)">'
        "%s</g></svg>"
    ) % (PERIOD, "".join(css), "".join(groups))


def svg(frames: list[Image.Image]) -> str:
    """48刻みの絵を，1枚のアニメーション SVG にする．

    分け方の目安を幾つか試し，最も短いものを採る．
    """
    pictures = [cells(im) for im in frames]
    out = min((encode(blocks(pictures, cost)[0]) for cost in COSTS), key=len)
    assert len(out) <= LIMIT, "SVG が上限を超えた：%d 文字" % len(out)
    return out


COVER_HUES = [0, 0.58, 0.33, 0.12, 0.75, 0.47]   # 表紙の色相の回し方（1周を1とする）


def turn(color: Color, hue: float) -> tuple[int, ...]:
    """色相だけを回す．"""
    h, light, sat = colorsys.rgb_to_hls(*(v / 255 for v in color[:3]))
    rgb = colorsys.hls_to_rgb((h + hue) % 1, light, sat)
    return tuple(round(v * 255) for v in rgb)


def sprites() -> None:
    """役割ごとの SVG と，表紙の色の一覧を書き出す．"""
    wanted = {}                                 # ファイル名（拡張子を除く） → 48刻みの絵
    for role, make in draw.ROLES.items():
        for level in draw.LEVELS:
            key = "main-%s-%d" % (role, level)
            wanted[key] = draw.frames(make, False, level)
        wanted["sub-%s" % role] = draw.frames(make, True)
    wanted["main-rest"] = draw.frames(draw.rest, False)
    wanted["sub-rest"] = draw.frames(draw.rest, True)

    written = {key + ".svg": svg(frames) for key, frames in wanted.items()}

    # 個体ごとに変える色：本の表紙．先頭が元の色で，残りは色相だけを回したもの．
    cover = [draw.BOOK_PAL[k] for k in "CcSo"]
    # 表紙の色を，本以外の絵が使っていないことを確かめる．
    for name, text in written.items():
        used = any(hexa(c) in text for c in cover)
        assert "research" in name or not used, name
    index = {
        "covers": [[hexa(turn(c, hue)) for c in cover] for hue in COVER_HUES],
    }

    # 全ての絵が上限に収まってから書き換える（途中で止まっても，前の sprites/ が残る）．
    SPRITES.mkdir(exist_ok=True)
    for old in SPRITES.glob("*"):
        old.unlink()
    for name, text in written.items():
        (SPRITES / name).write_text(text, encoding="utf-8", newline="\n")
    (SPRITES / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n")
    sizes = [f.stat().st_size for f in SPRITES.glob("*.svg")]
    print("sprites: %d 枚，計 %d KB，最大 %d KB"
          % (len(sizes), sum(sizes) // 1024, max(sizes) // 1024))


# ── アイコン ──────────────────────────────────────────

def icon() -> None:
    """アイコンを書き出す：目を開いた本体のベースキャラを，8倍（512ドット）にした PNG．"""
    opened = draw.MAIN_BASE[16]                 # 刻み16：目を開いている
    ICON.parent.mkdir(exist_ok=True)
    opened.resize((512, 512), Image.NEAREST).save(ICON)
    print("icon:", ICON.name)


# ── 並べた GIF ────────────────────────────────────────

def sheet(
    out: Path, tiles: list[list[Image.Image]],
    scale: int, cols: int, pad: int, margin: int, bg: Color | None,
) -> None:
    """48刻みの絵を幾つか並べた GIF を書き出す．絵には説明の文字を入れない．

    絵を cols 個ずつ折り返して並べ，絵の間を pad，外周を margin ドット空けて，
    全体を scale 倍にする．bg が None なら背景を透過にする．
    """
    lines = (len(tiles) + cols - 1) // cols
    size = (cols * (64 + pad) - pad + 2 * margin,
            lines * (64 + pad) - pad + 2 * margin)
    shots = []
    for t in range(draw.N):
        fr = Image.new("RGBA", size, bg or (0, 0, 0, 0))
        for i, tile in enumerate(tiles):
            spot = (margin + (i % cols) * (64 + pad),
                    margin + (i // cols) * (64 + pad))
            fr.alpha_composite(tile[t], spot)
        shots.append(fr)

    # 色を減らさない：全ての刻みの色をそのまま並べたパレットに，1ドットずつ引き当てる
    # （quantize は近い色を取り違える）．透過にするなら，0番を透明に充てる．
    colors = sorted({c for fr in shots
                     for _, c in fr.getcolors(1 << 16) if c[3]})
    clear = bg is None
    first = 1 if clear else 0
    assert first + len(colors) <= 256, len(colors)
    index = {c: first + i for i, c in enumerate(colors)}
    palette = [0, 0, 0] * first + [v for c in colors for v in c[:3]]
    frames = []
    for fr in shots:
        dots = bytes(index[c] if c[3] else 0 for c in fr.getdata())
        im = Image.frombytes("P", size, dots)
        im.putpalette(palette)
        frames.append(im.resize((size[0] * scale, size[1] * scale),
                                Image.NEAREST))
    extra = {"transparency": 0, "disposal": 2} if clear else {}
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=draw.TICK, loop=0, **extra)
    print("%s: %d KB" % (out.name, out.stat().st_size // 1024))


def readme_preview() -> None:
    """README に載せる GIF を書き出す：本体の働く6つの役割を，透過の背景に1段で並べる．"""
    tiles = [draw.frames(make, False) for make in draw.ROLES.values()]
    sheet(README_PREVIEW, tiles, scale=2, cols=len(tiles), pad=8, margin=0,
          bg=None)


def check_preview(out: Path) -> None:
    """確かめ用の GIF を書き出す：全役割を黒背景に並べる．

    1段目は本体の，2段目は分身の，働く6つの役割．3段目は本体の眠気の段階0〜3（調べる役割で
    見せる）と，本体・分身の「眠る」．
    """
    tiles = [draw.frames(make, leaf)
             for leaf in (False, True) for make in draw.ROLES.values()]
    tiles += [draw.frames(draw.research, False, level)
              for level in draw.LEVELS]
    tiles += [draw.frames(draw.rest, leaf) for leaf in (False, True)]
    sheet(out, tiles, scale=4, cols=6, pad=3, margin=3, bg=(0, 0, 0, 255))


if __name__ == "__main__":
    sprites()
    icon()
    readme_preview()
    if len(sys.argv) > 1:
        check_preview(Path(sys.argv[1]))
