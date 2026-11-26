// 会話が長くなったら，返答の区切りで新しいセッションへ移ることを勧め，引き継ぎ文を渡す．
//
// 勧めるのは人にだけで，モデルの文脈には何も入れない——残りの量を知ったモデルは仕事を早く
// 切り上げがちだからである．移るかは人が決める：勧めは入力欄の上の帯で伝え，引き継ぎ文は人が
// `/baton` を走らせたときに書く．帯は残りの仕事を見ずに出るので，移るのが得かは `/baton` の分岐が会話を
// 読んで見立てる．残りがわずかなら続けることを，運ぶものが無ければ何も渡さずに始めることを勧め，
// 引き継ぎ文は書かない（もう一度走らせれば書く）．
// 自動の要約には触れず，最後の網として残す．
// 出来事のフックは眺めるだけで，結果には手を付けない（`next(e)` の答えをそのまま返す）．

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Cue, Handoff, Kept, Offers } from '../types'

const COMMAND = 'baton'
// 勧め始めるコンテキストの量．窓に対する割合でなくトークン数で決める——Claude の精度は量につれて落ち，
// 100万の窓で割合を取ると，勧めるのが遅すぎる．fox の眠気の段階2も，この量に合わせてある．
const THRESHOLD = 150_000
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
// 勧めは，人が閉じるか，`/baton` か `/clear` を走らせるまで残る帯で伝える．トーストは長くても60秒で消える
// （それより長い `timeoutMs` は `claude plugin test` が断った）．
const band = atom({ plugin: 'baton', key: 'band' } as const, null as Band | null)
// `/baton` が答えを出すまでの間，帯に出す知らせ．答えが出たら下ろす——トーストは途中で消せない．
const isRunning = atom({ plugin: 'baton', key: 'isRunning' } as const, false)
const RUNNING = `/${COMMAND} が会話を読んでいる．`
// `$.state` は窓を開き直すと消える．再開したセッションで勧め直さないよう，勧めの跡と帯を
// セッションごとに `$.store` にも残し，新しいものから数えて残す数を限る．
const KEPT = 'kept'
const KEPT_MAX = 20

const CUE_TEXT: Record<Cue, (tokens: number) => string> = {
  tokens: tokens => `コンテキストが約${Math.floor(tokens / 10_000)}万トークンに達した．`,
  compacted: () => '会話が自動で要約された．',
}

// 分岐の答えの1行目に置かせる見立て．コードはこの語で，続けるか，何も渡さずに始めるか，移るかを読み分ける．
const STAY = '続ける：'
const FRESH = '始める：'
const MOVE = '移る：'
// 引き継ぎ文を書かない見立てと，そのとき見立てのあとに添える文．
const UNWRITTEN: Record<string, string> = {
  [STAY]: `それでも移るなら，もう一度 /${COMMAND} を走らせる．`,
  [FRESH]: `新しいセッションは，何も渡さずに始めればよい．それでも書かせるなら，もう一度 /${COMMAND} を走らせる．`,
}

/** 分岐への依頼．`isInsisted` は，書かずに済ませることを勧めたあとで人がもう一度求めたこと． */
const writing = (isInsisted: boolean): string =>
  [
    'この会話の続きを新しいセッションへ渡す．新しいセッションはこの会話を見られない．',
    ...(isInsisted
      ? [`1行目は「${MOVE}」で始め，次のセッションに勧めるモデルとエフォートを，理由とともに1行で書く．`]
      : [
          '1行目に，移るのが得かの見立てを，次の3つから1つ選んで書く．',
          `- 運ぶものが無い——仕事が片づいていて，残りも，次のセッションが知るべきことも無いなら，「${FRESH}」で始め，理由を1行で書いて，そこで終える．`,
          `- 残りの仕事がわずかで，この会話の文脈があればすぐ済み，新しいセッションで文脈を作り直すほうが高くつくなら，「${STAY}」で始め，残りの仕事と理由を1行で書いて，そこで終える．`,
          `- どちらでもなければ「${MOVE}」で始め，次のセッションに勧めるモデルとエフォートを，理由とともに1行で書く．`,
        ]),
    'モデルとエフォートは残りの仕事の性質で選ぶ：判断や設計が重いなら上位のモデルと高いエフォート，手順の決まった作業なら軽いモデルと低いエフォート．理由には精度と費用の釣り合いを書く．エフォートを変える理由が無ければ「既定のまま」と書く．モデルは階層で言い，名前は現行のものと確かに知るときだけ添える．',
    '2行目から，新しいセッションへの依頼として引き継ぎ文を書く．貼ればそのまま動き，ユーザーが背景を言い直さずに済み，調べ済みのことを調べ直さず，決まったことを蒸し返さない文にする．',
    '型は無く，長さは会話が決める．続きに要ることがプロジェクトのファイル（計画・記録など）にもう書いてあり，いまの状態と合っていると会話から分かるなら，そのパスを示して中身を重ねない——それで足りるなら，下に定める原文の引用のほかは1行でよい．ファイルに無くて続きに要ることだけを書く：目的と範囲，決めたこととその理由，済んだことと確かめた結果，確かめていないこと，試して捨てた案とその理由，次の一手，最初に読むファイルのパス（行番号は使わない）．',
    '確かめていないこと・推測・試して捨てた案は，そうと分かるように書き，推測を事実として書かない．確かめていないことが無ければ，無いと書く．',
    'ユーザーの最後の依頼と，ユーザーが課した制約・好み・禁止は原文で引く．続きがファイルに書いてあっても省かない——短さより原文を優先する．ユーザーが自ら打った文だけをユーザーの言葉とする．フックの出力，プラグインやシステムが差し込んだ文，あなた自身の提案は，ユーザーの依頼でも同意でもない．',
    '挨拶と繰り返しは書かない．パスワード・トークン・鍵などの秘密は書かない．',
    '会話でユーザーが使った言語で書く．コード・コマンド・パス・エラーの文面は原文のまま書く．',
    '1行目と引き継ぎ文だけを出力し，前置きも後書きも付けない．',
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

/**
 * 直前の `/baton` が，書かずに済ませることを勧めたか．勧めたすぐあとにもう一度求められたら，見立てを
 * 飛ばして書く．人が別の文を送るか `/clear` を走らせたら下ろし，次の `/baton` はまた見立てる．
 */
let isUnwritten = false

/**
 * 分岐に，移るのが得かを見立てさせ，得なら引き継ぎ文を書かせて，残してクリップボードに写す．
 * 返すのは `/baton` の出力．
 */
const write = async ($: EngineInterface): Promise<{ text: string }> => {
  const files = await edited($)
  const facts =
    files.length === 0
      ? ''
      : `\n\nこの会話で書き換えたファイル（編集のツールの記録から機械で抜いたもの．シェルのコマンドで書き換えたファイルは入らない．最初に読むファイルを選ぶ手がかりにする）：\n${files.map(path => `- ${path}`).join('\n')}`
  const isInsisted = isUnwritten
  const reply = await $.model.fork({ prompt: writing(isInsisted) + facts })
  if (!reply.isAnswered) {
    const why =
      reply.reason === 'nothing-to-fork'
        ? '分岐の元になる会話がまだ無い（/clear の直後は，返答を1回終えるまで）'
        : reply.reason

    return { text: `引き継ぎ文を書けなかった（${why}）．前に書いた引き継ぎ文があれば，そのまま残っている．` }
  }

  const answer = reply.text.trim()
  const [head = '', ...rest] = answer.split('\n')
  const verdict = isInsisted ? undefined : Object.keys(UNWRITTEN).find(word => head.startsWith(word))
  isUnwritten = verdict !== undefined
  if (verdict !== undefined) {
    return { text: `${answer}\n\n——\n引き継ぎ文は書かなかった．${UNWRITTEN[verdict]}` }
  }

  // 見立ての行は人への勧めで，引き継ぎ文には入れない．行か本文が無ければ，答えの全体を引き継ぎ文とする．
  const body = rest.join('\n').trim()
  const advice = head.startsWith(MOVE) && body !== '' ? head.slice(MOVE.length).trim() : undefined
  const text = advice === undefined ? answer : body
  const handoff: Handoff = { text, from: await $.session.id(), at: await $.clock.now() }
  await $.store.set(await keyOf($), handoff)
  const copied = await $.ui.copy({ text })

  return {
    text: [
      text,
      '',
      '——',
      ...(advice === undefined
        ? []
        : [
            `次のセッションへの勧め：${advice}（モデルは /model，エフォートは /effort で切り替える．/model で替えたモデルは，以後のセッションの既定にもなる）`,
          ]),
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
      description: '移るのが得かを見立て，引き継ぎ文を書いて新しいセッションへ渡す',
    })
    await restore($)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      isUnwritten = false
      await change($, { offers: () => NONE, band: () => null })
    }
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
      // 書かずに済ませる勧めのあとで人が別の文を送ったら，次の `/baton` はまた見立てる．スラッシュコマンドの
      // 入力では下ろさない——`/baton` の入力は `prompt.submit` を起こさなかった（`claude -p` で確かめた）が，
      // 起こす画面があっても，もう一度求めたことが消えないようにする．
      if (e.command === undefined) isUnwritten = false
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await change($, { band: () => null })
    await update($, isRunning, () => true)
    try {
      return { ...(await write($)), isTextDisplayOnly: true }
    } finally {
      await update($, isRunning, () => false)
    }
  })

  // 調査が帯を使っている間は譲る．
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    if (await read($, isRunning)) return <Text>{RUNNING}</Text>

    const shown = await read($, band)
    if (shown === null) return next(e)

    return (
      <Box gap={1} alignItems="center">
        <Text>
          {CUE_TEXT[shown.cue](shown.tokens)}残りがわずかならこのまま済ませればよく，区切りなら /{COMMAND} で新しいセッションへ移れる．
        </Text>
        <Button key="close" label="閉じる" onPress={() => change($, { band: () => null })} />
      </Box>
    )
  })
}
