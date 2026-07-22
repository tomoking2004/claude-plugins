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
from pathlib import Path

# 出力は UTF-8 に固定する——Git Bash から起動すると Python の既定は cp932 に
# なる一方で端末は UTF-8 で読むため，日本語の報告が化ける．
sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")

# capstone:commit の「文面の基準」のうち機械に判定できる半分
# （声・因果・1コミット1意図は，ここからは判定できない）．
SUBJECT = re.compile(
    r"^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)"
    r"(\([a-z][a-z0-9-]*\))?: .+"
)
# スキルが求めるのは「約50字以内」だが，50 は読みやすさの目安で超えても
# 何も壊れない．機械の関門は硬い上限（本文の折り返しと同じ 72 字）に置き，
# 目安との差はスキルの走査に委ねる．
SUBJECT_LIMIT = 72
BODY_LIMIT = 72
# ハーネスが注入するトレーラ．スキルはトレーラ全般を禁じるが，
# 「Key: value」と読める本文行と区別できるのはこれらだけ．
INJECTED = re.compile(
    r"^(Co-Authored-By|Claude-Session)\b|Generated with \[Claude Code\]", re.I
)

# 素の名前がこれらのいずれかに解決するスキルは，もう呼び出せない
# （README の「開発」）．Claude Code の組み込みコマンド一覧の写しであり，
# 上流でその集合が増減すれば失効しうる．
BUILTIN_COMMANDS = {
    "add-dir", "agents", "bug", "clear", "compact", "config", "context", "cost",
    "doctor", "exit", "export", "fast", "help", "hooks", "ide", "init",
    "install-github-app", "login", "logout", "mcp", "memory", "migrate-installer",
    "model", "output-style", "permissions", "plugin", "pr-comments",
    "privacy-settings", "release-notes", "resume", "review", "rewind", "sandbox",
    "security-review", "status", "statusline", "terminal-setup", "todos",
    "upgrade", "usage", "vim",
}

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
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return {}
    body = lines[1 : lines.index("---", 1)]
    return {
        k.strip(): v.strip()
        for k, _, v in (line.partition(":") for line in body)
        if k.strip() and v.strip()
    }


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
        fail(rel(marketplace), f"プラグイン {name} を載せているが，ディレクトリが無い")
    for name in sorted(present - listed.keys()):
        fail(rel(marketplace), f"プラグイン {name} が存在するのに載せていない")
    for name, source in sorted(listed.items()):
        if source != f"./plugins/{name}":
            fail(rel(marketplace), f"{name} の source が ./plugins/{name} でない（{source}）")

    for name in sorted(present):
        path = REPO / "plugins" / name / ".claude-plugin" / "plugin.json"
        m = json.loads(path.read_text(encoding="utf-8"))
        if m.get("name") != name:
            fail(rel(path), f"name がディレクトリと食い違う（{m.get('name')!r}）")
        if not SEMVER.match(str(m.get("version", ""))):
            fail(rel(path), f"version が SemVer でない（{m.get('version')!r}）")
        if not m.get("description"):
            fail(rel(path), "description が無い")
        for dep in m.get("dependencies", []):
            if dep not in listed:
                fail(rel(path), f"dependency {dep} がマーケットプレイスに無い")

    return present


def check_skills(plugins: set[str]) -> None:
    """各 SKILL.md の frontmatter がディレクトリと一致し，素の名前が一意か．"""
    by_bare: dict[str, list[str]] = {}

    for plugin, d in skill_dirs(plugins):
        path = d / "SKILL.md"
        if not path.exists():
            fail(rel(d), "SKILL.md が無い")
            continue
        fm = frontmatter(path)
        if fm.get("name") != d.name:
            fail(rel(path), f"frontmatter の name がディレクトリと食い違う（{fm.get('name')!r}）")
        if not fm.get("description"):
            fail(rel(path), "description が無い")
        by_bare.setdefault(d.name, []).append(f"{plugin}:{d.name}")

    for bare, owners in sorted(by_bare.items()):
        if bare in BUILTIN_COMMANDS:
            fail(", ".join(owners), f"素の名前 /{bare} が組み込みコマンドと衝突する")
        if len(owners) > 1:
            fail(", ".join(owners), f"素の名前 /{bare} が複数のスキルで重複する")


def markdown() -> list[Path]:
    """走査対象の Markdown——リポジトリ直下（README・CLAUDE）と plugins/ 配下の全て．

    .claude/skills/ は plugins/ へのジャンクションなので辿らない
    （辿れば同じものを二重に見るだけになる）．
    """
    return sorted(REPO.glob("*.md")) + sorted((REPO / "plugins").rglob("*.md"))


def plugin_root(md: Path) -> Path | None:
    """文書が属するプラグインのルート；plugins/ 配下でなければ None．"""
    try:
        parts = md.resolve().relative_to((REPO / "plugins").resolve()).parts
    except ValueError:
        return None
    return (REPO / "plugins" / parts[0]).resolve()


def check_links() -> None:
    """相対リンクが解決し，プラグイン内のものが境界を越えていないか．"""
    link = re.compile(r"\[[^\]]*\]\((?!https?://|#)([^)]+)\)")

    for md in markdown():
        for target in link.findall(md.read_text(encoding="utf-8")):
            resolved = (md.parent / target.split("#")[0]).resolve()
            if not resolved.exists():
                fail(rel(md), f"リンク先が存在しない（{target}）")
                continue
            root = plugin_root(md)
            if root and root not in resolved.parents and resolved != root:
                fail(rel(md), f"リンクがプラグイン境界を越える（{target}）：導入時に解決しない")


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
    commit = 'git -c user.email=a@b -c user.name=a commit -qm'
    return {
        "non-git": ":",
        "pre-first-commit": "git init -q .",
        "commit-only": f"git init -q . && touch a && git add . && {commit} 'feat: a'",
        # HEAD を指すタグ＝リリース直後．`git log "$tag..HEAD"` が成功しつつ
        # 空を返す唯一の状態で，ここを見落としたために release で空の節が通った．
        "tag-at-HEAD": (
            f"git init -q . && touch a && git add . && {commit} 'feat: a'"
            f" && git tag v0.1.0"
        ),
        "changes-after-tag": (
            f"git init -q . && touch a && git add . && {commit} 'feat: a'"
            f" && git tag v0.1.0 && touch b && git add . && {commit} 'fix: b'"
        ),
        "dirty-worktree": (
            f"git init -q . && touch a && git add . && {commit} 'feat: a' && echo x > b"
        ),
    }


def check_dynamic_context(plugins: set[str]) -> None:
    """SKILL.md の各 !`...` が exit 0 かつ非空の出力を返すか．

    非ゼロ終了はスキル読み込み時の実行時エラーになる（refine:docs の
    「媒体の正典」）．exit 0 でも出力が空になることはある——タグが HEAD に
    あるとき `git log "$tag..HEAD"` は成功しつつ何も返さず，`|| echo "(none)"`
    の代替文は発火しない．空の節は「示すものが無い」と「取得に失敗した」を
    区別できないので，非空であることも併せて要求する．
    """
    commands: list[tuple[str, str]] = []
    for _, d in skill_dirs(plugins):
        path = d / "SKILL.md"
        if not path.exists():
            continue
        for cmd in re.findall(r"^!`(.+)`$", path.read_text(encoding="utf-8"), re.M):
            commands.append((rel(path), cmd))
    if not commands:
        return

    sh = sh_path()
    if not sh:
        fail(SELF, "動的コンテキストを検査する sh が無い（Windows では Git Bash）")
        return

    with tempfile.TemporaryDirectory() as tmp:
        for state, setup in fixtures().items():
            cwd = Path(tmp) / state
            cwd.mkdir()
            prep = subprocess.run([sh, "-c", setup], cwd=cwd, capture_output=True)
            if prep.returncode != 0:
                # 黙って受け流せば，全コマンドを誤った git 状態に対して
                # 検査したうえで通してしまう．
                fail(SELF, f"[{state}] git 状態の準備に失敗した：{setup}")
                continue
            for where, cmd in commands:
                r = subprocess.run([sh, "-c", cmd], cwd=cwd, capture_output=True)
                if r.returncode != 0:
                    fail(where, f"[{state}] 動的コンテキストが exit {r.returncode}：{cmd}")
                elif not r.stdout.strip():
                    fail(where, f"[{state}] 動的コンテキストの出力が空：{cmd}")


def check_commits() -> None:
    """全コミットメッセージが capstone:commit の機械的な半分を満たすか．

    同スキルの走査は自己申告——実行したかを外から確かめる者はおらず，
    push 済みのコミットは，ここで唯一もう refine し直せない成果物である．
    機械に判定できるものは，ここで判定する．
    """
    if (REPO / ".git" / "shallow").exists():
        fail(SELF, "履歴が浅い——fetch-depth: 0 で取得すること")
        return
    r = subprocess.run(
        ["git", "log", "--no-merges", "--format=%h%x00%B%x1e"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    if r.returncode != 0:
        fail(SELF, "コミットメッセージを検査する git 履歴が無い")
        return

    for entry in r.stdout.split("\x1e"):
        if not entry.strip():
            continue
        short, _, message = entry.strip("\n").partition("\x00")
        where = f"commit {short}"
        lines = message.rstrip().splitlines()
        # --allow-empty-message は読むものを残さない．落ちずに報告する．
        subject = lines[0] if lines else ""

        if not SUBJECT.match(subject):
            fail(where, f"件名が type(scope): summary の形でない（{subject!r}）")
        if len(subject) > SUBJECT_LIMIT:
            fail(where, f"件名が {len(subject)} 字で {SUBJECT_LIMIT} 字を超える")
        if subject.endswith("."):
            fail(where, "件名が句点で終わる")
        if len(lines) > 1 and lines[1].strip():
            fail(where, "件名と本文の間に空行が無い")
        for line in lines[1:]:
            if INJECTED.search(line):
                fail(where, f"注入トレーラがある（{line.strip()}）")
            # 上限超過を数えるのは折り返せた行だけ——裸の URL やパスは
            # どこにも切れ目が無い．
            if len(line) > BODY_LIMIT and " " in line[:BODY_LIMIT]:
                fail(where, f"本文行が {len(line)} 字で {BODY_LIMIT} 字を超える")


def main() -> int:
    """全ての検査を走らせ，違反ゼロなら 0，一つでもあれば 1 を返す．"""
    plugins = check_manifests()
    check_skills(plugins)
    check_links()
    check_dynamic_context(plugins)
    check_commits()

    if violations:
        print(f"scan: 違反 {len(violations)} 件")
        for v in violations:
            print(f"  x {v}")
        return 1
    print("scan: ゼロ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
