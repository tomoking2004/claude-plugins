#!/usr/bin/env python3
"""Scan this repository's invariants.

A tool that turns BEAUTY.md's "zero check" into a rerunnable test rather than
an impression: exit 0 when there are no violations, exit 1 when there is even
one -- CI rests its verdict on this.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")

# A bare name that resolves to one of these can no longer be invoked as a skill
# (README "Development"). This mirrors Claude Code's built-in command list and
# can go stale as that set grows or shrinks upstream.
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
    violations.append(f"{where}: {msg}")


def rel(path: Path) -> str:
    """The one format for pointing at a violation: a repo-relative path."""
    return path.relative_to(REPO).as_posix()


def skill_dirs(plugins: set[str]) -> list[tuple[str, Path]]:
    """Enumerate every plugin's skill directories as (plugin, directory)."""
    return [
        (plugin, d)
        for plugin in sorted(plugins)
        for d in sorted((REPO / "plugins" / plugin / "skills").glob("*/"))
    ]


def frontmatter(path: Path) -> dict[str, str]:
    """Read a SKILL.md's leading frontmatter (flat key: value only)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    body = lines[1 : lines.index("---", 1)] if "---" in lines[1:] else []
    return {
        k.strip(): v.strip()
        for k, _, v in (line.partition(":") for line in body)
        if k.strip() and v.strip()
    }


def check_manifests() -> set[str]:
    """Whether marketplace.json, each plugin.json, and the directory layout agree.

    Returns the plugin names the remaining checks operate on.
    """
    marketplace = REPO / ".claude-plugin" / "marketplace.json"
    market = json.loads(marketplace.read_text(encoding="utf-8"))
    listed = {p["name"]: p["source"] for p in market["plugins"]}
    present = {
        d.name for d in (REPO / "plugins").iterdir()
        if (d / ".claude-plugin" / "plugin.json").exists()
    }

    for name in listed.keys() - present:
        fail(rel(marketplace), f"lists plugin {name}, which has no directory")
    for name in present - listed.keys():
        fail(rel(marketplace), f"omits plugin {name}, which exists")
    for name, source in listed.items():
        if source != f"./plugins/{name}":
            fail(rel(marketplace), f"{name} source is not ./plugins/{name} ({source})")

    for name in sorted(present):
        path = REPO / "plugins" / name / ".claude-plugin" / "plugin.json"
        m = json.loads(path.read_text(encoding="utf-8"))
        if m.get("name") != name:
            fail(rel(path), f"name disagrees with directory ({m.get('name')!r})")
        if not SEMVER.match(str(m.get("version", ""))):
            fail(rel(path), f"version is not SemVer ({m.get('version')!r})")
        if not m.get("description"):
            fail(rel(path), "no description")
        for dep in m.get("dependencies", []):
            if dep not in listed:
                fail(rel(path), f"dependency {dep} is not in the marketplace")

    return present


def check_skills(plugins: set[str]) -> None:
    """SKILL.md frontmatter, and bare-name collisions."""
    by_bare: dict[str, list[str]] = {}

    for plugin, d in skill_dirs(plugins):
        path = d / "SKILL.md"
        if not path.exists():
            fail(rel(d), "no SKILL.md")
            continue
        fm = frontmatter(path)
        if fm.get("name") != d.name:
            fail(rel(path), f"frontmatter name disagrees with directory ({fm.get('name')!r})")
        if not fm.get("description"):
            fail(rel(path), "no description")
        by_bare.setdefault(d.name, []).append(f"{plugin}:{d.name}")

    for bare, owners in sorted(by_bare.items()):
        if bare in BUILTIN_COMMANDS:
            fail(", ".join(owners), f"bare name /{bare} collides with a built-in command")
        if len(owners) > 1:
            fail(", ".join(owners), f"bare name /{bare} is shared by multiple skills")


def markdown() -> list[Path]:
    """Markdown in scope: the repo root (README, CLAUDE) and everything under plugins/.

    .claude/skills/ is a junction to plugins/, so it is not walked (it would
    only double the view).
    """
    return sorted(REPO.glob("*.md")) + sorted((REPO / "plugins").rglob("*.md"))


def plugin_root(md: Path) -> Path | None:
    """The root of the plugin a document belongs to; None if not under plugins/."""
    try:
        parts = md.resolve().relative_to((REPO / "plugins").resolve()).parts
    except ValueError:
        return None
    return (REPO / "plugins" / parts[0]).resolve()


def check_links() -> None:
    """Whether relative links resolve, and those inside a plugin stay in bounds."""
    link = re.compile(r"\[[^\]]*\]\((?!https?://|#)([^)]+)\)")

    for md in markdown():
        for target in link.findall(md.read_text(encoding="utf-8")):
            resolved = (md.parent / target.split("#")[0]).resolve()
            if not resolved.exists():
                fail(rel(md), f"link target does not exist ({target})")
                continue
            root = plugin_root(md)
            if root and root not in resolved.parents and resolved != root:
                fail(rel(md), f"link crosses the plugin boundary ({target}) -- unresolved once installed")


def check_dynamic_context(plugins: set[str]) -> None:
    """Whether each !`...` in a SKILL.md returns exit 0 and non-empty output.

    A non-zero exit becomes a runtime error when the skill loads (refine:docs,
    the medium's canon). Empty output can occur at exit 0 too: `git log
    "$tag..HEAD"` succeeds yet returns nothing when the tag is at HEAD, so a
    `|| echo "(none)"` fallback never fires. An empty section cannot tell
    "nothing to show" from "failed to fetch," so non-empty is required as well.
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

    sh = shutil.which("sh")
    if not sh:
        fail("scripts/scan.py", "no sh to check dynamic context (Git Bash on Windows)")
        return

    with tempfile.TemporaryDirectory() as tmp:
        for state, setup in fixtures().items():
            cwd = Path(tmp) / state
            cwd.mkdir()
            subprocess.run([sh, "-c", setup], cwd=cwd, capture_output=True)
            for where, cmd in commands:
                r = subprocess.run([sh, "-c", cmd], cwd=cwd, capture_output=True)
                if r.returncode != 0:
                    fail(where, f"[{state}] dynamic context exits {r.returncode}: {cmd}")
                elif not r.stdout.strip():
                    fail(where, f"[{state}] dynamic context output is empty: {cmd}")


def fixtures() -> dict[str, str]:
    """The git states a dynamic-context command may meet."""
    commit = 'git -c user.email=a@b -c user.name=a commit -qm'
    return {
        "non-git": ":",
        "pre-first-commit": "git init -q .",
        "commit-only": f"git init -q . && touch a && git add . && {commit} 'feat: a'",
        # A tag pointing at HEAD = just released. The one state where
        # `git log "$tag..HEAD"` succeeds yet returns empty; missing it is how
        # an empty section in release slipped through.
        "tag-at-HEAD": f"git init -q . && touch a && git add . && {commit} 'feat: a' && git tag v0.1.0",
        "changes-after-tag": (
            f"git init -q . && touch a && git add . && {commit} 'feat: a'"
            f" && git tag v0.1.0 && touch b && git add . && {commit} 'fix: b'"
        ),
        "dirty-worktree": (
            f"git init -q . && touch a && git add . && {commit} 'feat: a' && echo x > b"
        ),
    }


def main() -> int:
    """Run every check; return 0 on zero violations, 1 if there is any."""
    plugins = check_manifests()
    check_skills(plugins)
    check_links()
    check_dynamic_context(plugins)

    if violations:
        print(f"scan: {len(violations)} violation(s)")
        for v in violations:
            print(f"  x {v}")
        return 1
    print("scan: zero")
    return 0


if __name__ == "__main__":
    sys.exit(main())
