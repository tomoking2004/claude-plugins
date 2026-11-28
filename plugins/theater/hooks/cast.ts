// 演者たちの状態の決まり．状態を進める関数は，受け取った状態を変えずに次の状態を返す．

import type {
  TheaterActor as Actor,
  TheaterCast as Cast,
  TheaterRole as Role,
} from '../types'

export const MAIN = 'main'
/** 一度出した役割を，最低これだけ続けてから切り替える（ちらつきを防ぐ）． */
export const HOLD_MS = 2000
// 終了の出来事が来ないまま，これだけ動かなかった分身は，終えた扱いにする．
const STALE_MS = 10 * 60_000
// `seen` を書き直す間隔．ツールのたびに書くと，絵が変わらないのに描き直しが走る．
const SEEN_STEP_MS = 60_000

const ASKING = 'AskUserQuestion'
const PERMIT = 'permit:' // 許可待ちの印の頭．許可待ちの出来事は呼び出しの id を持たないので，ツール名で控える
const ROLE_OF: Record<string, Role> = {
  Read: 'research',
  Grep: 'research',
  Glob: 'research',
  WebSearch: 'research',
  WebFetch: 'research',
  Write: 'write',
  Edit: 'write',
  NotebookEdit: 'write',
  Bash: 'run',
  PowerShell: 'run',
  Agent: 'watch',
  Task: 'watch',
}

/** ツール名から役割を決める．どれにも当たらないツールは「考える」． */
const roleOf = (tool: string): Role => ROLE_OF[tool] ?? 'think'

const born = (id: string, now: number, label = ''): Actor => ({
  id,
  label,
  role: 'think',
  since: now - HOLD_MS,
  queued: null,
  asks: [],
  isIdle: false,
  isDone: false,
  seen: now,
})

export const EMPTY: Cast = { actors: [born(MAIN, 0)], sleepiness: 0 }

const altered = (cast: Cast, id: string, change: (actor: Actor) => Actor): Cast => ({
  ...cast,
  actors: cast.actors.map(actor => (actor.id === id ? change(actor) : actor)),
})

export const has = (cast: Cast, id: string): boolean => cast.actors.some(actor => actor.id === id)

/** 役割を替える．替えてすぐなら，次の役割として控えるだけにする． */
const turned = (actor: Actor, role: Role, now: number): Actor =>
  role === actor.role
    ? { ...actor, queued: null }
    : now - actor.since >= HOLD_MS
      ? { ...actor, role, since: now, queued: null }
      : { ...actor, queued: role }

/** ツールを使った．列にいない演者の分は捨てる． */
export const used = (cast: Cast, id: string, tool: string, callId: string, now: number): Cast =>
  altered(cast, id, actor => ({
    ...turned(actor, roleOf(tool), now),
    asks: tool === ASKING ? [...actor.asks, callId] : actor.asks,
    isIdle: false,
    isDone: false,
    seen: now - actor.seen >= SEEN_STEP_MS ? now : actor.seen,
  }))

/** 控えていた役割のうち，切り替えてよい時刻になったものを出す． */
export const flushed = (cast: Cast, now: number): Cast => ({
  ...cast,
  actors: cast.actors.map(actor =>
    actor.queued === null ? actor : turned(actor, actor.queued, now),
  ),
})

/** 控えた役割を出せるようになるまでの時間．控えが無ければ undefined． */
export const untilFlush = (cast: Cast, now: number): number | undefined => {
  const left = cast.actors
    .filter(actor => actor.queued !== null)
    .map(actor => Math.max(0, actor.since + HOLD_MS - now))

  return left.length === 0 ? undefined : Math.min(...left)
}

/** ツールの許可を待ち始めた． */
export const asked = (cast: Cast, id: string, tool: string): Cast =>
  altered(cast, id, actor => ({ ...actor, asks: [...actor.asks, PERMIT + tool] }))

/** ツールが終わった：その呼び出しの質問の印と，同じツールの許可待ちの印を1つ外す． */
export const answered = (cast: Cast, id: string, tool: string, callId: string): Cast =>
  altered(cast, id, actor => {
    const permit = actor.asks.indexOf(PERMIT + tool)
    const asks = actor.asks.filter((mark, i) => mark !== callId && i !== permit)

    return asks.length === actor.asks.length ? actor : { ...actor, asks }
  })

/** まだ一言の無い演者に，一言を付ける． */
const labeled = (cast: Cast, id: string, label: string): Cast =>
  altered(cast, id, actor => (actor.label !== '' || label === '' ? actor : { ...actor, label }))

/** 演者に新しい指示が届いた：一言を付け替える．指示の合間（ツールを使う間）には呼ばない． */
export const relabeled = (cast: Cast, id: string, label: string): Cast =>
  altered(cast, id, actor => (label === '' || actor.label === label ? actor : { ...actor, label }))

/** 分身が加わった．既にいるなら，一言がまだ無いときだけ書き足す． */
export const joined = (cast: Cast, id: string, now: number, label = ''): Cast =>
  has(cast, id)
    ? labeled(cast, id, label)
    : { ...cast, actors: [...cast.actors, born(id, now, label)] }

const done = (actor: Actor): Actor =>
  actor.isDone ? actor : { ...actor, queued: null, asks: [], isDone: true }

/** 分身が仕事を終えた．すぐには外さず，眠る姿で列に残す． */
export const finished = (cast: Cast, id: string): Cast =>
  id === MAIN ? cast : altered(cast, id, done)

/** ユーザーが次の依頼を送った：終えた分身を列から外す． */
export const tidied = (cast: Cast): Cast =>
  cast.actors.some(actor => actor.isDone)
    ? { ...cast, actors: cast.actors.filter(actor => !actor.isDone) }
    : cast

/** 本体が動き出した：すぐ「考える」に戻す． */
export const woken = (cast: Cast, now: number): Cast =>
  altered(cast, MAIN, actor => ({
    ...actor,
    role: 'think',
    since: now,
    queued: null,
    asks: [],
    isIdle: false,
  }))

/** 本体が返答を終えた． */
export const stopped = (cast: Cast): Cast =>
  altered(cast, MAIN, actor => ({ ...actor, queued: null, asks: [], isIdle: true }))

/** 終了の出来事を取りこぼした分身（`ended`）と，長く動いていない分身を，終えた扱いにする． */
export const swept = (cast: Cast, ended: readonly string[], now: number): Cast => ({
  ...cast,
  actors: cast.actors.map(actor =>
    actor.id !== MAIN && (ended.includes(actor.id) || now - actor.seen >= STALE_MS)
      ? done(actor)
      : actor,
  ),
})

/**
 * 画面に出す役割．「呼ぶ」が最優先．終えた分身は眠り，止まった本体は，働く分身がいれば
 * 見守り，いなければ眠る．
 */
export const shown = (cast: Cast, actor: Actor): Role =>
  actor.asks.length > 0
    ? 'call'
    : actor.isDone
      ? 'rest'
      : actor.id === MAIN && actor.isIdle
        ? cast.actors.some(other => other.id !== MAIN && !other.isDone)
          ? 'watch'
          : 'rest'
        : actor.role

/** 演者の順位．本体，「呼ぶ」の分身，ほかの働く分身，眠る分身の順に先． */
const rankOf = (cast: Cast, actor: Actor): number => {
  if (actor.id === MAIN) return 0
  const role = shown(cast, actor)

  return role === 'call' ? 1 : role === 'rest' ? 3 : 2
}

/**
 * 並べる順．本体が先頭で，「呼ぶ」の分身をその次へ寄せる（「呼ぶ」の分身が折り返しの
 * 下の段に隠れると，待たせていることを見落とすため）．ほかの分身は加わった順．
 */
export const lined = (cast: Cast): Actor[] => {
  const at = (actor: Actor) => Math.min(rankOf(cast, actor), 2)

  return [0, 1, 2].flatMap(rank => cast.actors.filter(actor => at(actor) === rank))
}

/** 画面が描ける絵の量か動かせる絵の数が足りないときに，絵を先に取る順．順位の先から，同じ順位では加わった順． */
export const ranked = (cast: Cast): Actor[] =>
  [0, 1, 2, 3].flatMap(rank => cast.actors.filter(actor => rankOf(cast, actor) === rank))

/**
 * 絵の大きさの合計を `room` に収めるよう，パネルに出す演者を選ぶ．`sizes` は，絵を先に取る順に並べた
 * 演者ごとの絵の大きさで，絵の無い演者は undefined．返すのは，演者ごとの，出すかどうか．
 * 先の演者から順に，残りに入る絵を出す．入らない絵を，小さい絵では代えない．
 */
export const fitted = (sizes: (number | undefined)[], room: number): boolean[] => {
  let left = room

  return sizes.map(size => {
    if (size === undefined || size > left) return false
    left -= size

    return true
  })
}

const widthOf = (ch: string): number => (ch.charCodeAt(0) > 0xff ? 2 : 1)

/** 文字列の幅（半角1字を1，全角1字を2と数える）． */
export const widthOfText = (text: string): number =>
  [...text].reduce((sum, ch) => sum + widthOf(ch), 0)

/** 絵の下に書く一言を1行に詰め，幅（`widthOfText` の数え方）に収まらなければ切る．切った印の「…」は幅1と数える． */
export const brief = (label: string, width: number): string => {
  const line = label.split(/\s+/).join(' ').trim()
  if (widthOfText(line) <= width) return line

  let spent = 1 // 末尾の「…」の分
  const kept = [...line].filter(ch => (spent += widthOf(ch)) <= width)

  return `${kept.join('')}…`
}

// 眠気の段階が上がるコンテキストのトークン数．決め方は，DESIGN.md の「本体の眠気」が定める．
const DROWSY = [100_000, 150_000, 200_000]

/** コンテキストのトークン数から，本体の眠気の段階を決める． */
export const sleepinessOf = (tokens: number | undefined): number =>
  tokens === undefined ? 0 : DROWSY.filter(edge => tokens >= edge).length

/**
 * 絵の名前（拡張子を除く）の候補．先のものほど望ましく，キャラクターが持つ最初の絵を使う．
 * 分身の絵が無ければ本体の絵で，眠気の段階の絵が無ければ段階0の絵か描き分けない絵で，役割の絵が無ければ
 * 「考える」の絵で代える．眠気は本体だけが持つ．
 */
export const spritesOf = (cast: Cast, actor: Actor): string[] => {
  const isMain = actor.id === MAIN
  const level = isMain ? cast.sleepiness : 0
  const of = (role: Role) => [
    ...(isMain ? [] : [`sub-${role}`]),
    `main-${role}-${level}`,
    `main-${role}-0`,
    `main-${role}`,
  ]

  return [...new Set([...of(shown(cast, actor)), ...of('think')])]
}
