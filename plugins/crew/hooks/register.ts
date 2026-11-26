// 仕事の分担を，徴候が数に現れた時にだけモデルへ促す．
//
// 促すのは二つの時だけ：一つの依頼の読み・調べとコマンドを主の文脈のまま独りで長く続けている時と，
// エージェントを多く起こした時．どちらも依頼ごとに1回，ツールの結果に添える知らせでモデルにだけ伝える．
// 任せるかどうかはモデルが決める——知らせは数えた事実と，分担を定めるスキルの名を渡すだけで，
// 呼び出しを止めも書き換えもせず，利用者への問いも求めない．始める前の見分けと見積もりは，スキルが担う．
// コンテキストの量は数えず，知らせにも入れない（量に応じて新しいセッションを勧めるのは別の役目）．

import type { Register } from 'claude-code'

const SKILL = '/crew:divide-work'
// エージェントを起こすツール．
const AGENT = 'Agent'
// 独りの知らせが数える，読み・調べとコマンドのツール．任せやすいのは読む・探す仕事だが，
// 読みはコマンド（`cat` など）でも済まされるので，Bash と PowerShell も数える．書くツールは数えない．
const COUNTED = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash', 'PowerShell']
// 独りで続けていると見なす，一つの依頼の中の回数．
const SOLO = 40
// 費用への注意を促す，一つの依頼の中のエージェントの数．スキルの「見積もる」と同じ数にする．
const MANY = 8
// 人が送った文の出どころ：端末の入力欄，スマホやウェブ（Remote Control），VS Code のパネル．
// パネルからの送信は `sdk` で届く．知らせや他のセッションの伝言は依頼に数えない．
const FROM_USER = ['composer', 'bridge', 'sdk']

const SOLO_NOTE =
  `crew：この依頼で，主の文脈のまま読み・調べとコマンドのツール（${COUNTED.join('・')}）を${SOLO}回使い，エージェントには何も任せていない．` +
  `残りの仕事に，互いに独立で，結論だけ受け取れば足りる部分があるなら，${SKILL} の「見分け」に照らして任せる．` +
  '残りが互いに絡む直しか，あとわずかなら，このまま続ける．この知らせは依頼ごとに1回だけ届く．'

const MANY_NOTE =
  `crew：この依頼で起こしたエージェントが${MANY}体に達した．起こすたびに文脈を一から読み込むので，費用は数に比例して増える．` +
  'この先は，利用者には問わず，本当に要る分だけを起こす．' +
  `戻った報告は，${SKILL} の「確かめ」に従って決め手だけを自分で確かめる．この知らせは依頼ごとに1回だけ届く．`

/** 一つの依頼の中で，主の文脈が数えるツールを使った回数と，起こしたエージェントの数と，届けた知らせ． */
type Tally = { calls: number; agents: number; isSoloTold: boolean; isManyTold: boolean }

const fresh = (): Tally => ({ calls: 0, agents: 0, isSoloTold: false, isManyTold: false })

// 数えるのは進行中の依頼だけなので，セッションをまたいで残さない．
let tally = fresh()

/** 主の文脈の呼び出しを一つ受け，数える対象なら数えて，届ける知らせがあれば返す． */
const count = (tool: string): string | undefined => {
  if (tool === AGENT) {
    tally.agents += 1
    if (tally.agents < MANY || tally.isManyTold) return undefined
    tally.isManyTold = true

    return MANY_NOTE
  }

  if (!COUNTED.includes(tool)) return undefined

  tally.calls += 1
  if (tally.calls < SOLO || tally.agents > 0 || tally.isSoloTold) return undefined
  tally.isSoloTold = true

  return SOLO_NOTE
}

export const register: Register = on => {
  // 人が新しい依頼を送ったら数え直す．
  on('prompt.submit', ($, e, next) => {
    if (e.isMeta !== true && FROM_USER.includes(e.origin.kind)) tally = fresh()

    return next(e)
  })

  // エージェント自身の呼び出し（`agentId` を持つ）と，断られた呼び出しは数えない．
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) return ran

    const note = count(e.tool)

    return note === undefined ? ran : { ...ran, context: [...(ran.context ?? []), note] }
  })
}
