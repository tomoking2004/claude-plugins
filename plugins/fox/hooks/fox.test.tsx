import type { AgentInfo, ModelUsage, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import * as den from './den'

const PANE = {
  plugin: 'fox',
  component: 'Pane',
  requestId: 'fox',
  props: {
    title: 'キツネ',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const COVERS = [['#964034'], ['#345b96']]
const SPRITE = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{stroke:#964034}.layer{animation-delay:0s}</style><title>${name}</title></svg>`

/** エンジンの代わり：プラグインが呼ぶ時計・パネル・ファイル・コンテキストの量・エージェントの一覧・小さなモデルに答える． */
const world = (on: On, usage = { tokens: 10_000 }) => {
  const clock = mock.clock(on, { now: 100_000 })
  on('command.register', () => ({ value: { command: 'fox' } }))
  const pane = { reason: '' } // 空なら置かれ，そうでなければ，その理由で置かれない
  on('ui.open', () => ({
    value: pane.reason === '' ? { isPlaced: true } : { isPlaced: false, reason: pane.reason },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  const agents: AgentInfo[] = []
  on('agent.list', () => ({ value: agents }))
  const names = { text: 'README の校正', isAnswered: true }
  on('model.complete', () => ({
    value: names.isAnswered
      ? { isAnswered: true, text: names.text, usage: {} as ModelUsage }
      : { isAnswered: false, reason: 'empty-reply', usage: {} as ModelUsage },
  }))
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
      ? JSON.stringify({ covers: COVERS })
      : SPRITE(e.path.split('/').pop() ?? ''),
  }))

  return { clock, usage, agents, names, pane }
}

/** パネルに並ぶキツネの，読み上げ用の文（本体か分身か：役割）と絵を返す． */
const foxes = async ($: Engine) => {
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

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

/** ユーザーが `/fox` を打ち，返ってきた文を返す． */
const open = async ($: Engine) => {
  const answer = await $.command.run({
    command: 'fox',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  return answer.text
}

test('本体は，最後に使ったツールの役割を次のツールまで続ける', async ($, on) => {
  const { clock } = world(on)
  await start($)
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える'])

  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：調べる'])

  await clock.advance(den.HOLD_MS)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((await foxes($))[0]?.alt).toBe('本体：実行する')
  expect((await foxes($))[0]?.source).toContain('main-run-0.svg')
})

test('切り替えてすぐの役割は，2秒経ってから替わる', async ($, on) => {
  const { clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  expect((await foxes($))[0]?.alt).toBe('本体：調べる')

  await clock.advance(den.HOLD_MS + 10)
  expect((await foxes($))[0]?.alt).toBe('本体：書く')
})

test('分身の絵は，個体ごとに位相と表紙の色が変わる', async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })

  const [main, sub] = await foxes($)
  expect(sub?.source).toContain('sub-research.svg')
  expect(sub?.source).not.toContain('animation-delay:0s')
  expect(main?.source).toContain('animation-delay:0s')
  // 表紙の色は，索引の2通りのうち，この分身の id が選ぶほうに替わる．本体は元の色のまま．
  expect(sub?.source).toContain('#345b96')
  expect(sub?.source).not.toContain('#964034')
  expect(main?.source).toContain('#964034')
})

test('分身は開始で列に加わり，終えても次の依頼まで列に残る', async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：調べる'])

  await $.classic.SubagentStop({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    agent_transcript_path: '/t',
    stop_hook_active: false,
  })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：眠る'])
  expect((await foxes($))[1]?.source).toContain('sub-rest.svg')

  // 知らせなどの機械が入れた番では外さず，ユーザーが次の依頼を送ったときに外す．
  await notify($, '知らせ')
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：眠る'])

  await say($, '次の依頼')
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える'])
})

test('絵の下の一言は，指示が届いたときだけ替わる', async ($, on) => {
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

test('返答を終えた本体は，働いている分身がいれば見守り，いなければ眠る', async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.classic.Stop({ stop_hook_active: false })
  expect((await foxes($))[0]?.alt).toBe('本体：見守る')

  await $.classic.SubagentStop({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    agent_transcript_path: '/t',
    stop_hook_active: false,
  })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：眠る', '分身：眠る'])

  await say($, 'again')
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える'])
})

test('モデルが答えなければ，依頼の文をそのまま一言にする', async ($, on) => {
  const { clock, names } = world(on)
  names.isAnswered = false
  await start($)
  await say($, '表を\n  足して')
  await clock.settle()
  expect(await captions($)).toEqual(['表を 足して'])
})

test('モデルが依頼そのものに答えたら，その返事は一言にせず，依頼の文を使う', async ($, on) => {
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

test('絵は匹数によらず同じ大きさで，入力欄の上のパネルでは一段小さい', async ($, on) => {
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

test('キツネを，パネルの幅に入るだけ横に並べて折り返す', async ($, on) => {
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

test('許可待ちの間は呼び，ツールが終わると元の役割へ戻る', async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect((await foxes($))[0]?.alt).toBe('本体：呼ぶ')

  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
  })
  expect((await foxes($))[0]?.alt).toBe('本体：実行する')
})

test('許可待ちの呼び出しが並ぶと，片方が終わってもキツネは呼び続ける', async ($, on) => {
  world(on)
  await start($)
  const done = (id: string) =>
    $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: id })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })

  await done('t1')
  expect((await foxes($))[0]?.alt).toBe('本体：呼ぶ')
  await done('t2')
  expect((await foxes($))[0]?.alt).toBe('本体：実行する')
})

test('許可を待つ分身は，本体の次へ寄る', async ($, on) => {
  world(on)
  await start($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'Explore' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a2' })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：考える', '分身：実行する'])

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'a2' })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：呼ぶ', '分身：考える'])

  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
    agent_id: 'a2',
  })
  expect((await foxes($)).map(fox => fox.alt)).toEqual(['本体：考える', '分身：考える', '分身：実行する'])
})

test('本体の眠気は窓の大きさによらずトークン数で決まり，圧縮で減れば目覚める', async ($, on) => {
  // 100万の窓の25%でも，眠気は最も深い．
  const { usage } = world(on, { tokens: 250_000 })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect((await foxes($))[0]?.source).toContain('main-research-3.svg')

  usage.tokens = 20_000
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: '' })
  expect((await foxes($))[0]?.source).toContain('main-research-0.svg')
})

test('/fox は，パネルが置かれなかったら，その理由を伝える', async ($, on) => {
  const { pane } = world(on)
  await start($)
  expect(await open($)).toBe('キツネのパネルを開いた．')

  pane.reason = 'no-surface: no surface is attached ($.session.surfaces() is empty)'
  expect(await open($)).toBe(`キツネのパネルを開いたが，画面に置かれていない：${pane.reason}`)
})

test('端末では，役割を文字で並べる', async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('本体：書く')
  await ui.unmount()
})

test('絵の下の一言は，幅に収まらなければ切る（全角は2字ぶん）', () => {
  expect(den.brief('abcdef', 6)).toBe('abcdef')
  expect(den.brief('abcdefg', 6)).toBe('abcde…')
  expect(den.brief('設計文書と実装の照合', 10)).toBe('設計文書…')
})

test('眠気の段階の境目', () => {
  expect(
    [undefined, 99_999, 100_000, 149_999, 150_000, 199_999, 200_000, 900_000].map(den.sleepinessOf),
  ).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
})
