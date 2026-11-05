#!/usr/bin/env python3
"""本リポジトリの不変条件を走査する．

BEAUTY.md の「ゼロ確認」を印象でなく再実行可能な検査として持つための道具．
違反ゼロなら exit 0，一つでもあれば exit 1——CI はこれを確定の根拠にする．
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

# 出力は UTF-8 に固定する——Git Bash から起動すると Python の既定は cp932 に
# なる一方で端末は UTF-8 で読むため，日本語の報告が化ける．
sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parent.parent
SEMVER = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?",
    re.ASCII,
)

# capstone:commit の「文面の基準」「固有の走査」のうち機械に判定できる部分
# （声・因果・1コミット1意図は，ここからは判定できない）．
SUBJECT = re.compile(
    r"^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)"
    r"(\([a-z][a-z0-9-]*\))?: .+"
)
# スキルの 50 字は読みやすさの目安で，超えても何も壊れない．機械の関門は
# 硬い上限（本文の折り返しと同じ 72 字）に置き，目安との差はスキルの走査に
# 委ねる．
SUBJECT_LIMIT = 72
BODY_LIMIT = 72
UNBREAKABLE = re.compile(r"\s*([-*]\s+)?[\x21-\x7e]+")
# ハーネスが注入するトレーラ．スキルは他のトレーラも禁じるが，
# 「Key: value」と読める本文行と区別できるのはこれらだけ．
INJECTED = re.compile(
    r"^(Co-Authored-By|Claude-Session):|Generated with \[Claude Code\]", re.I
)

# 素の名前がこれらのいずれかと一致するスキルは，素の名前で呼び出せないおそれがある
# （README の「開発」）．この集合は，公式文書の commands ページが挙げるコマンドと
# その別名の写しであり，上流で増減すれば失効しうる．
BUILTIN_COMMANDS = {
    "add-dir", "advisor", "agents", "allowed-tools", "android", "app",
    "artifact-capabilities", "artifact-diagramming", "artifacts",
    "auto-mode-setup", "autocompact", "autofix-pr", "background", "bashes",
    "batch", "bg", "branch", "btw", "bug", "cd", "checkpoint", "checkup",
    "chrome", "claude-api", "claude-in-chrome", "clear", "code-review",
    "color", "compact", "config", "context", "continue", "copy", "cost",
    "dataviz", "debug", "deep-research", "design", "design-login",
    "design-sync", "desktop", "diff", "doctor", "effort", "exit", "export",
    "extra-usage", "fast", "feedback", "fewer-permission-prompts", "focus",
    "fork", "goal", "heapdump", "help", "hooks", "ide", "import", "init",
    "insights", "install-github-app", "install-slack-app", "ios",
    "keybindings", "list-agents", "login", "logout", "loop", "mcp", "memory",
    "mobile", "model", "new", "output-style", "passes", "peers", "permissions",
    "plan", "plugin", "plugin-authoring", "powerup", "pr-comments",
    "privacy-settings", "proactive", "quit", "radio", "rate-limit-options",
    "rc", "recap", "release-notes", "reload-plugins", "reload-skills",
    "remote-control", "remote-env", "rename", "reset", "restart", "resume",
    "review", "rewind", "routines", "run", "run-skill-generator", "sandbox",
    "schedule", "scroll-speed", "security-review", "settings", "setup-bedrock",
    "setup-vertex", "share", "simplify", "skill-doctor", "skills", "slides",
    "stats", "status", "statusline", "stickers", "stop", "subtask", "tasks",
    "team-onboarding", "teleport", "terminal-setup", "theme", "tp", "tui",
    "ultraplan", "ultrareview", "undo", "update", "update-config", "upgrade",
    "usage", "usage-credits", "verify", "vim", "voice", "web-setup",
    "workflow-authoring", "workflows",
}

# 各スキルへ写した定型文の照合元．キーの語を持つ配布文書は，値を一字違わず持つ
# （BEAUTY.md に句のある項は同書が正で，ここはその控え）．
COPIES = {
    "推測せず問う": (
        "問い方：調べて届くことは調べ尽くし，ユーザーにしか分からないことだけを"
        "最初にまとめて問う．問いには調べた範囲・対象の原文・問う理由・"
        "答えで変わることを書き，未確認の前提で選ばせない．対象が一通りに読めるなら"
        "問わずにその読みで進め，採った読みを報告に1行載せる．"
        "ユーザーの発話が問いの形なら，依頼と読まず問いとして答える．"
    ),
    "一括編集": (
        "スクリプトで一括編集するときは，編集箇所を一意な文字列で指定し，"
        "想定する一致件数をスクリプトに検査させ，結果を読み直して完了とする．"
    ),
    "それぞれ1回だけ": (
        "全文の読みは美の基準が変わった後と公開・提出の前にそれぞれ1回だけ"
    ),
    "経緯を知らない": "経緯を知らない新しい役に任せる．",
    "その参照先": "変わった文とその参照先に当てる",
    "確度": (
        "検査役の指摘には確度（読みの確かさ）を高・中・低で付けさせ，「低」は止めず，"
        "書き手が判定して報告へ回す．"
    ),
    "何をいくつ数えた": "何をいくつ数えたかを報告させ",
    "事実照合・目的": "観点（事実照合・目的・言語・本番の読み手）ごとに",
    "読み手の役には": "読み手の役には本番の読み手が持つものだけを渡す．",
    "生成物のみ除く": (
        "生成物のみ除く；`.gitignore` 対象も走査し，私的なメモ等は変えてよいかを"
        "先に問う）．"
    ),
    "部分の手直し": (
        "周回は3まで；止める指摘が残れば部分の手直しを重ねず，指摘のある単位を"
        "丸ごと目的に戻って書き直し，それでも消えなければ上流（方針・割り当て）を"
        "疑って問う．"
    ),
    "採れるものを採り": "止める指摘以外は採れるものを採り，残りは報告する．",
    "立てた役と渡した材料": "立てた役と渡した材料（立てられない環境ならその旨）",
    "検査役に割った": "検査役に割った範囲の外で見つけた止める指摘も見送らない．",
    "次の作業へ積まない": (
        "範囲の外の，止める指摘でないものは報告だけして，次の作業へ積まない．"
    ),
    "指定された対象の外": "指定された対象の外は直さず報告する．",
    "別セッション": (
        "長い作業の途中で，会話が要約された・同じ欠陥を二度直した・読み直すと"
        "直しが消えていた・スキルの定義を読み直さずに書いた，のどれかが起きたら，"
        "区切りのよい箇所で止める．"
        "続きの状態をファイルに残し，別セッションに貼ればそのまま動く依頼の全文"
        "（目的・読むもの・済んだこと・残り・守る決定）を示して，移るよう促す．"
    ),
    "差し止める指摘": (
        "事実の誤り・目的に答えていない・数えられる規則の違反・"
        "意味が取れないか二通りに読める・明晰さの欠け（一文に二つの事柄・"
        "息が続かない・同じ語の近接・字数合わせで痩せた）"
    ),
    "選択式ダイアログ": (
        "平文の提案へのチャットの返信で受ける——選択式ダイアログは提案の表示を"
        "妨げるため使わない（承認でなく選ぶだけの問いは選択式でよい）．"
    ),
    "周回": "（走査と直しの一巡）",
    "検査役のゼロは": "検査役のゼロは，確定を差し止める指摘（止める指摘）のゼロを指す",
    "まず [BEAUTY": "まず [BEAUTY.md](../../BEAUTY.md) を読み，美の6条と走査の規律に従う．",
    "列挙で固定しない": "対応を列挙で固定しない（媒体スキルの増減に自動で追従させる）．",
    "大幅に・劇的に等": "測っていない程度の語（大幅に・劇的に等）を使わない",
    "その**進行**": (
        "[RUBRIC.md](../../RUBRIC.md) を読み，その**進行**（受領・納品・修正）に従う"
    ),
    "「領域の正典」に従って書く": (
        "出題文・採点基準を目的として，下の「領域の正典」に従って書く．"
    ),
    "二重定義しない": (
        "美の基準（BEAUTY.md）は refine プラグインの正典であり，本スキルはそれを"
        "二重定義しない．委譲の際は，必要十分の基準となる目的が出題文・採点基準で"
        "あることと，仕上げる対象が外へ出す成果物であることを明示する"
        "（成果物の文脈から推測させない）．検査役は委譲元が立てるので，"
        "委譲先には立てさせない．"
    ),
    "遵守ゲート**・**走査の規律": (
        "下の「固有の走査」と RUBRIC.md の**遵守ゲート**・**走査の規律**を全件通し，"
        "欠陥ゼロを確認して確定する．"
    ),
    "単独で呼ばれたなら本スキルが": (
        "納品するかは同書の**進行**に従う——単独で呼ばれたなら本スキルが納品し，"
        "委譲されたなら束ねて出すのは委譲元の責務なので納品しない．"
    ),
    "承認が覆う": (
        "承認が覆うのは見せた内容だけである——提案の後に内容を変えたら"
        "（但し書き1つでも）示して改めて問い，見せていない他所の変更を含めない．"
        "修正指示は反映して再提案，意図の割れる箇所は問う．"
    ),
    "通した証跡": (
        "「文面の基準」に従い，出す前に「固有の走査」を全件通し，"
        "**通した証跡を提案に添える**"
    ),
    "黙って飛ばして": (
        "走査は成果物を残さないので，黙って飛ばしても外からは見えない；添えれば"
        "見える．通さなかった走査があれば，その旨と理由も書く．"
    ),
    "両者を満たせば足り": "**両者を満たせば足り，実行時に他所を参照しない**．",
    "/groundwork:survey を先に": (
        "存在しなければ「/groundwork:survey を先に実行してください」と伝え，中断する．"
    ),
    "未確定は未確定": "未確定は未確定と書き，手順2に戻って問う．",
    "前提の位置": "未確定の事実を前提の位置（設計・整合条件）に置いていないか",
    "意味づけを混ぜ": "発言を約束・合意へ格上げするなど，記録者の意味づけを混ぜていないか．",
}
# これより短い一致は，語句の偶然の一致と見分けがつかない．
COPY_MIN = 30
# 写しの件数の控え．キーの語ごと書き換えた写しは照合を逃れ，件数の減りにだけ現れる．
COPY_TOTAL = 122

DATE = re.compile(r"(?<!\d)20\d{2}[-/年]\d{1,2}")
# 環境語を許す配布文書．ops は環境の操作そのものを担い，commit・release・docs は
# ツールの注入やハーネスの値を規則の対象として語る．他は環境に依存させない．
ENV_EXEMPT = (
    "plugins/ops/skills/*/SKILL.md",
    "plugins/capstone/skills/commit/SKILL.md",
    "plugins/capstone/skills/release/SKILL.md",
    "plugins/refine/skills/docs/SKILL.md",
)
ENV_WORDS = re.compile(
    r"Bash|PowerShell|Monitor|PushNotification|Remote Control|VS Code"
    r"|サブエージェント|ハーネス"
)

violations: list[str] = []


def fail(where: str, msg: str) -> None:
    """違反を一件記録する——`where` は違反の在処（パス・スキル名・コミット）．"""
    violations.append(f"{where}: {msg}")


def rel(path: Path) -> str:
    """パスで在処を名指す形——リポジトリ相対・スラッシュ区切り．"""
    return path.relative_to(REPO).as_posix()


# リポジトリの不変条件ではなく，本スクリプト自身の前提が破れたときの報告先．
SELF = rel(Path(__file__).resolve())


def skill_dirs(plugins: set[str]) -> list[tuple[str, Path]]:
    """全プラグインのスキルディレクトリを (プラグイン, ディレクトリ) で列挙する．"""
    return [
        (plugin, d)
        for plugin in sorted(plugins)
        for d in sorted((REPO / "plugins" / plugin / "skills").glob("*/"))
    ]


def frontmatter(path: Path) -> dict[str, str]:
    """SKILL.md 冒頭の frontmatter を読む（平坦な key: value のみ）．"""
    text = path.read_text(encoding="utf-8")
    lines = [line.strip() for line in text.splitlines()]
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return {}
    body = lines[1 : lines.index("---", 1)]
    pairs = (line.partition(":") for line in body)
    cleaned = ((k.strip(), v.strip().strip("\"'")) for k, _, v in pairs)
    return {k: v for k, v in cleaned if k and v}


def check_manifests() -> set[str]:
    """marketplace.json・各 plugin.json・ディレクトリ構成が一致するか．

    以降の検査が対象とするプラグイン名を返す．
    """
    marketplace = REPO / ".claude-plugin" / "marketplace.json"
    market = json.loads(marketplace.read_text(encoding="utf-8"))
    listed = {p["name"]: p["source"] for p in market["plugins"]}
    present = {
        d.name for d in (REPO / "plugins").iterdir()
        if (d / ".claude-plugin" / "plugin.json").exists()
    }

    for name in sorted(listed.keys() - present):
        fail(rel(marketplace), f"{name} を載せているが，ディレクトリが無い")
    for name in sorted(present - listed.keys()):
        fail(rel(marketplace), f"プラグイン {name} が存在するのに載せていない")
    for name, source in sorted(listed.items()):
        if source != f"./plugins/{name}":
            fail(rel(marketplace), f"{name} の source が違う（{source}）")

    for name in sorted(present):
        path = REPO / "plugins" / name / ".claude-plugin" / "plugin.json"
        m = json.loads(path.read_text(encoding="utf-8"))
        if m.get("name") != name:
            fail(rel(path), f"name がディレクトリと食い違う（{m.get('name')!r}）")
        if not SEMVER.fullmatch(str(m.get("version", ""))):
            fail(rel(path), f"version が SemVer でない（{m.get('version')!r}）")
        if not m.get("description"):
            fail(rel(path), "description が無い")
        for dep in m.get("dependencies", []):
            if dep not in listed:
                fail(rel(path), f"dependency {dep} がマーケットプレイスに無い")

    return present


def check_skills(plugins: set[str]) -> int:
    """各 SKILL.md の frontmatter がディレクトリと一致し，description が文で終わり，素の名前が一意か．

    走査したスキルの数を返す．
    """
    by_bare: dict[str, list[str]] = {}

    for plugin, d in skill_dirs(plugins):
        path = d / "SKILL.md"
        if not path.exists():
            fail(rel(d), "SKILL.md が無い")
            continue
        fm = frontmatter(path)
        if fm.get("name") != d.name:
            fail(rel(path), f"name がディレクトリと食い違う（{fm.get('name')!r}）")
        if not fm.get("description"):
            fail(rel(path), "description が無い")
        # 平仮名で終わらない文は体言止め——短くしても文として成立させる
        # （refine:docs の「description」）．
        plain = re.sub(r"（[^（）]*）", "", fm.get("description", ""))
        for sentence in re.findall(r"[^．]+．", plain):
            if not re.match(r"[ぁ-ん]", sentence[-2]):
                fail(rel(path), f"description の文が体言で止まる（{sentence}）")
        by_bare.setdefault(d.name, []).append(f"{plugin}:{d.name}")

    for bare, owners in sorted(by_bare.items()):
        if bare in BUILTIN_COMMANDS:
            fail(", ".join(owners), f"素の名前 /{bare} が組み込みコマンドと衝突する")
        if len(owners) > 1:
            fail(", ".join(owners), f"素の名前 /{bare} が複数のスキルで重複する")

    return sum(len(owners) for owners in by_bare.values())


def markdown() -> list[Path]:
    """走査対象の Markdown——リポジトリ直下（README・CLAUDE）と plugins/ 配下の全て．

    .claude/skills/ の中身は plugins/ の各プラグインへのジャンクションなので
    辿らない（辿れば同じものを二重に見るだけになる）．
    """
    return sorted(REPO.glob("*.md")) + distributed()


def distributed() -> list[Path]:
    """配布される Markdown——plugins/ 配下の全て．"""
    return sorted((REPO / "plugins").rglob("*.md"))


def prose(md: Path) -> str:
    """Markdown の本文——コードフェンスの中は例であって，構造として読まない．"""
    text = md.read_text(encoding="utf-8")
    fence = r"^[ \t]*```.*?^[ \t]*```[ \t]*$"
    return re.sub(fence, "", text, flags=re.M | re.S)


def plugin_root(md: Path) -> Path | None:
    """文書が属するプラグインのルート；plugins/ 配下でなければ None．"""
    try:
        parts = md.resolve().relative_to((REPO / "plugins").resolve()).parts
    except ValueError:
        return None
    return (REPO / "plugins" / parts[0]).resolve()


def check_links() -> int:
    """相対リンクが解決し，プラグイン内のものが境界を越えていないか．

    走査したリンクの数を返す．
    """
    link = re.compile(r"\[[^\]]*\]\((?!https?://|mailto:|#)([^)\s]+)")
    count = 0

    for md in markdown():
        text = re.sub(r"`[^`\n]*`", "", prose(md))  # インラインコードは例である
        for target in link.findall(text):
            count += 1
            resolved = (md.parent / target.split("#")[0]).resolve()
            if not resolved.exists():
                fail(rel(md), f"リンク先が存在しない（{target}）")
                continue
            root = plugin_root(md)
            if root and root not in resolved.parents and resolved != root:
                fail(rel(md), f"リンクがプラグイン境界を越える（{target}）")

    return count


def check_articles() -> int:
    """BEAUTY.md の「美のN条」の見出しが，条の数と全文書の参照に一致するか．

    走査した参照の数を返す．
    """
    beauty = REPO / "plugins" / "refine" / "BEAUTY.md"
    section = re.search(
        r"^## 美の(\d+)条$(.*?)^## ", prose(beauty), flags=re.M | re.S
    )
    if not section:
        fail(rel(beauty), "「美のN条」の節が無い")
        return 0
    declared = section[1]
    items = len(re.findall(r"^- \*\*", section[2], flags=re.M))
    if items != int(declared):
        fail(rel(beauty), f"見出しは {declared} 条だが，条は {items} 項ある")

    count = 0
    for md in markdown():
        # 「3条件」のような語は条の参照でない．
        for n in re.findall(r"(?<!\d)(\d+)条(?!件)", prose(md)):
            count += 1
            if n != declared:
                fail(rel(md), f"「{n}条」が条の数 {declared} と食い違う")
    return count


def check_copies() -> int:
    """写した定型文が，キーの語を持つ配布文書の全てで一字違わず一致するか．

    走査した写しの数を返す．
    """
    count = 0
    for md in distributed():
        text = prose(md)
        for key, sentence in COPIES.items():
            if key in text:
                count += 1
                if sentence not in text:
                    fail(rel(md), f"「{key}」の定型文が正と食い違う")
    if count != COPY_TOTAL:
        fail(SELF, f"定型文の写しが {count} 件で，控えの {COPY_TOTAL} 件と違う")
    return count


def fragments(md: Path) -> list[str]:
    """本文を句点・セミコロン・コロン・ダッシュで切った断片——写しを探す単位．

    項の見出し語は項の名前なので除く．動的コンテキストの行は別の検査が走らせて
    確かめるので，写しに数えない．
    """
    head = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(?:\*\*[^*]+\*\*：)?")
    parts: list[str] = []
    for line in prose(md).splitlines():
        if not line.startswith("!`"):
            parts += re.split(r"(?<=[．；：])|——", head.sub("", line, count=1))
    return [part.strip() for part in parts]


def unlisted(part: str) -> bool:
    """断片が，COPIES の定型文で覆えない COPY_MIN 字以上を持つか．"""
    if any(part in sentence for sentence in COPIES.values()):
        return False
    for sentence in COPIES.values():
        part = part.replace(sentence, "")
    return len(part) >= COPY_MIN


def check_unlisted_copies() -> int:
    """二つの配布文書に現れる同じ断片が，COPIES に載っているか．

    載らない写しは，片方だけ直されても誰も気づかない．走査した断片の数を返す．
    """
    owners: dict[str, set[str]] = {}
    for md in distributed():
        for part in fragments(md):
            if len(part) >= COPY_MIN:
                owners.setdefault(part, set()).add(rel(md))
    for part, documents in sorted(owners.items()):
        if len(documents) > 1 and unlisted(part):
            fail(", ".join(sorted(documents)), f"COPIES に無い写し（{part}）")
    return len(owners)


def check_emphasis() -> int:
    """強調の両端の `**` が GitHub の描画で区切りとして働くか．

    CommonMark では，内側の端が約物で外側の隣が文字の `**` は強調の区切りに
    ならず，記号のまま露出する（`**項目（注）**が` の類）．括弧は強調の外へ出す．
    走査した強調の数を返す．
    """
    emphasis = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")

    def mark(char: str) -> bool:
        return unicodedata.category(char)[0] in "PS"

    def word(char: str) -> bool:
        return not char.isspace() and not mark(char)

    count = 0
    for md in markdown():
        text = re.sub(r"`[^`\n]*`", "``", prose(md))
        for line in text.splitlines():
            padded = f" {line} "
            for m in emphasis.finditer(padded):
                count += 1
                before, after = padded[m.start() - 1], padded[m.end()]
                if (mark(m[1][-1]) and word(after)) or (
                    mark(m[1][0]) and word(before)
                ):
                    fail(rel(md), f"強調が閉じない（{m[0]}）")
    return count


def check_endings() -> int:
    """一つの段落・項の中で，同じ文末が3回続かないか（refine:docs の「近接の反復」）．

    文末は句点の前の2字で見る．走査した文の数を返す．
    """
    count = 0
    for md in markdown():
        for line in prose(md).splitlines():
            sentences = re.findall(r"[^．]+．", re.sub(r"`[^`\n]*`", "C", line))
            count += len(sentences)
            ends = [sentence[-3:-1] for sentence in sentences]
            for first, second, third in zip(ends, ends[1:], ends[2:]):
                if first == second == third:
                    fail(rel(md), f"文末「{first}．」が3回続く")
    return count


def check_encoding() -> int:
    """追跡中の .ps1 が，非 ASCII を含むなら BOM を持つか．

    BOM が無いと Windows PowerShell 5.1 はシステムの符号化で読み，コメント末尾の
    全角句点が次の行を飲み込む．走査したファイルの数を返す．
    """
    tracked = subprocess.run(
        ["git", "ls-files", "-z", "--", "*.ps1"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    ).stdout.split("\0")
    paths = (REPO / name for name in tracked if name)
    scripts = [path for path in paths if path.exists()]
    for path in scripts:
        raw = path.read_bytes()
        if not raw.isascii() and not raw.startswith(b"\xef\xbb\xbf"):
            fail(rel(path), "非 ASCII を含むのに BOM が無い")
    return len(scripts)


def check_distribution() -> int:
    """配布文書に所有者の固有名・日付が無いか（コードフェンスの中も配布される）．

    走査した配布文書の数を返す．マニフェストは固有名を必須項として持つので，
    対象は Markdown に限る．
    """
    marketplace = REPO / ".claude-plugin" / "marketplace.json"
    market = json.loads(marketplace.read_text(encoding="utf-8"))
    owner = market["owner"]["name"]
    documents = distributed()

    for md in documents:
        text = md.read_text(encoding="utf-8")
        if owner in text:
            fail(rel(md), f"所有者の固有名 {owner} がある")
        for date in DATE.findall(text):
            fail(rel(md), f"日付がある（{date}）")

    return len(documents)


def check_environment() -> int:
    """ENV_EXEMPT 以外の配布文書に実行環境の語が無いか．

    走査した文書の数を返す．
    """
    exempt = {md for pattern in ENV_EXEMPT for md in REPO.glob(pattern)}
    documents = [md for md in distributed() if md not in exempt]
    for md in documents:
        for word in ENV_WORDS.findall(md.read_text(encoding="utf-8")):
            fail(rel(md), f"環境語がある（{word}）")
    return len(documents)


def sh_path() -> str | None:
    """動的コンテキストを走らせる sh；見つからなければ None．

    PATH に無ければ git から辿る——PowerShell から起動すると Git for Windows
    の sh は PATH に載らないが，git 本体（`<Git>/cmd/git.exe`）の隣
    （`<Git>/bin/sh.exe`）には必ずある．
    """
    sh = shutil.which("sh")
    if sh:
        return sh
    git = shutil.which("git")
    if git:
        beside = Path(git).resolve().parent.parent / "bin" / "sh.exe"
        if beside.exists():
            return str(beside)
    return None


def fixtures() -> dict[str, str]:
    """動的コンテキストのコマンドが出会いうる git 状態．"""
    commit = "git -c user.email=a@b -c user.name=a commit -qm"
    first = f"git init -q . && touch a && git add . && {commit} 'feat: a'"
    return {
        "non-git": ":",
        "pre-first-commit": "git init -q .",
        "commit-only": first,
        "detached-HEAD": f"{first} && git checkout -q --detach",
        # HEAD を指すタグ＝リリース直後．`git log "$tag..HEAD"` が成功しつつ
        # 空を返す唯一の状態．
        "tag-at-HEAD": f"{first} && git tag v0.1.0",
        "changes-after-tag": (
            f"{first} && git tag v0.1.0"
            f" && touch b && git add . && {commit} 'fix: b'"
        ),
        # 見直しの記録がある状態．heal:canon の動的コンテキストの本筋が通る．
        "after-review": (
            "git init -q . && touch a && git add ."
            f" && {commit} 'chore: review the canon'"
            " && mkdir s && touch s/SKILL.md && git add ."
            f" && {commit} 'feat: b'"
        ),
        "dirty-worktree": f"{first} && echo x > b",
    }


def check_dynamic_context(plugins: set[str]) -> int:
    """SKILL.md の各 !`...` が exit 0 かつ非空の出力を返すか．

    非ゼロ終了はスキルの呼び出しごと止める（refine:docs の
    「媒体の正典」）．exit 0 でも出力が空になることはある——タグが HEAD に
    あるとき `git log "$tag..HEAD"` は成功しつつ何も返さず，`|| echo "（なし）"`
    の代替文は発火しない．空の節は何を示すのか読み手に分からないので，
    非空であることも併せて要求する．走査したコマンドの数を返す．
    """
    commands: list[tuple[str, str]] = []
    for _, d in skill_dirs(plugins):
        path = d / "SKILL.md"
        if not path.exists():
            continue
        for cmd in re.findall(r"(?:^|(?<=\s))!`([^`]+)`", prose(path), re.M):
            commands.append((rel(path), cmd))
    if not commands:
        return 0

    sh = sh_path()
    if not sh:
        fail(SELF, "動的コンテキストを検査する sh が無い（Windows では Git Bash）")
        return len(commands)

    with tempfile.TemporaryDirectory() as tmp:
        for state, setup in fixtures().items():
            cwd = Path(tmp) / state
            cwd.mkdir()
            prep = subprocess.run(
                [sh, "-c", setup], cwd=cwd, capture_output=True
            )
            if prep.returncode != 0:
                # 黙って受け流せば，全コマンドを誤った git 状態に対して
                # 検査したうえで通してしまう．
                fail(SELF, f"[{state}] git 状態の準備に失敗した：{setup}")
                continue
            for where, cmd in commands:
                r = subprocess.run(
                    [sh, "-c", cmd], cwd=cwd, capture_output=True
                )
                if r.returncode != 0:
                    fail(where, f"[{state}] exit {r.returncode}：{cmd}")
                elif not r.stdout.strip():
                    fail(where, f"[{state}] 出力が空：{cmd}")

    return len(commands)


def check_commits() -> int:
    """マージを除く全コミットメッセージが capstone:commit の機械的な部分を満たすか．

    マージの件名はホスティングが機械的に作るので，形式を負わせない．

    同スキルの走査は自己申告——実行したかを外から確かめる者はおらず，
    push 済みのコミットは，もう refine し直せない成果物である．
    機械に判定できる形式は，ここで判定する．走査したコミットの数を返す．
    """
    shallow = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"],
        cwd=REPO, capture_output=True, text=True,
    )
    if shallow.stdout.strip() == "true":
        fail(SELF, "履歴が浅い——fetch-depth: 0 で取得すること")
        return 0
    r = subprocess.run(
        ["git", "log", "--no-merges", "--format=%h%x00%B%x1e"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    if r.returncode != 0:
        fail(SELF, "コミットメッセージを検査する git 履歴が無い")
        return 0

    count = 0
    for entry in r.stdout.split("\x1e"):
        if not entry.strip():
            continue
        count += 1
        short, _, message = entry.strip("\n").partition("\x00")
        where = f"commit {short}"
        lines = message.rstrip().splitlines()
        # --allow-empty-message は読むものを残さない．落ちずに報告する．
        subject = lines[0] if lines else ""

        if not SUBJECT.match(subject):
            fail(where, f"件名が type(scope): summary の形でない（{subject!r}）")
        if len(subject) > SUBJECT_LIMIT:
            fail(where, f"件名が {len(subject)} 字で {SUBJECT_LIMIT} 字を超える")
        if subject.endswith((".", "．", "。")):
            fail(where, "件名が句点で終わる")
        if len(lines) > 1 and lines[1].strip():
            fail(where, "件名と本文の間に空行が無い")
        for line in lines[1:]:
            if INJECTED.search(line):
                fail(where, f"注入トレーラがある（{line.strip()}）")
            # 上限超過を数えるのは折り返せる行だけ——裸の URL やパスは
            # どこにも切れ目が無い．
            if len(line) > BODY_LIMIT and not UNBREAKABLE.fullmatch(line):
                fail(where, f"本文行が {len(line)} 字で上限を超える")

    return count


def main() -> int:
    """全ての検査を走らせ，違反ゼロなら 0，一つでもあれば 1 を返す．

    対象が0件の検査は，何も見ずに合格したのと見分けがつかないので違反に数える．
    """
    plugins = check_manifests()
    counts = {
        "プラグイン": len(plugins),
        "スキル": check_skills(plugins),
        "リンク": check_links(),
        "条の参照": check_articles(),
        "定型文": check_copies(),
        "写しの断片": check_unlisted_copies(),
        "強調": check_emphasis(),
        "文末": check_endings(),
        "ps1": check_encoding(),
        "配布文書": check_distribution(),
        "環境語の文書": check_environment(),
        "動的コンテキスト": check_dynamic_context(plugins),
        "コミット": check_commits(),
    }
    for name, count in counts.items():
        if count == 0:
            fail(SELF, f"{name} の検査の対象が0件——当たっていない")
    print("scan: 対象 " + "・".join(f"{k} {v}" for k, v in counts.items()))

    if violations:
        print(f"scan: 違反 {len(violations)} 件")
        for v in violations:
            print(f"  x {v}")
        return 1
    print("scan: ゼロ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
