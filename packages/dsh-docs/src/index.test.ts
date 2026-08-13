/**
 * Regression tests for the dsh:// handler — each test guards a REAL fix that
 * failed on the initial implementation:
 *
 * - `dsh:///etc/passwd` (absolute-path URL) was originally peeled of its
 *   leading slash before the absolute-path check, so it fell through to a
 *   "Documentation file not found: etc/passwd" instead of being rejected.
 *   The fix checks the raw rest before peeling; this test fails on the
 *   pre-fix code and passes on the fixed code.
 *
 * Generic corpus behavior (root listing, docs alias, did-you-mean, …) that
 * already worked on the initial prototype is intentionally NOT tested here.
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
  await fs.writeFile(path.join(dir, 'index.txt'), 'architecture.md\n')
  await fs.writeFile(path.join(dir, 'architecture.md'), '# DeepSeek Harness Architecture\n')
})

after(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('dsh:// handler absolute-path rejection (peel-order fix)', () => {
  it('rejects dsh:///etc/passwd instead of peeling it into a not-found lookup', async () => {
    const handler = createDshHandler({ corpusDir: dir, agents: undefined })
    await assert.rejects(
      () => handler.resolve({ href: 'dsh:///etc/passwd', raw: 'dsh:///etc/passwd' }),
      /Absolute paths/,
    )
  })
})
