/**
 * Contract tests for the uri-registry core (pure factory, no cordis runtime).
 * Each test asserts one externally observable contract:
 * registration/unregistration, routing, normalization, security, completion.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry, type UriHandler } from './index.js'

function makeHandler(scheme: string, content = 'hello ' + scheme): UriHandler {
  return {
    scheme,
    immutable: true,
    async resolve(url) {
      if (url.href.endsWith('/missing')) throw new Error('not found: ' + url.href)
      return { url: url.href, content, contentType: 'text/markdown' }
    },
    async complete() {
      return [{ value: 'a.md' }, { value: 'b.md' }]
    },
  }
}

describe('uriRegistry', () => {
  it('routes a scheme:// URL to its handler and normalizes the resource shape', async () => {
    const registry = createRegistry()
    registry.register(makeHandler('dsh', '# docs'))
    const resource = await registry.resolve('dsh://x.md')
    assert.equal(resource.content, '# docs')
    assert.equal(resource.contentType, 'text/markdown')
    assert.equal(resource.immutable, true)
    assert.equal(resource.url, 'dsh://x.md')
  })

  it('stamps immutable=false for writable handlers', async () => {
    const registry = createRegistry()
    registry.register({ ...makeHandler('w'), immutable: false })
    const resource = await registry.resolve('w://x')
    assert.equal(resource.immutable, false)
  })

  it('reports Unknown protocol with the supported list', async () => {
    const registry = createRegistry()
    registry.register(makeHandler('dsh'))
    await assert.rejects(() => registry.resolve('unknown://x'), /Unknown protocol: unknown:\/\/\nSupported: dsh:\/\//)
  })

  it('rejects non-hierarchical input', async () => {
    const registry = createRegistry()
    await assert.rejects(() => registry.resolve('not-a-url'), /Not a scheme:\/\/ URL/)
  })

  it('register returns a disposer that unregisters', async () => {
    const registry = createRegistry()
    const dispose = registry.register(makeHandler('dsh'))
    assert.equal(registry.listSchemes().length, 1)
    dispose()
    assert.equal(registry.listSchemes().length, 0)
    await assert.rejects(() => registry.resolve('dsh://x'), /Unknown protocol/)
  })

  it('rejects duplicate schemes', () => {
    const registry = createRegistry()
    registry.register(makeHandler('dsh'))
    assert.throws(() => registry.register(makeHandler('dsh')), /already registered/)
  })

  it('listSchemes reports immutable and completion capability', () => {
    const registry = createRegistry()
    registry.register(makeHandler('dsh'))
    const schemes = registry.listSchemes()
    assert.deepEqual(schemes, [{ scheme: 'dsh', immutable: true, hasComplete: true }])
  })

  it('forwards completion candidates', async () => {
    const registry = createRegistry()
    registry.register(makeHandler('dsh'))
    const items = await registry.complete('dsh', '')
    assert.deepEqual(items, [{ value: 'a.md' }, { value: 'b.md' }])
  })

  it('normalizePath rejects absolute paths and traversal', () => {
    const registry = createRegistry()
    assert.throws(() => registry.normalizePath('/etc/passwd'), /Absolute paths/)
    assert.throws(() => registry.normalizePath('../etc/passwd'), /Path traversal/)
    assert.throws(() => registry.normalizePath('a/../b'), /Path traversal/)
    assert.equal(registry.normalizePath('docs/read.md'), 'docs/read.md')
    assert.equal(registry.normalizePath('docs//read.md'), 'docs/read.md') // internal duplicate slashes collapse
  })

  it('threads caller context into the handler', async () => {
    const registry = createRegistry()
    let seen: unknown
    registry.register({
      scheme: 'ctx',
      async resolve(_url, context) {
        seen = context
        return { url: 'ctx://x', content: 'ok', contentType: 'text/plain' }
      },
    })
    await registry.resolve('ctx://x', { exec: { agent: 'a' } })
    assert.deepEqual(seen, { exec: { agent: 'a' } })
  })

  it('rejects a handler result with a missing content field', async () => {
    const registry = createRegistry()
    registry.register({
      scheme: 'bad',
      async resolve() {
        return { url: 'bad://x', content: '' } as never // content must be a string; empty string is still a string
      },
    })
    // content: '' is valid; craft an actually invalid shape instead:
    registry.unregister('bad')
    registry.register({
      scheme: 'bad',
      async resolve() {
        return { url: 'bad://x', contentType: 'text/plain' } as never // missing content
      },
    })
    await assert.rejects(() => registry.resolve('bad://x'), /returned an invalid resource/)
  })
})
