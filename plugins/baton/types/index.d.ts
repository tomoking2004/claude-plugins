/** 移ることを勧めるきっかけ．`tokens` はコンテキストが量に達したこと，`compacted` は会話が自動で要約されたこと． */
export type Cue = 'tokens' | 'compacted'

/** このセッションで勧めた跡． */
export type Offers = {
  /** 勧め終えたきっかけ．どのきっかけも1セッションに1回だけ勧める． */
  done: Cue[]
  /** 自動の要約を終え，次の返答の区切りで勧めるのを待っている． */
  isCompacted: boolean
}

/** 入力欄の上の帯に出している勧め． */
export type Band = {
  cue: Cue
  /** 勧めたときのコンテキストのトークン数． */
  tokens: number
}

/** `$.store` に，セッションごとに残す勧めの跡と帯．窓を開き直して再開したセッションに戻す． */
export type Kept = Record<
  string,
  {
    offers: Offers
    band: Band | null
    /** 残した時刻（`$.clock.now()` のミリ秒）．古いものから間引く． */
    at: number
  }
>

/** `$.store` に，プロジェクトごとに1つ置く引き継ぎ文． */
export type Handoff = {
  text: string
  /** 書いたセッションの id．そのセッション自身の入力欄には入れない． */
  from: string
  /** 書いた時刻（`$.clock.now()` のミリ秒）． */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    baton: { offers: Shaped<Offers>; band: Band | null }
  }
}
