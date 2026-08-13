/**
 * bang — `!` prefix quick command runner (port of omp's bang/bash input modes).
 *
 * Architecture (all official DSH mechanisms, no invented rendering):
 *  1. Registers the `bang` command on the commands service (`/bang <cmd>`).
 *  2. The client button maps `!cmd` -> `/bang cmd` and `!!cmd` -> `/bang !!cmd`
 *     and dispatches through `commands.execute` via a thin Host RPC bridge.
 *  3. The commands service logs `command/run` + `command/done` on the session
 *     and the Web UI renders them as a PERSISTENT command card in the
 *     conversation flow — the chat log is the record, history stays readable.
 *  4. Nothing is submitted to the model: the card is the only outcome. `!!`
 *     adds an explicit "excluded from context" label to the card text.
 *
 * Execution runs through the DSH shell service with the session's cwd and
 * resolved sandbox policy — the same path the bash tool takes. GUI launchers
 * (`zed .`, `code .`) are NOT blocked by the file sandbox (the sandbox
 * constrains file writes, not command execution).
 *
 * Design rules (repo AGENTS.md): KISS — no runtime deps beyond the DSH
 * runtime; decoupling — the runner knows nothing about the UI.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'bang'

/** Services this plugin hard-depends on. */
export const inject = ['commands', 'shell', 'sandboxPolicy', 'agents']

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
    handler(invocation: { agent: { session?: { header?: { cwd?: string } } }; rawInput: string }): unknown
  }): () => void
  execute(agent: unknown, line: string, signal: { aborted: boolean }): Promise<unknown>
}

/** One command-card outcome (the official CommandResult shape). */
export type BangCardResult =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

/** Parse the raw command input after `/bang`: `cmd` or `!!cmd`. */
export function parseBangInput(rawInput: string): { command: string; exclude: boolean } | null {
  const trimmed = String(rawInput ?? '').trim()
  if (trimmed.startsWith('!!')) {
    const command = trimmed.slice(2).trim()
    return command ? { command, exclude: true } : null
  }
  if (trimmed.startsWith('!')) {
    const command = trimmed.slice(1).trim()
    return command ? { command, exclude: false } : null
  }
  const command = trimmed
  return command ? { command, exclude: false } : null
}

/** Build the card text: plain ASCII, no emoji. */
export function renderCardText(command: string, exitCode: number, output: string, exclude: boolean): string {
  const body = output || '(no output)'
  return (
    '[exit ' + exitCode + '] ' + command + '\n\n' + body +
    (exclude ? '\n\nExcluded from context: visible on this card only.' : '')
  )
}

/** Execute one bang invocation inside a command handler; returns the card result. */
export async function executeBangCommand(deps: {
  shell: ShellLike
  sandboxPolicy: SandboxPolicyLike
  timeoutMs?: number
}, agent: { session?: { header?: { cwd?: string } } }, rawInput: string): Promise<BangCardResult> {
  const { shell, sandboxPolicy, timeoutMs = 60_000 } = deps
  const parsed = parseBangInput(rawInput)
  if (parsed === null) return { kind: 'error', text: 'empty command: use !<command> or !!<command>' }
  const { command, exclude } = parsed
  const cwd = agent.session?.header?.cwd
  const policy = sandboxPolicy.resolve({ session: agent.session })
  try {
    const spec = shell.resolve({
      command,
      ...(cwd !== undefined ? { workdir: cwd } : {}),
      sandboxPolicy: policy,
      timeoutMs,
    })
    const result = await shell.run(spec)
    const textOf = (part: { text: string } | string): string =>
      typeof part === 'string' ? part : (part?.text ?? '')
    const output = [textOf(result.stdout), textOf(result.stderr)].filter(Boolean).join('\n')
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1
    return {
      kind: exitCode === 0 ? 'success' : 'error',
      text: renderCardText(command, exitCode, output, exclude),
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/** A never-aborting signal shape (dynamic sandbox has no AbortController). */
export const NEVER_SIGNAL = { aborted: false, addEventListener() {}, removeEventListener() {} }

export function apply(ctx: Context): void {
  const commands = ctx.get('commands') as CommandRegistryLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const agents = ctx.get('agents') as { currentInitiator(): unknown } | undefined
  if (commands === undefined || shell === undefined || sandboxPolicy === undefined) {
    ctx.logger?.warn?.('bang: commands/shell/sandboxPolicy unavailable; /bang not registered')
    return
  }

  commands.register({
    name: 'bang',
    description: '! prefix quick command runner: result renders as a command card; !! prefix adds an excluded-from-context label',
    input: { hint: '<command> or !!<command>' },
    handler: ({ agent, rawInput }) =>
      executeBangCommand({ shell, sandboxPolicy }, agent, rawInput),
  })

  // Thin RPC bridge: client button -> official command pipeline.
  // (Dynamic-plugin prototype wires this through harness.handle('bang/exec');
  // the bundled package can expose the same method via @Remote.)
  ;(ctx as unknown as { bangBridge?: { execute(line: string): Promise<unknown> } }).bangBridge = {
    execute: (line: string) => {
      const agent = agents?.currentInitiator()
      if (agent === undefined) return Promise.resolve({ ok: false, error: 'no active agent' })
      return commands.execute(agent, line, NEVER_SIGNAL).then(
        (execution) => (execution === undefined ? { ok: false, error: 'unknown command: ' + line } : { ok: true }),
        (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}
