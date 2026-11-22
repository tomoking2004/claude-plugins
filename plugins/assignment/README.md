# assignment

大学の課題を出題文・採点基準に照らして過不足なく仕上げるスキル群．

## 導入

手順はマーケットプレイスの README（リポジトリ最上位の README.md）が定める．

- **対応先**：Claude Code と Claude．チャットでは全スキルを使える．
- **依存先**：refine・heal

## 使い方

課題をまるごと任せるなら，/assignment:complete-assignment が出題文から仕上げまで運ぶ．媒体が一つだけなら，その媒体のスキルを直接使う．

| 課題の媒体 | スキル |
| --- | --- |
| レポート・小論文 | /assignment:write-report |
| コード | /assignment:write-code |

課題に固有の基準（進行と遵守事項）は [RUBRIC.md](RUBRIC.md) が定める．美の仕上げは，refine の媒体スキルへ委譲する．

## 開発

課題全体を束ねる /assignment:complete-assignment は，媒体ごとのスキルへ委譲する側で，それ自身は媒体のスキルでない．それでも束ねる役は課題の領域に固有で，他に置き場が無いので，本プラグインに内包する．
