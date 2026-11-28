# theater

Claude とその分身（サブエージェント）が働く様子を，キャラクターのドット絵でパネルに映す仕組み．絵はキャラクターのプラグインが持ち寄る．

## 導入

手順はマーケットプレイスの README（リポジトリ最上位の README.md）が定める．

- **対応先**：Claude Code 専用．theater は Claude Code の画面にパネルを足す画面拡張（mod）で，チャットで働く部品を持たない．
- **依存先**：なし

theater だけを導入しても，何も映らない．キャラクターのプラグインを導入すれば，theater は依存先として併せて入る．

## 使い方

パネルの使い方は，導入したキャラクターの README が述べる．ここでは，新しいキャラクターの作り方を述べる．

1. プラグインを作り，`.claude-plugin/plugin.json` の `dependencies` に theater を宣言する．
2. `art/` に，絵の元を置く．Claude 自身が考えているときのアニメーション GIF（`main-think.gif`）が1枚あれば足りる．調べる・書くなどの絵を足すほど，描き分けられる姿が増える．
3. リポジトリの最上位で `python plugins/theater/tools/build.py <キャラクターのディレクトリ>` を走らせ（Pillow が要る），`sprites/`・アイコン・README のプレビューを書き出す．このリポジトリの外で作るときも，このリポジトリを手元に写して，その `build.py` を使う．
4. `hooks/` にモジュールを置き，`hooks/hooks.json` で名指す．モジュールは，セッションの開始時に `$.theater.join` を呼ぶ．
5. Claude Code 専用の印として，theater の `bin/theater-claude-code-only` と同じ形のファイルを `bin/<名前>-claude-code-only` に置く．プラグインの最上位に `bin/` があると，Claude はそのプラグインを追加できない．
6. `claude plugin validate <キャラクターのディレクトリ>` で読み込みを確かめる．キャラクターを `plugins/theater` と同じ親ディレクトリ（`plugins/`）に置き，その親を `claude --plugin-dir` に渡すと，手元の版が読み込まれる．
7. このマーケットプレイスに加えるなら，一覧（`.claude-plugin/marketplace.json`）に載せ，README を書く．`scripts/scan.py` の `CLAUDE_CODE_ONLY` に名前を足し，ツール名などの実行環境の語を使う文書があれば，そのパスを同じ scan.py の `ENV_EXEMPT` に足す．README の形と scan.py の走査は，最上位の README が定める．

絵の名前と決まり，持っていない絵の代え方，`dependencies` の形，モジュールの書き方と `$.theater.join` に渡す値は，[DESIGN.md](DESIGN.md) の「キャラクター」が定める．

## 開発

仕組みの決まりと確かめ方は，[DESIGN.md](DESIGN.md) が定める．
