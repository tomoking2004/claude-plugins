"""キャラクターの絵を書き出す．

使い方：python build.py <キャラクターのディレクトリ> [確かめ用.gif]

絵の元は，キャラクターの art/ から読む．

- art/draw.py があれば，それを読み込む．`sprites()` が，絵の名前 → 刻みごとの絵
  （64×64，RGBA）を返す．`VARIANTS`（個体ごとに置き換える色の組．先頭の組が元の色）と
  `ICON`（アイコンにする絵）は，あれば使う．
- 無ければ，art/ の GIF を読む．ファイル名（拡張子を除く）が絵の名前になる．

書き出すもの（キャラクターのディレクトリの下）：

- sprites/：パネルが流すアニメーション SVG と，絵の一覧 index.json．必ず作り直す．
- .claude-plugin/icon.png：プラグインの一覧に出るアイコン．必ず作り直す．
- preview.gif：README に載せる，本体の働く役割を並べた1枚（透過）．必ず作り直す．
- 確かめ用.gif：全ての絵を並べた1枚（黒背景）．絵を目で確かめるためのもので，
  パスを渡したときだけ作る．

Pillow が要る．
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

from PIL import Image

Color = tuple[int, int, int, int]
Variant = list[tuple[int, ...]]               # 個体ごとに置き換える色の組（RGB か RGBA）
Point = tuple[int, int]
Frames = list[Image.Image]                    # 1枚の絵の，刻みごとの絵
Cells = dict[Point, Color]                    # 1刻みの絵：(x, y) → 色
Ticks = tuple[int, ...]                       # ドットを見せる刻み
Mark = tuple[Point, Color]                    # 1つのドット：位置と色
Layers = dict[Ticks, set[Mark]]               # 見せる刻み → その間だけ見せるドット

SIDE = 64               # キャンバスの一辺（ドット）
TICK = 100              # 1刻みの長さ（ms）
LIMIT = 131072          # パネルが受け取る SVG の上限（文字数）
WORKING = ["think", "research", "write", "run", "watch", "call"]   # 働く役割
LEVELS = range(4)       # 本体の眠気の段階
REQUIRED = ["main-think-0", "main-think"]     # どちらかが要る（ほかの絵は，これで代えられる）
# 絵の名前：本体は main-<役割>（眠気の段階を付けるなら main-<役割>-<段階>），分身は sub-<役割>．
NAME = re.compile(r"(main-(?P<role>%s)(-(?P<level>[0-%d]))?|sub-(%s))"
                  % ("|".join(WORKING + ["rest"]), LEVELS[-1],
                     "|".join(WORKING + ["rest"])))


# ── 絵の元 ────────────────────────────────────────────

def ticks(path: Path) -> Frames:
    """GIF を，刻みごとの絵（64×64，RGBA）にする．"""
    im = Image.open(path)
    out = []
    for i in range(im.n_frames):
        im.seek(i)
        duration = im.info.get("duration", 0)
        assert duration and duration % TICK == 0, \
            "%s：コマの長さが%dmsの倍数でない" % (path.name, TICK)
        assert im.width == im.height and im.width % SIDE == 0, \
            "%s：一辺が%dドットの整数倍の正方形でない" % (path.name, SIDE)
        frame = im.convert("RGBA").resize((SIDE, SIDE), Image.NEAREST)
        out += [frame] * (duration // TICK)
    return out


def load(art: Path) -> tuple[dict[str, Frames], list[Variant], Image.Image]:
    """絵の元を読む：絵の名前 → 刻みごとの絵，個体ごとに置き換える色の組，アイコンにする絵．"""
    script = art / "draw.py"
    if script.exists():
        sys.path.insert(0, str(art))
        spec = importlib.util.spec_from_file_location("draw", script)
        draw = importlib.util.module_from_spec(spec)
        sys.modules["draw"] = draw
        spec.loader.exec_module(draw)
        wanted = draw.sprites()
        variants = getattr(draw, "VARIANTS", [])
        picture = getattr(draw, "ICON", None)
    else:
        wanted = {path.stem: ticks(path) for path in sorted(art.glob("*.gif"))}
        variants, picture = [], None

    for key in wanted:
        assert NAME.fullmatch(key), "絵の名前が決まりに合わない：%s" % key
    idle = next((key for key in REQUIRED if key in wanted), None)
    assert idle, "本体の「考える」の絵（%s）が無い" % "・".join(REQUIRED)
    lengths = {len(frames) for frames in wanted.values()}
    assert len(lengths) == 1, "絵によって刻みの数が違う：%s" % sorted(lengths)
    return wanted, variants, picture or wanted[idle][0]


# ── アニメーション SVG ────────────────────────────────

def hexa(color: tuple[int, ...]) -> str:
    """色を，CSS の16進表記（#rrggbb）にする．"""
    return "#%02x%02x%02x" % color[:3]


def percent(tick: int, n: int) -> str:
    """刻みを，1周に占める位置（キーフレームの百分率）にする．"""
    return ("%.4f" % (tick * 100 / n)).rstrip("0").rstrip(".") + "%"


FROZEN = 0   # アニメーションを外して描かれるときに見せる刻み
LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"   # 色のクラス名
PATH = '<path class="%s" d="%s"/>'
LAYER = '<g class="layer%s" style="animation-name:k%d">%s</g>'
KEYFRAMES = "@keyframes k%d{%s}"


def cells(im: Image.Image) -> Cells:
    """1枚の絵を {(x, y): 色} にする（透明なドットは除く）．"""
    out = {}
    for y in range(SIDE):
        for x in range(SIDE):
            p = im.getpixel((x, y))
            assert p[3] in (0, 255), "半透明のドットがある"
            if p[3]:
                out[x, y] = p
    return out


def layers(pictures: list[Cells]) -> Layers:
    """ドットを，見せる刻みが同じものどうしの層に分ける．

    1周の間ずっと不透明な位置は，最も長く見せる色を全ての刻みで見せて下地にし，
    ほかの色は，その色の刻みの間だけ上に重ねる（下地は隠さずに済む）．透明になる
    刻みがある位置は，どの色も，その色の刻みの間だけ見せる．
    """
    always = tuple(range(len(pictures)))
    out = {}
    for y in range(SIDE):
        for x in range(SIDE):
            line = [cell.get((x, y)) for cell in pictures]
            shown = {}
            for t, color in enumerate(line):
                if color:
                    shown.setdefault(color, []).append(t)
            if None not in line:
                under = max(shown, key=lambda color: (len(shown[color]), color))
                shown[under] = always
            for color, at in shown.items():
                out.setdefault(tuple(at), set()).add(((x, y), color))
    return out


def steps(shown: Ticks, n: int) -> str:
    """層を見せる・隠すの切り替えを，1周 n 刻みのキーフレームの中身にする．"""
    on = set(shown)
    return "".join("%s{opacity:%d}" % (percent(t, n), t in on)
                   for t in range(n)
                   if t == 0 or (t in on) != (t - 1 in on))


def paths(marks: set[Mark], classes: dict[Color, str]) -> str:
    """ドットの集まりを，色ごとの横線の集まり（<path>）にする．

    線は左上から順に，前の線の終わりからの相対位置でつなぐ（絶対位置より短い）．
    """
    runs = {}
    for (x, y), color in sorted(marks, key=lambda mark: (mark[0][1], mark[0][0])):
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
        out.append(PATH % (classes[color], "".join(d)))
    return "".join(out)


def layer(shown: Ticks, marks: set[Mark], classes: dict[Color, str],
          n: int, i: int) -> tuple[str, str]:
    """1つの層を，1周 n 刻みの SVG の記述（キーフレームと，ドットのまとまり）にする．

    アニメーションを外すと刻み FROZEN の絵になるよう，その刻みに見せない層は，
    素の状態で隠しておく（off）．
    """
    off = "" if FROZEN in shown else " off"
    return (KEYFRAMES % (i, steps(shown, n)),
            LAYER % (off, i, paths(marks, classes)))


def merged(found: Layers, n: int) -> Layers:
    """層を，ほかの層へ配って減らす．

    ある層の刻みを，それに含まれる刻みだけを見せるほかの層を幾つか合わせて，ちょうど
    覆えることがある．そのとき，層のドットをそれらの層へ配っても同じ絵になる（同じドットを
    2つの層が同時に見せてもよい）．配った先で増える文字数が，その層の記述の文字数より少なければ配る．
    記述の短い層から順に試し，配れる層が無くなるまで繰り返す．全ての刻みで見せる層は
    下地なので，配らない．
    """
    always = tuple(range(n))
    out = {shown: set(marks) for shown, marks in found.items()}
    sets = {shown: frozenset(shown) for shown in out}
    classes = {color: LETTERS[0] for marks in out.values() for _, color in marks}

    def length(shown: Ticks, marks: set[Mark]) -> int:
        return sum(map(len, layer(shown, marks, classes, n, 0)))

    def cover(shown: Ticks) -> list[Ticks] | None:
        """shown をちょうど覆う，ほかの層の組（残りを最も多く覆う層から取る）．"""
        inside = [other for other in sorted(out)
                  if other != shown and sets[other] <= sets[shown]]
        left, chosen = set(shown), []
        while left:
            best = max(inside, key=lambda other: len(sets[other] & left),
                       default=None)
            if best is None or not sets[best] & left:
                return None
            chosen.append(best)
            left -= sets[best]
        return chosen

    size = {shown: length(shown, marks) for shown, marks in out.items()}
    moved = True
    while moved:
        moved = False
        for shown in sorted(out, key=lambda shown: (size[shown], shown)):
            onto = None if shown == always else cover(shown)
            if onto is None:
                continue
            grown = {other: length(other, out[other] | out[shown])
                     for other in onto}
            if sum(grown[other] - size[other] for other in onto) < size[shown]:
                for other in onto:
                    out[other] |= out[shown]
                    size[other] = grown[other]
                del out[shown]
                moved = True
    return out


def encode(found: Layers, n: int) -> str:
    """層を，1周 n 刻みの SVG の文字列にする．

    層ごとに，見せる・隠すの切り替えを CSS のアニメーションで持つ．全ての刻みで
    見せる層（下地）を先に描き，ほかの層をその上に描く．
    """
    always = tuple(range(n))
    colors = sorted({color for marks in found.values() for _, color in marks})
    assert len(colors) <= len(LETTERS), \
        "1枚の絵の色が%d色を超えた：%d色" % (len(LETTERS), len(colors))
    classes = dict(zip(colors, LETTERS))

    css = [".%s{stroke:%s}" % (classes[color], hexa(color))
           for color in colors]
    groups = [paths(found.get(always, set()), classes)]
    for i, shown in enumerate(sorted(set(found) - {always})):
        keyframes, group = layer(shown, found[shown], classes, n, i)
        css.append(keyframes)
        groups.append(group)

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d"'
        ' shape-rendering="crispEdges">'
        "<style>.layer{animation-duration:%gs;"
        "animation-timing-function:step-end;"
        "animation-iteration-count:infinite;animation-delay:0s}"
        ".off{opacity:0}%s</style>"
        '<g fill="none" stroke-width="1" transform="translate(0 .5)">'
        "%s</g></svg>"
    ) % (SIDE, SIDE, n * TICK / 1000, "".join(css), "".join(groups))


def svg(frames: Frames) -> str:
    """刻みごとの絵を，1枚のアニメーション SVG にする．"""
    n = len(frames)
    out = encode(merged(layers([cells(im) for im in frames]), n), n)
    assert len(out) <= LIMIT, "SVG が上限を超えた：%d 文字" % len(out)
    return out


def sprites(
    out: Path, wanted: dict[str, Frames], variants: list[Variant],
) -> None:
    """絵ごとの SVG と，絵の一覧を書き出す．"""
    written = {key + ".svg": svg(frames) for key, frames in wanted.items()}
    index = {
        "ticks": len(next(iter(wanted.values()))),
        "sprites": list(wanted),
        "variants": [[hexa(color) for color in variant]
                     for variant in variants],
    }

    # 全ての絵が上限に収まってから書き換える（途中で止まっても，前の sprites/ が残る）．
    out.mkdir(exist_ok=True)
    for old in out.glob("*"):
        old.unlink()
    for name, text in written.items():
        (out / name).write_text(text, encoding="utf-8", newline="\n")
    (out / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n")
    sizes = [f.stat().st_size for f in out.glob("*.svg")]
    print("sprites: %d 枚，計 %d KB，最大 %d KB"
          % (len(sizes), sum(sizes) // 1024, max(sizes) // 1024))


# ── アイコン ──────────────────────────────────────────

def icon(out: Path, picture: Image.Image) -> None:
    """アイコンを書き出す：絵を8倍（512ドット）にした PNG．"""
    out.parent.mkdir(exist_ok=True)
    picture.resize((SIDE * 8, SIDE * 8), Image.NEAREST).save(out)
    print("icon:", out.name)


# ── 並べた GIF ────────────────────────────────────────

def sheet(
    out: Path, tiles: list[Frames],
    scale: int, cols: int, pad: int, margin: int, bg: Color | None,
) -> None:
    """刻みごとの絵を幾つか並べた GIF を書き出す．絵には説明の文字を入れない．

    絵を cols 個ずつ折り返して並べ，絵の間を pad，外周を margin ドット空けて，
    全体を scale 倍にする．bg が None なら背景を透過にする．
    """
    lines = (len(tiles) + cols - 1) // cols
    size = (cols * (SIDE + pad) - pad + 2 * margin,
            lines * (SIDE + pad) - pad + 2 * margin)
    shots = []
    for t in range(len(tiles[0])):
        fr = Image.new("RGBA", size, bg or (0, 0, 0, 0))
        for i, tile in enumerate(tiles):
            spot = (margin + (i % cols) * (SIDE + pad),
                    margin + (i // cols) * (SIDE + pad))
            fr.alpha_composite(tile[t], spot)
        shots.append(fr)

    # 色を減らさない：全ての刻みの色をそのまま並べたパレットに，1ドットずつ引き当てる
    # （quantize は近い色を取り違える）．透過にするなら，0番を透明に充てる．
    colors = sorted({c for fr in shots
                     for _, c in fr.getcolors(1 << 16) if c[3]})
    clear = bg is None
    first = 1 if clear else 0
    assert first + len(colors) <= 256, "%s：並べた絵%sの色が%d色を超えた：%d色" % (
        out.name, "" if clear else "と背景", 256 - first, len(colors))
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
                   duration=TICK, loop=0, **extra)
    print("%s: %d KB" % (out.name, out.stat().st_size // 1024))


def awake(wanted: dict[str, Frames]) -> list[str]:
    """本体の働く役割の，眠気の無い絵の名前（持っているものだけ．役割の順）．"""
    found = [next((key for key in ("main-%s-0" % role, "main-%s" % role)
                   if key in wanted), None) for role in WORKING]
    return [key for key in found if key]


def readme_preview(out: Path, wanted: dict[str, Frames]) -> None:
    """README に載せる GIF を書き出す：本体の働く役割を，透過の背景に1段で並べる．"""
    tiles = [wanted[key] for key in awake(wanted)]
    sheet(out, tiles, scale=2, cols=len(tiles), pad=8, margin=0, bg=None)


def check_preview(out: Path, wanted: dict[str, Frames]) -> None:
    """確かめ用の GIF を書き出す：全ての絵を，黒背景に6つずつ並べる．

    本体の働く役割（眠気なし），分身の働く役割，本体の眠気の段階1・2・3それぞれの
    働く役割，「眠る」の順．
    """
    def order(key: str) -> tuple[int, int]:
        role = key.split("-")[1]
        level = int(NAME.fullmatch(key)["level"] or 0)
        line = (9 if role == "rest" else 1 if key.startswith("sub-")
                else 0 if key in awake(wanted) else 1 + level)
        return line, (WORKING + ["rest"]).index(role)

    tiles = [wanted[key] for key in sorted(wanted, key=order)]
    sheet(out, tiles, scale=4, cols=len(WORKING), pad=3, margin=3,
          bg=(0, 0, 0, 255))


if __name__ == "__main__":
    character = Path(sys.argv[1]).resolve()
    wanted, variants, picture = load(character / "art")
    sprites(character / "sprites", wanted, variants)
    icon(character / ".claude-plugin" / "icon.png", picture)
    readme_preview(character / "preview.gif", wanted)
    if len(sys.argv) > 2:
        check_preview(Path(sys.argv[2]), wanted)
