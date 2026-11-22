# forge

既存のスキルを調べて比べ，取捨を決めてから新しいスキルを作る，定義づくりのスキル群．

## 導入

手順はマーケットプレイスの README（リポジトリ最上位の README.md）が定める．

- **対応先**：Claude Code と Claude．チャットでは，/forge:distill-skill の調査から内容の判定までを行える——実行評価は Claude Code で行う．
- **依存先**：heal
- **併せて要るもの**：Anthropic 公式の skill-creator．実行評価の委譲先で，依存には宣言していない．無ければ次で導入する．

```text
/plugin install skill-creator@claude-plugins-official
```

## 使い方

新しいスキルを作るときに /forge:distill-skill を使う．類似の既存スキルを調べて比べ，取捨を決めてから，実行評価を skill-creator へ委譲する．
