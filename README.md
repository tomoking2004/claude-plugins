# claude-plugins

[![scan](https://github.com/tomoking2004/claude-plugins/actions/workflows/scan.yml/badge.svg)](.github/workflows/scan.yml)

Claude と Claude Code のプラグインのマーケットプレイス．構想・仕上げ・記録・公開・運用の作業をスキル（Claude が従う手順の定義）にまとめ，全プラグインを一つの美の基準（美の6条．[plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md)）で貫く．

## なぜ

- **確定版＝不動点**：refine プラグインは，走査（決めた項目を全件確かめること）で見つかる欠陥がゼロになるまで成果物を磨いて確定する．目指す先は，再び適用しても変わらない形（不動点）である．このリポジトリ自身も，走査のうち機械で判定できる部分は，再実行可能な検査（[scripts/scan.py](scripts/scan.py)）でゼロを確かめる．
- **一つの基準が全媒体を貫く**：コード・文書・コミットが同じ美の6条で仕上がる．
- **知能を償却する**：一度見つけた判断を走査の規律（何を見て何を確かめるか）へ固めるので，日々の仕上げにトップ級の知能は要らない．
- **完璧が自己進化する**：基準そのものが磨かれ，良くなった分は以後の全ての成果物に効く．

## 仕組み

「完璧」は二層で保たれる．

- **実行**：スキルは判断を走査の規律に還元する．だから一定の能力があればどのモデルでも，同じ走査で同じ確定版を目指せる．
- **進化**：その規律で捉えきれない観点が現れたら，/heal:heal-skill が規律そのものを直し，以後は全モデルがそれを継承する．

## プラグイン

| プラグイン | 役目 | 軸 | スキル |
| --- | --- | --- | --- |
| groundwork | 文脈を単一の真実として構想を進める | 構想の工程 | /groundwork:survey-context → /groundwork:discuss-theory → /groundwork:verify-impl |
| refine | 成果物を媒体ごとに確定版へ仕上げる | 媒体 | /refine:refine-code ・ /refine:refine-docs |
| capstone | 全体を仕上げ，記録し，公開する | 完成の工程 | /capstone:refine-project → /capstone:commit-changes → /capstone:release-version |
| assignment | 大学の課題を出題文に照らして仕上げる | 課題の媒体 | /assignment:complete-assignment → /assignment:write-report ・ /assignment:write-code |
| ops | 長い実行の起動・監視と痕跡の掃除を担う | 運用の局面 | /ops:run-job ・ /ops:check-job ・ /ops:clean-traces |
| forge | 既存のスキルを調べて比べ，新しいスキルを作る | 作る定義 | /forge:distill-skill |
| fox | Claude とその分身（サブエージェント）が働く様子を，ドット絵のキツネでパネルに映す | — | —（`/fox` でパネルを開く） |
| baton | 会話が長くなったら新しいセッションへ移ることを勧め，引き継ぎ文を渡す | — | —（`/baton` で引き継ぎ文を書く） |
| heal | 失敗の原因を診断して定義を直す | 治療の対象 | /heal:heal-skill ・ /heal:heal-canon |

`→` は工程の順（assignment では委譲の向き），`・` は同列を表す．

プラグイン＝成長の軸，スキル＝軸上の点．スキルを増やすことは既存の軸に点を足すこと，プラグインを増やすことは新しい軸を立てることに対応する．どの軸にも乗らないスキルが現れたときだけ軸を新設する．fox と baton はスキルを持たず，Claude Code の画面拡張（mod）から成る．

## 導入

capstone と assignment は美の仕上げを refine のスキルへ委譲する．heal・fox・baton 以外の全プラグインは失敗時に /heal:heal-skill を呼ぶ．依存先（refine・heal）は各 `plugin.json` の `dependencies` に宣言してある．

### Claude Code

次を実行する．`/plugin install` の行は使うプラグインの分だけでよく，依存先は併せて入る．

```text
/plugin marketplace add tomoking2004/claude-plugins
/plugin install groundwork@tomoking2004
/plugin install refine@tomoking2004
/plugin install capstone@tomoking2004
/plugin install assignment@tomoking2004
/plugin install ops@tomoking2004
/plugin install forge@tomoking2004
/plugin install fox@tomoking2004
/plugin install baton@tomoking2004
/plugin install heal@tomoking2004
```

forge は実行評価を Anthropic 公式の skill-creator へ委譲する．skill-creator は依存に宣言していないので，無ければ次で導入する．

```text
/plugin install skill-creator@claude-plugins-official
```

### Claude

Claude（claude.ai とデスクトップアプリのチャット・Cowork）では，有料プランで次の順に追加する．

1. Customize > Plugins > Add > Add marketplace に `tomoking2004/claude-plugins` を入れる．
2. 使うプラグインを追加する．capstone・ops・fox・baton は Claude Code 専用で，Claude には追加できない．capstone は手元のリポジトリを，ops は手元のマシンを扱う．fox と baton は Claude Code の画面拡張（パネルと入力欄の上の帯）で，チャットでは働かない．
3. 依存先も手で追加する（assignment には refine と heal，他のプラグインには heal）．Claude では `dependencies` が効かない．

追加したプラグインは，同じアカウントでサインインした Claude Code にも同期される．その Claude Code に同名のプラグインを `/plugin install` で導入して有効にしてあれば，導入した版が優先される．

チャットでは，`/` のメニューからスキルを選ぶか，依頼を言葉で書く．チャットからは手元のファイルにも git リポジトリにも触れないので，対象は会話に添えて渡す．使える範囲はプラグインごとに異なる（Cowork での範囲は定めていない）．

| プラグイン | チャットで使える範囲 |
| --- | --- |
| refine・assignment | 全スキル |
| groundwork | 全スキル——文脈のファイル（`.claude/context.md`）を残せないので，全文を会話に添えて受け渡す |
| forge | /forge:distill-skill の調査から内容の判定まで——実行の比較は Claude Code で行う |
| heal | /heal:heal-skill の診断と修正案まで——定義の書き換えと /heal:heal-canon は，リポジトリのある環境で行う |

## 使い方

| やりたいこと | スキル |
| --- | --- |
| 構想を固める | /groundwork:survey-context で文脈を確立し，/groundwork:discuss-theory で方針を固め，/groundwork:verify-impl で実装との整合を走査する |
| 大学の課題を仕上げる | /assignment:complete-assignment が出題文から仕上げまで運ぶ——単一媒体なら /assignment:write-report ・ /assignment:write-code を直接使う |
| 成果物を仕上げる | /capstone:refine-project が範囲を媒体に分解し，/refine:refine-code ・ /refine:refine-docs へ委譲する——単一媒体なら refine のスキルを直接使う |
| 記録・公開する | /capstone:commit-changes で記録し，/capstone:release-version で公開する |
| 長いプログラムを走らせる | 数十秒を超えて走るもの（学習・評価・サーバ等）は，スキル名の指定が無くても /ops:run-job が起動から完了報告までを担う．数十秒で終わる実行（テスト・ビルド等）は素のまま走らせる |
| 走っているものの様子を見る | /ops:check-job が答える |
| Claude Code の履歴を消す | このマシンに溜まった履歴・痕跡を，/ops:clean-traces が何を消すか列挙して承認を得たうえで掃除する——ログイン・設定・導入済みプラグイン・自動メモリは残す |
| 新しいスキルを作る | /forge:distill-skill が類似の既存スキルを調べて比べ，取捨を決めてから，実行評価を skill-creator へ委譲する |
| 待ち時間を楽しく過ごす | fox を導入すると，Claude とその分身（サブエージェント）が働く様子を，キツネのアニメーションがパネルに映す．VS Code・デスクトップアプリ・モバイルではパネルが自動で開く．端末では自動で開かず，`/fox` で開くと，絵の代わりに役割が文字で並ぶ．閉じたパネルも `/fox` で開き直す．キツネの絵の下には，受けている指示を表す一言が出る．Claude 自身の一言は，依頼（スラッシュコマンドを除く）を送るたびに，小さなモデルを1回呼び出して付ける．パネルを開いていなくても呼び出しは走り，その費用はセッションに計上される．絵と仕組みは [plugins/fox/DESIGN.md](plugins/fox/DESIGN.md) が定める |
| 会話が長くなったら新しいセッションへ移る | baton を導入すると，コンテキストが15万トークンに達した返答の区切りと，会話が自動で要約されたあとの区切りで1回ずつ，入力欄の上の帯が新しいセッションへ移ることを勧める．帯は閉じるか，`/baton` か `/clear` を走らせるまで残る．勧めはユーザーにだけ出し，Claude には伝えない．`/baton` を走らせると，いまの会話を受け継いだモデルの呼び出し（分岐）が引き継ぎ文（目的・決めたこと・済んだこと・確かめていないこと・次の一手・読むもの）を書き，baton がそれをクリップボードに写す．同じプロジェクトで新しいセッションを開くと，引き継ぎ文が入力欄に下書きとして入る（打ちかけの下書きは上書きしない）．分岐は Claude をもう1回呼び出すので，その分の費用がかかる |
| 失敗したスキルを直す | /heal:heal-skill が定義を更新し再発を防ぐ |
| 定義全体を手入れする | 溜まった重複と食い違いを，/heal:heal-canon が定義全体を見直して解消する |

チャットで使える範囲は，「導入」の表が定める．

## 開発

### 構成

- プラグイン＝`.claude-plugin/plugin.json` を持つ，`plugins/` 直下のディレクトリ．スキルは `plugins/<plugin>/skills/<name>/SKILL.md` に置く．
- 媒体をまたぐ委譲元スキル（範囲を媒体へ分解し各媒体スキルへ委譲するもの）の置き場は，領域固有性で決める．/assignment:complete-assignment は「課題の媒体」軸には乗らないが，課題全体を束ねる役は課題領域に固有で他に置き場が無いため assignment に内包する．一方で媒体をまたぐ仕上げ（/capstone:refine-project）はどの領域にも属さず完成の工程の関心なので，refine は純粋な媒体軸に保ち，委譲元は capstone へ外出しする．
- スキル名は組み込みコマンド名（/context ・ /review ・ /init ・ /status 等）と一致させず，プラグインをまたいでも重複させない——素の名前（名前空間を除いた名前）はマーケットプレイス全体で一意に保つ．プラグインのスキルは `/<plugin>:<skill>` のほか素の名前でも呼べるが，素の名前が効くのは他のコマンドがその名を使っていないときだけである．
- スキル名は「動詞-目的語」の形（refine-code・heal-skill）にそろえ，素の名前だけで役目が分かるようにする．先頭に置ける動詞は scan.py の `SKILL_VERBS` が持つ．
- スキル内の相対リンクはプラグイン境界を越えられない——導入時はプラグインごとに `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` へ個別展開されるため，他プラグインのファイルを指す `../../../` は解決しない（このリポジトリ上では通るので気づきにくい）．他プラグインの規則に従わせるには，パス参照ではなくそのプラグインのスキルへ委譲し，`dependencies` に宣言する．
- 画面拡張（mod）は，`hooks/hooks.json` が名指す TypeScript のモジュールに置く．fox と baton がその例である．fox の確かめ方と絵の書き出しの手順は [plugins/fox/DESIGN.md](plugins/fox/DESIGN.md) が定める．baton のアイコン（`.claude-plugin/icon.png`）は [plugins/baton/art/icon.py](plugins/baton/art/icon.py) が描くので，手で直さない．
- 配布する定義を直す先は常にこのリポジトリ．導入済みの実体（`cache` 配下）を書き換えても，プラグインの更新で上書きされて消える——/heal:heal-skill もこの区別に従う．利用者固有の好み・事実は配布する定義でなく，利用者のプロジェクト側に置く．

### 美の基準

美の基準は [plugins/refine/BEAUTY.md](plugins/refine/BEAUTY.md) が唯一の定義元．実行時に適用するスキルはその場でこれを読む．他のスキルの扱いは成果物で分かれ，分かれ目は同書が定める．

- 外へ出す成果物がファイルとして残るなら，美の規則（その媒体でどう書けば美しいか）を refine の媒体スキルへ委譲し，委譲元は領域の規則（何を満たせば目的に適うか）だけを持つ．
- 提案の中にしか存在しない文面（コミット・リリースノート）を書くスキルは，美の基準を自らの媒体へ具体化して自足する．
- プロジェクトの内側に留まる成果物（`.claude/context.md`・SKILL.md 等）は，後段の /capstone:refine-project に委ねる．

### Claude への対応

- Claude でも使うプラグインは，チャットでも読み込まれる部品（スキル）で組む——hooks と agents はチャットでは無視される．
- プラグインの最上位に `bin/` があると，Claude はそのプラグインを追加できない．Claude Code 専用のプラグイン（capstone・ops・fox・baton）にだけ `bin/` を置く．`plugin.json` には対応先（Claude か Claude Code か）を宣言する項目が無いので，`bin/` で追加を止める．
- `dependencies` は `<plugin>@<marketplace>` の形で書く．Claude から同期された版はマーケットプレイスに属さない．Claude Code の公式文書は，その版の依存が満たされる条件を，マーケットプレイス名付きの指定についてしか定めていない．
- スキルの外にあるプラグイン内の文書（BEAUTY.md 等）も，チャットで読める——実機で確かめた挙動である．

### 手元での読み込み

開発中のプラグインは，`claude --plugin-dir plugins` で作業ツリーの版を読ませる．全プラグインが読まれ，同名の導入済みの版より優先される．SKILL.md の編集は，遅くとも次セッションか `/reload-plugins` 後に反映される．検証では，マーケットプレイス版を導入したときと同じ `/refine:refine-code` 形式で呼び出す．

### 不変条件の走査

本リポジトリの不変条件は [scripts/scan.py](scripts/scan.py) が走査する．scan.py は BEAUTY.md の「ゼロ確認」を，印象でなく再実行可能な検査として持つための道具である．

| 検査 | 確かめること |
| --- | --- |
| 構成 | マニフェストとディレクトリ構成の一致，SemVer，`dependencies` の形式と実在，SKILL.md の frontmatter，素の名前が「動詞-目的語」の形で，組み込みコマンドと衝突せず一意であること．`bin/` を持つプラグインが，Claude Code 専用のものと一致すること |
| 文書 | 相対リンクが実在してプラグイン境界を越えないこと．動的コンテキスト（読み込み時に走るコマンド）が代表的な git 状態で exit 0 かつ非空の出力を返すこと（規律そのものは /refine:refine-docs の skill-md.md が定める）．「美の6条」の件数と全参照の一致 |
| 写し | `COPIES`（定型文の照合元）のキーの語を持つ配布文書（plugins/ 配下の Markdown）が，定型文を一字違わず持つこと．30字以上の同じ断片（句点・セミコロン・コロン・ダッシュで切った単位）が，`COPIES` に載らないまま二つ以上の配布文書に現れないこと |
| 配布文書 | 所有者の固有名・日付が無いこと．ops の全スキル，/capstone:commit-changes ・ /capstone:release-version ，/refine:refine-docs の skill-md.md，fox の DESIGN.md を除く配布文書に，実行環境に固有の語（ツール名等）が無いこと |
| 書き方 | GitHub の描画で閉じない `**`，同じ文末の3連続，description の体言止めが無いこと |
| コミット | マージを除く全コミットメッセージの機械的な部分——件名の形式と長さ，件名と本文を分ける空行，本文の折り返し，ツールが注入するトレーラの不在（規律そのものは /capstone:commit-changes の「文面の基準」と「固有の走査」が定める） |

声（文の調子）・因果・1コミット1意図は機械に判定できないので scan.py は担わない．

`python scripts/scan.py` で走らせると，検査ごとの対象件数を出す．対象が0件の検査は空振りとして違反に数える．違反が一件も無ければ exit 0 を返す．[CI](.github/workflows/scan.yml) は master への push と PR ごとに scan.py を走らせ，その結果を確定の根拠にする．コミットの検査に全履歴が要るので，リポジトリを `fetch-depth: 0` で取得する．

機械で捉えられる観点が増えたら scan.py に足す．足したら違反を1つ注入して落ちることを確かめる．除外を設けるなら理由をコメントに残し，除外が検出を殺していないかも確かめる．

### リリース

各プラグインは独立した SemVer 単位——利用者はプラグインを個別に導入するため，バージョンは変更のあったプラグインだけが上がる（lockstep にしない）．リリースは /capstone:release-version がプラグインごとに上げ幅を判定し，`<plugin>-vX.Y.Z` 形式のタグと GitHub Release を個別に発行する．

## ライセンス

[MIT](LICENSE)
