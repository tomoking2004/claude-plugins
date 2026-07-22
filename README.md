# claude-plugins

Claude Code プラグインのマーケットプレイス．全てを一つの美の基準（[plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md)）で貫く．

## なぜ

- **確定版＝不動点**：refine は走査がゼロを返すまで磨いて確定する——不動点は目指す先で，機械に載る分は再実行可能な検査（[scripts/scan.py](scripts/scan.py)）が保証する．
- **一つの基準が全媒体を貫く**：コード・文書・コミットが同じ美の6条で仕上がる．
- **知能を償却する**：日々の仕上げにトップ級の知能は要らない．
- **完璧が自己進化する**：基準そのものが磨かれ，良くなった分は以後の全てに効く．

## 仕組み

「完璧」は二層で保たれる．

- **実行**：スキルは判断を走査の規律（何を見て何を確かめるか）に還元する．だから一定の能力があればどのモデルでも，走査がゼロを返す同じ確定版に収束する．
- **進化**：その規律で捉えきれない観点が現れたら，/heal:skill が観点を規律そのものに書き足し，以後は全モデルが継承する．

## プラグイン

プラグイン＝成長の軸，スキル＝軸上の点．スキルの追加は既存の軸に点を足すこと，プラグインの追加は新しい軸を立てることに対応し，どの軸にも乗らないスキルが現れたときだけ軸を新設する．

| プラグイン | 軸 | スキル |
| --- | --- | --- |
| groundwork | 構想の工程 | /groundwork:survey → /groundwork:theory → /groundwork:impl |
| refine | 媒体 | /refine:code ・ /refine:docs |
| capstone | 完成の工程 | /capstone:refine → /capstone:commit → /capstone:release |
| assignment | 課題の媒体 | /assignment:complete → /assignment:report ・ /assignment:program |
| ops | 運用の局面 | /ops:exec ・ /ops:progress ・ /ops:clean |
| heal | 治療の対象 | /heal:skill |

## 導入

```text
/plugin marketplace add tomoking2004/claude-plugins
/plugin install groundwork@tomoking2004
/plugin install refine@tomoking2004
/plugin install capstone@tomoking2004
/plugin install assignment@tomoking2004
/plugin install ops@tomoking2004
/plugin install heal@tomoking2004
```

capstone と assignment は美の仕上げを refine のスキルへ委譲するため refine を，heal 以外の全プラグインは失敗時に /heal:skill を呼ぶため heal を，併せて導入する（各 `plugin.json` の `dependencies` に宣言済み）．

## 使い方

/groundwork:survey で文脈を確立し，/groundwork:theory で方針を固め，/groundwork:impl で実装との整合を走査する．大学の課題は /assignment:complete が出題文から仕上げまで運ぶ——単一媒体なら report・program のスキルを直接使う．仕上げは /capstone:refine——範囲を媒体に分解し /refine:code ・ /refine:docs へ委譲する；単一媒体なら refine のスキルを直接使う．記録は /capstone:commit，公開は /capstone:release．数十秒を超えて走るプログラム（学習・評価・サーバ等）は，明示の指定がなくても /ops:exec が起動から完了報告までを担い，走っているものの様子は /ops:progress が答える——数十秒で終わる実行（テスト・ビルド等）は素のまま走らせる．このマシンに溜まった Claude Code の履歴・痕跡は /ops:clean が，何を消すか列挙して承認を得たうえで掃除する——ログイン・設定・導入済みプラグインは残す．スキルが失敗したら /heal:skill が定義を更新し再発を防ぐ．

## 開発

- プラグイン＝`plugins/` 直下の `.claude-plugin/plugin.json` を持つディレクトリ．スキルは `plugins/<plugin>/skills/<name>/SKILL.md` に置く．
- 媒体をまたぐ委譲元スキル（範囲を媒体へ分解し各媒体スキルへ委譲するもの）の置き場は，領域固有性で決める——/assignment:complete は「課題の媒体」軸には乗らないが，課題全体を束ねる役は課題領域に固有で他に置き場が無いため assignment に内包する；一方で媒体をまたぐ仕上げ（/capstone:refine）はどの領域にも属さず完成の工程の関心なので，refine は純粋な媒体軸に保ち，委譲元は capstone へ外出しする．
- 各プラグインは独立した SemVer 単位——ユーザーはプラグインを個別に導入するため，バージョンは変更のあったプラグインだけが上がる（lockstep にしない）．リリースは /capstone:release がプラグインごとに判定し，`<plugin>-vX.Y.Z` 形式のタグと GitHub Release を個別に発行する．
- スキル名は組み込みコマンド名（/context ・ /review ・ /init ・ /status 等）と一致させず，プラグインをまたいでも重複させない——素の名前はマーケットプレイス全体で一意に保つ．VS Code 拡張は名前空間付き呼び出しをコマンドとして認識せず素の名前で解決するため，組み込みと衝突するスキルは呼び出せなくなり，スキル同士が重複すればどちらが出るか定まらない．
- 本リポジトリの不変条件は [scripts/scan.py](scripts/scan.py) が走査する——マニフェストとディレクトリ構成の一致，SemVer，`dependencies` の実在，SKILL.md の frontmatter，素の名前が組み込みコマンドと衝突せず一意であること，相対リンクの実在と境界，動的コンテキストが全 git 状態で exit 0 かつ非空の出力を返すこと（規律そのものは /refine:docs の「媒体の正典」が定める），そして全コミットメッセージの機械的な部分——件名の形式と長さ，件名と本文を分ける空行，本文の折り返し，注入トレーラの不在（規律そのものは /capstone:commit の「文面の基準」が定める；声・因果・1コミット1意図は機械に判定できないので走査は担わない）．`python scripts/scan.py` で走り，違反ゼロなら exit 0；[CI](.github/workflows/scan.yml) が master への push と PR ごとにこれを確定の根拠にする——コミットの走査に全履歴が要るため `fetch-depth: 0` で取得する．BEAUTY.md の「ゼロ確認」を，印象でなく再実行可能な検査として持つための道具であり，走査で捉えられる観点が増えたらここに足す．
- 美の基準は [plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md) が唯一の定義元．実行時に適用するスキルはその場でこれを読む．他のスキルは，外へ出す成果物がファイルとして残るなら美の規則を refine の媒体スキルへ委譲し（自分は領域の規則だけを持つ），提案の中にしか存在しない文面（コミット・リリースノート）は自らの媒体へ具体化して自足させ，プロジェクトの内側に留まる成果物（`.claude/context.md`・SKILL.md 等）は後段の /capstone:refine に委ねる——分かれ目は同書が定める．
- スキル内の相対リンクはプラグイン境界を越えられない——導入時はプラグインごとに `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` へ個別展開されるため，他プラグインのファイルを指す `../../../` は解決しない（このリポジトリ上では通るので気づきにくい）．他プラグインの正典に従わせるには，パス参照ではなくそのプラグインのスキルへ委譲し，`dependencies` に宣言する．
- 定義を直す先は常にこのリポジトリ．導入済みの実体（`cache` 配下）を書き換えても，プラグインの更新で上書きされて消える——/heal:skill もこの区別に従う．
- 開発中のプラグインは `.claude/skills/<plugin>/` へのジャンクションで直接読み込む（skills-dir プラグイン `<plugin>@skills-dir`；導入不要で，SKILL.md の編集は次セッションか /reload-plugins 後に反映される）．検証は CLI ならマーケットプレイス版の導入と同じ `/refine:code` 形式，VS Code 拡張なら素の名前 `/code` で呼び出す．同期は SessionStart フック（[.claude/settings.json](.claude/settings.json)）が [.claude/sync-junctions.ps1](.claude/sync-junctions.ps1) を実行して毎セッション自動で行う；セッション中のプラグイン追加・改名・削除は，同スクリプトを再実行し /reload-plugins で読み直す．
- 初回起動や信頼状態のリセット後は，プラグインスキャンがワークスペース信頼の確定より先に走ることがあり，`(suppressed)` になってスキルが一つも見えなくなる（`.claude-plugin/plugin.json` を持つディレクトリだけが対象；plugin.json なしの素のスキルはこの対象外）．`/plugin` で `(suppressed)` が出たら，信頼ダイアログを確定した上で `/reload-plugins` を実行するか，アプリを完全に再起動する．

## ライセンス

[MIT](LICENSE)
