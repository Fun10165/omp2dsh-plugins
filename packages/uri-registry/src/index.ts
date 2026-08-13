/**
 * URI protocol registry — the DSH port of omp's `InternalUrlRouter`.
 *
 * One process-wide registry maps `scheme://` to handler plugins. Any plugin
 * (bundle, skill, or dynamic) can register its own scheme; the single
 * `read_uri` model tool resolves every registered protocol. This is the
 * router half only — content lives in handler plugins (see @omp2dsh/dsh-docs).
 *
 * Design rules this package enforces (see repo AGENTS.md):
 * - KISS: no runtime dependencies beyond the DSH runtime itself.
 * - Decoupling: the registry never reads files or knows about docs; handlers
 *   own their content and their own semantics. Only generic security
 *   (path traversal) lives here so every protocol inherits it.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'uri-registry'

/** Services this plugin hard-depends on. */
export const inject = ['tools']

/** Minimal tool-registry shape (subset of @deepseek-ai/dsh-tools ToolRuntime). */
interface ToolRegistryLike {
  register(definition: {
    name: string
    description: string
    parameters?: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render: (args: unknown, value: { text: string }) => Array<{ type: 'text'; text: string }>
    }
    execute(args: { path?: string }, exec: unknown): Promise<unknown>
  }): () => void
}

/** One resolved resource, in the shape omp's InternalResource uses. */
export interface UriResource {
  url: string
  content: string
  contentType: string
  size?: number
}

/** Contract a protocol plugin must implement to register a scheme. */
export interface UriHandler {
  /** The scheme without `://` (e.g. `dsh`). Lowercased on registration. */
  scheme: string
  /** True when resources are read-only (edit affordances suppressed). */
  immutable?: boolean
  /**
   * Resolve one URL to content.
   * @param url - `href` is the exact input; `raw` is the unparsed input.
   * @param context - caller context threaded from the executing tool
   *   (e.g. `{ exec }` so handlers can read the calling session's cwd).
   */
  resolve(url: { href: string; raw: string }, context?: unknown): Promise<UriResource>
  /** Optional autocomplete candidates for the host/path portion. */
  complete?(query?: string, context?: unknown): Promise<Array<{ value: string; label?: string; description?: string }>>
}

/** The service this plugin publishes for other plugins via `ctx.get('uriRegistry')`. */
export interface UriRegistry {
  /** Register a handler; returns the disposer that unregisters it. */
  register(handler: UriHandler): () => void
  /** Remove a scheme; returns whether it was present. */
  unregister(scheme: string): boolean
  /** Current schemes for observability UI. */
  listSchemes(): Array<{ scheme: string; immutable: boolean; hasComplete: boolean }>
  /** Route `scheme://...` to its handler and normalize the result shape. */
  resolve(input: string, context?: unknown): Promise<UriResource & { immutable: boolean }>
  /** Completion candidates for one scheme. */
  complete(scheme: string, query?: string, context?: unknown): Promise<Array<{ value: string }>>
  /**
   * Shared path normalization with traversal protection, ported from
   * omp-protocol.ts. Handlers should run every path segment through it.
   */
  normalizePath(rest: string): string
}

/** Parse `scheme://rest`; throws on non-hierarchical input. */
function parseUri(input: string): { scheme: string; rest: string; href: string } {
  const match = String(input ?? '').match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i)
  if (!match) throw new Error('Not a scheme:// URL: ' + input)
  return { scheme: match[1]!.toLowerCase(), rest: (match[2] ?? '').replace(/^\/+/, ''), href: String(input ?? '') }
}

/** Shared traversal guard, identical in behavior to omp's OmpProtocolHandler. */
function normalizePath(rest: string): string {
  if (rest.startsWith('/')) throw new Error('Absolute paths are not allowed in uri:// URLs')
  const parts = rest.split('/')
  if (parts.includes('..')) throw new Error('Path traversal (..) is not allowed in uri:// URLs')
  const normalized = parts.filter(p => p !== '' && p !== '.').join('/')
  if (normalized.startsWith('../')) throw new Error('Path traversal (..) is not allowed in uri:// URLs')
  return normalized
}

/** Create a standalone registry (pure logic, no cordis needed — testable). */
export function createRegistry(): UriRegistry {
  const handlers = new Map<string, UriHandler>()

  const registry: UriRegistry = {
    register(handler: UriHandler): () => void {
      if (!handler || typeof handler.scheme !== 'string' || typeof handler.resolve !== 'function') {
        throw new Error('uriRegistry.register: handler needs { scheme, resolve(url, context) }')
      }
      const scheme = handler.scheme.toLowerCase()
      if (handlers.has(scheme)) throw new Error('uriRegistry.register: scheme already registered: ' + scheme + '://')
      handlers.set(scheme, handler)
      return () => {
        if (handlers.get(scheme) === handler) handlers.delete(scheme)
      }
    },

    unregister(scheme: string): boolean {
      return handlers.delete(scheme.toLowerCase())
    },

    listSchemes() {
      return Array.from(handlers.entries()).map(([scheme, handler]) => ({
        scheme,
        immutable: handler.immutable === true,
        hasComplete: typeof handler.complete === 'function',
      }))
    },

    async resolve(input: string, context?: unknown) {
      const { scheme, href } = parseUri(input)
      const handler = handlers.get(scheme)
      if (!handler) {
        const available = Array.from(handlers.keys()).map(s => s + '://').join(', ')
        throw new Error('Unknown protocol: ' + scheme + '://\nSupported: ' + (available || 'none'))
      }
      const resource = await handler.resolve({ href, raw: input }, context)
      if (!resource || typeof resource.content !== 'string' || typeof resource.url !== 'string') {
        throw new Error('uriRegistry: handler for ' + scheme + ':// returned an invalid resource')
      }
      return {
        url: resource.url || href,
        content: resource.content,
        contentType: typeof resource.contentType === 'string' ? resource.contentType : 'text/plain',
        size: typeof resource.size === 'number' ? resource.size : undefined,
        immutable: handler.immutable === true,
      }
    },

    async complete(scheme: string, query?: string, context?: unknown) {
      const handler = handlers.get(scheme.toLowerCase())
      if (!handler || typeof handler.complete !== 'function') return []
      const items = await handler.complete(query, context)
      return Array.isArray(items) ? items : []
    },

    normalizePath,
  }

  return registry
}

export function apply(ctx: Context): void {
  const tools = ctx.get('tools') as ToolRegistryLike | undefined
  if (tools === undefined) return

  const registry = createRegistry()

  // Publish the service: other plugins (dynamic or bundled) reach it via ctx.get('uriRegistry').
  ctx.provide('uriRegistry', registry)

  // One model tool for every registered protocol. Registered as a plain
  // definition: DSH's tools.register validates the output shape itself, so no
  // defineTool wrapper is needed outside the dynamic-plugin sandbox.
  tools.register({
    name: 'read_uri',
    description:
      'Read a resource through a registered URI protocol (scheme://path). ' +
      'dsh:// lists/reads DSH built-in docs (dsh:// for the index, dsh://docs/<path>.md for one doc). ' +
      'Other plugins may register further schemes; all of them are reached through this tool.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'scheme:// URI, e.g. dsh:// or dsh://docs/architecture.md' },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          url: { type: 'string' },
          contentType: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      try {
        const resource = await registry.resolve(args.path ?? '', { exec })
        return { text: resource.content, url: resource.url, contentType: resource.contentType }
      } catch (error) {
        return {
          url: args.path ?? '',
          contentType: 'text/plain',
          text: '# Error\n\n' + (error instanceof Error ? error.message : String(error)),
        }
      }
    },
  })
}
