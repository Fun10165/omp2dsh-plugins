/**
 * bang — minimal faces of the injected DSH services (subset of the contracts,
 * typed locally so the package stays zero-dependency). Types only, no logic.
 */

/** Minimal face of `ctx.shell` (subset of the dsh-shell contract). */
export interface ShellLike {
  resolve(request: Record<string, unknown>): { command: string; workdir?: string; timeoutMs?: number }
  run(spec: { command: string; workdir?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{
    exitCode: number
    stdout: { text: string } | string
    stderr: { text: string } | string
    timedOut?: boolean
  }>
}

/** Minimal face of `ctx.sandboxPolicy`. */
export interface SandboxPolicyLike {
  resolve(request?: { session?: unknown }): unknown
}

/** Minimal face of `ctx.commands` (subset of the dsh-commands contract). */
export interface CommandRegistryLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler(invocation: { agent: AgentLike; rawInput: string; signal?: AbortSignal }): unknown
  }): () => void
}

/** Minimal face of an agent session (subset of dsh-session). */
export interface AgentLike {
  session?: {
    header?: { cwd?: string }
    append(type: 'user/message', data: unknown, intent: { surfaceOp: 'append' }): unknown
  }
}

/** One command-card outcome (the official CommandResult shape). */
export type BangCardResult =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

/** One running bang execution keyed by its command text. */
export interface RunningBang {
  /** Abort controller owned by this plugin — the ONLY reliable cancel path today
   * (the official UI never forwards a signal: ui-commands executes without one
   * and the gateway falls back to NEVER_ABORTED_SIGNAL). */
  controller: AbortController
  startedAt: number
}
