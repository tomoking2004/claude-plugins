// キツネを，パネルに映すキャラクターとして theater に加える．
// 絵は `sprites/` が持ち，パネルの描画と出来事の扱いは theater が担う．

import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.theater.join({ name: 'fox', title: 'キツネ', root: $.plugin.root })

    return next(e)
  })
}
