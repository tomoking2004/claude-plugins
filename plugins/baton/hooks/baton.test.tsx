import type { ModelUsage, On, SessionMessage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/work/project'
const KEY = `handoff:${ROOT}`
const HANDOFF = 'docs/plan.md を読み，続きから進める．'
const ADVICE = '手順の決まった作業なので，軽いモデルと低いエフォートで足りる．'
const MOVE = `移る：${ADVICE}\n${HANDOFF}`
const STAY = '続ける：残りは誤字の直し1件で，この会話のまま済ませるほうが安い．'
const FRESH = '始める：頼まれた直しは済んで確かめ終えており，次へ運ぶものが無い．'

const ENGINE = 'engine'
const BAND = {
  plugin: 'baton',
  surface: 'vscode',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

/** 入力欄の上の帯の文．出ていなければ undefined． */
const bandOf = async ($: Engine): Promise<string | undefined> => {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()

  return text === ENGINE ? undefined : text
}

/** 帯の「閉じる」を押す． */
const close = async ($: Engine): Promise<void> => {
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'close' })
  await ui.unmount()
}

/** エンジンの代わり：コンテキストの量・会話の記録・分岐の答え・クリップボード・入力欄・帯に答える． */
const world = (on: On) => {
  const seen = {
    tokens: 10_000 as number | undefined,
    session: 'old',
    messages: [] as SessionMessage[],
    fork: { isAnswered: true, text: MOVE },
    forked: [] as string[],
    // 分岐が答える前に，検査が挟む仕事．
    during: undefined as (() => Promise<void>) | undefined,
    copied: [] as string[],
    filled: [] as string[],
    draft: '',
    // 入力欄が文を受けるか．受けないときの理由（`no_composer` など）は，フックからは返せない（エンジンが外す）．
    box: 'ready' as 'ready' | 'busy',
    store: new Map<string, unknown>(),
  }
  const clock = mock.clock(on, { now: 100_000 })
  on('store.get', (_, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_, e) => {
    seen.store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    seen.store.delete(e.key)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'baton' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: seen.session }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, tokens: seen.tokens }, rateLimits: [] },
  }))
  on('session.messages', () => ({ value: seen.messages }))
  on('model.fork', async (_, e) => {
    seen.forked.push(e.prompt)
    await seen.during?.()

    return {
      value: seen.fork.isAnswered
        ? { isAnswered: true, text: seen.fork.text, usage: {} as ModelUsage }
        : { isAnswered: false, reason: 'nothing-to-fork' },
    }
  })
  on('ui.copy', (_, e) => {
    seen.copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('prompt.read', () => ({ value: { text: seen.draft, cursor: seen.draft.length } }))
  on('prompt.fill', (_, e) => {
    if (seen.box === 'busy') return { isFilled: false }
    seen.filled.push(e.text)
    seen.draft = e.text

    return { isFilled: true }
  })
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('classic.SessionStart', () => ({}))
  // 帯に何も出さないときにエンジンが描くもの．
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{ENGINE}</Text>
  })

  return Object.assign(seen, { clock })
}

const STOP = { stop_hook_active: false }
const BATON = {
  command: 'baton',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('量に達した返答の区切りで1回だけ勧め，量に達する前は勧めない', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.Stop(STOP)
  expect(await bandOf($)).toBeUndefined()

  seen.tokens = 160_000
  await $.classic.Stop(STOP)
  const shown = await bandOf($)
  expect(shown).toContain('約16万トークン')
  expect(shown).toContain('/baton')

  // 次の区切りでも残り，閉じれば戻らない．
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toBe(shown)
  await close($)
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toBeUndefined()
})

// 窓を開き直すと `$.state` は空になり，store の記録だけが残る．
test('窓を開き直して再開しても勧め直さず，閉じていない帯は出し続ける', async ($, on) => {
  const seen = world(on)
  seen.tokens = 170_000
  seen.store.set('kept', {
    old: { offers: { done: ['tokens'], isCompacted: false }, band: { cue: 'tokens', tokens: 150_000 }, at: 0 },
  })
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  expect(await bandOf($)).toContain('約15万トークン')
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toContain('約15万トークン')

  // 閉じたことも残り，もう一度開き直しても出ない．
  await close($)
  const kept = seen.store.get('kept') as { old: { band: unknown } }
  expect(kept.old.band).toBeNull()
})

test('残す記録は新しいものから20セッションまでにする', async ($, on) => {
  const seen = world(on)
  seen.tokens = 160_000
  const others = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`s${i}`, { offers: { done: [], isCompacted: false }, band: null, at: i }]),
  )
  seen.store.set('kept', others)
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.Stop(STOP)
  const kept = seen.store.get('kept') as Record<string, unknown>
  expect(Object.keys(kept).length).toBe(20)
  expect('old' in kept).toBe(true)
  expect('s0' in kept).toBe(false)
  expect('s19' in kept).toBe(true)
})

test('/baton を走らせると勧めの帯を下ろし，答えが出るまでの間だけ，走っていることを帯に出す', async ($, on) => {
  const seen = world(on)
  seen.tokens = 160_000
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.Stop(STOP)
  expect(await bandOf($)).toContain('/baton')
  const shown: (string | undefined)[] = []
  seen.during = async () => void shown.push(await bandOf($))
  await $.command.run(BATON)
  expect(shown).toEqual(['/baton が会話を読んでいる．'])
  expect(await bandOf($)).toBeUndefined()
})

test('他の Stop フックが続けさせる回・裏の仕事が動く間・分身の Stop では勧めない', async ($, on) => {
  const seen = world(on)
  seen.tokens = 160_000
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.Stop({ stop_hook_active: true })
  await $.classic.Stop({
    ...STOP,
    background_tasks: [{ id: 't1', type: 'local_bash', status: 'running', description: 'build' }],
  } as never)
  await $.classic.Stop({ ...STOP, agent_id: 'a1' } as never)
  expect(await bandOf($)).toBeUndefined()

  await $.classic.Stop(STOP)
  expect(await bandOf($)).toContain('/baton')
})

test('自動の要約のあとの区切りで勧め，人が選んだ要約のあとは勧めない', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.PostCompact({ trigger: 'manual', compact_summary: '' })
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toBeUndefined()

  await $.classic.PostCompact({ trigger: 'auto', compact_summary: '' })
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toContain('自動で要約')
  await close($)
  await $.classic.Stop(STOP)
  expect(await bandOf($)).toBeUndefined()
})

test('/baton が引き継ぎ文を書き，写して残し，書き換えたファイルを分岐に渡す', async ($, on) => {
  const seen = world(on)
  seen.messages = [
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'u1', tool: 'Edit', input: { file_path: '/work/project/a.ts' } },
        { tool_use_id: 'u2', tool: 'Read', input: { file_path: '/work/project/b.ts' } },
        { tool_use_id: 'u3', tool: 'Write', input: { file_path: '/work/project/c.md' } },
        { tool_use_id: 'u4', tool: 'Edit', input: { file_path: '/work/project/a.ts' } },
      ],
    },
  ]
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  const out = await $.command.run(BATON)
  expect(seen.forked.length).toBe(1)
  expect(seen.forked[0]).toContain('- /work/project/c.md\n- /work/project/a.ts')
  expect(seen.forked[0]).not.toContain('b.ts')
  // 勧めは人に見せるだけで，引き継ぎ文には入れない．
  expect(seen.copied).toEqual([HANDOFF])
  expect(out.text).toContain(`次のセッションへの勧め：${ADVICE}`)
  expect(out.text).toContain('/model')
  expect(out.text).toContain('以後のセッションの既定')
  expect(out.text).toContain('クリップボードに写した')
  expect(seen.store.get(KEY)).toEqual({ text: HANDOFF, from: 'old', at: 100_000 })
})

test('残りがわずかなら続けることを勧めて書かず，もう一度求められたら書く', async ($, on) => {
  const seen = world(on)
  seen.fork.text = STAY
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  const out = await $.command.run(BATON)
  expect(seen.forked[0]).toContain('続ける：')
  expect(out.text).toContain(STAY)
  expect(out.text).toContain('もう一度 /baton')
  expect(seen.copied).toEqual([])
  expect(seen.store.has(KEY)).toBe(false)

  // 2回目は見立てを求めず，続けると答えても引き継ぎ文として扱う．3回目はまた見立てる．
  await $.command.run(BATON)
  expect(seen.forked[1]).not.toContain('続ける：')
  expect(seen.copied).toEqual([STAY])
  await $.command.run(BATON)
  expect(seen.forked[2]).toContain('続ける：')
})

test('続けることを勧めたあとで人が別の文を送ったら，次はまた見立てる', async ($, on) => {
  const seen = world(on)
  seen.fork.text = STAY
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  // 知らせとスラッシュコマンドの入力では，もう一度求めたことを消さない．
  await $.command.run(BATON)
  await $.prompt.submit({ text: '終わった', wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  await $.prompt.submit({
    text: '/baton',
    wait: false,
    command: { name: 'baton', args: '' },
    origin: { kind: 'composer' },
  })
  await $.command.run(BATON)
  expect(seen.forked[1]).not.toContain('続ける：')

  await $.command.run(BATON)
  await $.prompt.submit({ text: '誤字を直して', wait: false, origin: { kind: 'composer' } })
  await $.command.run(BATON)
  expect(seen.forked[3]).toContain('続ける：')
  expect(seen.copied).toEqual([STAY])
})

test('運ぶものが無ければ何も渡さずに始めることを勧めて書かず，もう一度求められたら書く', async ($, on) => {
  const seen = world(on)
  seen.fork.text = FRESH
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  const out = await $.command.run(BATON)
  expect(seen.forked[0]).toContain('始める：')
  expect(out.text).toContain(FRESH)
  expect(out.text).toContain('何も渡さずに始めればよい')
  expect(seen.copied).toEqual([])
  expect(seen.store.has(KEY)).toBe(false)

  await $.command.run(BATON)
  expect(seen.forked[1]).not.toContain('始める：')
  expect(seen.copied).toEqual([FRESH])
})

test('分岐への依頼は，原文の引用を短さより優先させ，確かめていないことが無ければ無いと書かせ，エフォートに既定のままを許す', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.command.run(BATON)
  expect(seen.forked[0]).toContain('短さより原文を優先する')
  expect(seen.forked[0]).toContain('確かめていないことが無ければ，無いと書く')
  expect(seen.forked[0]).toContain('「既定のまま」')
})

test('見立ての行が無い答えは，全体を引き継ぎ文とする', async ($, on) => {
  const seen = world(on)
  seen.fork.text = HANDOFF
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  const out = await $.command.run(BATON)
  expect(seen.copied).toEqual([HANDOFF])
  expect(out.text).not.toContain('次のセッションへの勧め')
})

test('書けなければ理由を言い，前の引き継ぎ文を残す', async ($, on) => {
  const seen = world(on)
  seen.fork.isAnswered = false
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })
  seen.store.set(KEY, { text: 'まえの文', from: 'older', at: 0 })

  const out = await $.command.run(BATON)
  expect(out.text).toContain('書けなかった')
  expect(seen.copied).toEqual([])
  expect((seen.store.get(KEY) as { text: string }).text).toBe('まえの文')
})

test('同じプロジェクトの新しいセッションで1回だけ入力欄に入れ，最初の文で消す', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  expect(seen.filled).toEqual(['ひきつぎ'])

  // 知らせ（人が打った文でない）では消さず，人の最初の文で消す．
  await $.prompt.submit({ text: '終わった', wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  expect(seen.store.has(KEY)).toBe(true)
  await $.prompt.submit({ text: 'ひきつぎ', wait: false, origin: { kind: 'composer' } })
  expect(seen.store.has(KEY)).toBe(false)
})

test('書いたセッション自身と，再開したセッションには入れない', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  seen.session = 'new'
  await $.classic.SessionStart({ source: 'resume' })
  expect(seen.filled).toEqual([])
})

test('入力欄が用意されるまで，間を置いて試し直す', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.box = 'busy'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'clear' })
  expect(seen.filled).toEqual([])

  seen.box = 'ready'
  await seen.clock.advance(1_000)
  expect(seen.filled).toEqual(['ひきつぎ'])
})

// 実機の VS Code では，画面がつながる前は入力欄が無いとして（`no_composer`）断られる．その理由はフックからは
// 返せない（エンジンが外す）ので，ここでは試し直しが尽きるまで入らない入力欄で代える．
test('入れられないまま画面がつながったら，そのとき入れる', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.box = 'busy'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  await seen.clock.advance(10_000)
  expect(seen.filled).toEqual([])

  seen.box = 'ready'
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  expect(seen.filled).toEqual(['ひきつぎ'])

  // 入れたあとに別の画面がつながっても，二度は入れない．
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' })
  expect(seen.filled).toEqual(['ひきつぎ'])
})

test('試し直しを待つ間に画面がつながって入れたら，試し直しをやめる', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.box = 'busy'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  seen.box = 'ready'
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  expect(seen.filled).toEqual(['ひきつぎ'])

  // 人が下書きを消したあとで別の画面がつながっても，入れ直さない．
  await seen.clock.advance(10_000)
  seen.draft = ''
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' })
  expect(seen.filled).toEqual(['ひきつぎ'])
})

test('再開したセッションでは，画面がつながっても入れない', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'resume' })
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  expect(seen.filled).toEqual([])
})

test('人が打ちかけた下書きは上書きせず，空になってから入れる', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.draft = '打ちかけ'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'clear' })
  expect(seen.filled).toEqual([])

  seen.draft = ''
  await seen.clock.advance(1_000)
  expect(seen.filled).toEqual(['ひきつぎ'])
})

test('人が文を送ったら，あとで画面がつながっても入れない', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.draft = '打ちかけ'
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  await $.prompt.submit({ text: '打ちかけ', wait: false, origin: { kind: 'composer' } })
  seen.draft = ''
  await seen.clock.advance(10_000)
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' })
  expect(seen.filled).toEqual([])
})

test('入力欄にもう引き継ぎ文があれば入ったものとし，送ったら消す', async ($, on) => {
  const seen = world(on)
  seen.store.set(KEY, { text: 'ひきつぎ', from: 'old', at: 0 })
  seen.session = 'new'
  seen.draft = 'ひきつぎ' // 答えが無いまま届いていたか，画面が前の下書きを引き継いだ
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })

  await $.classic.SessionStart({ source: 'startup' })
  await seen.clock.advance(10_000)
  expect(seen.filled).toEqual([])

  await $.prompt.submit({ text: 'ひきつぎ', wait: false, origin: { kind: 'composer' } })
  expect(seen.store.has(KEY)).toBe(false)
})
