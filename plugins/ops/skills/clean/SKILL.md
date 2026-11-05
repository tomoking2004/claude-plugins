---
name: clean
description: このマシンに溜まった Claude Code の履歴・痕跡・キャッシュを，何を消すか列挙して承認を得たうえで消し，ログイン・設定・導入済みプラグイン・自動メモリは残す．「Claude Code の履歴を消して」「痕跡を掃除して」など，Claude Code がローカルに残したものの削除を明示的に求められたときだけ使う——「クリーンアップして」等の一般の整理の依頼では発動しない．実行中ジョブのログを見たいだけなら /ops:progress を使う．
---

対象：このマシンに Claude Code が残す**履歴・痕跡・キャッシュ**——過去の会話・入力・編集前スナップショット・スクラッチ・利用統計など，消えても次回以降の起動と身元・設定・導入済みプラグイン・自動メモリに影響しないもの．

**対象外（消さない）**：身元と設定と導入済みプラグインと自動メモリ——履歴ではなく，消せば再ログインや再導入・再設定を強いるか，積み上げた記憶を失うもの．何がそれに当たるかは下の「維持の対象」が列挙する．

## 手順

1. **列挙する**：下の「削除の対象」を実際に走査し，各項目の実在を確かめ，ファイル数・容量を数える——存在しない項目は黙って飛ばす．同時に「維持の対象」も実在を確かめ，触れないものとして脇に置く．
2. **明示して承認を得る**：何を・どれだけ消し，何を残すかを表で示してから問う——削除は取り消せない（手順3のバックアップは `~/.claude.json` のみを守る）．ユーザーが範囲を指定していればそれに従う．承認なしに手順4へ進まない．
3. **`~/.claude.json` を退避する**：このファイルは残すものの中で唯一，身元・設定と履歴が同居し，手順5で一部キーだけを削る——編集前の全文を `%TEMP%\claude-cleanup-backup\`（POSIX では `$TMPDIR/claude-cleanup-backup`）へ複製してから触る．他の削除対象はバックアップしない（履歴そのものを消すのが目的）．
4. **ファイル・ディレクトリを消す**：「削除の対象」を下の「削除の正典」に従って消す——ディレクトリの残し方も，生きているセッションの避け方もそこが定める．
5. **`~/.claude.json` から履歴キーだけを削る**：「削除の正典」の除去方式で，利用統計・キャッシュ系のキーだけを落とし，身元・設定キーは残す．
6. **裏取りして報告する**：削除後に，下の「維持の対象」が無傷であることを実際に読んで確かめ，手順3で退避した複製を消す（本体の全内容を持つので，残せば履歴を消したことにならない）．解放した容量と残したものを簡潔に伝える．

## 削除の対象

`~/.claude/` 配下（`~` は Windows では `%USERPROFILE%`）：

- `projects/` — 全会話のトランスクリプト（`.jsonl`・tool-results・subagents ログ）．**ただし各プロジェクトの `memory/` は残す**（維持の対象）．
- `file-history/` — 編集前ファイルのスナップショット（Undo 用）．
- `history.jsonl` — 入力したプロンプトの履歴．
- `shell-snapshots/` — シェル環境のスナップショット．
- `session-env/` — セッション毎の環境ディレクトリ．
- `backups/` — `~/.claude.json` の自動バックアップ．
- `cache/` — changelog・issue 等のキャッシュ．
- `telemetry/` — 送信待ち／失敗したテレメトリイベント．
- `ide/` — IDE のロック．**ただし生きているものは残す**（正典参照）．
- `paste-cache/` — 大きな貼り付けの中身．
- `uploads/` — Remote Control の添付．
- `plans/` — プランモードの計画ファイル．
- `debug/` — セッション毎のデバッグログ．
- `stats-cache.json`・`usage-data/` — `/usage` の集計と `/insights` の分析．
- `image-cache/`・`todos/`・`statsig/`・`logs/` — 旧版の残り．

`~/` 直下と一時領域：

- `~/.claude.json.tmp.*` — 書き込み失敗の残骸．空のこともあるが，`~/.claude.json` の**全内容をそのまま含むことがある**（`oauthAccount` も `projects.*` も）——本体からキーを削っても，これを残せば履歴は消えていない．
- スクラッチ領域 `%TEMP%\claude\`（POSIX では `$TMPDIR/claude-<uid>`，macOS では `/tmp/claude-<uid>`） — レンダリング・ブラウザプロファイル等の作業ファイル．**生きているセッションのディレクトリと `bundled-skills` は残す**（正典参照）．

`~/.claude.json` 内のキー（利用統計・キャッシュ・参照履歴）：`tipsHistory`・`tipLifetimeShownCounts`・`skillUsage`・`pluginUsage`・`announcementImpressions`・`seenNotifications`・`promptQueueUseCount`・`numStartups`・`lastPlanModeUse`・`closedIssuesLastChecked`・`changelogLastFetched`・`cachedGrowthBookFeatures`(+`At`)・`cachedExperimentData`・`cachedExperimentFeatures`・`clientDataCacheSlots`・各種 `*Cache`・`passesEligibilityCache`・`groveConfigCache`・`feedbackSurveyState`・`githubRepoPaths`．

## 維持の対象

- `~/.claude/.credentials.json` — **OAuth ログイン資格情報**．これを消すと再ログインが要る．
- `~/.claude/settings.json` — モデル・テーマ・`enabledPlugins`・`extraKnownMarketplaces` 等の設定．
- `~/.claude/plugins/` 一式 — 導入済みプラグイン本体と `installed_plugins.json`．
- `~/.claude/projects/*/memory/` — 自動メモリ．会話の履歴ではなく，セッションをまたいで積み上げた記憶で，消すと戻らない．
- `~/.claude.json` の身元・設定キー — `oauthAccount`・`userID`・`machineID`・`hasCompletedOnboarding`・`migrationVersion`・`autoUpdates`，および `projects.*`（`hasTrustDialogAccepted`＝信頼ダイアログ・`mcpServers`）．**`projects.*` を削ると次回起動時に信頼ダイアログが再び出て，local スコープの MCP サーバーを失う**ので，履歴が混じっていても残す．例外として，ユーザーが「信頼の記録も消す」と明示したときだけ，各プロジェクトの `hasTrustDialogAccepted` を削る．
- 各リポジトリ内の `.claude/` — プロジェクト固有の資産（`~/.claude/` 配下ではないので走査対象外だが，混同して消さない）．

## 削除の正典

- **生きているものに触れない**：`claude agents --json` が列挙する生きたセッションの `sessionId` に当たる会話は残す——`projects/*/<sessionId>*`・`file-history/<sessionId>/`・`session-env/<sessionId>/`．`ide/*.lock` は中身の `pid` が現存プロセスなら**残す**（ファイル名は pid でない）．Windows は `Get-Process -Id <pid>`，POSIX は `kill -0 <pid>` で生死を判定する．`sessions/` は Claude Code が自分で片づけるので触れない．スクラッチ配下も同様に，生きているセッションのディレクトリは残す——現在のセッションには本スキル自身の出力ファイルがあり，消せば `ENOENT` で自分のツールの結果が読めなくなり，実行そのものが壊れる．
- **`bundled-skills` は残す**：スクラッチ配下だが起動時に展開される実行資産で，履歴ではない．
- **除去方式で削る**：ファイルも `~/.claude.json` のキーも「削除の対象」に載るものだけを落とし，残り全部を保つ——「維持の対象」に無いものを消す方式は採らない．「削除の対象」に無いファイル・ディレクトリも，そこに挙げたキー名・接尾辞（`*Cache`）のどれにも当たらないキーも，既定で**残る**側に倒れる（迷ったら残す）——列挙に無い新種のキーを「履歴らしいから」で巻き込まない．`~/.claude.json` はキー順と値の型を壊さぬよう，JSON パーサで書き直す：`node` があれば `JSON.parse`→`delete`→`JSON.stringify`，無ければ .NET の `System.Text.Json`（`JsonDocument` を列挙し，除去対象を飛ばして `Utf8JsonWriter` へ書き戻す）を使う．**テキスト置換や正規表現で消さない**——構造を壊す．
- **ディレクトリは器を残す**：削除対象のディレクトリは中身のみ消して空で残す．
- **プラットフォーム差**：パスは Windows＝`%USERPROFILE%`・`%TEMP%`，POSIX＝`$HOME`・`$TMPDIR`（既定 `/tmp`）．どちらでも `~/.claude/` の構造は同じ．

## 自己点検

- **身元の無事**：削除後に `.credentials.json`・`settings.json`・`installed_plugins.json`・`projects/*/memory/` が無傷で，`oauthAccount`/`userID` が `~/.claude.json` に残っているか実際に読んで確かめたか．
- **承認の先行**：列挙して見せ，承認を得てから消したか——黙って走らせていないか．
- **生存の尊重**：現在のセッション・生きた PID とその会話・`bundled-skills` を巻き込んでいないか．
- **除去方式**：ファイルもキーも「削除の対象」で削り，列挙に無いものを残す側に倒したか．
- **走査で示す**：「無い」の判断を，実在確認（ゼロ件）で裏取りしたか．

## 制約

本スキルが扱うのはこのマシンの痕跡だけ——claude.ai 側の会話履歴やクラウドの成果物は消せないし，消そうとしない．

## 失敗時

/heal:skill を呼ぶ．
