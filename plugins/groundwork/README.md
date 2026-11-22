# groundwork

文脈（.claude/context.md）を単一の真実として，プロジェクトの構想を進める工程スキル群．

## 導入

手順はマーケットプレイスの README（リポジトリ最上位の README.md）が定める．

- **対応先**：Claude Code と Claude．チャットでは全スキルを使える——文脈のファイル（`.claude/context.md`）を残せないので，全文を会話に添えて受け渡す．
- **依存先**：heal

## 使い方

構想は次の順に進める．

1. /groundwork:survey-context で文脈を確立する．
2. /groundwork:discuss-theory で方針を固める．
3. /groundwork:verify-impl で実装との整合を走査する．
