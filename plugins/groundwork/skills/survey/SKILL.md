---
name: survey
description: プロジェクト文脈を把握し .claude/context.md を作成する．新しいプロジェクトを始めるときに使う．context.md が既にある場合は /groundwork:theory を使う．
---

対象：`.claude/context.md`（新規作成のみ）．

## 手順

1. **前提確認**：`.claude/context.md` が既に存在すれば「/groundwork:theory で更新してください」と伝え，中断する．
2. **把握**：プロジェクトについて自由に説明してもらう（会話中に既に説明があればそれを使う）．読み取れない箇所は補足を求める．
3. **作成**：把握した内容を次のフォーマットで `.claude/context.md` に書き出し，続けて /groundwork:theory の議論に移る．

   ```markdown
   # プロジェクト文脈：[name]

   ## 目的・仮説

   ## 設計

   ## 整合条件

   - **条件名**：説明

   ## 評価基準

   - `指標名`：定義
   ```

## 制約

内容の評価・改善は /groundwork:theory として継続する．実装の検証は /groundwork:impl に委ねる．コードは読まない．

## 失敗時

/doctor:skill を呼ぶ．
