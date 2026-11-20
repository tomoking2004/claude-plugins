// Claude とその分身が働く様子を，キツネのアニメーションでパネルに映す．
//
// 出来事のフックは眺めるだけで，結果には手を付けない（必ず `next(e)` をそのまま返す）．
// 答えを返すのは，自分のコマンド（`/fox`）とパネルの描画だけである．
// ツールの呼び出しは `tool.check` で拾う——`tool.call` に掛けると，エンジンがそのツールの
// 裏への切り替えを止めてしまうため．

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Den, Fox, Role } from '../types'
import * as den from './den'

const PANE = 'fox'
const TITLE = 'キツネ'
// 絵の一辺．何匹並んでも同じ大きさで描く（ドットが崩れないよう，64の整数倍にする）．
// 入力欄の上に置かれたパネル（inline）は背が低いので，1匹と一言がスクロールせずに収まる
// 大きさへ一段下げる．横に置かれたパネル（dock）では大きく描く．
const SIZE = { dock: 256, inline: 192 }
// パネルに頼む高さ（文字の行数）．1匹ぶんの絵と一言が，スクロールせずに収まる高さにする．
// 頼みであって，ユーザーが自分で変えた高さがあればそちらが勝つ．
const ROWS = 18
const TICKS = 48 // アニメーション1周の刻み（1刻み100ms）
const UNIT_PX = 7 // 絵の下の一言で，半角1字が取る幅の目安
const ROLE_NAME: Record<Role, string> = {
  think: '考える',
  research: '調べる',
  write: '書く',
  run: '実行する',
  watch: '見守る',
  call: '呼ぶ',
  rest: '眠る',
}
const ENDED = ['completed', 'failed', 'killed']

const state = atom({ plugin: 'fox', key: 'den' } as const, den.EMPTY, { shape: 'den-5' })

// ── 絵 ───────────────────────────────────────────────

/** 個体ごとの本の表紙の色の一覧（先頭が絵に描かれた元の色）． */
type Index = { covers: string[][] }

let index: Index | undefined
const sprites = new Map<string, string>()

const load = async ($: EngineInterface, name: string): Promise<string> => {
  const cached = sprites.get(name)
  if (cached !== undefined) return cached
  const text = String(await $.fs.read(`${$.plugin.root}/sprites/${name}`))
  sprites.set(name, text)

  return text
}

/** 1匹ぶんの SVG．分身は個体ごとに，動きの位相と本の表紙の色を変える． */
const sprite = async ($: EngineInterface, key: string, id: string): Promise<string> => {
  index ??= JSON.parse(await load($, 'index.json')) as Index
  const svg = await load($, `${key}.svg`)
  if (id === den.MAIN) return svg

  const seed = [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const original = index.covers[0] ?? []
  const cover = index.covers[seed % index.covers.length] ?? original

  return original.reduce(
    (out, color, i) => out.replace(color, cover[i] ?? color),
    svg.replace('animation-delay:0s', `animation-delay:-${(seed % TICKS) / 10}s`),
  )
}

// ── 状態の書き換え ───────────────────────────────────

let timer: Timer | undefined

/** 状態を書き換える．状態が変わらないなら書かない（書けばパネルの描き直しが走る）． */
const change = async (
  $: EngineInterface,
  step: (was: Den, now: number) => Den,
): Promise<void> => {
  const now = await $.clock.now()
  const before = await read($, state)
  const after = step(before, now)
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await update($, state, was => step(was, now))
  }

  // 控えた役割があれば，切り替えてよい時刻にもう一度見る．
  const ms = den.wait(after, now)
  timer?.cancel()
  timer = ms === undefined ? undefined : $.clock.after(ms + 1, () => void change($, den.flushed))
}

/** 本体の眠気を，いまのコンテキストの使用率に合わせる． */
const drowsy = async ($: EngineInterface): Promise<(was: Den) => Den> => {
  const { context } = await $.session.usage()
  const sleepiness = den.sleepinessOf(context.percent)

  return was => (was.sleepiness === sleepiness ? was : { ...was, sleepiness })
}

/** 分身が任された仕事の名前（起動の呼び出しが付けた数語）．一覧に無ければ undefined． */
const taskOf = async ($: EngineInterface, id: string): Promise<string | undefined> =>
  (await $.agent.list()).find(agent => agent.id === id)?.description

/** 終わった分身の id．一覧に載らない分身は，動かなくなってから終えた扱いにする． */
const ended = async ($: EngineInterface): Promise<string[]> =>
  (await $.agent.list()).filter(agent => ENDED.includes(agent.status)).map(agent => agent.id)

// 本体の一言は，依頼が届くたびに，その文から小さなモデルに付けさせる（依頼1件につき短い呼び出しが1回）．
const NAMER = 'haiku'
const NAMING = [
  'ユーザーの依頼を受けた担当者の役割を，一言の名詞句で答える．',
  '例：「リコーの調査」「README の校正」「テストの修理」．',
  '依頼と同じ言語で，全角12字（半角24字）以内．役割だけを1行で出力し，説明・引用符・句点は付けない．',
].join('')
const PROMPT_LIMIT = 2000 // 一言を付けるのに読ませる依頼の長さ．モデルが答えないときに一言に使う長さでもある

// ユーザー自身が送った依頼の出どころ（知らせや他のセッションの伝言は含めない）．
const FROM_USER = ['composer', 'bridge', 'sdk']

// 分身へ追加の指示を送るツール．宛先（`to`）と，指示の要約（`summary`）を持つ．
const MESSAGING = 'SendMessage'

let namings = 0 // 一言を頼んだ回数

/** 本体の一言を付け替える．届くまでは前の一言を出しておき，モデルが答えなければ依頼の文を使う． */
const name = async ($: EngineInterface, prompt: string): Promise<void> => {
  const turn = ++namings
  const reply = await $.model
    .complete({
      model: NAMER,
      system: NAMING,
      prompt: prompt.slice(0, PROMPT_LIMIT),
      maxTokens: 40,
      timeoutMs: 15_000,
    })
    .catch(() => undefined)
  const label = reply?.isAnswered ? (reply.text.trim().split('\n')[0] ?? '') : ''
  // 待つ間に次の依頼が届いていたら，古い答えは捨てる．
  if (turn === namings) {
    const text = label === '' ? prompt.slice(0, PROMPT_LIMIT) : label
    await change($, was => den.renamed(was, den.MAIN, text))
  }
}

/** 分身への追加の指示なら，宛先の分身の一言を，その指示の要約に付け替える． */
const instruct = async ($: EngineInterface, input: unknown): Promise<void> => {
  const { to, summary } = (input ?? {}) as { to?: unknown; summary?: unknown }
  if (typeof to !== 'string' || typeof summary !== 'string') return
  // 宛先は分身の id か，起動のときに付けた呼び名．
  const id = (await $.agent.list()).find(agent => agent.id === to || agent.name === to)?.id ?? to
  await change($, was => den.renamed(was, id, summary))
}

type Finished = { agent_id?: string; tool_name: string; tool_use_id: string }

const settle = ($: EngineInterface, e: Finished) =>
  change($, was => den.answered(was, e.agent_id ?? den.MAIN, e.tool_name, e.tool_use_id))

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, rows: ROWS })

// ── フック ───────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fox', description: 'キツネのパネルを開く' })
    // 端末では，パネルが画面の一部を取るので，頼まれたときだけ開く．
    if (e.surface !== 'terminal') void open($)

    return next(e)
  })

  on('session.attach', ($, e, next) => {
    if (e.surface !== 'terminal') void open($)

    return next(e)
  })

  on('command.run', { command: 'fox' }, async $ => {
    await open($)

    return { text: 'キツネのパネルを開いた．' }
  })

  on('tool.check', async ($, e, next) => {
    const callId = e.tool_use_id
    if (callId !== undefined && e.op === undefined) {
      if (e.tool === MESSAGING) await instruct($, e.input)
      const id = e.agentId ?? den.MAIN
      const sleepy = id === den.MAIN ? await drowsy($) : (was: Den) => was
      // プラグインが会話の途中で読み込まれたときは，動いている分身を一覧で確かめて列に加える．
      const task = den.has(await read($, state), id) ? '' : await taskOf($, id)
      if (task !== undefined) {
        await change($, (was, now) =>
          sleepy(den.used(den.joined(was, id, now, task), id, e.tool, callId, now)),
        )
      }
    }

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await change($, was => den.asked(was, e.agent_id ?? den.MAIN, e.tool_name))

    return next(e)
  })

  // 返事か許可が届いてツールが終わった（断られた・失敗した場合も含む）．
  on('classic.PostToolUse', async ($, e, next) => {
    await settle($, e)

    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await settle($, e)

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    await settle($, e)

    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const task = (await taskOf($, e.agent_id)) ?? e.agent_type
    await change($, (was, now) => den.joined(was, e.agent_id, now, task))

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await change($, was => den.finished(was, e.agent_id))

    return next(e)
  })

  // ユーザーが次の依頼を送った：終えた分身を片づけ，本体の一言をこの依頼のものに付け替える．
  // 完了の知らせなど，機械が入れた番では何もしない．
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && FROM_USER.includes(e.origin.kind)) {
      await change($, den.tidied)
      // 依頼の受け付けを待たせないよう，一言はあとから付ける．スラッシュコマンドの入力からは付けない．
      if (e.command === undefined) $.clock.after(0, () => void name($, e.text))
    }

    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const sleepy = await drowsy($)
    await change($, (was, now) => sleepy(den.woke(was, now)))

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined) {
      const [sleepy, gone] = [await drowsy($), await ended($)]
      await change($, (was, now) => sleepy(den.swept(den.stopped(was), gone, now)))
    }

    return next(e)
  })

  // 圧縮を終えたら，眠気を測り直す（使用率が50%を下回っていれば目覚める）．
  on('classic.PostCompact', async ($, e, next) => {
    const sleepy = await drowsy($)
    await change($, sleepy)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') await change($, () => den.EMPTY)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, state)
    const foxes = den.lined(current)
    const alt = (fox: Fox) =>
      `${fox.id === den.MAIN ? '本体' : '分身'}：${ROLE_NAME[den.shown(current, fox)]}`

    // 端末は絵（SVG）を描けないので，役割を文字で並べる．
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {foxes.map(fox => (
            <Text>{[alt(fox), den.brief(fox.label, 80)].filter(Boolean).join('　')}</Text>
          ))}
        </Box>
      )
    }

    const { Box, Svg, Text } = $.ui.resolve(e)
    const size = e.props.placement === 'inline' ? SIZE.inline : SIZE.dock
    const sources = await Promise.all(
      foxes.map(fox => sprite($, den.spriteOf(current, fox), fox.id)),
    )

    // 1段に並ぶ数は決めず，パネルの幅に入るだけ並べて折り返す．各段は中央に寄せる．
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="center">
        {foxes.map((fox, i) => (
          <Box flexDirection="column" alignItems="center" flexShrink={0}>
            <Svg source={sources[i] ?? ''} alt={alt(fox)} width={size} height={size} />
            <Text dimColor>{den.brief(fox.label, size / UNIT_PX)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
