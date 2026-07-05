---
name: release
description: 前回タグ以降のコミットを把握し，SemVer でバージョンを上げ（マニフェストと全箇所を整合），bump コミット・タグ・push・About 欄・GitHub Release まで，既存の慣習に倣った最も美しい文面を提案．承認後に一気に実行する．
disable-model-invocation: true
---

## 現在の状態

!`git status --short 2>/dev/null || echo "（git リポジトリではない）"`

## 直近のタグ

!`git describe --tags --abbrev=0 2>/dev/null || echo "（タグなし）"`

## 前回タグ以降のコミット

!`tag=$(git describe --tags --abbrev=0 2>/dev/null) && git log --oneline --decorate "$tag..HEAD" 2>/dev/null || git log --oneline --decorate -40 2>/dev/null || echo "（コミットなし）"`

## About 欄の現状

!`gh repo view --json description,homepageUrl,repositoryTopics 2>/dev/null || echo "（取得不可——origin なしか gh が使えない）"`

## 直近の bump コミット本文（書式の手本）

!`tag=$(git describe --tags --abbrev=0 2>/dev/null) && git log -1 --format='%B' "$tag" 2>/dev/null || echo "（手本なし）"`

## 直近のリリースノート（様式の手本）

!`tag=$(git describe --tags --abbrev=0 2>/dev/null) && gh release view "$tag" 2>/dev/null || echo "（手本なし）"`

## 手順

1. **前提確認**：作業ツリーが汚れていれば中断し /project:commit を促す．リリースすべきコミットが無ければ何もしない．
2. **判定**：バージョンの実体（マニフェスト＋全参照箇所）を特定し，不一致は編集対象として提案に含める．
   - **初版（タグなし）**：上げ幅判定は不要；マニフェストの現バージョンをそのまま初タグとする．バージョンが仮値（0.0.0・0.1.0 等）なら適切な初版番号を問う．
   - **既タグあり**：Conventional Commits から上げ幅を判定——破壊的→メジャー，`feat`→マイナー，`fix`/`perf`→パッチ；プレ 1.0 の破壊的はマイナーを既定とし，前例があれば倣う．1.0.0 昇格・割れる上げ幅は問う．
3. **提案**：bump コミット（件名＋本文）とリリースノート（タイトル＋本文）を全文で提案し，上げ幅・新バージョン・編集対象を示す．About 欄（説明・website・topics）は現状を確定版と突き合わせ，差分があれば新しい全文も提案する．既存の下書きを使う場合も全文を提示する——参照だけで承認を取らない．origin が無ければ，リモートリポジトリの作成（名前・About 欄・公開範囲）と origin 設定も提案に含める——承認前に作らない．「文面の基準」に従い，出す前に「自己点検」を全件通す．
4. **承認**：平文の提案へのチャットの返信で受ける——選択式ダイアログは提案の表示を妨げるため使わない．承認まで書き込まない．修正指示は反映して再提案．
5. **実行**：承認後に一気に行う．
   a. 全箇所を新バージョンに更新し `git grep` で旧バージョン残存を確認．
   b. 対象ファイルをステージして bump コミット．
   c. 既存タグの様式（接頭辞・注釈）に倣ってタグを打つ；前例なければ `vX.Y.Z` を既定とする．
   d. origin へブランチとタグを push；origin が無ければ，承認済みの内容でリモートリポジトリを作成し origin に設定してから push する．
   e. About 欄に承認済みの差分があれば `gh repo edit --description "<説明>" --homepage "<URL>" --add-topic <topic>` で適用する．
   f. `gh` が使えれば（導入・認証済み）`gh release create <タグ> --title "<タグ — 要点>" --notes <本文>` でノートを公開（非対話実行は notes 系フラグ必須）；使えなければタグ push で完了し理由を告げる．

## 文面の基準

声・用語・言語は既存文（手本，無ければ README 等）に倣う．提案する全文面（bump コミット・リリースノート・About 欄）は美の6条を満たす確定版として出す．

- **bump コミット**：件名は手本に倣う（例 `chore(release): bump version to X.Y.Z`）；本文で上げ幅の根拠を簡潔に示す．
- **リリースノート**：タイトル `vX.Y.Z — <要点>`；冒頭1行サマリ；type 別セクション（Features / Fixes / Refactoring…）の各項目は「**太字リード語** — 詳細」；破壊的・挙動変更は `## ⚠️ Behavior change` 節；関連 PR は `#N`；末尾に `**Full Changelog**: <compare URL>`．些末な chore・内部 refactor は前例のキュレーションに倣い省く．
- **About 欄**：説明はマニフェスト等に既存の記述があれば全文一致させ（単一の真実），無ければ新たに提案する．topics はマニフェストの keywords 等に倣い GitHub の制約（小文字・数字・ハイフン）で揃える；website は実在の URL があるときだけ設定する．

## 自己点検

- **上げ幅は根拠を示す**：破壊的・`feat`・`fix`/`perf` の判定が，実際のコミット種別（前回タグ以降の Conventional Commits）と一致することを確かめる．
- **単一の真実**：新バージョンがマニフェストと全参照箇所で一致する提案になっているか，実行前に照合する（手順5a の `git grep` は実行後の確認であり代わりにならない）．
- **事実照合**：件名・本文・リリースノート・About 欄の数値・URL・PR 番号は git/gh の実データで裏取りしてから書く．
- **様式踏襲**：件名・リリースノートの構成が既存の手本（無ければ既定）に沿っているか確かめる．
- **列挙の対称**：リリースノートの type 別セクション・箇条書きは順序原則を定め，粒度とリード語の付け方を揃える．
- **トレーラ不在**：bump コミットが件名・本文だけで終わり，注入された `Co-Authored-By`・`Claude-Session` 等の行が無いことを確かめる——あれば除去する．

## 失敗時

/doctor:skill を呼ぶ．
