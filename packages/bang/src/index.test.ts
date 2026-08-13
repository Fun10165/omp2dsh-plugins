/**
 * Regression tests for bang — each test guards a REAL fix that failed on the
 * initial prototype and only passes on the fixed architecture:
 *
 * - v3 fix: `!cmd`/`!!cmd` now dispatch through the official command pipeline
 *   (`/bang <cmd>`), which renders a persistent command card in the flow
 *   instead of the removed dock; `bangLine`/`executeBang` exist only since
 *   that fix.
 * - v4 fix: the steer injection (which triggered a model turn) was removed
 *   and card text is plain ASCII without emoji; `renderCardText` asserts the
 *   fixed card shape and the explicit excluded-from-context label.
 *
 * Generic shell/pipeline behavior that already worked on the initial
 * prototype is intentionally NOT tested here (no value, no regression).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderCardText } from './index.js'
import { bangLine, executeBang, type BangRpc } from './client.js'

describe('bang v4 card text (steer removed, ASCII only)', () => {
  it('renders exit code, command and output in plain ASCII — no emoji since the v4 fix', () => {
    const text = renderCardText('ls', 0, 'a\nb', false)
    assert.equal(text, '[exit 0] ls\n\na\nb')
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u)
  })

  it('appends the explicit excluded-from-context label for !!', () => {
    const text = renderCardText('ls', 0, 'secret', true)
    assert.match(text, /Excluded from context: visible on this card only\./)
  })
})

describe('bang v3 official pipeline mapping (dock removed)', () => {
  it('maps !cmd to the /bang command line', () => {
    assert.equal(bangLine({ command: 'zed .', exclude: false }), '/bang zed .')
    assert.equal(bangLine({ command: 'ls', exclude: true }), '/bang !!ls')
  })

  it('dispatches through the rpc seam without any model injection', async () => {
    const lines: string[] = []
    const rpc: BangRpc = { exec: async (line) => { lines.push(line); return { ok: true } } }
    const ok = await executeBang(rpc, { command: 'ls', exclude: true })
    assert.equal(ok, true)
    assert.deepEqual(lines, ['/bang !!ls'])
  })
})
