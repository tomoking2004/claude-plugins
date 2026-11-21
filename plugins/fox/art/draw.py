"""役割ごとのキツネを描く．

ベースキャラ（fox_main.gif＝本体，fox_sub.gif＝分身）の待機アニメーションに，
役割の小道具・前足・目・眠気を重ねる．時間の刻みは100ms，1周48刻み（4.8秒）で，
ベースキャラと同じ長さ．書き出しは build.py が担う．
"""
from collections.abc import Callable
from pathlib import Path
from typing import Any

from PIL import Image

Color = tuple[int, int, int, int]
Point = tuple[int, int]
Pixels = Any  # Image.load() が返す，[x, y] で読み書きするドットの表
Palette = dict[str, Color]

ART = Path(__file__).resolve().parent
MAIN, SUB = ART / "fox_main.gif", ART / "fox_sub.gif"
N, TICK = 48, 100

EDGE = (122, 52, 16, 255)
FUR = (242, 162, 58, 255)
PAW = (56, 40, 36, 255)
EYE = (58, 32, 16, 255)
PINK = (236, 120, 120, 255)
METAL_D = (78, 78, 92, 255)
PAPER, PAPER_D = (250, 240, 215, 255), (196, 170, 130, 255)
INK = (40, 50, 80, 255)
STEAM = (225, 222, 215, 255)


# ── ベースキャラ ────────────────────────────────────

def ticks(path: Path) -> list[Image.Image]:
    """ベースキャラの GIF を，100msごとの48刻みの絵（64×64）にする．"""
    im = Image.open(path)
    out = []
    for i in range(im.n_frames):
        im.seek(i)
        f = im.convert("RGBA").resize((64, 64), Image.NEAREST)
        out += [f] * (im.info["duration"] // TICK)
    assert len(out) == N, len(out)
    return out


SUB_BASE, MAIN_BASE = ticks(SUB), ticks(MAIN)   # 分身・本体のベースキャラ（48刻み）


# ── 描画の道具 ──────────────────────────────────────

def line(px: Pixels, a: Point, b: Point, color: Color, r: int = 0) -> None:
    """a から b へ線を引く．線の幅は 2r+1 ドット．"""
    (x0, y0), (x1, y1) = a, b
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x, y = round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if 0 <= x + dx < 64 and 0 <= y + dy < 64:
                    px[x + dx, y + dy] = color


def rect(
    px: Pixels, x0: int, y0: int, x1: int, y1: int,
    fill: Color, edge: Color | None = None,
) -> None:
    """四角を塗る．edge を渡せば，外周の1ドットをその色にする．"""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            framed = edge and (x in (x0, x1) or y in (y0, y1))
            px[x, y] = edge if framed else fill


def paw(px: Pixels, x: int, y: int) -> None:
    """前足の先を，(x, y) を中心に描く．"""
    rect(px, x - 2, y - 2, x + 2, y + 1, PAW, EDGE)


def arm(px: Pixels, shoulder: Point, hand: Point) -> None:
    """shoulder から hand へ腕を伸ばし，hand に前足の先を描く．"""
    line(px, shoulder, hand, EDGE, 2)
    line(px, shoulder, hand, FUR, 1)
    paw(px, *hand)


def stamp(px: Pixels, x0: int, y0: int, rows: list[str], pal: Palette) -> None:
    """文字の並びで描いた小さな絵を置く（"." は透明）．"""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != ".":
                px[x0 + i, y0 + j] = pal[ch]


# ベースキャラで，刻み0（目を閉じている）と同じ姿勢のまま目だけを開いた刻み
OPEN = SUB_BASE[16]
# ベースキャラで，頭と体が1ドット沈む刻み
DY = [1 if t % 16 >= 8 else 0 for t in range(N)]
EYE_BOXES = [(range(17, 28), range(21, 31)), (range(33, 45), range(21, 31))]
EYE_COLORS = {   # 開いた目の色
    (74, 42, 24, 255), (104, 62, 36, 255),
    (255, 250, 240, 255), (176, 120, 84, 255),
}


class Sleep:
    """刻み t での，本体の眠気（コンテキストの量）の表れ．level は0〜3で，分身は常に0．

    shut：目を閉じる．yawn：あくびの経過（あくび中でなければ None）．
    nod：頭が下がる量（船をこぐ）．
    """

    def __init__(self, t: int, level: int) -> None:
        """段階1でまぶたが重くなり，2であくびが加わる．3は目を閉じて船をこぎ，起きてあくびをする．"""
        self.shut = level >= 1 and t % 12 < 3
        start = {2: 18, 3: 36}.get(level)   # あくびの始まり（3はハッと起きたあと）
        self.yawn = None
        if start is not None and 0 <= t - start < 12:
            self.yawn = t - start
        self.nod = 0
        if level == 3:
            self.nod = (0 if t < 10 or t >= 34 else 1 if t < 18
                        else 2 if t < 26 else 3)
            self.shut = 6 <= t < 34


def head_shift(f: Image.Image, dx: int, dy: int) -> None:
    """頭（上37行，左53列）だけをずらす．dy は下向き（0以上）．"""
    if not (dx or dy):
        return
    px = f.load()
    head = f.crop((0, 0, 53, 37))
    for y in range(37):
        for x in range(53):
            px[x, y] = (0, 0, 0, 0)
    f.alpha_composite(head, (dx, dy))


def working(t: int, leaf: bool) -> Image.Image:
    """役割の土台：ベースキャラの刻み t の絵で，目を閉じ，分身なら葉っぱを頭に固定したもの．

    尻尾の揺れ・耳のぴくっ・体の沈みは，ベースキャラのまま残す．
    """
    f = MAIN_BASE[t].copy()
    px, shut = f.load(), MAIN_BASE[0].load()
    dy = DY[t]
    for xs, ys in EYE_BOXES:   # 目は閉じた状態にそろえる（役割が開け閉めする）
        for y in ys:
            for x in xs:
                px[x, y + dy] = shut[x, y]
    if leaf:                   # 葉っぱは揺らさず，頭と一緒に動かす
        sub = SUB_BASE[0].load()
        for y in range(64):
            for x in range(64):
                if sub[x, y] != shut[x, y] and y + dy < 64:
                    px[x, y + dy] = sub[x, y]
    return f


WORKING = {(t, leaf): working(t, leaf)
           for t in range(N) for leaf in (False, True)}


def fox(
    t: int, leaf: bool, sl: Sleep,
    eyes: bool = True, dx: int = 0, head: Point = (0, 0),
) -> tuple[Image.Image, Pixels]:
    """作業中のキツネの絵と，そのドットの表を返す．役割はこの上に小道具と前足を描く．

    ベースキャラの待機アニメーション（尻尾・耳・体の沈み）をそのまま使い，目は役割に
    合わせて開け閉めする（eyes）．開いた目はベースキャラの開いた目をそのまま写す．葉っぱは分身
    （leaf=True）だけで，頭に固定する．dx：視線の左右．head：頭のずれ．
    sl に従って，目を閉じ，あくびの口を描き，頭を下げる．
    """
    f = WORKING[t, leaf].copy()
    px = f.load()
    dy = DY[t]
    if eyes and not sl.shut and sl.yawn is None:
        o = OPEN.load()
        for xs, ys in EYE_BOXES:
            for y in ys:
                for x in xs:
                    if px[x, y + dy] == EYE:
                        px[x, y + dy] = FUR
        for xs, ys in EYE_BOXES:
            for y in ys:
                for x in xs:
                    if o[x, y] in EYE_COLORS:
                        px[x + dx, y + dy] = o[x, y]
    if sl.yawn is not None:  # 大きく開けた口
        for x in range(29, 32):
            px[x, 35 + dy] = px[x, 39 + dy] = EDGE
        for y in (36, 37, 38):
            px[28, y + dy] = px[32, y + dy] = EDGE
            for x in range(29, 32):
                px[x, y + dy] = PINK
    head_shift(f, head[0], head[1] + sl.nod)
    return f, f.load()


def blinking(t: int, period: int, offset: int) -> bool:
    """period 刻みに1度のまばたきが，刻み t に当たるか．"""
    return (t + offset) % period == 0


# ── 役割 ────────────────────────────────────────────

def think(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """考える：ベースキャラの待機アニメーションそのまま（眠気は，段階3で頭が下がるだけ）．"""
    f = (SUB_BASE if leaf else MAIN_BASE)[t].copy()
    head_shift(f, 0, sl.nod)
    return f


WOOD_PAL = {"o": (90, 54, 28, 255), "w": (204, 152, 98, 255),
            "g": (184, 130, 80, 255), "h": (222, 174, 120, 255),
            "f": (150, 98, 56, 255), "F": (124, 78, 42, 255)}


def low_table(
    px: Pixels, top: int, depth: int, legs: Point = (8, 53),
) -> None:
    """木の座卓．上から少し見下ろした天板（木目つき）と，手前の縁，脚．"""
    wood, x0, x1 = WOOD_PAL, 5, 58
    for y in range(top, top + depth):          # 天板
        for x in range(x0, x1 + 1):
            grain = (x * 7 + (y - top) * 13) % 23 < 3
            key = "h" if y == top else "g" if grain else "w"
            px[x, y] = wood[key]
    for y in (top + depth, top + depth + 1):   # 手前の縁
        for x in range(x0, x1 + 1):
            px[x, y] = wood["f"] if y == top + depth else wood["F"]
    for x in range(x0, x1 + 1):
        px[x, top - 1] = px[x, top + depth + 2] = wood["o"]
    for y in range(top - 1, top + depth + 3):
        px[x0 - 1, y] = px[x1 + 1, y] = wood["o"]
    for lx in legs:                            # 脚
        for y in range(top + depth + 3, 62):
            px[lx - 1, y] = px[lx + 3, y] = wood["o"]
            for x in range(lx, lx + 3):
                px[x, y] = wood["f"] if x == lx else wood["F"]
        for x in range(lx - 1, lx + 4):
            px[x, 62] = wood["o"]


BOOK_PAL = {"o": (70, 26, 22, 255), "C": (150, 64, 52, 255),
            "c": (124, 50, 42, 255), "S": (110, 42, 36, 255),
            "G": (214, 172, 84, 255), "p": (246, 236, 212, 255),
            "q": (206, 192, 166, 255)}
BOOK_ROWS = [".pqpqpqpqpqp.....pqpqpqpqpqp.",   # ページの小口（上からのぞく）
             "ooooooooooooooooooooooooooooo",
             "oCCCCCCCCCCCoSSSoCCCCCCCCCCCo",
             "oCcccccccccCoSGSoCcccccccccCo",   # 表紙の縁の押し型と，背の金の帯
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcCCCCCCCcCoSSSoCcCCCCCCCcCo",
             "oCcccccccccCoSGSoCcccccccccCo",
             "oCCCCCCCCCCCoSSSoCCCCCCCCCCCo",
             "ooooooooooooooooooooooooooooo"]


def research(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """調べる：布張りの本を自分へ向けて開いて読む（見えるのは表紙・裏表紙と背，上にページの小口）．

    本がゆっくり上下し，視線が行を追う．ページをめくるときと，あくびのときは，
    本を大きく下げる．
    """
    gaze = [-1, -1, 0, 0, 1, 1][(t // 2) % 6]
    f, px = fox(t, leaf, sl, eyes=not blinking(t, 24, 5), dx=gaze)
    b = [0, 0, 1, 2, 2, 1][(t // 3) % 6]                       # ゆっくり上下
    b = {30: 2, 31: 4, 32: 5, 33: 5, 34: 5, 35: 5, 36: 4, 37: 2}.get(t, b)
    if sl.yawn is not None:
        b = min(7, 2 + sl.yawn) if sl.yawn < 8 else 7 - 2 * (sl.yawn - 8)
    top = 38 + b
    flip = {32: (33, 42, 29), 33: (29, 31, 25), 34: (18, 27, 29)}.get(t)
    if flip:  # めくれるページ
        x0, x1, y0 = flip
        rect(px, x0, y0, x1, top, PAPER, PAPER_D)
    stamp(px, 16, top - 1, BOOK_ROWS, BOOK_PAL)
    paw(px, 16, top + 9)
    paw(px, 44, top + 9)
    return f


INKWELL_PAL = {"o": (36, 40, 66, 255), "k": (96, 108, 140, 255),
               "i": (34, 40, 74, 255), "h": (176, 196, 226, 255),
               "c": (150, 98, 56, 255)}
INKWELL_ROWS = ["..ccc..",      # コルクの栓
                "..oko..",
                ".ooooo.",
                "oiiiiho",
                "oiiiiho",
                "oiiiiio",
                "oiiiiio",
                ".ooooo."]
PAPER_PAL = {"p": (248, 242, 226, 255), "e": (210, 200, 178, 255)}
QUILL_V, QUILL_S = (250, 248, 240, 255), (214, 210, 200, 255)
QUILL_E, NIB = (170, 164, 154, 255), (40, 40, 52, 255)


def quill(px: Pixels, nx: int, ny: int) -> None:
    """羽ペン．ペン先（nx, ny）から右上へ，軸の左に羽根をつける．"""
    tx, ty = nx + 6, ny - 13
    n = 13
    pts = [(round(nx + (tx - nx) * i / n), round(ny + (ty - ny) * i / n))
           for i in range(n + 1)]
    for i, (x, y) in enumerate(pts):
        if i >= 4:                              # 羽根（根元と先は細く）
            w = 1 if i in (4, 5, n) else 2
            for k in range(1, w + 1):
                px[x - k, y] = QUILL_S if k == w else QUILL_V
            px[x - w - 1, y] = QUILL_E
    for i, (x, y) in enumerate(pts):            # 軸とペン先
        px[x, y] = NIB if i < 2 else QUILL_V if i >= 4 else QUILL_S


def write(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """書く：座卓の和紙に，羽ペンを左から右へ大きく走らせる．

    行の終わりで戻り，ときどき腕を大きく回してガラスのインク壺に浸す．
    頭も羽ペンを追って傾く．浸したあとは，新しい紙の行頭で構えて1周を終える．
    あくびのときは前足を止め，羽ペンを口の前からどける．
    """
    dip = [(30, 42), (22, 37), (15, 35), (11, 37),
           (11, 37), (15, 35), (22, 37), (30, 42)]
    done = t if t < 36 else 36 if t < 44 else 0   # 書いた刻み（浸したあとは新しい紙）
    if sl.yawn is not None:                     # 前足を止め，羽ペンを右へどける
        hx, hy = 38, 45
    elif t < 36:
        hx, hy = 22 + 2 * (done % 9), 46 - (done % 2)
    elif t < 44:
        hx, hy = dip[t - 36]
    else:                                       # 行頭で構える
        hx, hy = 22, 45
    lean = 0 if sl.yawn is not None else -1 if hx < 26 else 1 if hx > 34 else 0
    f, px = fox(t, leaf, sl, eyes=not blinking(t, 16, 9),
                dx=lean, head=(lean, 0))
    low_table(px, 44, 6, legs=(9, 50))
    rect(px, 17, 44, 41, 48, PAPER_PAL["p"])    # 和紙（天板の上に寝かせる）
    line(px, (17, 49), (41, 49), PAPER_PAL["e"])
    lines = done // 9                           # 書いた字（紙には2行まで見える）
    spans = [(row, 40) for row in range(min(lines, 2))]
    if lines < 2 and done < 36:                 # 書きかけの行
        spans.append((lines, 21 + 2 * (done % 9)))
    for row, end in spans:
        for x in range(21, end, 2):
            color = INK if (x // 2) % 3 else PAPER_PAL["p"]
            px[x, 46 + row] = px[x + 1, 46 + row] = color
    stamp(px, 8, 37, INKWELL_ROWS, INKWELL_PAL)
    paw(px, 18, 47)
    quill(px, hx + 1, hy)
    paw(px, hx, hy)
    return f


LID_PAL = {"o": (62, 64, 74, 255), "L": (222, 224, 230, 255),
           "m": (184, 188, 196, 255), "d": (150, 154, 164, 255),
           "H": (88, 90, 100, 255), "B": (164, 168, 178, 255)}
LID_ROWS = ["..ooooooooooooooooooo..",
            ".oLLLLLLLLLLLLLLLLLLLo.",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "oLmmmmmmmmmmmmmmmmmmmdo",
            "odddddddddddddddddddddo",
            "oHHHHHHHHHHHHHHHHHHHHHo"]   # 23×13ドット（実物に近い縦横比）．下端は蝶番
BASE_ROWS = ["oBBBBBBBBBBBBBBBBBBBBBBBo",
             ".ooooooooooooooooooooooo."]


def laptop(px: Pixels) -> None:
    """座卓の上のノートパソコン．見えるのは銀色のふたの外側（肉球のシール）と，キーボード側の縁．"""
    low_table(px, 52, 3)
    for x in range(19, 43):                     # 天板に落ちる影
        px[x, 52] = WOOD_PAL["g"]
    stamp(px, 19, 37, LID_ROWS, LID_PAL)
    stamp(px, 18, 50, BASE_ROWS, LID_PAL)
    for x, y in ((26, 41), (29, 40), (32, 41)):   # 肉球のシール：指
        rect(px, x, y, x + 1, y + 1, METAL_D)
    rect(px, 28, 43, 31, 45, METAL_D)             # 肉球のシール：掌
    px[27, 44] = px[32, 44] = METAL_D


def run(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """実行する：前のノートパソコンを必死にカタカタ打つ．

    前足がふたの上へ交互に跳ね上がり（下りた前足はキーボードの上で，ふたに隠れる），
    打つたびに頭が揺れる．ときどき両方の前足をそろえて構え，Enter を押し込む
    （腕は伸ばさない）．あくびのときは打つのを止める．
    """
    k = t % 16
    enter = k >= 12
    bob = int(k == 14) if enter else t % 2        # 打つたびに頭が揺れる
    if sl.yawn is not None:                       # あくびの間は打たない
        bob = 0
    f, px = fox(t, leaf, sl, eyes=enter or not blinking(t, 16, 5),
                head=(0, bob))
    laptop(px)
    if sl.yawn is not None:
        return f
    if not enter:                                 # ふたの上へ交互に跳ね上がる
        paw(px, *((21, 35) if t % 2 else (39, 35)))
    elif k < 14:                                  # 両方の前足をそろえて構え…
        paw(px, 21, 34)
        paw(px, 39, 34)
    # 14・15：両方の前足で Enter を押し込む（前足はふたに隠れ，頭がこくんと揺れる）
    return f


CUP_PAL = {  # 湯呑み（灰緑の釉薬の焼き物．上から緑茶が見え，下は素焼きの高台）
    "o": (74, 86, 78, 255),      # 縁取り
    "t": (128, 160, 72, 255),    # 緑茶
    "T": (160, 188, 96, 255),    # 緑茶の光
    "r": (214, 222, 206, 255),   # 口縁の光
    "g": (158, 178, 150, 255),   # 釉薬
    "h": (196, 212, 188, 255),   # 釉薬の光
    "s": (122, 142, 116, 255),   # 釉薬の陰
    "b": (96, 112, 100, 255),    # 線の模様
    "c": (176, 124, 82, 255),    # 素焼きの高台
}
CUP_ROWS = [".ooooooooooo.",       # 13×11ドット．口縁を少し上から見て，緑茶が見える
            "orTttttttttro",
            "o.rrrrrrrrr.o",
            "ohhgggggggsso",
            "ohhgggggggsso",
            "obbbbbbbbbbbo",
            "ohhgggggggsso",
            ".ohggggggsso.",
            ".ohggggggsso.",
            "..occccccco..",
            "...ooooooo..."]


def cup(px: Pixels, x0: int, y0: int) -> None:
    """湯呑みを，左上を (x0, y0) にして置く．"""
    stamp(px, x0, y0, CUP_ROWS, CUP_PAL)
    px[x0 + 1, y0 + 2] = px[x0 + 11, y0 + 2] = CUP_PAL["o"]   # 口縁の下の左右


def watch(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """見守る：分身の働きを，湯呑みのお茶を飲みながら待つ．

    湯呑みを口まで大きく持ち上げて一口飲み，湯気がゆらゆら高く昇る．
    あくびのときは飲まない（持ち上げた湯呑みが口を覆うため）．
    """
    sip = {36: 3, 37: 6, 38: 9, 39: 9, 40: 9, 41: 9, 42: 6, 43: 3}
    lift = (t // 6) % 2
    if sl.yawn is None:
        lift = sip.get(t, lift)
    f, px = fox(t, leaf, sl, eyes=False)
    top = 42 - lift
    cup(px, 24, top)
    if lift <= 1:
        for k in range(3):
            h = (t + 5 * k) % 15
            x = 30 + [0, 1, 1, 0, -1, -1][(t // 2 + k) % 6]
            if top - 3 - h > 18:
                px[x, top - 2 - h] = px[x, top - 3 - h] = STEAM
    for x in (21, 36):   # 両方の前足で両脇から包むように持つ（湯呑みの縁取りにだけ重ねる）
        rect(px, x, top + 4, x + 3, top + 7, PAW, EDGE)
    return f


def call(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """呼ぶ：ユーザーの返事や許可を待ち，こちらを向いて，胸の前で前足を小さく振る．"""
    f, px = fox(t, leaf, sl, eyes=not blinking(t, 12, 7))
    arm(px, (40, 42), [(45, 33), (47, 32)][(t // 3) % 2])
    return f


def rest(t: int, leaf: bool, sl: Sleep) -> Image.Image:
    """眠る：働き終えて，頭を垂れて眠る．ゆっくり息をして頭が上下する．眠気は重ねない．"""
    f = WORKING[t, leaf].copy()
    head_shift(f, 0, 3 + (t // 12) % 2)
    return f


# 役割の描き手：刻み・分身か・眠気 → 絵
Make = Callable[[int, bool, Sleep], Image.Image]

# 役割の名前（書き出すファイル名に使う）と描き手．
# 「眠る」（rest）は眠気の段階を持たないので別に扱う．
ROLES: dict[str, Make] = {"think": think, "research": research, "write": write,
                          "run": run, "watch": watch, "call": call}
LEVELS = range(4)   # 本体の眠気の段階


def frames(make: Make, leaf: bool, level: int = 0) -> list[Image.Image]:
    """一つの役割の48刻みの絵（64×64，RGBA）．"""
    return [make(t, leaf, Sleep(t, level)) for t in range(N)]
