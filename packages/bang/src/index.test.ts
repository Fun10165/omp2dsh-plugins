/**
 * Regression tests for bang — each test guards a REAL fix that failed on an
 * earlier version and only passes on the fixed architecture:
 *
 * - v4 fix: card text is plain ASCII without emoji; the excluded label is
 *   explicit (`renderCardText`).
 * - v5 fix: `/b` (in-context) appends the result to the session flow via
 *   `session.append` WITHOUT waking the driver, while `/bb` (excluded) never
 *   touches the session flow. `executeBangCommand(include=true)` fails on
 *   v4 (no append existed); `include=false` must NOT append. Also fixes the
 *   ill-formed `/bang !!ls` hybrid by splitting into two commands.
 *
 * Generic shell/pipeline behavior that already worked on the initial
 * prototype is intentionally NOT tested here.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderCardText,
  executeBangCommand,
  noteToSession,
  noteText,
  type ShellLike,
  type SandboxPolicyLike,
  type AgentLike,
} from './index.js'

function makeShell(): ShellLike {
  return {
    resolve(request) {
      return { command: String(request.command), workdir: String(request.workdir ?? ''), timeoutMs: 60000 }
    },
    async run(spec) {
      return { exitCode: 0, stdout: { text: 'out:' + spec.command }, stderr: { text: '' } }
    },
  }
}

function makePolicy(): SandboxPolicyLike {
  return { resolve: () => ({ mode: 'workspace-write' }) }
}

function makeAgent(): AgentLike & { appended: unknown[] } {
  const agent = {
    session: {
      header: { cwd: '/ws' },
      append: function (_type: 'user/message', data: unknown, _intent: { surfaceOp: 'append' }) {
        agent.appended.push(data)
      },
    },
  } as unknown as AgentLike & { appended: unknown[] }
  agent.appended = []
  return agent
}

describe('bang v4 card text (ASCII, no emoji)', () => {
  it('renders exit code, command and output in plain ASCII — no emoji since the v4 fix', () => {
    const text = renderCardText('ls', 0, 'a\nb', false)
    assert.equal(text, '[exit 0] ls\n\na\nb')
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u)
  })

  it('appends the explicit excluded-from-context label', () => {
    const text = renderCardText('ls', 0, 'secret', true)
    assert.match(text, /Excluded from context: visible on this card only\./)
  })
})

describe('bang v5 /b vs /bb context split (session.append without wake)', () => {
  it('/b include=true appends the result to the session flow (fails on v4: no append existed)', async () => {
    const agent = makeAgent()
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, agent, 'ls', true)
    assert.equal(result.kind, 'success')
    assert.equal(agent.appended.length, 1)
    const message = agent.appended[0] as { role: string; content: Array<{ type: string; text: string }> }
    assert.equal(message.role, 'user')
    assert.match(message.content[0]!.text, /out:ls/)
  })

  it('/bb include=false NEVER appends to the session flow (excluded)', async () => {
    const agent = makeAgent()
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, agent, 'ls', false)
    assert.equal(result.kind, 'success')
    assert.equal(agent.appended.length, 0)
    assert.match(result.text, /Excluded from context/)
  })

  it('noteToSession returns false without a session (no silent crash)', () => {
    assert.equal(noteToSession({} as AgentLike, 'ls', 'x'), false)
  })
})

describe('bang v6 injected-note provenance marker', () => {
  it('noteText carries an explicit provenance marker (fails on v5: no marker existed)', () => {
    const text = noteText('ls', 'out:ls')
    assert.match(text, /> \/b ls/)
    assert.match(text, /非用户直接输入/)
    assert.match(text, /自动注入/)
  })
})
