// キツネたちの状態の決まり．どの関数も，受け取った状態を変えずに次の状態を返す．

import type { Den, Fox, Role } from '../types'

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

const born = (id: string, now: number, label = ''): Fox => ({
  id,
  label,
  tool: 'think',
  since: now - HOLD_MS,
  queued: null,
  asks: [],
  isIdle: false,
  isDone: false,
  seen: now,
})

export const EMPTY: Den = { foxes: [born(MAIN, 0)], sleepiness: 0 }

const each = (den: Den, id: string, change: (fox: Fox) => Fox): Den => ({
  ...den,
  foxes: den.foxes.map(fox => (fox.id === id ? change(fox) : fox)),
})

export const has = (den: Den, id: string): boolean => den.foxes.some(fox => fox.id === id)

/** 役割を替える．替えてすぐなら，次の役割として控えるだけにする． */
const turned = (fox: Fox, role: Role, now: number): Fox =>
  role === fox.tool
    ? { ...fox, queued: null }
    : now - fox.since >= HOLD_MS
      ? { ...fox, tool: role, since: now, queued: null }
      : { ...fox, queued: role }

/** ツールを使った．列にいないキツネの分は捨てる． */
export const used = (den: Den, id: string, tool: string, callId: string, now: number): Den =>
  each(den, id, fox => ({
    ...turned(fox, roleOf(tool), now),
    asks: tool === ASKING ? [...fox.asks, callId] : fox.asks,
    isIdle: false,
    isDone: false,
    seen: now - fox.seen >= SEEN_STEP_MS ? now : fox.seen,
  }))

/** 控えていた役割のうち，切り替えてよい時刻になったものを出す． */
export const flushed = (den: Den, now: number): Den => ({
  ...den,
  foxes: den.foxes.map(fox => (fox.queued === null ? fox : turned(fox, fox.queued, now))),
})

/** 控えた役割を出せるようになるまでの時間．控えが無ければ undefined． */
export const wait = (den: Den, now: number): number | undefined => {
  const left = den.foxes
    .filter(fox => fox.queued !== null)
    .map(fox => Math.max(0, fox.since + HOLD_MS - now))

  return left.length === 0 ? undefined : Math.min(...left)
}

/** ツールの許可を待ち始めた． */
export const asked = (den: Den, id: string, tool: string): Den =>
  each(den, id, fox => ({ ...fox, asks: [...fox.asks, PERMIT + tool] }))

/** ツールが終わった：その呼び出しの質問の印と，同じツールの許可待ちの印を1つ外す． */
export const answered = (den: Den, id: string, tool: string, callId: string): Den =>
  each(den, id, fox => {
    const permit = fox.asks.indexOf(PERMIT + tool)
    const asks = fox.asks.filter((mark, i) => mark !== callId && i !== permit)

    return asks.length === fox.asks.length ? fox : { ...fox, asks }
  })

/** まだ一言の無いキツネに，一言を付ける． */
const named = (den: Den, id: string, label: string): Den =>
  each(den, id, fox => (fox.label !== '' || label === '' ? fox : { ...fox, label }))

/** キツネに新しい指示が届いた：一言を付け替える．指示の合間（ツールを使う間）には呼ばない． */
export const renamed = (den: Den, id: string, label: string): Den =>
  each(den, id, fox => (label === '' || fox.label === label ? fox : { ...fox, label }))

/** 分身が加わった．既にいるなら，一言がまだ無いときだけ書き足す． */
export const joined = (den: Den, id: string, now: number, label = ''): Den =>
  has(den, id) ? named(den, id, label) : { ...den, foxes: [...den.foxes, born(id, now, label)] }

const done = (fox: Fox): Fox => (fox.isDone ? fox : { ...fox, queued: null, asks: [], isDone: true })

/** 分身が仕事を終えた．すぐには外さず，眠る姿で列に残す． */
export const finished = (den: Den, id: string): Den => (id === MAIN ? den : each(den, id, done))

/** ユーザーが次の依頼を送った：終えた分身を列から外す． */
export const tidied = (den: Den): Den =>
  den.foxes.some(fox => fox.isDone) ? { ...den, foxes: den.foxes.filter(fox => !fox.isDone) } : den

/** 本体が動き出した：すぐ「考える」に戻す． */
export const woke = (den: Den, now: number): Den =>
  each(den, MAIN, fox => ({
    ...fox,
    tool: 'think',
    since: now,
    queued: null,
    asks: [],
    isIdle: false,
  }))

/** 本体が返答を終えた． */
export const stopped = (den: Den): Den =>
  each(den, MAIN, fox => ({ ...fox, queued: null, asks: [], isIdle: true }))

/** 終了の出来事を取りこぼした分身（`ended`）と，長く動いていない分身を，終えた扱いにする． */
export const swept = (den: Den, ended: readonly string[], now: number): Den => ({
  ...den,
  foxes: den.foxes.map(fox =>
    fox.id !== MAIN && (ended.includes(fox.id) || now - fox.seen >= STALE_MS) ? done(fox) : fox,
  ),
})

/**
 * 画面に出す役割．「呼ぶ」が最優先．終えた分身は眠り，止まった本体は，働く分身がいれば
 * 見守り，いなければ眠る．
 */
export const shown = (den: Den, fox: Fox): Role =>
  fox.asks.length > 0
    ? 'call'
    : fox.isDone
      ? 'rest'
      : fox.id === MAIN && fox.isIdle
        ? den.foxes.some(other => other.id !== MAIN && !other.isDone)
          ? 'watch'
          : 'rest'
        : fox.tool

/**
 * 並べる順．本体が先頭で，「呼ぶ」の分身をその次へ寄せる（「呼ぶ」の分身が折り返しの
 * 下の段に隠れると，待たせていることを見落とすため）．ほかの分身は加わった順．
 */
export const lined = (den: Den): Fox[] => {
  const rank = (fox: Fox) => (fox.id === MAIN ? 0 : shown(den, fox) === 'call' ? 1 : 2)

  return [0, 1, 2].flatMap(at => den.foxes.filter(fox => rank(fox) === at))
}

const widthOf = (ch: string): number => (ch.charCodeAt(0) > 0xff ? 2 : 1)

/** 文字列の幅（半角1字を1，全角1字を2と数える）． */
export const widthOfText = (text: string): number =>
  [...text].reduce((sum, ch) => sum + widthOf(ch), 0)

/** 絵の下に書く一言を1行に詰め，幅（`widthOfText` の数え方）に収まらなければ切る． */
export const brief = (label: string, width: number): string => {
  const line = label.split(/\s+/).join(' ').trim()
  if (widthOfText(line) <= width) return line

  let spent = 1 // 末尾の「…」の分
  const kept = [...line].filter(ch => (spent += widthOf(ch)) <= width)

  return `${kept.join('')}…`
}

/** コンテキストの使用率（0〜100）から，本体の眠気の段階を決める． */
export const sleepinessOf = (percent: number | undefined): number =>
  percent === undefined || percent < 50 ? 0 : percent < 70 ? 1 : percent < 85 ? 2 : 3

/** 絵のファイル名（拡張子を除く）．眠気は本体だけが持ち，「眠る」には段階が無い． */
export const spriteOf = (den: Den, fox: Fox): string => {
  const role = shown(den, fox)
  if (fox.id !== MAIN) return `sub-${role}`

  return role === 'rest' ? 'main-rest' : `main-${role}-${den.sleepiness}`
}
