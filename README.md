# claude-plugins

Claude Code プラグインのマーケットプレイス．全プラグインを一つの美の基準（美の6条．[plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md)）で貫く．

## なぜ

- **確定版＝不動点**：refine プラグインは，走査（決めた項目を全件確かめること）で見つかる欠陥がゼロになるまで成果物を磨いて確定する．目指す先は，再び適用しても変わらない形（不動点）である．走査のうち機械で判定できる部分は，再実行可能な検査（[scripts/scan.py](scripts/scan.py)）がゼロを確かめる．
- **一つの基準が全媒体を貫く**：コード・文書・コミットが同じ美の6条で仕上がる．
- **知能を償却する**：一度見つけた判断を走査の規律（何を見て何を確かめるか）へ固めるので，日々の仕上げにトップ級の知能は要らない．
- **完璧が自己進化する**：基準そのものが磨かれ，良くなった分は以後の全ての成果物に効く．

## 仕組み

「完璧」は二層で保たれる．

- **実行**：スキルは判断を走査の規律に還元する．だから一定の能力があればどのモデルでも，同じ走査で同じ確定版を目指せる．
- **進化**：その規律で捉えきれない観点が現れたら，/heal:skill が規律そのものを直し，以後は全モデルが，直された規律を継承する．

## プラグイン

プラグイン＝成長の軸，スキル＝軸上の点．スキルの追加は既存の軸に点を足すこと，プラグインの追加は新しい軸を立てることに対応する．どの軸にも乗らないスキルが現れたときだけ軸を新設する．

| プラグイン | 軸 | スキル |
| --- | --- | --- |
| groundwork | 構想の工程 | /groundwork:survey → /groundwork:theory → /groundwork:impl |
| refine | 媒体 | /refine:code ・ /refine:docs |
| capstone | 完成の工程 | /capstone:refine → /capstone:commit → /capstone:release |
| assignment | 課題の媒体 | /assignment:complete → /assignment:report ・ /assignment:program |
| ops | 運用の局面 | /ops:exec ・ /ops:progress ・ /ops:clean |
| heal | 治療の対象 | /heal:skill ・ /heal:canon |

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

capstone と assignment は美の仕上げを refine のスキルへ委譲し，heal 以外の全プラグインは失敗時に /heal:skill を呼ぶ．依存先（refine・heal）は各 `plugin.json` の `dependencies` に宣言してあるので，導入すれば併せて入る．

## 使い方

/groundwork:survey で文脈を確立し，/groundwork:theory で方針を固め，/groundwork:impl で実装との整合を走査する．大学の課題は /assignment:complete が出題文から仕上げまで運ぶ——単一媒体なら report・program のスキルを直接使う．仕上げは /capstone:refine——範囲を媒体に分解し /refine:code ・ /refine:docs へ委譲する；単一媒体なら refine のスキルを直接使う．記録は /capstone:commit，公開は /capstone:release．数十秒を超えて走るプログラム（学習・評価・サーバ等）は，スキル名の指定が無くても /ops:exec が起動から完了報告までを担う——数十秒で終わる実行（テスト・ビルド等）は素のまま走らせる．走っているものの様子は /ops:progress が答える．このマシンに溜まった Claude Code の履歴・痕跡は /ops:clean が，何を消すか列挙して承認を得たうえで掃除する——ログイン・設定・導入済みプラグイン・自動メモリは残す．スキルが失敗したら /heal:skill が定義を更新し再発を防ぐ．溜まった重複と食い違いは /heal:canon が定義全体を見直して解消する．

## 開発

- プラグイン＝`.claude-plugin/plugin.json` を持つ，`plugins/` 直下のディレクトリ．スキルは `plugins/<plugin>/skills/<name>/SKILL.md` に置く．
- 媒体をまたぐ委譲元スキル（範囲を媒体へ分解し各媒体スキルへ委譲するもの）の置き場は，領域固有性で決める．/assignment:complete は「課題の媒体」軸には乗らないが，課題全体を束ねる役は課題領域に固有で他に置き場が無いため assignment に内包する．一方で媒体をまたぐ仕上げ（/capstone:refine）はどの領域にも属さず完成の工程の関心なので，refine は純粋な媒体軸に保ち，委譲元は capstone へ外出しする．
- 各プラグインは独立した SemVer 単位——利用者はプラグインを個別に導入するため，バージョンは変更のあったプラグインだけが上がる（lockstep にしない）．リリースは /capstone:release がプラグインごとに上げ幅を判定し，`<plugin>-vX.Y.Z` 形式のタグと GitHub Release を個別に発行する．
- スキル名は組み込みコマンド名（/context ・ /review ・ /init ・ /status 等）と一致させず，プラグインをまたいでも重複させない——素の名前（名前空間を除いた名前）はマーケットプレイス全体で一意に保つ．プラグインのスキルは `/<plugin>:<skill>` のほか素の名前でも呼べるが，素の名前が効くのは他のコマンドがその名を使っていないときだけである．
- 本リポジトリの不変条件は [scripts/scan.py](scripts/scan.py) が走査する——マニフェストとディレクトリ構成の一致，SemVer，`dependencies` の実在，SKILL.md の frontmatter，素の名前が組み込みコマンドと衝突せず一意であること，相対リンクの実在と境界，動的コンテキストが全 git 状態で exit 0 かつ非空の出力を返すこと（規律そのものは /refine:docs の「媒体の正典」が定める），そして全コミットメッセージの機械的な部分——件名の形式と長さ，件名と本文を分ける空行，本文の折り返し，注入トレーラの不在（規律そのものは /capstone:commit の「文面の基準」が定める；声・因果・1コミット1意図は機械に判定できないので走査は担わない）．`python scripts/scan.py` で走り，違反ゼロなら exit 0；[CI](.github/workflows/scan.yml) が master への push と PR ごとにこれを確定の根拠にする——コミットの走査に全履歴が要るため `fetch-depth: 0` で取得する．BEAUTY.md の「ゼロ確認」を，印象でなく再実行可能な検査として持つための道具であり，走査で捉えられる観点が増えたらここに足す．
- 美の基準は [plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md) が唯一の定義元．実行時に適用するスキルはその場でこれを読む．他のスキルの扱いは成果物で分かれ，分かれ目は同書が定める．外へ出す成果物がファイルとして残るなら，美の規則（その媒体でどう書けば美しいか）を refine の媒体スキルへ委譲し，委譲元は領域の規則（何を満たせば目的に適うか）だけを持つ．提案の中にしか存在しない文面（コミット・リリースノート）を書くスキルは，美の基準を自らの媒体へ具体化して自足する．プロジェクトの内側に留まる成果物（`.claude/context.md`・SKILL.md 等）は，後段の /capstone:refine に委ねる．
- スキル内の相対リンクはプラグイン境界を越えられない——導入時はプラグインごとに `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` へ個別展開されるため，他プラグインのファイルを指す `../../../` は解決しない（このリポジトリ上では通るので気づきにくい）．他プラグインの規則に従わせるには，パス参照ではなくそのプラグインのスキルへ委譲し，`dependencies` に宣言する．
- 配布する定義を直す先は常にこのリポジトリ．導入済みの実体（`cache` 配下）を書き換えても，プラグインの更新で上書きされて消える——/heal:skill もこの区別に従う．利用者固有の好み・事実は配布する定義でなく，利用者のプロジェクト側に置く．
- 開発中のプラグインは，`plugins/<plugin>` を指す `.claude/skills/<plugin>/` のジャンクションで直接読み込む（skills-dir プラグイン `<plugin>@skills-dir`；導入不要で，SKILL.md の編集は遅くとも次セッションか `/reload-plugins` 後に反映される）．同名のマーケットプレイス版が有効だとジャンクションは読まれないので，そのときは `claude --plugin-dir plugins/<plugin>` で作業ツリーの版を読ませる．検証では，マーケットプレイス版を導入したときと同じ `/refine:code` 形式で呼び出す．ジャンクションの同期は SessionStart フック（[.claude/settings.json](.claude/settings.json)）が [.claude/sync-junctions.ps1](.claude/sync-junctions.ps1) を実行して毎セッション自動で行う．セッション中にプラグインを追加・改名・削除したら，同スクリプトを再実行し `/reload-plugins` で定義を読み直す．
- プロジェクトの `.claude/skills/` にあるプラグインは，そのフォルダの信頼ダイアログを受け入れるまで読まれない．初回起動や信頼状態のリセット後にスキルが見えなければ，ダイアログを確定して `/reload-plugins` を実行する．

## ライセンス

[MIT](LICENSE)
