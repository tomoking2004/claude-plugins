/** キツネの役割．`rest`（眠る）は，働き終えたキツネが取る． */
export type Role = 'think' | 'research' | 'write' | 'run' | 'watch' | 'call' | 'rest'

/** 1匹のキツネ．本体の `id` は `main`，分身の `id` はエージェントとしての id． */
export type Fox = {
  id: string
  /** 絵の下に書く，いま受けている指示の一言（「リコーの調査」など）．次の指示が届くまで変えない．まだ無ければ空． */
  label: string
  /** 最後に使ったツールの役割．次のツールまで続く． */
  tool: Role
  /** `tool` に切り替えた時刻．切り替えてすぐの役割は，ここから一定の間は替えない． */
  since: number
  /** 役割を替えられない間に届いた，次の役割．替えられるようになったら `tool` になる． */
  queued: Role | null
  /** ユーザーの返事か許可を待つたびに1つ入る印．1つでもあれば「呼ぶ」．待っていたツールが終わると外れる． */
  asks: string[]
  /** 返答を終えて止まっている（本体だけ）． */
  isIdle: boolean
  /** 仕事を終えた（分身だけ）．次の依頼が届くまで列に残る． */
  isDone: boolean
  /** 最後に動いた時刻．終了の出来事が来なかった分身を，終えた扱いにするのに使う． */
  seen: number
}

/** パネルに映る全員と，本体の眠気の段階（0〜3）． */
export type Den = { foxes: Fox[]; sleepiness: number }

declare module 'claude-code' {
  interface PluginState {
    fox: { den: Shaped<Den> }
  }
}
