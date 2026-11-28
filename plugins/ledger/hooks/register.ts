// プロジェクトの `.ledger/` にある記録のうち，会話の始まりに要る分だけをモデルへ渡す．
//
// 渡す文は，会話の最初のユーザー発言に付く文脈の塊として，CLAUDE.md と同じ場所に置かれる．
// エンジンはこの塊を会話ごとに1回作り，コンテキストの圧縮と /clear のあとに作り直すので，
// そのときの記録が渡る．会話の途中で書いた項は，書いた会話がすでに持っているので渡し直さない．
// 渡すのは，どの仕事にも効く項（general.md）の全文と，主題ごとのファイルの題と字数と，
// 書き込みの決まりの要約．決まりの全文は LEDGER.md が持ち，要約はそれと食い違わせない．
// `.ledger/` が無ければ何も足さない．書き込みは，承認を経てスキルがする．

import type { EngineInterface, Register } from 'claude-code'

/** 記録の置き場． */
const LEDGER = '.ledger'
/** 私用の記録の置き場（`.ledger/` の中）． */
const LOCAL = 'local'
/** 塊の名前．エンジンの知らない名前なので，会話に1部だけ載る． */
const BLOCK = 'ledger'
/** 渡す量の上限（字）．会話のたびに読む量を小さく保つ． */
const LIMIT = 4000
/** どの仕事にも効く項のファイル．全文を渡し，一覧の先頭に置く． */
const GENERAL = 'general.md'

/** 記録のファイル一つ．`name` は `.ledger/` からの相対パスで，`/` で区切る． */
type Doc = { name: string; text: string }

/** 渡す細かさ：general.md の全文を含めるか，題までか，ファイルの名前と字数だけか． */
type Depth = 'whole' | 'titles' | 'sizes'

/** 書き込みの決まりの要約．LEDGER.md の「受け持つもの」「置き分け」「項の書式」「書く条件」「案の示し方」「承認」と食い違わせない． */
const note = (guide: string): string =>
  [
    `書き込みの決まり（全文は ${guide}．書くときは /ledger:update-ledger に従う）：`,
    '- ledger はプロジェクトの中身（目的・仕様・設計の決定・仮説・評価の基準・外の制約・分かったこと・未決の問い）を持つ．作業の仕方（コマンド・書き方の約束・道具・作業フォルダの扱い・してはいけない操作）は CLAUDE.md の領分で，ledger に書かず，番号を振った案とは別に，置き先と文面を利用者に示す．',
    '- このプロジェクトの中身は，自動メモリへ書かず，ledger の案にする．',
    '- どの仕事にも効く項は general.md へ，特定の仕事にだけ効く項は <主題>.md へ書く．<主題>.md は，その仕事に触れる前に開く．',
    '- 書くのは，利用者が述べたか実物で確かめたことで，後の仕事を縛り，コード・差分・CLAUDE.md・自動メモリから読めないことだけ．一度きりの指示・作業の進み具合・利用者自身の好み・推し量ったこと・弱い項は書かない．',
    '- 記録に値することがあった返答では，末尾に番号を振った書き込みの案を添える．作業の途中では示さない．エージェントとして起こされた側は示さず，記録に値することを報告に書く．',
    '- 項は「## <題>」・1〜3文の文面・「出所：<出所>（YYYY-MM-DD）」の形で書く．出所は「利用者の発言」「`<パス>` を確かめた」「`<コマンド>` の出力を確かめた」のどれか．',
    '- 案ごとに，操作（足す・改める・消す・移す）・書き先・文面・出所・理由（一行）を並べる．改める・消す・移す案には，前の文面も並べる．示す前に，同じ事柄を持つ項を ledger・CLAUDE.md・自動メモリから検索し，既にあれば示さず，ledger の項と食い違えば改める案にする．利用者が取り消したことは，消す案にする．',
    '- 承認は，平文の案へのチャットの返信で受け，選択式の問いでは受けない．',
    '- 書くのは，利用者が番号か「全部」で認めた案だけで，示した文面のまま書く．答えの無い案と断られた案は，この会話で再び示さない．',
    '- 個人の事情は追跡される側へ書かず，このプロジェクトの後の仕事を縛るときだけ local/ へ書く．事情から決まった決定は，事情にも理由にも触れない文面で追跡される側へ書く．利用者が私用と言った事柄は，決定でも local/ へ書く．パスワード・鍵・トークンの値は，どこにも書かず，在処だけを書く．',
  ].join('\n')

/**
 * 上限を超えて，general.md の全文を渡せないときに添える文．`depth` は落とした先の細かさ，
 * `total` は general.md を全文で載せたときの渡す分の全体の量で，超えたのが一つのファイルでなく全体だと告げる．
 * `generals` は在る general.md の名前（`local/` のものも）で，題に落としたそれを，どの仕事の前にも開かせる．
 */
const over = (depth: Exclude<Depth, 'whole'>, total: number, generals: readonly string[]): string => {
  const named = generals.join('・')
  const whole = generals.length === 0 ? '' : `${named} を全文で載せると`
  const titled = `${generals.length === 0 ? '' : `${named} も`}題だけを渡す`
  const open = generals.length === 0 ? '' : `どの仕事の前にも ${named} を開く．`

  return (
    `会話の始まりに渡す分は，${whole}全体で ${total.toLocaleString('en-US')}字になり，` +
    `渡す量の上限（${LIMIT.toLocaleString('en-US')}字）を超えるので，` +
    `${depth === 'titles' ? titled : 'ファイルの名前と字数だけを渡す'}．` +
    `${open}/ledger:tidy-ledger での整理を，利用者に一度だけ勧める．`
  )
}

/** 字数．サロゲートペアを1字に数える． */
const size = (text: string): number => [...text].length

/** パスの区切り．与えられたパスの書き方に合わせる． */
const separator = (path: string): string => (path.includes('\\') ? '\\' : '/')

/** `dir` の下の `name` のパス．`dir` が区切りで終わるとき（`C:\` など）は区切りを重ねない． */
const join = (dir: string, name: string, sep: string): string =>
  dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`

/** `dir` とその上のディレクトリを，近い順に並べる（`C:\a\b` なら `C:\a\b`・`C:\a`・`C:\`）． */
const lineage = (dir: string, sep: string): string[] => {
  const lead = /^[\\/]+/.exec(dir)?.[0] ?? ''
  const parts = dir.split(/[\\/]/).filter(part => part !== '')
  const dirs = parts
    .map((_, i) => lead + parts.slice(0, parts.length - i).join(sep))
    .map(one => (/^[A-Za-z]:$/.test(one) ? `${one}${sep}` : one))

  return lead === '/' ? [...dirs, '/'] : dirs
}

/** 在るか．断られたときと読めない場所は，無いと見なす． */
const has = ($: EngineInterface, path: string): Promise<boolean> => $.fs.exists(path).catch(() => false)

/**
 * 使う `.ledger/` の在処を返す．作業ディレクトリから git の根まで上へたどり，最初に見つかったもの．
 * git の外では作業ディレクトリのものだけを使う——上の階にある別のプロジェクトの記録を取り違えない．
 */
const locate = async ($: EngineInterface, cwd: string): Promise<string | undefined> => {
  const sep = separator(cwd)
  const dirs = lineage(cwd, sep)
  let found: string | undefined

  for (const dir of dirs) {
    if (found === undefined && (await has($, join(dir, LEDGER, sep)))) found = join(dir, LEDGER, sep)
    if (await has($, join(dir, '.git', sep))) return found
  }

  return found === join(dirs[0] ?? cwd, LEDGER, sep) ? found : undefined
}

/**
 * `.ledger/`（`sub` を渡せばその下の区画）の記録を読む．記録はその階の `.md` だけから成り，
 * general.md を先に，主題のファイルを名前の順に並べる．下のフォルダと空のファイルは除く．
 */
const gather = async ($: EngineInterface, at: string, sep: string, sub?: string): Promise<Doc[]> => {
  const dir = sub === undefined ? at : join(at, sub, sep)
  const prefix = sub === undefined ? '' : `${sub}/`
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(one => one.kind === 'file' && one.name.endsWith('.md')).map(one => one.name)
  const names = [...files.filter(name => name === GENERAL), ...files.filter(name => name !== GENERAL).sort()]

  const docs = await Promise.all(
    names.map(async name => {
      const text = await $.fs.read(join(dir, name, sep)).catch(() => undefined)

      return text === undefined ? undefined : { name: `${prefix}${name}`, text: String(text) }
    }),
  )

  return docs.filter((doc): doc is Doc => doc !== undefined && doc.text.trim() !== '')
}

/** 項の題．`## ` で始まる行． */
const titles = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter(line => line.startsWith('## '))
    .map(line => line.slice(3).trim())

/** どの仕事にも効く項のファイルか（`local/` のものも）． */
const isGeneral = (doc: Doc): boolean => doc.name === GENERAL || doc.name === `${LOCAL}/${GENERAL}`

/** ファイル一つを一覧の一行にする．題の無いファイルは，名前と字数だけにする． */
const entry = (doc: Doc, depth: Depth): string => {
  const head = `- ${doc.name}（${size(doc.text)}字）`
  const found = titles(doc.text)
  if (depth === 'sizes' || found.length === 0) return head

  return `${head}：${found.join('／')}`
}

/**
 * 区画一つ分の段落．general.md を全文で載せるかは `depth` による．
 * 一覧に載せるのは先頭の `shown` ファイルまでで，残りは数だけを書く．
 */
const section = (docs: readonly Doc[], depth: Depth, shown: number): string[] => {
  const general = depth === 'whole' ? docs.find(isGeneral) : undefined
  const rest = docs.filter(doc => doc !== general)
  const lines = rest.slice(0, shown).map(doc => entry(doc, depth))
  const hidden = rest.length - lines.length
  const list = hidden > 0 ? [...lines, `- ほか${hidden}ファイル`] : lines
  const heading = depth === 'sizes' ? 'ファイルの一覧' : '題の一覧'

  return [
    ...(general === undefined ? [] : [`どの仕事にも効く項（${general.name}）：\n${general.text.trim()}`]),
    ...(list.length === 0 ? [] : [`${heading}（中身は，要る仕事の前に開く）：\n${list.join('\n')}`]),
  ]
}

/**
 * 渡す文．`own` は `local/` の記録で，一覧には合わせて `shown` ファイルまでを載せる．
 * `notice` は上限を超えたことを告げる文で，在処を告げる一文の次に置く．
 */
const compose = (
  at: string,
  guide: string,
  main: readonly Doc[],
  own: readonly Doc[],
  depth: Depth,
  shown: number,
  notice: string | undefined,
): string => {
  const mine = section(own, depth, Math.max(0, shown - main.length))

  return [
    `このプロジェクトで承認された決定と事実の記録が ${at} にある．以下は会話の始まりに渡す分で，ほかの項は要るときに開く．`,
    ...(notice === undefined ? [] : [notice]),
    ...section(main, depth, shown),
    ...(mine.length === 0 ? [] : [`私用の記録（${LOCAL}/．git で追跡しない）：`, ...mine]),
    note(guide),
  ].join('\n\n')
}

/** 上限に収まる最も細かい文を返す．名前と字数だけでも超えるなら，一覧を後ろから省く． */
const fit = (at: string, guide: string, main: readonly Doc[], own: readonly Doc[]): string => {
  const all = main.length + own.length
  const full = compose(at, guide, main, own, 'whole', all, undefined)
  const total = size(full)
  if (total <= LIMIT) return full

  const generals = [...main, ...own].filter(isGeneral).map(doc => doc.name)
  const tries = [
    (): string => compose(at, guide, main, own, 'titles', all, over('titles', total, generals)),
    ...Array.from(
      { length: all + 1 },
      (_, omitted) => (): string => compose(at, guide, main, own, 'sizes', all - omitted, over('sizes', total, generals)),
    ),
  ]

  let text = full
  for (const attempt of tries) {
    text = attempt()
    if (size(text) <= LIMIT) break
  }

  return text
}

/** 作業ディレクトリから見つかる記録を，渡す文にする．記録が無ければ undefined． */
const brief = async ($: EngineInterface): Promise<string | undefined> => {
  const cwd = await $.session.cwd()
  const at = await locate($, cwd)
  if (at === undefined) return undefined

  const sep = separator(cwd)
  const main = await gather($, at, sep)
  const own = await gather($, at, sep, LOCAL)
  const guide = join($.plugin.root, 'LEDGER.md', separator($.plugin.root))

  return main.length === 0 && own.length === 0 ? undefined : fit(at, guide, main, own)
}

export const register: Register = on => {
  on('prompt.context', async ($, e, next) => {
    const ran = await next(e)
    const text = await brief($).catch(() => undefined)

    return text === undefined ? ran : { ...ran, blocks: [...ran.blocks, { name: BLOCK, text }] }
  })
}
