# claude-plugins

Claude Code プラグインのマーケットプレイス．全てを一つの美の基準（[plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md)）で貫く．

## なぜ

- **確定版＝不動点**：/refine は走査がゼロを返すまで磨いて確定する——再適用しても変わらない，検証できる完成．
- **一つの基準が全媒体を貫く**：コード・文書・コミットが同じ美の6条で仕上がる．
- **知能を償却する**：日々の仕上げにトップ級の知能は要らない．
- **完璧が自己進化する**：基準そのものが磨かれ，良くなった分は以後の全てに効く．

## 仕組み

「完璧」は二層で保たれる．

- **実行**：スキルは判断を走査の規律（何を見て何を確かめるか）に還元する．だから一定の能力があればどのモデルでも，走査がゼロを返す同じ確定版に収束する．
- **進化**：その規律で捉えきれない観点が現れたら，/doctor:skill が観点を規律そのものに書き足し，以後は全モデルが継承する．

## プラグイン

プラグイン＝成長の軸，スキル＝軸上の点．スキルの追加は既存の軸に点を足すこと，プラグインの追加は新しい軸を立てることに対応し，どの軸にも乗らないスキルが現れたときだけ軸を新設する．

| プラグイン | 軸 | スキル |
| --- | --- | --- |
| groundwork | 構想の工程 | /groundwork:survey → /groundwork:theory → /groundwork:impl |
| refine | 媒体 | /refine:code ・ /refine:docs |
| project | 完成の工程 | /project:refine → /project:commit → /project:release |
| doctor | 治療の対象 | /doctor:skill |

## 導入

```text
/plugin marketplace add tomoking2004/claude-plugins
/plugin install groundwork@tomoking2004
/plugin install refine@tomoking2004
/plugin install project@tomoking2004
/plugin install doctor@tomoking2004
```

project は /project:refine が refine のスキルへ委譲するため refine を，doctor 以外の全プラグインは失敗時に /doctor:skill を呼ぶため doctor を，併せて導入する．

## 使い方

/groundwork:survey で文脈を確立し，/groundwork:theory で方針を固め，/groundwork:impl で実装との整合を走査する．仕上げは /project:refine——範囲を媒体に分解し /refine:code ・ /refine:docs へ委譲する；単一媒体なら refine のスキルを直接使う．記録は /project:commit，公開は /project:release．スキルが失敗したら /doctor:skill が定義を更新し再発を防ぐ．

## 開発

- プラグイン＝`plugins/` 直下の `.claude-plugin/plugin.json` を持つディレクトリ．スキルは `plugins/<plugin>/skills/<name>/SKILL.md` に置く．
- スキル名は組み込みコマンド名（/context ・ /review ・ /init など）と一致させない．VS Code 拡張は名前空間付き呼び出しをコマンドとして認識せず，素の名前は同名の組み込みに解決されるため，衝突するスキルはコマンドから呼び出せなくなる．
- 美の基準は [plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md) が唯一の定義元．refine の各スキルは実行時にこれを読み，他の全スキル・全成果物は設計時に自らの媒体へ具体化して従う．
- 開発中のプラグインは `.claude/skills/<plugin>/` へのジャンクションで直接読み込む（skills-dir プラグイン `<plugin>@skills-dir`；導入不要で，SKILL.md の編集は次セッションか /reload-plugins 後に反映される）．検証は CLI ならマーケットプレイス版の導入と同じ `/refine:code` 形式，VS Code 拡張なら素の名前 `/code` で呼び出す．同期は SessionStart フック（[.claude/settings.json](.claude/settings.json)）が [.claude/sync-junctions.ps1](.claude/sync-junctions.ps1) を実行して毎セッション自動で行う；セッション中のプラグイン追加・改名・削除は，同スクリプトを再実行し /reload-plugins で読み直す．
- 初回起動や信頼状態のリセット後は，プラグインスキャンがワークスペース信頼の確定より先に走ることがあり，`(suppressed)` になってスキルが一つも見えなくなる（`.claude-plugin/plugin.json` を持つディレクトリだけが対象；plugin.json なしの素のスキルはこの対象外）．`/plugin` で `(suppressed)` が出たら，信頼ダイアログを確定した上で `/reload-plugins` を実行するか，アプリを完全に再起動する．

## ライセンス

[MIT](LICENSE)
