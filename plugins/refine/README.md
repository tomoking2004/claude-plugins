# refine

美の基準（BEAUTY.md）を定義し，成果物を媒体ごとに最も美しい確定版へ仕上げるスキル群．

## 導入

手順はマーケットプレイスの README（リポジトリ最上位の README.md）が定める．

- **対応先**：Claude Code と Claude．チャットでは全スキルを使える．
- **依存先**：heal

## 使い方

仕上げたい成果物の媒体でスキルを選ぶ．どのスキルも，美の基準（[BEAUTY.md](BEAUTY.md)）で成果物を走査し，見つかる欠陥がゼロになるまで直す．

| 媒体 | スキル |
| --- | --- |
| コード（スクリプト・設定を含む） | /refine:refine-code |
| 文書（README・レポート・Markdown 全般） | /refine:refine-docs |
