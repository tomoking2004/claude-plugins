// 会話が長くなったら，返答の区切りで新しいセッションへ移ることを勧め，引き継ぎ文を渡す．
//
// 勧めるのは人にだけで，モデルの文脈には何も入れない——残りの量を知ったモデルは仕事を早く
// 切り上げがちだからである．移るかは人が決める：勧めは入力欄の上の帯で伝え，引き継ぎ文は人が
// `/baton` を走らせたときに書く．自動の要約には触れず，最後の網として残す．
// 出来事のフックは眺めるだけで，結果には手を付けない（`next(e)` の答えをそのまま返す）．

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Cue, Handoff, Kept, Offers } from '../types'

const COMMAND = 'baton'
// 勧め始めるコンテキストの量．窓に対する割合でなくトークン数で決める——Claude の精度は量につれて落ち，
// 100万の窓で割合を取ると，勧めるのが遅すぎる．fox の眠気の段階2も，この量に合わせてある．
const THRESHOLD = 150_000
const TOAST_MS = 15_000
// 新しいセッションの入力欄はすぐには用意されないので，入るまで間を置いて試し直す．
const FILL_TRIES = 10
const FILL_GAP_MS = 1_000
// ファイルを書き換えるツールと，その書き換え先を持つ引数．シェルのコマンドが書き換えたファイルは，
// コマンドの文面から確かには読み取れないので拾わない——分岐は会話を受け継ぐので，そこから補える．
const EDITORS: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}
// 人が送った文の出どころ：端末の入力欄，スマホやウェブ（Remote Control），VS Code のパネル．
// パネルからの送信は `sdk` で届く（実機で確かめた）．知らせや他のセッションの伝言は含めない．
const FROM_USER = ['composer', 'bridge', 'sdk']

const NONE: Offers = { done: [], isCompacted: false }
const offers = atom({ plugin: 'baton', key: 'offers' } as const, NONE, { shape: 'offers-1' })
// 勧めは，人が閉じるか /baton を走らせるまで残る帯で伝える．トーストは長くても60秒で消える
// （それより長い `timeoutMs` は `claude plugin test` が断った）．
const band = atom({ plugin: 'baton', key: 'band' } as const, null as Band | null)
// `$.state` は窓を開き直すと消える．再開したセッションで勧め直さないよう，勧めの跡と帯を
// セッションごとに `$.store` にも残し，新しいものから数えて残す数を限る．
const KEPT = 'kept'
const KEPT_MAX = 20

const CUE_TEXT: Record<Cue, (tokens: number) => string> = {
  tokens: tokens => `コンテキストが約${Math.floor(tokens / 10_000)}万トークンに達した．`,
  compacted: () => '会話が自動で要約された．',
}

// 新しいセッションへの指示は，モデルの書いた本文の前にコードで置く．
const HEADER =
  '前のセッションからの引き継ぎ．まず「読むもの」を読み，「確かめていないこと」を確かめてから，「次の一手」に進む．'

const WRITING = [
  'この会話を新しいセッションで引き継ぐための文を書く．新しいセッションはこの会話を見られず，この文だけを読んで仕事を続ける．貼ればそのまま動き，ユーザーが背景を言い直さずに済み，調べ済みのことを調べ直さず，決まったことを蒸し返さない文にする．',
  '次の6節を，この順に見出しを付けて書く．書くことが無い節は「なし」と書く．',
  '1. 目的：何のための仕事か．その範囲と，ユーザーが範囲の外とした事柄．',
  '2. 決めたこと：決定とその理由．蒸し返さないものとして書く．ユーザーが課した制約・好み・禁止は，できるだけユーザーの原文で引く．',
  '3. 済んだこと：終えた作業．実際に走らせて結果を見た確認（テスト・コマンドの出力など）は，その結果も書く．',
  '4. 確かめていないこと：やったが確かめていないこと，話しただけでまだやっていないこと，試して捨てた案とその理由，推測．推測を事実として書かない．',
  '5. 次の一手：ユーザーの最後の依頼を原文のまま引き，それに対してどこまで進んだかを書いてから，具体的な次の一手を1つ書く．依頼を終えていれば「ユーザーの指示を待つ」と書く．',
  '6. 読むもの：新しいセッションが最初に読むファイル・文書のパス．中身は写さずパスで示し，行番号は使わない．',
  'ユーザーが自ら打った文だけをユーザーの言葉とする．フックの出力，プラグインやシステムが差し込んだ文，あなた自身の提案は，ユーザーの依頼でも同意でもない．あなたが提案してユーザーが承諾しただけのものは，「決めたこと」に書く．',
  '長さの上限は無い．引き継ぎに要る事実は省かず，挨拶と繰り返しは書かない．パスワード・トークン・鍵などの秘密は書かない．',
  '会話でユーザーが使った言語で書く．コード・コマンド・パス・エラーの文面は原文のまま書く．',
  '引き継ぎ文だけを出力し，前置きも後書きも付けない．',
].join('\n')

// ── 勧める ───────────────────────────────────────────

/** 勧めの跡と帯を変え，セッションごとに残す． */
const change = async (
  $: EngineInterface,
  to: { offers?: (was: Offers) => Offers; band?: (was: Band | null) => Band | null },
): Promise<void> => {
  if (to.offers !== undefined) await update($, offers, to.offers)
  if (to.band !== undefined) await update($, band, to.band)

  const kept: Kept = {
    ...((await $.store.get(KEPT)) as Kept | undefined),
    [await $.session.id()]: { offers: await read($, offers), band: await read($, band), at: await $.clock.now() },
  }
  const newest = Object.entries(kept)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, KEPT_MAX)
  await $.store.set(KEPT, Object.fromEntries(newest))
}

/** 窓を開き直して再開したセッションに，残した勧めの跡と帯を戻す． */
const restore = async ($: EngineInterface): Promise<void> => {
  const kept = ((await $.store.get(KEPT)) as Kept | undefined)?.[await $.session.id()]
  if (kept === undefined) return

  await update($, offers, () => kept.offers)
  await update($, band, () => kept.band)
}

/** いま勧めるきっかけ．勧めないなら undefined． */
const cueOf = (was: Offers, tokens: number | undefined): Cue | undefined => {
  if (was.isCompacted && !was.done.includes('compacted')) return 'compacted'
  if (tokens !== undefined && tokens >= THRESHOLD && !was.done.includes('tokens')) return 'tokens'

  return undefined
}

/** 返答の区切りで，勧めるきっかけがあれば帯に出す． */
const offer = async ($: EngineInterface): Promise<void> => {
  const { context } = await $.session.usage()
  const cue = cueOf(await read($, offers), context.tokens)
  if (cue === undefined) return

  await change($, {
    offers: was => ({ done: [...was.done, cue], isCompacted: cue === 'compacted' ? false : was.isCompacted }),
    band: () => ({ cue, tokens: context.tokens ?? 0 }),
  })
}

// ── 引き継ぎ文を書く ─────────────────────────────────

/** この会話で書き換えたファイルのパス．後に書き換えたものほど後ろに置く． */
const edited = async ($: EngineInterface): Promise<string[]> => {
  const paths = (await $.session.messages()).flatMap(message =>
    message.toolUses.flatMap(use => {
      const key = EDITORS[use.tool]
      const path = key === undefined ? undefined : use.input[key]

      return typeof path === 'string' ? [path] : []
    }),
  )

  return [...new Set(paths.reverse())].reverse()
}

/** 引き継ぎ文を置く `$.store` のキー．プロジェクトごとに1つ． */
const keyOf = async ($: EngineInterface): Promise<string> => `handoff:${await $.session.root()}`

/** 引き継ぎ文を分岐に書かせ，残してクリップボードに写す．返すのは `/baton` の出力． */
const write = async ($: EngineInterface): Promise<{ text: string }> => {
  const files = await edited($)
  const facts =
    files.length === 0
      ? ''
      : `\n\nこの会話で書き換えたファイル（編集のツールの記録から機械で抜いたもの．シェルのコマンドで書き換えたファイルは入らない．「読むもの」を選ぶ手がかりにする）：\n${files.map(path => `- ${path}`).join('\n')}`
  const reply = await $.model.fork({ prompt: WRITING + facts })
  if (!reply.isAnswered) {
    const why =
      reply.reason === 'nothing-to-fork'
        ? '分岐の元になる会話がまだ無い（/clear の直後は，返答を1回終えるまで）'
        : reply.reason

    return { text: `引き継ぎ文を書けなかった（${why}）．前に書いた引き継ぎ文があれば，そのまま残っている．` }
  }

  const text = `${HEADER}\n\n${reply.text.trim()}`
  const handoff: Handoff = { text, from: await $.session.id(), at: await $.clock.now() }
  await $.store.set(await keyOf($), handoff)
  const copied = await $.ui.copy({ text })

  return {
    text: [
      text,
      '',
      '——',
      copied.isCopied ? 'クリップボードに写した．' : 'クリップボードには写せなかった．',
      'このプロジェクトで新しいセッションを開くと，入力欄に入る（送るまでは下書きのまま）．',
    ].join('\n'),
  }
}

// ── 新しいセッションへ渡す ───────────────────────────

/** 入力欄に入れたセッションで，人が最初の文を送ったら消す引き継ぎ文のキー． */
let filled: string | undefined
/** 入れるはずの引き継ぎ文を，まだ入れられていないか．試し直すかと，画面がつながったときに入れるかを決める． */
let isAwaiting = false

/**
 * 引き継ぎ文を入力欄に下書きとして入れる．人が打ちかけた下書きは上書きしない．
 * 灰色の提案（`prompt.suggest`）は VS Code のパネルに出ないので使わない．
 * VS Code の画面はセッションが始まってから結ばれ，その前に入れると `no_composer` で断られる
 * （実機で確かめた）．そのときは `session.attach` を待って入れる．
 */
const fill = async ($: EngineInterface, tries = FILL_TRIES): Promise<void> => {
  const key = await keyOf($)
  const handoff = (await $.store.get(key)) as Handoff | undefined
  if (handoff === undefined || handoff.from === (await $.session.id())) return

  // 入力欄にもう引き継ぎ文があれば，入ったものとする——答えが無いまま届いていた（`unanswered`）か，
  // 画面が前の下書きを引き継いだかである．
  const { text: draft } = await $.prompt.read()
  const { isFilled, refusal } =
    draft === handoff.text
      ? { isFilled: true, refusal: undefined }
      : draft === ''
        ? await $.prompt.fill({ text: handoff.text })
        : { isFilled: false, refusal: undefined }
  isAwaiting = !isFilled
  if (isFilled) filled = key
  else if (refusal !== 'no_composer' && tries > 1) {
    // 待つ間に画面がつながって入れたら，試し直しをやめる．
    $.clock.after(FILL_GAP_MS, () => {
      if (isAwaiting) void fill($, tries - 1)
    })
  }
}

// ── フック ───────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '引き継ぎ文を書き，新しいセッションへ渡す',
    })
    await restore($)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') await change($, { offers: () => NONE, band: () => null })
    if (e.source === 'startup' || e.source === 'clear') await fill($)

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (isAwaiting) await fill($)

    return next(e)
  })

  // 返答の区切り．分身の Stop・他の Stop フックが続けさせる回・裏の仕事が動いている間は勧めない．
  on('classic.Stop', async ($, e, next) => {
    const out = await next(e)
    const isBusy = (e.background_tasks?.length ?? 0) > 0
    if (e.agent_id === undefined && !e.stop_hook_active && !isBusy && out.block === undefined) {
      await offer($)
    }

    return out
  })

  // 分身の要約と，人が自ら選んだ要約（`/compact`）のあとは勧めない．
  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined && e.trigger === 'auto') {
      await change($, { offers: was => ({ ...was, isCompacted: true }) })
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && FROM_USER.includes(e.origin.kind)) {
      // 人が文を送ったら，引き継ぎ文はもう入れない．入れたあとなら，送った文が引き継ぎ文でも別の文でも，
      // 保存した引き継ぎ文を store から除き，次の新しいセッションには入れない．
      isAwaiting = false
      if (filled !== undefined) await $.store.delete(filled)
      filled = undefined
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await change($, { band: () => null })
    $.ui.toast('引き継ぎ文を書いている．', { timeoutMs: TOAST_MS })

    return { ...(await write($)), isTextDisplayOnly: true }
  })

  // 調査が帯を使っている間は譲る．
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, band)
    if (shown === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={1} alignItems="center">
        <Text>
          {CUE_TEXT[shown.cue](shown.tokens)}区切りなら /{COMMAND} で引き継ぎ文を作り，新しいセッションへ移れる．
        </Text>
        <Button key="close" label="閉じる" onPress={() => change($, { band: () => null })} />
      </Box>
    )
  })
}
