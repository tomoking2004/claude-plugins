# .claude/skills/ のジャンクションを本リポジトリのプラグイン構成に同期する．
# 冪等——全リンクを消して張り直すだけで，実フォルダには触れない．
# ジャンクションの使い方と，同名のマーケットプレイス版が有効なときの対処は README の「開発」節を参照．
$ErrorActionPreference = 'Stop'
$repo   = Split-Path $PSScriptRoot -Parent
$skills = Join-Path $PSScriptRoot 'skills'

New-Item -ItemType Directory -Force $skills | Out-Null
Get-ChildItem $skills | Where-Object LinkType | ForEach-Object { $_.Delete() }
Get-ChildItem -Directory (Join-Path $repo 'plugins') |
  Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') } |
  ForEach-Object { New-Item -ItemType Junction (Join-Path $skills $_.Name) -Target $_.FullName | Out-Null }
