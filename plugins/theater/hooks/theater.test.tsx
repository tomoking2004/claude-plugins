import type { AgentInfo, ModelUsage, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import * as cast from './cast'

const PANE = {
  plugin: 'theater',
  component: 'Pane',
  requestId: 'theater',
  props: {
    title: 'キツネ',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// キャラクターのプラグイン．セッションの開始時に，自分を theater に加える．
const FOX: Plugin = {
  name: 'fox',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.theater.join({ name: 'fox', title: 'キツネ', root: '/fox' })

      return next(e)
    })
  },
}
// 絵を1枚しか持たないキャラクター．
const KIT: Plugin = {
  name: 'kit',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.theater.join({ name: 'kit', title: 'キット', root: '/kit' })

      return next(e)
    })
  },
}
const ONE = { plugins: [FOX] }
const TWO = { plugins: [FOX, KIT] }
const WORKING = ['think', 'research', 'write', 'run', 'watch', 'call']
const INDEX = {
  '/fox': {
    ticks: 48,
    sprites: [
      ...WORKING.flatMap(role => [0, 1, 2, 3].map(level => `main-${role}-${level}`)),
      ...WORKING.map(role => `sub-${role}`),
      'main-rest',
      'sub-rest',
    ],
    variants: [['#964034'], ['#345b96']],
  },
  '/kit': { ticks: 8, sprites: ['main-think'], variants: [] },
}
const SPRITE = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{stroke:#964034}.layer{animation-delay:0s}</style><title>${name}</title></svg>`

/** エンジンの代わり：プラグインが呼ぶ時計・コマンドの登録・パネル・保存した値・ファイル・コンテキストの量・エージェントの一覧・小さなモデルに答える． */
const world = (on: On, usage = { tokens: 10_000 }) => {
  const clock = mock.clock(on, { now: 100_000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // `reason` が空なら置かれ，そうでなければ，その理由で置かれない．`titles` は開いたパネルの題．
  const pane = { reason: '', titles: [] as string[] }
  on('ui.open', (_, e) => {
    pane.titles.push(e.title ?? '')

    return {
      value: pane.reason === '' ? { isPlaced: true } : { isPlaced: false, reason: pane.reason },
    }
  })
  const stored = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  const agents: AgentInfo[] = []
  on('agent.list', () => ({ value: agents }))
  // `calls` は，一言を頼まれた回数．
  const names = { text: 'README の校正', isAnswered: true, calls: 0 }
  on('model.complete', () => {
    names.calls += 1

    return {
      value: names.isAnswered
        ? { isAnswered: true, text: names.text, usage: {} as ModelUsage }
        : { isAnswered: false, reason: 'empty-reply', usage: {} as ModelUsage },
    }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, tokens: usage.tokens }, rateLimits: [] },
  }))
  on('fs.read', (_, e) => ({
    value: e.path.endsWith('index.json')
      ? JSON.stringify(e.path.includes('kit') ? INDEX['/kit'] : INDEX['/fox'])
      : SPRITE(e.path.replaceAll('\\', '/')),
  }))

  return { clock, usage, agents, names, pane }
}

/** パネルに並ぶ演者の，読み上げ用の文（本体か分身か：役割）と絵を返す． */
const actors = async ($: Engine) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const drawn = await ui.findAll({ type: 'Svg' })
  await ui.unmount()

  return drawn.map(svg => ({ alt: String(svg.props.alt), source: String(svg.props.source) }))
}

/** 絵の下に書かれた一言を，並び順に返す． */
const captions = async ($: Engine) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const drawn = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return drawn.map(text => text.text)
}

/** ユーザーが文を送る． */
const say = async ($: Engine, text: string) => {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.classic.UserPromptSubmit({ prompt: text })
}

/** 完了の知らせが届く（機械が入れた番）． */
const notify = async ($: Engine, text: string) => {
  await $.prompt.submit({ text, wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  await $.classic.UserPromptSubmit({ prompt: text })
}

/** セッションを始める．キャラクターのプラグインが，ここで加わる． */
const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

/** ユーザーがキャラクターのコマンド（`/fox` など）を打ち，返ってきた文を返す． */
const open = async ($: Engine, command = 'fox') => {
  const answer = await $.command.run({
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  return answer.text
}

test('本体は，最後に使ったツールの役割を次のツールまで続ける', ONE, async ($, on) => {
  const { clock } = world(on)
  await start($)
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える'])

  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：調べる'])

  await clock.advance(cast.HOLD_MS)
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：調べる'])

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((await actors($))[0]?.alt).toBe('本体：実行する')
  expect((await actors($))[0]?.source).toContain('main-run-0.svg')
})

test('切り替えてすぐの役割は，2秒経ってから替わる', ONE, async ($, on) => {
  const { clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  expect((await actors($))[0]?.alt).toBe('本体：調べる')

  await clock.advance(cast.HOLD_MS + 10)
  expect((await actors($))[0]?.alt).toBe('本体：書く')
})

test('分身の絵は，個体ごとに位相と色が変わる', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })

  const [main, sub] = await actors($)
  expect(sub?.source).toContain('sub-research.svg')
  expect(sub?.source).not.toContain('animation-delay:0s')
  expect(main?.source).toContain('animation-delay:0s')
  // 色は，一覧（`variants`）の2通りのうち，この分身の id が選ぶほうに替わる．本体は元の色のまま．
  expect(sub?.source).toContain('#345b96')
  expect(sub?.source).not.toContain('#964034')
  expect(main?.source).toContain('#964034')
})

test('分身は開始で列に加わり，終えても次の依頼まで列に残る', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：調べる'])

  await $.classic.SubagentStop({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    agent_transcript_path: '/t',
    stop_hook_active: false,
  })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：眠る'])
  expect((await actors($))[1]?.source).toContain('sub-rest.svg')

  // 知らせなどの機械が入れた番では外さず，ユーザーが次の依頼を送ったときに外す．
  await notify($, '知らせ')
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：眠る'])

  await say($, '次の依頼')
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える'])
})

test('絵の下の一言は，指示が届いたときだけ替わる', ONE, async ($, on) => {
  const { agents, clock, names } = world(on)
  // 一覧のうち，この検査でプラグインが読むのは id・description・name だけである．
  agents.push({ id: 'a1', description: 'リンクの確認' } as AgentInfo)
  await start($)
  await say($, 'README を直して')
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  // 本体の一言は，依頼の受け付けを待たせず，あとから届く．
  expect(await captions($)).toEqual(['', 'リンクの確認'])
  await clock.settle()
  expect(await captions($)).toEqual(['README の校正', 'リンクの確認'])

  // 知らせが届いても，ツールを使っても，一言は変わらない．
  names.text = '表の追加'
  agents[0] = { id: 'a1', description: '別の仕事', name: 'checker' } as AgentInfo
  await notify($, '知らせ')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await clock.settle()
  expect(await captions($)).toEqual(['README の校正', 'リンクの確認'])

  // ユーザーの次の依頼で，本体の一言が替わる（届くまでは前の一言のまま）．
  await say($, '表を足して')
  expect((await captions($))[0]).toBe('README の校正')
  await clock.settle()
  expect(await captions($)).toEqual(['表の追加', 'リンクの確認'])

  // 本体が分身へ追加の指示を送ると，その分身の一言が替わる（宛先は id でも呼び名でもよい）．
  await $.tool.call({ tool: 'SendMessage', to: 'checker', summary: '画像リンクの確認', message: '…' })
  expect(await captions($)).toEqual(['表の追加', '画像リンクの確認'])

  // 一覧に載らない分身には，エージェントの種類を書く．
  await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'Explore' })
  expect((await captions($))[2]).toBe('Explore')
})

test('返答を終えた本体は，働いている分身がいれば見守り，いなければ眠る', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.classic.Stop({ stop_hook_active: false })
  expect((await actors($))[0]?.alt).toBe('本体：見守る')

  await $.classic.SubagentStop({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    agent_transcript_path: '/t',
    stop_hook_active: false,
  })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：眠る', '分身：眠る'])

  await say($, 'again')
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える'])
})

test('モデルが答えなければ，依頼の文をそのまま一言にする', ONE, async ($, on) => {
  const { clock, names } = world(on)
  names.isAnswered = false
  await start($)
  await say($, '表を\n  足して')
  await clock.settle()
  expect(await captions($)).toEqual(['表を 足して'])
})

test('モデルが依頼そのものに答えたら，その返事は一言にせず，依頼の文を使う', ONE, async ($, on) => {
  const { clock, names } = world(on)
  names.text = 'Bashの実行環境がないため、pwdを実際に実行することはできません。ターミナルで `pwd` と入力してください。'
  await start($)
  await say($, 'Bash で pwd を実行して')
  await clock.settle()
  expect(await captions($)).toEqual(['Bash で pwd を実行して'])

  // 短くても，句点で終わる返事は捨てる．
  names.text = '実行しました。'
  await say($, 'ls を実行して')
  await clock.settle()
  expect(await captions($)).toEqual(['ls を実行して'])

  // 句点で終わらなくても，幅が半角24字を超える返事は捨てる．ちょうど24字なら一言にする．
  names.text = '設計文書と実装の照合の確認'
  await say($, 'もう一度')
  await clock.settle()
  expect(await captions($)).toEqual(['もう一度'])

  names.text = '設計文書と実装の照合確認'
  await say($, 'さらにもう一度')
  await clock.settle()
  expect(await captions($)).toEqual(['設計文書と実装の照合確認'])
})

test('絵は演者の数によらず同じ大きさで，入力欄の上のパネルでは一段小さい', ONE, async ($, on) => {
  world(on)
  await start($)
  const widths = async (placement: 'dock' | 'inline') => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement }, surface: 'vscode' })
    const drawn = await ui.findAll({ type: 'Svg' })
    await ui.unmount()

    return drawn.map(svg => svg.props.width)
  }
  expect(await widths('dock')).toEqual([256])
  expect(await widths('inline')).toEqual([192])

  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  expect(await widths('dock')).toEqual([256, 256])
  expect(await widths('inline')).toEqual([192, 192])
})

test('演者を，パネルの幅に入るだけ横に並べて折り返す', ONE, async ($, on) => {
  world(on)
  await start($)
  for (const id of ['a1', 'a2', 'a3', 'a4']) {
    await $.classic.SubagentStart({ agent_id: id, agent_type: 'Explore' })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const page = await ui.drawn()
  await ui.unmount()
  expect(page).toMatchObject({ type: 'Box', props: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' } })
  expect('children' in page ? [page.children].flat().length : 0).toBe(5)
})

test('許可待ちの間は呼び，ツールが終わると元の役割へ戻る', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect((await actors($))[0]?.alt).toBe('本体：呼ぶ')

  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
  })
  expect((await actors($))[0]?.alt).toBe('本体：実行する')
})

test('許可待ちの呼び出しが並ぶと，片方が終わっても演者は呼び続ける', ONE, async ($, on) => {
  world(on)
  await start($)
  const done = (id: string) =>
    $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: id })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })

  await done('t1')
  expect((await actors($))[0]?.alt).toBe('本体：呼ぶ')
  await done('t2')
  expect((await actors($))[0]?.alt).toBe('本体：実行する')
})

test('許可を待つ分身は，本体の次へ寄る', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'Explore' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a2' })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：考える', '分身：実行する'])

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'a2' })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：呼ぶ', '分身：考える'])

  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
    agent_id: 'a2',
  })
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える', '分身：考える', '分身：実行する'])
})

test('本体の眠気は窓の大きさによらずトークン数で決まり，圧縮で減れば目覚める', ONE, async ($, on) => {
  // 100万の窓の25%でも，眠気は最も深い．
  const { usage } = world(on, { tokens: 250_000 })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect((await actors($))[0]?.source).toContain('main-research-3.svg')

  usage.tokens = 20_000
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: '' })
  expect((await actors($))[0]?.source).toContain('main-research-0.svg')
})

test('キャラクターのコマンドは，パネルが置かれなかったら，その理由を伝える', ONE, async ($, on) => {
  const { pane } = world(on)
  await start($)
  expect(await open($)).toBe('キツネのパネルを開いた．')

  pane.reason = 'no-surface: no surface is attached ($.session.surfaces() is empty)'
  expect(await open($)).toBe(`キツネのパネルを開いたが，画面に置かれていない：${pane.reason}`)
})

test('キャラクターがいなければ，何も映さず，パネルも開かず，一言も頼まない', async ($, on) => {
  const { clock, names, pane } = world(on)
  await start($)
  await say($, 'README を直して')
  await clock.settle()
  expect(await actors($)).toEqual([])
  expect(pane.titles).toEqual([])
  expect(names.calls).toBe(0)
})

test('キャラクターが加わると，その題でパネルを開く', ONE, async ($, on) => {
  const { pane } = world(on)
  await start($)
  expect(pane.titles).toContain('キツネ')
  expect(new Set(pane.titles).size).toBe(1)
  expect((await actors($)).map(actor => actor.alt)).toEqual(['本体：考える'])
})

test('映すのは最初に加わったキャラクターで，コマンドで選ぶと替わり，次のセッションにも残る', TWO, async ($, on) => {
  const { pane } = world(on)
  await start($)
  expect((await actors($))[0]?.source).toContain('fox/sprites/main-think-0.svg')

  expect(await open($, 'kit')).toBe('キットのパネルを開いた．')
  expect(pane.titles.at(-1)).toBe('キット')
  expect((await actors($))[0]?.source).toContain('kit/sprites/main-think.svg')

  // 次のセッションでも，選んだキャラクターを映す．
  await start($)
  expect(pane.titles.at(-1)).toBe('キット')
  expect((await actors($))[0]?.source).toContain('kit/sprites/main-think.svg')
})

test('持っていない絵は，本体の絵・眠気なしの絵・「考える」の絵で代える', TWO, async ($, on) => {
  world(on, { tokens: 250_000 })
  await start($)
  await open($, 'kit')
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })

  const drawn = await actors($)
  expect(drawn.map(actor => actor.alt)).toEqual(['本体：調べる', '分身：調べる'])
  expect(drawn.every(actor => actor.source.includes('kit/sprites/main-think.svg'))).toBe(true)
  // 位相は，キャラクターの刻み（8刻み）のどこかへ，個体ごとにずらす．
  expect(drawn[1]?.source).toMatch(/animation-delay:-0(\.[1-7])?s/)
})

test('絵の候補は，望ましい順に並ぶ', () => {
  const sub = { ...cast.EMPTY.actors[0]!, id: 'a1', role: 'run' as const }
  const all = { actors: [{ ...cast.EMPTY.actors[0]!, role: 'run' as const }, sub], sleepiness: 2 }
  expect(cast.spritesOf(all, all.actors[0]!)).toEqual([
    'main-run-2',
    'main-run-0',
    'main-run',
    'main-think-2',
    'main-think-0',
    'main-think',
  ])
  expect(cast.spritesOf(all, sub)).toEqual([
    'sub-run',
    'main-run-0',
    'main-run',
    'sub-think',
    'main-think-0',
    'main-think',
  ])
})

test('端末では，役割を文字で並べる', ONE, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('本体：書く')
  await ui.unmount()
})

test('絵の下の一言は，幅に収まらなければ切る（全角は2字ぶん）', () => {
  expect(cast.brief('abcdef', 6)).toBe('abcdef')
  expect(cast.brief('abcdefg', 6)).toBe('abcde…')
  expect(cast.brief('設計文書と実装の照合', 10)).toBe('設計文書…')
})

test('眠気の段階の境目', () => {
  expect(
    [undefined, 99_999, 100_000, 149_999, 150_000, 199_999, 200_000, 900_000].map(
      cast.sleepinessOf,
    ),
  ).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
})
