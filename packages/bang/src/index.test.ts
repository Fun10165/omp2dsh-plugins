/**
 * Contract tests for the bang core (pure factory + draft parser, no cordis).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createBangRunner, type ShellLike } from './index.js'
import { parseBangDraft, executeBang, type BangRpc } from './client.js'

function makeShell(): ShellLike {
  return {
    resolve(request) {
      return { command: String(request.command), workdir: String(request.workdir ?? ''), timeoutMs: 60000 }
    },
    async run(spec) {
      if (spec.command.startsWith('boom')) throw new Error('boom exploded')
      return {
        exitCode: spec.command === 'fail' ? 2 : 0,
        stdout: { text: 'out:' + spec.command },
        stderr: { text: spec.command === 'fail' ? 'bad' : '' },
      }
    },
  }
}

describe('createBangRunner', () => {
  it('runs a command through the shell and normalizes the result', async () => {
    const runner = createBangRunner({ shell: makeShell(), sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } })
    const result = await runner.run('ls -la')
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, 'out:ls -la')
  })

  it('reports non-zero exit codes and stderr', async () => {
    const runner = createBangRunner({ shell: makeShell(), sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } })
    const result = await runner.run('fail')
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 2)
    assert.equal(result.stderr, 'bad')
  })

  it('rejects empty commands', async () => {
    const runner = createBangRunner({ shell: makeShell(), sandboxPolicy: { resolve: () => ({}) } })
    const result = await runner.run('   ')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /empty command/)
  })

  it('surfaces shell failures as ok:false', async () => {
    const runner = createBangRunner({ shell: makeShell(), sandboxPolicy: { resolve: () => ({}) } })
    const result = await runner.run('boom x')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /boom exploded/)
  })

  it('resolves the sandbox policy against the session when an agent is present', async () => {
    let resolvedWithSession = false
    const runner = createBangRunner({
      shell: makeShell(),
      sandboxPolicy: {
        resolve(request) {
          resolvedWithSession = request !== undefined && 'session' in request
          return { mode: 'workspace-write' }
        },
      },
      agents: { currentInitiator: () => ({ session: { header: { cwd: '/ws' } } }) },
    })
    const result = await runner.run('pwd')
    assert.equal(result.ok, true)
    assert.equal(resolvedWithSession, true)
    assert.equal(result.cwd, '/ws')
  })
})

describe('parseBangDraft', () => {
  it('parses !cmd as context-included', () => {
    assert.deepEqual(parseBangDraft('!zed .'), { command: 'zed .', exclude: false })
  })

  it('parses !!cmd as context-excluded', () => {
    assert.deepEqual(parseBangDraft('!!ls -la'), { command: 'ls -la', exclude: true })
  })

  it('returns null for non-bang drafts and empty commands', () => {
    assert.equal(parseBangDraft('ls -la'), null)
    assert.equal(parseBangDraft('!'), null)
    assert.equal(parseBangDraft('!!'), null)
  })
})

describe('executeBang', () => {
  it('injects the result into context for ! (non-excluded) via rpc.note', async () => {
    const calls: string[] = []
    const rpc: BangRpc = {
      run: async () => ({ ok: true, exitCode: 0, stdout: 'hello' }),
      note: async (text) => { calls.push('note'); assert.match(text, /hello/); return { ok: true } },
    }
    const states: string[] = []
    await executeBang(rpc, { command: 'echo hello', exclude: false }, (s) => states.push(s.status))
    assert.deepEqual(states, ['running', 'done'])
    assert.deepEqual(calls, ['note'])
  })

  it('never calls note for !! (excluded)', async () => {
    let noted = false
    const rpc: BangRpc = {
      run: async () => ({ ok: true, exitCode: 0, stdout: 'secret' }),
      note: async () => { noted = true; return { ok: true } },
    }
    const states: string[] = []
    const final = await executeBang(rpc, { command: 'echo secret', exclude: true }, (s) => states.push(s.status))
    assert.deepEqual(states, ['running', 'done'])
    assert.equal(noted, false)
    assert.equal(final.output, 'secret')
  })

  it('marks failed runs and surfaces errors', async () => {
    const rpc: BangRpc = {
      run: async () => ({ ok: false, error: 'no shell' }),
      note: async () => ({ ok: true }),
    }
    const final = await executeBang(rpc, { command: 'x', exclude: false }, () => {})
    assert.equal(final.status, 'error')
    assert.match(final.error ?? '', /no shell/)
  })
})
