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
    assert.equal(noteToSession({} as AgentLike, 'ls', 'x', 1), false)
  })
})

describe('bang v6/v7c injected-note provenance + exit code', () => {
  it('noteText carries an explicit provenance marker (fails on v5: no marker existed)', () => {
    const text = noteText('ls', 'out:ls', 0)
    assert.match(text, /> \/b ls/)
    assert.match(text, /非用户直接输入/)
    assert.match(text, /自动注入/)
  })

  it('noteText includes the exit code (fails pre-v7c: exit code was absent from injected context)', () => {
    const text = noteText('lsof :i', 'error text', 1)
    assert.match(text, /\[exit 1\]/)
    const ok = noteText('ls', 'out', 0)
    assert.match(ok, /\[exit 0\]/)
  })
})

describe('bang v7b signal forwarding (long commands must be cancellable)', () => {
  it('bridges the invocation signal onto the self-owned controller in the shell spec (fails pre-fix: no controller existed)', async () => {
    let seenSignal: AbortSignal | undefined
    const shell: ShellLike = {
      resolve(request: Record<string, unknown>) {
        seenSignal = request.signal as AbortSignal
        return { command: String(request.command), timeoutMs: 60000 }
      },
      async run() {
        return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }
      },
    }
    const invocation = new AbortController()
    const probe = new AbortController()
    let releaseRun: () => void = () => {}
    const runGate = new Promise<void>((resolve) => { releaseRun = resolve })
    const shellWithGate: ShellLike = {
      resolve(request: Record<string, unknown>) {
        seenSignal = request.signal as AbortSignal
        return { command: String(request.command), timeoutMs: 60000 }
      },
      async run() {
        await runGate
        return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }
      },
    }
    // Start the run first: shell.resolve sets seenSignal synchronously before
    // the first await, so the listener can attach while the run is in flight.
    const pending = executeBangCommand({ shell: shellWithGate, sandboxPolicy: makePolicy() }, makeAgent(), 'sleep 100', false, invocation.signal)
    assert.ok(seenSignal !== undefined)
    seenSignal!.addEventListener('abort', () => probe.abort(), { once: true })
    // Abort WHILE the run is in flight: the bridge must reach the spec signal.
    invocation.abort()
    assert.equal(probe.signal.aborted, true)
    releaseRun()
    await pending
  })

  it('rejects immediately when the signal is already aborted (session must not hang)', async () => {
    let ran = false
    const shell: ShellLike = {
      resolve(request: Record<string, unknown>) {
        return { command: String(request.command), timeoutMs: 60000 }
      },
      async run() {
        ran = true
        return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }
      },
    }
    const aborted = { aborted: true } as AbortSignal
    const result = await executeBangCommand({ shell, sandboxPolicy: makePolicy() }, makeAgent(), 'sleep 100', false, aborted)
    assert.equal(ran, false)
    assert.equal(result.kind, 'error')
    assert.match(result.text, /cancelled before execution/)
  })
})

describe('bang /bq cancellation (self-owned, UI never forwards a signal)', () => {
  it('exposes a cancellable controller in the running registry (fails pre-fix: no registry existed)', async () => {
    const running = new Map<string, import('./index.js').RunningBang>()
    const shell: ShellLike = {
      resolve(request: Record<string, unknown>) {
        return { command: String(request.command), timeoutMs: 60000, signal: request.signal as AbortSignal }
      },
      async run(spec) {
        assert.equal(running.has('sleep 100'), true)
        return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }
      },
    }
    await executeBangCommand({ shell, sandboxPolicy: makePolicy() }, makeAgent(), 'sleep 100', false, undefined, running)
    assert.equal(running.size, 0) // cleaned up after settle
  })

  it('aborting the registry controller stops the shell run', async () => {
    const running = new Map<string, import('./index.js').RunningBang>()
    let receivedSignal: AbortSignal | undefined
    const shell: ShellLike = {
      resolve(request: Record<string, unknown>) {
        receivedSignal = request.signal as AbortSignal
        return { command: String(request.command), timeoutMs: 60000, signal: receivedSignal }
      },
      async run() {
        return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }
      },
    }
    const pending = executeBangCommand({ shell, sandboxPolicy: makePolicy() }, makeAgent(), 'sleep 100', false, undefined, running)
    const entry = running.get('sleep 100')
    assert.ok(entry !== undefined)
    entry.controller.abort()
    assert.equal(receivedSignal?.aborted, true) // the spec carried the abortable signal
    await pending
  })
})
