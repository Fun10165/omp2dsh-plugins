/**
 * DSH built-in docs — the DSH port of omp's `OmpProtocolHandler` +
 * `docs-index` split.
 *
 * This package owns CONTENT ONLY:
 * - the official deepseek-harness docs corpus under `corpus/` (independent
 *   of code, replaceable per version — run `pnpm sync-corpus`),
 * - one `dsh://` handler registered on the uri-registry service.
 *
 * It registers no model tool and knows nothing about routing/security —
 * both belong to @omp2dsh/uri-registry. Swap the corpus, bump the version,
 * and the docs update without touching any routing code.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { UriHandler, UriRegistry } from '@omp2dsh/uri-registry'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'dsh-docs'

/** Services this plugin hard-depends on: the registry and session lookup. */
export const inject = ['uriRegistry', 'agents']

/** Corpus directory shipped inside the package (sibling of lib/). */
const CORPUS_DIR = fileURLToPath(new URL('../corpus/', import.meta.url))
const INDEX_FILE = 'index.txt'

/** Read cap for one document; larger files get truncated with a marker. */
const MAX_DOC_BYTES = 100 * 1024

/** Static fallback doc that ships in code — the "embedded" layer, omp-style. */
const STATIC_DOCS: Record<string, string> = {
  'overview.md': `# DeepSeek Harness (DSH)

DeepSeek Harness is a Cordis-based AI agent runtime and web UI.

- Composition: every capability is a plugin row in cordis.yml; an agent preset is one such file mounted per session.
- Two planes: the HOST composition owns registries and shared capabilities; an AGENT PRESET owns one session's tools/persona/prompt sections.
- Creation mode: hot-swap dynamic Cordis plugins per session (define → approve → run).

## dsh:// docs protocol

Provided by the @omp2dsh/uri-registry + @omp2dsh/dsh-docs pair, modeled on omp's omp://:

- \`dsh://\` lists every available document
- \`dsh://docs/<path>.md\` reads one document (the docs/ prefix may be omitted)

The official corpus comes from deepseek-ai/deepseek-harness docs/ (215 files), shipped under corpus/ and refreshable with \`pnpm sync-corpus\`.
`,
}

/** Which session called us: tool exec context first, then the RPC initiator. */
function sessionCwdOf(
  agents: { currentInitiator(): { session?: { header?: { cwd?: string } } } | undefined } | undefined,
  context?: unknown,
): string | undefined {
  const exec = context as { exec?: { agent?: { session?: { header?: { cwd?: string } } } } } | undefined
  const fromExec = exec?.exec?.agent?.session?.header?.cwd
  if (fromExec) return fromExec
  const initiator = agents?.currentInitiator()
  return initiator?.session?.header?.cwd
}

/** Read the corpus index (file name per line), caching per cwd. */
function makeIndex(corpusDir: string): (cwd: string | undefined) => Promise<string[]> {
  const cache = new Map<string | undefined, { files: string[]; err: string | null }>()
  return async (cwd) => {
    const hit = cache.get(cwd)
    if (hit) return hit.files
    let files: string[] = []
    let err: string | null = null
    try {
      const raw = await fs.readFile(path.join(corpusDir, INDEX_FILE), 'utf8')
      files = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    } catch (error) {
      err = error instanceof Error ? error.message : String(error)
    }
    cache.set(cwd, { files, err })
    return files
  }
}

/** Build the dsh:// handler over a corpus directory. */
export function createDshHandler(deps: {
  corpusDir: string
  agents: { currentInitiator(): { session?: { header?: { cwd?: string } } } | undefined } | undefined
}): UriHandler {
  const { corpusDir, agents } = deps
  const getFilenames = makeIndex(corpusDir)

  async function readDoc(relPath: string): Promise<string> {
    let text = await fs.readFile(path.join(corpusDir, relPath), 'utf8')
    if (text.length > MAX_DOC_BYTES) {
      text = text.slice(0, MAX_DOC_BYTES) + '\n\n<!-- [dsh-docs] document truncated at 100KB -->\n'
    }
    return text
  }

  function rootListing(filenames: readonly string[]): string {
    const statics = Object.keys(STATIC_DOCS).map(f => '- [' + f + '](dsh://' + f + ')')
    const lines = filenames.map(f => '- [' + f + '](dsh://docs/' + f + ')')
    const head = statics.length + filenames.length + ' files available (static embedded + official corpus):\n\n'
    return '# Documentation\n\n' + head + statics.join('\n') + '\n' + lines.join('\n') + '\n'
  }

  return {
    scheme: 'dsh',
    immutable: true,

    async resolve(url, context) {
      const cwd = sessionCwdOf(agents, context)
      const match = String(url.href ?? '').match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i)
      const rawRest = match ? (match[1] ?? '') : ''
      // Absolute-path URLs (dsh:///etc/passwd) are rejected before any peeling.
      if (rawRest.startsWith('/')) throw new Error('Absolute paths are not allowed in dsh:// URLs')
      const rest = rawRest.replace(/^\/+/, '')

      if (rest === '' || rest === 'docs') {
        const files = await getFilenames(cwd)
        return { url: url.href, content: rootListing(files), contentType: 'text/markdown' }
      }

      // Traversal guard lives in the registry; apply it here as well so the
      // handler is safe even when embedded outside the registry.
      const parts = rest.split('/')
      if (parts.includes('..')) throw new Error('Path traversal (..) is not allowed in dsh:// URLs')
      let rel = parts.filter(p => p !== '' && p !== '.').join('/')
      if (rel.startsWith('docs/')) rel = rel.slice('docs/'.length)

      if (Object.prototype.hasOwnProperty.call(STATIC_DOCS, rel)) {
        return { url: url.href, content: STATIC_DOCS[rel]!, contentType: 'text/markdown' }
      }

      const files = await getFilenames(cwd)
      if (files.includes(rel)) {
        try {
          return { url: url.href, content: await readDoc(rel), contentType: 'text/markdown' }
        } catch (error) {
          throw new Error('Failed to read ' + rel + ': ' + (error instanceof Error ? error.message : String(error)))
        }
      }

      const lookup = rel.replace(/\.md$/, '')
      const suggestions = files
        .filter(f => f.includes(lookup) || lookup.includes(f.replace(/\.md$/, '')))
        .slice(0, 5)
      const suffix =
        suggestions.length > 0
          ? '\nDid you mean: ' + suggestions.join(', ')
          : '\nUse dsh:// to list available files.'
      throw new Error('Documentation file not found: ' + rel + suffix)
    },

    async complete() {
      const files = await getFilenames(sessionCwdOf(agents))
      return Object.keys(STATIC_DOCS).map(f => ({ value: f })).concat(files.map(f => ({ value: 'docs/' + f })))
    },
  }
}

export function apply(ctx: Context): void {
  const registry = ctx.get('uriRegistry') as UriRegistry | undefined
  if (registry === undefined) {
    ctx.logger?.warn?.('dsh-docs: uriRegistry unavailable (mount @omp2dsh/uri-registry first); dsh:// not registered')
    return
  }
  const agents = ctx.get('agents') as { currentInitiator(): { session?: { header?: { cwd?: string } } } | undefined } | undefined
  const handler = createDshHandler({ corpusDir: CORPUS_DIR, agents })
  ctx.effect(() => registry.register(handler))
  ctx.logger?.info?.('dsh-docs: dsh:// handler registered on uriRegistry')
}
