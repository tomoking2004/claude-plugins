import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

const SOLO = 40
const MANY = 8

/** エンジンの代わり：どのツールも空の結果で答え，送られた文をそのまま通す． */
const world = (on: On): void => {
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
}

/** 読みのツールを1回使い，結果に添えられた知らせを返す．`agentId` を渡すと，そのエージェントの呼び出しになる． */
const read = async ($: Engine, agentId?: string): Promise<readonly string[] | undefined> =>
  (await $.tool.call({ tool: 'Read', file_path: '/a', agentId })).context

/** 数えるツールの種類の数（下の look が1回ずつ使う）． */
const KINDS = 7

/** 主の文脈が読み・調べとコマンドの七つのツールを1回ずつ使い，結果に添えられた知らせを集めて返す． */
const look = async ($: Engine): Promise<(readonly string[])[]> => {
  const ran = [
    await $.tool.call({ tool: 'Read', file_path: '/a' }),
    await $.tool.call({ tool: 'Grep', pattern: 'x' }),
    await $.tool.call({ tool: 'Glob', pattern: '*.md' }),
    await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: '要点' }),
    await $.tool.call({ tool: 'WebSearch', query: 'x' }),
    await $.tool.call({ tool: 'Bash', command: 'cat a.py' }),
    await $.tool.call({ tool: 'PowerShell', command: 'Get-Content a.py' }),
  ]

  return ran.flatMap(one => (one.context === undefined ? [] : [one.context]))
}

/** 主の文脈がエージェントを1体起こし，結果に添えられた知らせを返す． */
const spawn = async ($: Engine): Promise<readonly string[] | undefined> =>
  (await $.tool.call({ tool: 'Agent', description: 'リンクの確認', prompt: '…', subagent_type: 'general-purpose' }))
    .context

/** 人が新しい依頼を送る． */
const ask = ($: Engine): Promise<unknown> =>
  $.prompt.submit({ text: '次の依頼', wait: false, origin: { kind: 'composer' } })

test('独りで読み・調べを続けると，決めた回数で1回だけ知らせる', async ($, on) => {
  world(on)

  for (let i = 1; i < SOLO; i++) expect(await read($)).toBeUndefined()

  const note = await read($)
  expect(note).toHaveLength(1)
  expect(note?.[0]).toContain(`を${SOLO}回`)
  expect(note?.[0]).toContain('/crew:divide-work')

  for (let i = 0; i < SOLO; i++) expect(await read($)).toBeUndefined()
})

test('読み・調べとコマンドのツールは，どれも同じ一つの数に数える', async ($, on) => {
  world(on)

  const rounds = Math.floor((SOLO - 1) / KINDS)
  for (let i = 0; i < rounds; i++) expect(await look($)).toEqual([])
  for (let i = rounds * KINDS + 1; i < SOLO; i++) expect(await read($)).toBeUndefined()
  expect(await read($)).toHaveLength(1)
})

test('書くツールは数えない', async ($, on) => {
  world(on)

  for (let i = 0; i < SOLO * 2; i++) {
    const edited = await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'x', new_string: 'y' })
    const written = await $.tool.call({ tool: 'Write', file_path: '/b', content: 'x' })
    expect([edited.context, written.context]).toEqual([undefined, undefined])
  }

  for (let i = 1; i < SOLO; i++) expect(await read($)).toBeUndefined()
  expect(await read($)).toHaveLength(1)
})

test('エージェントに任せていれば，独りの知らせは出さない', async ($, on) => {
  world(on)

  expect(await spawn($)).toBeUndefined()
  for (let i = 0; i < SOLO * 2; i++) expect(await read($)).toBeUndefined()
})

test('エージェント自身の呼び出しは数えない', async ($, on) => {
  world(on)

  for (let i = 0; i < SOLO * 2; i++) expect(await read($, 'a1')).toBeUndefined()
  for (let i = 1; i < SOLO; i++) expect(await read($)).toBeUndefined()
  expect(await read($)).toHaveLength(1)
})

test('断られた呼び出しは数えない', async ($, on) => {
  let isDenied = true
  on('tool.call', () => (isDenied ? { deny: '許可されていない' } : { result: {} }))

  for (let i = 0; i < SOLO * 2; i++) await read($)
  isDenied = false
  for (let i = 1; i < SOLO; i++) expect(await read($)).toBeUndefined()
  expect(await read($)).toHaveLength(1)
})

test('人が新しい依頼を送ると数え直し，知らせや伝言では数え直さない', async ($, on) => {
  world(on)

  for (let i = 1; i < SOLO; i++) await read($)
  await ask($)
  for (let i = 1; i < SOLO; i++) expect(await read($)).toBeUndefined()

  await $.prompt.submit({ text: '終わった', wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  expect(await read($)).toHaveLength(1)

  // 知らせは依頼ごとに1回なので，次の依頼ではまた届く．
  await ask($)
  for (let i = 1; i < SOLO; i++) await read($)
  expect(await read($)).toHaveLength(1)
})

test('エージェントを多く起こすと，決めた数で1回だけ注意を促し，利用者への問いは求めない', async ($, on) => {
  world(on)

  for (let i = 1; i < MANY; i++) expect(await spawn($)).toBeUndefined()

  const note = await spawn($)
  expect(note).toHaveLength(1)
  expect(note?.[0]).toContain(`${MANY}体`)
  expect(note?.[0]).toContain('利用者には問わず')

  for (let i = 0; i < MANY; i++) expect(await spawn($)).toBeUndefined()
})

test('下の層が添えた知らせを残し，その後ろに足す', async ($, on) => {
  on('tool.call', () => ({ result: {}, context: ['下の層の知らせ'] }))

  for (let i = 1; i < SOLO; i++) expect(await read($)).toEqual(['下の層の知らせ'])

  const note = await read($)
  expect(note).toHaveLength(2)
  expect(note?.[0]).toBe('下の層の知らせ')
})
