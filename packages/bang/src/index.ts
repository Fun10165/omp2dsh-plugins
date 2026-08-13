/**
 * bang — quick command runner ported from omp's bang input modes.
 *
 * Architecture (all official DSH mechanisms):
 *  1. Registers TWO independent commands: `/b <cmd>` and `/bb <cmd>`.
 *     (Port of omp's `!` vs `!!`: two distinct prefixes, not an argument
 *     marker — `/bang !!ls` was rejected as an ill-formed hybrid.)
 *  2. Both execute through the DSH shell service with the session's cwd and
 *     resolved sandbox policy (the bash tool's exact path). GUI launchers
 *     (`zed .`, `code .`) are NOT blocked by the file sandbox — the sandbox
 *     constrains file writes, not command execution.
 *  3. `/b` (in-context): the result renders as a persistent command card AND
 *     is appended to the session flow as a plugin user message via
 *     `session.append('user/message', …, { surfaceOp: 'append' })` — visible
 *     in the Web UI, durable, and model-visible in later turns, WITHOUT
 *     waking the driver: no model turn is triggered.
 *  4. `/bb` (excluded): card-only, labeled "Excluded from context".
 *
 * Design rules (repo AGENTS.md): KISS — no runtime deps beyond the DSH
 * runtime, no client code (slash commands trigger natively).
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'bang'

/** Services this plugin hard-depends on. */
export const inject = ['commands', 'shell', 'sandboxPolicy']

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
export interface CommandRegistryLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler(invocation: { agent: AgentLike; rawInput: string; signal?: AbortSignal }): unknown
  }): () => void
}
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

/** Build the card text: plain ASCII, no emoji. */
export function renderCardText(command: string, exitCode: number, output: string, exclude: boolean): string {
  const body = output || '(no output)'
  return (
    '[exit ' + exitCode + '] ' + command + '\n\n' + body +
    (exclude ? '\n\nExcluded from context: visible on this card only.' : '')
  )
}

/** The injected message text: explicit provenance so the model never mistakes it for user-typed input. */
export function noteText(command: string, output: string): string {
  return (
    '> /b ' + command +
    '：用户执行指令的输出（由 bang 插件自动注入，非用户直接输入；仅作上下文参考，除非用户要求否则无需回应）' +
    '\n\n```\n' + output + '\n```'
  )
}

/** Append the result to the session flow (in-context, no wake). */
export function noteToSession(agent: AgentLike, command: string, output: string): boolean {
  if (agent.session === undefined || typeof agent.session.append !== 'function') return false
  try {
    agent.session.append(
      'user/message',
      {
        id: 'bang-' + Date.now() + '-' + Math.floor(Math.random() * 1e9),
        role: 'user',
        content: [{ type: 'text', text: noteText(command, output) }],
        source: { kind: 'plugin', plugin: 'bang' },
      },
      { surfaceOp: 'append' },
    )
    return true
  } catch {
    return false
  }
}

/** Execute one command and build its card result; `include` decides whether the result also enters the session flow. */
export async function executeBangCommand(deps: {
  shell: ShellLike
  sandboxPolicy: SandboxPolicyLike
  timeoutMs?: number
}, agent: AgentLike, command: string, include: boolean, signal?: AbortSignal): Promise<BangCardResult> {
  const { shell, sandboxPolicy, timeoutMs = 60_000 } = deps
  const trimmed = String(command ?? '').trim()
  if (!trimmed) {
    return { kind: 'error', text: 'empty command: use /b <command> or /bb <command>' }
  }
  if (signal?.aborted === true) {
    return { kind: 'error', text: 'cancelled before execution' }
  }
  const cwd = agent.session?.header?.cwd
  const policy = sandboxPolicy.resolve({ session: agent.session })
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
    const output = [textOf(result.stdout), textOf(result.stderr)].filter(Boolean).join('\n')
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1
    if (include) noteToSession(agent, trimmed, output || '(no output)')
    return { kind: exitCode === 0 ? 'success' : 'error', text: renderCardText(trimmed, exitCode, output, !include) }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

export function apply(ctx: Context): void {
  const commands = ctx.get('commands') as CommandRegistryLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  if (commands === undefined || shell === undefined || sandboxPolicy === undefined) {
    ctx.logger?.warn?.('bang: commands/shell/sandboxPolicy unavailable; /b /bb not registered')
    return
  }

  commands.register({
    name: 'b',
    description: 'Run a command quickly; result renders as a command card AND enters the conversation flow (model-visible in later turns, no turn is triggered)',
    input: { hint: '<command>' },
    handler: ({ agent, rawInput, signal }) => executeBangCommand({ shell, sandboxPolicy }, agent, rawInput, true, signal),
  })

  commands.register({
    name: 'bb',
    description: 'Run a command quickly; result renders as a command card ONLY, excluded from model context',
    input: { hint: '<command>' },
    handler: ({ agent, rawInput, signal }) => executeBangCommand({ shell, sandboxPolicy }, agent, rawInput, false, signal),
  })
}
