/** 演者の役割．`rest`（眠る）は，働き終えた演者が取る． */
export type TheaterRole = 'think' | 'research' | 'write' | 'run' | 'watch' | 'call' | 'rest'

/** パネルに映る1体．本体の `id` は `main`，分身の `id` はエージェントとしての id． */
export type TheaterActor = {
  id: string
  /** 絵の下に書く，いま受けている指示の一言（「ログの調査」など）．次の指示が届くまで変えない．まだ無ければ空． */
  label: string
  /** 最後に使ったツールの役割．次のツールまで続く．`call` と `rest` は入らない（画面に出すときに決める）． */
  role: TheaterRole
  /** `role` に切り替えた時刻．切り替えてすぐの役割は，ここから一定の間は替えない． */
  since: number
  /** 役割を替えられない間に届いた，次の役割．替えられるようになったら `role` になる． */
  queued: TheaterRole | null
  /** ユーザーの返事か許可を待つたびに1つ入る印．1つでもあれば「呼ぶ」．待っていたツールが終わると外れる． */
  asks: string[]
  /** 返答を終えて止まっている（本体だけ）． */
  isIdle: boolean
  /** 仕事を終えた（分身だけ）．次の依頼が届くまで列に残る． */
  isDone: boolean
  /** 最後に動いた時刻（書き直しは，多くて1分に1度）．終了の出来事が来なかった分身を，終えた扱いにするのに使う． */
  seen: number
}

/** パネルに映る全員と，本体の眠気の段階（0〜3）． */
export type TheaterCast = { actors: TheaterActor[]; sleepiness: number }

/** 絵を持ち寄るキャラクター．演者はみな，パネルに映すキャラクターの絵で映る． */
export type TheaterCharacter = {
  /** キャラクターの名前．パネルを開くコマンドの名前（`/<name>`）にもなる． */
  name: string
  /** パネルの題． */
  title: string
  /** キャラクターのプラグインの置き場（`$.plugin.root`）．絵は，その下の `sprites/` から読む． */
  root: string
}

/** `$.theater`．キャラクターのプラグインが，キャラクターを加えるのに呼ぶ． */
export type Theater = {
  /**
   * キャラクターを加える．セッションの開始時に，キャラクターのプラグインが呼ぶ．
   * 映すのは，ユーザーが最後に `/<name>` で選んだキャラクター．選んでいないか，選んだキャラクターが
   * 加わっていなければ，最初に加わったもの．
   *
   * @returns `isLead`：このキャラクターが，呼んだ時点でパネルに映すキャラクターか（あとから替わりうる）
   */
  join: (character: TheaterCharacter) => Promise<{ isLead: boolean }>
}

declare module 'claude-code' {
  interface EngineInterface {
    theater: Theater
  }

  interface PluginState {
    theater: { cast: Shaped<TheaterCast> }
  }
}
