/**
 * Contract tests for the dsh:// handler (pure factory over a temp corpus).
 * Each test asserts one observable contract: root listing, doc reading,
 * docs/ alias, traversal rejection, did-you-mean, static fallback, completion.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createDshHandler } from './index.js'

let dir: string

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-docs-test-'))
  await fs.mkdir(path.join(dir, 'sub'))
  await fs.writeFile(path.join(dir, 'index.txt'), 'architecture.md\nsub/tools.md\n')
  await fs.writeFile(path.join(dir, 'architecture.md'), '# DeepSeek Harness Architecture\n\nbody\n')
  await fs.writeFile(path.join(dir, 'sub', 'tools.md'), '# Tools\n\npipeline\n')
})

after(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function makeHandler() {
  return createDshHandler({ corpusDir: dir, agents: undefined })
}

const url = (href: string) => ({ href, raw: href })

describe('dsh:// handler', () => {
  it('lists the root with static + corpus files', async () => {
    const resource = await makeHandler().resolve(url('dsh://'))
    assert.match(resource.content, /^# Documentation/)
    assert.match(resource.content, /3 files available/)
    assert.match(resource.content, /architecture\.md/)
    assert.match(resource.content, /overview\.md/)
    assert.equal(resource.contentType, 'text/markdown')
  })

  it('treats dsh://docs as the root alias', async () => {
    const root = await makeHandler().resolve(url('dsh://'))
    const alias = await makeHandler().resolve(url('dsh://docs'))
    assert.equal(alias.content, root.content)
  })

  it('reads a corpus document, with and without the docs/ prefix', async () => {
    const handler = makeHandler()
    const direct = await handler.resolve(url('dsh://architecture.md'))
    const prefixed = await handler.resolve(url('dsh://docs/architecture.md'))
    assert.equal(prefixed.content, direct.content)
    assert.match(direct.content, /^# DeepSeek Harness Architecture/)
  })

  it('reads nested corpus documents', async () => {
    const resource = await makeHandler().resolve(url('dsh://sub/tools.md'))
    assert.match(resource.content, /^# Tools/)
  })

  it('rejects path traversal', async () => {
    const handler = makeHandler()
    await assert.rejects(() => handler.resolve(url('dsh://../etc/passwd')), /Path traversal/)
    await assert.rejects(() => handler.resolve(url('dsh://sub/../../etc')), /Path traversal/)
  })

  it('rejects absolute paths', async () => {
    await assert.rejects(() => makeHandler().resolve(url('dsh:///etc/passwd')), /Absolute paths/)
  })

  it('suggests did-you-mean for a close typo', async () => {
    await assert.rejects(
      () => makeHandler().resolve(url('dsh://architectur.md')),
      /Documentation file not found: architectur\.md\nDid you mean: architecture\.md/,
    )
  })

  it('serves the static overview doc without touching the corpus', async () => {
    const resource = await makeHandler().resolve(url('dsh://overview.md'))
    assert.match(resource.content, /^# DeepSeek Harness \(DSH\)/)
  })

  it('completion returns static docs and corpus files with docs/ prefix', async () => {
    const items = await makeHandler().complete!()
    const values = items.map(i => i.value)
    assert.ok(values.includes('overview.md'))
    assert.ok(values.includes('docs/architecture.md'))
    assert.ok(values.includes('docs/sub/tools.md'))
  })
})
