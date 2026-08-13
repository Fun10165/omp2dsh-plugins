/**
 * bang — `!` prefix quick command runner (port of omp's bang/bash input modes).
 *
 * Host half. Two responsibilities, both tiny:
 *  1. `run(command)`: execute through the DSH shell service with the calling
 *     session's cwd and resolved sandbox policy — the same path the bash tool
 *     takes, so behavior stays predictable and GUI launchers (`zed .`,
 *     `code .`) are NOT blocked by the file sandbox (the sandbox constrains
 *     file writes, not command execution).
 *  2. `note(text)`: write a plugin-sourced user message into the session flow
 *     WITHOUT waking the driver. DSH philosophy: anything visible in the Web
 *     UI is part of context — so `!cmd` results become a durable session
 *     message the model sees in later turns; `!!cmd` results never call
 *     `note` and stay in the client dock, explicitly labeled.
 *
 * Design rules (repo AGENTS.md): KISS — no runtime deps beyond the DSH
 * runtime; decoupling — the runner knows nothing about the UI/dock/trigger
 * wiring (all client-side).
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'bang'

/** Services this plugin hard-depends on. */
export const inject = ['shell', 'sandboxPolicy', 'agents']

/** Minimal faces of the injected services (subset of the DSH contracts). */
export interface ShellLike {
  resolve(request: Record<string, unknown>): { command: string; workdir?: string; timeoutMs?: number }
  run(spec: { command: string; workdir?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{
    exitCode: number
    stdout: { text: string } | string
    stderr: { text: string } | string
    timedOut?: boolean
  }>
}
export interface SandboxPolicyLike {
  resolve(request?: { session?: unknown }): unknown
}
export interface AgentsLike {
  currentInitiator(): { session?: { header?: { cwd?: string } } } | undefined
}

/** One execution outcome, JSON-safe for the client dock. */
export interface BangRunResult {
  ok: boolean
  exitCode?: number
  stdout?: string
  stderr?: string
  timedOut?: boolean
  cwd?: string | null
  error?: string
}

/** The client-facing surface the package exposes (Remote/HTTP wiring lives in the host apply). */
export interface BangService {
  run(command: string, signal?: AbortSignal): Promise<BangRunResult>
  /** Inject a plugin user message into the session flow without waking the driver. */
  note(text: string): { ok: boolean; error?: string }
  currentCwd(): string | null
}

/** Create the runner core (pure logic, testable without cordis). */
export function createBangRunner(deps: {
  shell: ShellLike
  sandboxPolicy: SandboxPolicyLike
  agents?: AgentsLike
  timeoutMs?: number
}): BangService {
  const { shell, sandboxPolicy, agents, timeoutMs = 60_000 } = deps

  function currentCwd(): string | null {
    const agent = agents?.currentInitiator()
    return agent?.session?.header?.cwd ?? null
  }

  async function run(command: string, signal?: AbortSignal): Promise<BangRunResult> {
    const trimmed = command.trim()
    if (!trimmed) return { ok: false, error: 'empty command' }
    const agent = agents?.currentInitiator()
    const cwd = agent?.session?.header?.cwd
    const policy = agent !== undefined ? sandboxPolicy.resolve({ session: agent.session }) : sandboxPolicy.resolve()
    try {
      const spec = shell.resolve({
        command: trimmed,
        ...(cwd !== undefined ? { workdir: cwd } : {}),
        sandboxPolicy: policy,
        timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
      })
      const result = await shell.run(spec)
      const textOf = (part: { text: string } | string): string =>
        typeof part === 'string' ? part : (part?.text ?? '')
      return {
        ok: true,
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1,
        stdout: textOf(result.stdout),
        stderr: textOf(result.stderr),
        timedOut: result.timedOut === true,
        cwd: cwd ?? null,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  function note(text: string): { ok: boolean; error?: string } {
    if (!text) return { ok: false, error: 'empty text' }
    const agent = agents?.currentInitiator() as
      | { send(message: unknown, target: 'next-turn' | 'next-step', wakeup: boolean): void }
      | undefined
    if (agent === undefined) return { ok: false, error: 'no active agent' }
    try {
      agent.send(
        {
          id: 'bang-' + Date.now() + '-' + Math.floor(Math.random() * 1e9),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'bang' },
        },
        'next-turn',
        false,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { run, note, currentCwd }
}

export function apply(ctx: Context): void {
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const agents = ctx.get('agents') as AgentsLike | undefined
  if (shell === undefined || sandboxPolicy === undefined) {
    ctx.logger?.warn?.('bang: shell/sandboxPolicy unavailable; runner not mounted')
    return
  }
  const service = createBangRunner({ shell, sandboxPolicy, agents })

  // RPC surface for the client dock.
  // In the bundled package this is the @Remote seam: the dynamic-plugin
  // prototype wires the same three methods through harness.handle
  // ('bang/run', 'bang/note', 'bang/cwd'). Keep method names identical so
  // the client half is transport-agnostic.
  ctx.provide('bang', service)
}
