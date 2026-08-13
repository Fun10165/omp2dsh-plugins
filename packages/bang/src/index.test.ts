/**
 * Contract tests for the bang core (pure logic, no cordis).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBangInput,
  renderCardText,
  executeBangCommand,
  type ShellLike,
  type SandboxPolicyLike,
} from './index.js'
import { parseBangDraft, bangLine, executeBang, type BangRpc } from './client.js'

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

function makePolicy(): SandboxPolicyLike {
  return { resolve: () => ({ mode: 'workspace-write' }) }
}

describe('parseBangInput', () => {
  it('parses !!cmd as excluded', () => {
    assert.deepEqual(parseBangInput('!!ls -la'), { command: 'ls -la', exclude: true })
  })

  it('parses bare command as included', () => {
    assert.deepEqual(parseBangInput('ls -la'), { command: 'ls -la', exclude: false })
  })

  it('returns null for empty input', () => {
    assert.equal(parseBangInput('  '), null)
  })
})

describe('renderCardText', () => {
  it('renders exit code, command and output in plain ASCII', () => {
    const text = renderCardText('ls', 0, 'a\nb', false)
    assert.equal(text, '[exit 0] ls\n\na\nb')
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u)
  })

  it('appends the excluded-from-context label for !!', () => {
    const text = renderCardText('ls', 0, 'secret', true)
    assert.match(text, /Excluded from context: visible on this card only\./)
  })
})

describe('executeBangCommand', () => {
  it('runs a command through the shell and returns a success card', async () => {
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, { session: { header: { cwd: '/ws' } } }, 'ls -la')
    assert.equal(result.kind, 'success')
    assert.match(result.text, /\[exit 0\] ls -la/)
    assert.match(result.text, /out:ls -la/)
  })

  it('returns an error card on non-zero exit with stderr', async () => {
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, { session: {} }, 'fail')
    assert.equal(result.kind, 'error')
    assert.match(result.text, /\[exit 2\]/)
    assert.match(result.text, /bad/)
  })

  it('surfaces shell failures as error cards', async () => {
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, { session: {} }, 'boom x')
    assert.equal(result.kind, 'error')
    assert.match(result.text, /boom exploded/)
  })

  it('rejects empty commands', async () => {
    const result = await executeBangCommand({ shell: makeShell(), sandboxPolicy: makePolicy() }, { session: {} }, '')
    assert.equal(result.kind, 'error')
    assert.match(result.text, /empty command/)
  })

  it('resolves the sandbox policy against the session', async () => {
    let resolvedWithSession = false
    const policy: SandboxPolicyLike = {
      resolve(request) {
        resolvedWithSession = request !== undefined && 'session' in request
        return { mode: 'workspace-write' }
      },
    }
    await executeBangCommand({ shell: makeShell(), sandboxPolicy: policy }, { session: { header: { cwd: '/ws' } } }, 'pwd')
    assert.equal(resolvedWithSession, true)
  })
})

describe('client draft mapping', () => {
  it('parses ! and !! drafts', () => {
    assert.deepEqual(parseBangDraft('!zed .'), { command: 'zed .', exclude: false })
    assert.deepEqual(parseBangDraft('!!ls'), { command: 'ls', exclude: true })
    assert.equal(parseBangDraft('ls'), null)
  })

  it('maps to official /bang lines', () => {
    assert.equal(bangLine({ command: 'zed .', exclude: false }), '/bang zed .')
    assert.equal(bangLine({ command: 'ls', exclude: true }), '/bang !!ls')
  })

  it('dispatches through the rpc seam', async () => {
    const lines: string[] = []
    const rpc: BangRpc = { exec: async (line) => { lines.push(line); return { ok: true } } }
    const ok = await executeBang(rpc, { command: 'ls', exclude: true })
    assert.equal(ok, true)
    assert.deepEqual(lines, ['/bang !!ls'])
  })
})
