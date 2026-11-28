import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

const LIMIT = 4000

/** 字数．mod と同じく，サロゲートペアを1字に数える． */
const size = (text: string): number => [...text].length

/**
 * 区切りを `/` にそろえ，ドライブと末尾の区切りを除く．エンジンは `$.fs` へのパスを手元の絶対パスに
 * 直して渡す（Windows では `/work` が `C:\work` になる）ので，ドライブを除いて照らす．
 */
const plain = (path: string): string =>
  path
    .replaceAll('\\', '/')
    .replace(/^[A-Za-z]:/, '')
    .replace(/(?<=.)\/$/, '')

/**
 * エンジンの代わり：`files` だけがあるファイルシステムで，`cwd` で動くセッション．
 * `dirs` は，ファイルを持たずに在るディレクトリ（`.git` など）．
 */
const world = (on: On, cwd: string, files: Record<string, string>, dirs: readonly string[] = []): void => {
  const paths = Object.keys(files).map(plain)
  const folders = new Set([
    ...dirs.map(plain),
    ...paths.flatMap(path => path.split('/').slice(1, -1).map((_, i, all) => `/${all.slice(0, i + 1).join('/')}`)),
  ])
  const text = (path: string): string | undefined =>
    Object.entries(files).find(([name]) => plain(name) === plain(path))?.[1]

  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_, e) => ({ value: text(e.path) !== undefined || folders.has(plain(e.path)) }))
  on('fs.read', (_, e) => {
    const found = text(e.path)
    if (found === undefined) throw new Error(`fs.read failed: ENOENT`)

    return { value: found }
  })
  on('fs.list', (_, e) => {
    const at = plain(e.path)
    if (!folders.has(at)) throw new Error(`fs.list failed: ENOENT`)
    const below = [...paths, ...folders].filter(path => path.startsWith(`${at}/`) && !path.slice(at.length + 1).includes('/'))

    return {
      value: below.map(path => ({
        name: path.slice(at.length + 1),
        kind: folders.has(path) ? ('dir' as const) : ('file' as const),
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
}

/** 会話の始まりの文脈を作らせ，ledger の塊を返す（無ければ undefined）． */
const brief = async ($: Engine): Promise<string | undefined> =>
  (await $.prompt.context({ blocks: [{ name: 'currentDate', text: '今日' }] })).blocks.find(one => one.name === 'ledger')
    ?.text

const GENERAL = '## 応答の言語\n\nAPI の応答は日本語で返す．\n\n出所：利用者の発言（YYYY-MM-DD）\n'
const API = '## 呼び出しの上限\n\n外部 API は1分に60回で止まる．\n\n出所：`api/client.py` を確かめた（YYYY-MM-DD）\n'

test('.ledger/ が無ければ，塊を足さず，ほかの塊をそのまま通す', async ($, on) => {
  world(on, '/work/app', { '/work/app/main.py': '' }, ['/work/app/.git'])

  const blocks = (await $.prompt.context({ blocks: [{ name: 'currentDate', text: '今日' }] })).blocks
  expect(blocks).toEqual([{ name: 'currentDate', text: '今日' }])
})

test('general.md は全文を，主題のファイルは題と字数を渡す', async ($, on) => {
  world(
    on,
    '/work/app',
    { '/work/app/.ledger/general.md': GENERAL, '/work/app/.ledger/api.md': API },
    ['/work/app/.git'],
  )

  const text = await brief($)
  expect(text).toContain('どの仕事にも効く項（general.md）：\n## 応答の言語\n\nAPI の応答は日本語で返す．')
  expect(text).toContain(`- api.md（${size(API)}字）：呼び出しの上限`)
  expect(text).not.toContain('1分に60回')
  expect(text).toContain('/ledger:update-ledger')
})

test('general.md を先に，主題のファイルを名前の順に並べ，名前の似たファイルは主題として扱う', async ($, on) => {
  world(
    on,
    '/work/app',
    {
      '/work/app/.ledger/evaluation.md': '## 比べる指標\n\n手法は精度でなく再現率で比べる．\n\n出所：利用者の発言（YYYY-MM-DD）\n',
      '/work/app/.ledger/my-general.md': '## 似た名前\n\n主題のファイル．\n',
      '/work/app/.ledger/general.md': GENERAL,
      '/work/app/.ledger/api.md': API,
    },
    ['/work/app/.git'],
  )

  const text = (await brief($)) ?? ''
  const order = ['API の応答は日本語で返す．', '- api.md（', '- evaluation.md（', '- my-general.md（'].map(one => text.indexOf(one))
  expect(order.every(at => at >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  expect(text).not.toContain('主題のファイル．')
  expect(text).not.toContain('再現率で比べる')
})

test('local/ 以外の下のフォルダと，.md でないファイルは渡さない', async ($, on) => {
  world(
    on,
    '/work/app',
    {
      '/work/app/.ledger/general.md': GENERAL,
      '/work/app/.ledger/archive/old.md': '## 古い項\n\n片づけた項．\n',
      '/work/app/.ledger/.gitignore': 'local/\n',
    },
    ['/work/app/.git'],
  )

  const text = await brief($)
  expect(text).toContain('API の応答は日本語で返す．')
  expect(text).not.toContain('old.md')
  expect(text).not.toContain('古い項')
  expect(text).not.toContain('.gitignore')
})

test('作業ディレクトリから git の根まで上へたどり，根より上の記録は使わない', async ($, on) => {
  world(on, '/work/app/src/lib', { '/work/app/.ledger/general.md': GENERAL, '/work/.ledger/general.md': '## 上の階\n\n別の記録．\n' }, [
    '/work/app/.git',
  ])

  const text = await brief($)
  expect(text).toContain('/work/app/.ledger')
  expect(text).toContain('API の応答は日本語で返す．')
  expect(text).not.toContain('別の記録')
})

test('git の外では，上の階の記録を使わない', async ($, on) => {
  world(on, '/home/notes/sub', { '/home/notes/.ledger/general.md': GENERAL })

  expect(await brief($)).toBeUndefined()
})

test('git の外でも，作業ディレクトリの記録は使う', async ($, on) => {
  world(on, '/home/notes', { '/home/notes/.ledger/general.md': GENERAL })

  expect(await brief($)).toContain('API の応答は日本語で返す．')
})

test('Windows のパスでも上へたどる', async ($, on) => {
  world(on, 'C:\\work\\app\\src', { 'C:\\work\\app\\.ledger\\general.md': GENERAL }, ['C:\\work\\app\\.git'])

  const text = await brief($)
  expect(text).toContain('C:\\work\\app\\.ledger')
  expect(text).toContain('API の応答は日本語で返す．')
})

test('local/ の記録は，私用と分かる印を付けて同じ形で渡す', async ($, on) => {
  world(
    on,
    '/work/app',
    {
      '/work/app/.ledger/general.md': GENERAL,
      '/work/app/.ledger/local/general.md': '## 手の空かない週\n\n今月の第3週は，利用者が私用で手が空かない．\n\n出所：利用者の発言（YYYY-MM-DD）\n',
      '/work/app/.ledger/local/draft.md': '## 草稿の公開\n\n第2章の草稿は，審査が済むまで外に出さない．\n\n出所：利用者の発言（YYYY-MM-DD）\n',
    },
    ['/work/app/.git'],
  )

  const text = (await brief($)) ?? ''
  const mark = text.indexOf('私用の記録')
  expect(mark).toBeGreaterThan(text.indexOf('API の応答は日本語で返す．'))
  expect(text.indexOf('今月の第3週は，利用者が私用で手が空かない．')).toBeGreaterThan(mark)
  expect(text).toContain('どの仕事にも効く項（local/general.md）：')
  expect(text).toContain('- local/draft.md（')
  expect(text).toContain('：草稿の公開')
  expect(text).not.toContain('審査が済むまで')
})

test('空のファイルしか無ければ，塊を足さない', async ($, on) => {
  world(on, '/work/app', { '/work/app/.ledger/general.md': '\n', '/work/app/.ledger/.gitignore': 'local/\n' }, ['/work/app/.git'])

  expect(await brief($)).toBeUndefined()
})

test('題の無いファイルは，名前と字数だけを並べる', async ($, on) => {
  const NOTE = 'まだ題の無いメモ．\n'
  world(on, '/work/app', { '/work/app/.ledger/general.md': GENERAL, '/work/app/.ledger/notes.md': NOTE }, ['/work/app/.git'])

  const text = (await brief($)) ?? ''
  expect(text).toMatch(new RegExp(`^- notes\\.md（${size(NOTE)}字）$`, 'm'))
  expect(text).not.toContain('まだ題の無いメモ')
})

test('全体が上限を超えるなら，general.md も題だけにして全体の字数を告げ，開かせ，整理を勧め，上限を守る', async ($, on) => {
  // general.md 単体は上限に収まり，決まりの要約と合わせると超える大きさにする．
  const many = Array.from({ length: 40 }, (_, i) => `## 項${i}\n\n${'長い文面．'.repeat(9)}\n\n出所：利用者の発言（YYYY-MM-DD）\n`).join('\n')
  const own = '## 私用の項\n\n私用の文面．\n\n出所：利用者の発言（YYYY-MM-DD）\n'
  world(
    on,
    '/work/app',
    { '/work/app/.ledger/general.md': many, '/work/app/.ledger/api.md': API, '/work/app/.ledger/local/general.md': own },
    ['/work/app/.git'],
  )

  const text = (await brief($)) ?? ''
  expect(size(many)).toBeLessThan(LIMIT)
  expect(size(text)).toBeLessThanOrEqual(LIMIT)
  expect(text).toContain('/ledger:tidy-ledger')
  expect(text).not.toContain('長い文面')
  expect(text).not.toContain('私用の文面')
  expect(text).toContain('- general.md（')
  expect(text).toContain('：項0／項1')
  expect(text).toContain('general.md・local/general.md も題だけを渡す')
  expect(text).toContain('どの仕事の前にも general.md・local/general.md を開く')
  expect(text).toContain('上限（4,000字）')
  const total = Number(/全体で ([\d,]+)字になり/.exec(text)?.[1]?.replaceAll(',', ''))
  expect(total).toBeGreaterThan(LIMIT)
  expect(total).toBeGreaterThan(size(many) + size(API))
})

test('ファイルが多すぎて題でも超えるなら，名前と字数に落とし，それでも超える分は数だけを書き，無い general.md には触れない', async ($, on) => {
  const files = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      `/work/app/.ledger/topic-${String(i).padStart(3, '0')}.md`,
      `## ${'長い題'.repeat(10)}${i}\n\n文面．\n`,
    ]),
  )
  world(on, '/work/app', files, ['/work/app/.git'])

  const text = (await brief($)) ?? ''
  expect(size(text)).toBeLessThanOrEqual(LIMIT)
  expect(text).not.toContain('長い題')
  expect(text).toContain('- topic-000.md（')
  expect(text).toMatch(/- ほか\d+ファイル/)
  expect(text).toContain('/ledger:tidy-ledger')
  expect(text).toContain('ファイルの名前と字数だけを渡す')
  expect(text).toContain('ファイルの一覧（')
  expect(text).not.toContain('題だけを渡す')
  expect(text).not.toContain('題の一覧')
  expect(text).not.toContain('全文で載せると')
  expect(text).not.toContain('どの仕事の前にも')
  expect(text).toMatch(/全体で [\d,]+字になり/)
})
