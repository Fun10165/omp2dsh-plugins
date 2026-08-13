/**
 * bang — execution: foreground (synchronous /bb) and background (/b)
 * shell runs with self-owned cancellation (the official UI never aborts the
 * command signal, so /bq aborts through a plugin-owned AbortController).
 */

import type { AgentLike, BangCardResult, RunningBang, SandboxPolicyLike, ShellLike } from './types.js'
import { renderCardText } from './text.js'
import { noteToSession } from './notes.js'

/** Start a bang command in the background: the handler returns immediately so the
 * composer claim releases and the user can type /bq or keep chatting; the shell
 * runs off the event loop and its result is injected into the session flow
 * (with provenance marker + exit code) when it settles. */
export function startBangBackground(deps: {
  shell: ShellLike
  sandboxPolicy: SandboxPolicyLike
  timeoutMs?: number
}, agent: AgentLike, command: string, running: Map<string, RunningBang>): { immediate: BangCardResult; done: Promise<void> } {
  const { shell, sandboxPolicy, timeoutMs = 60_000 } = deps
  const trimmed = String(command ?? '').trim()
  if (!trimmed) {
    return { immediate: { kind: 'error', text: 'empty command: use /b <command>' }, done: Promise.resolve() }
  }
  const controller = new AbortController()
  running.set(trimmed, { controller, startedAt: Date.now() })
  const done = (async () => {
    const cwd = agent.session?.header?.cwd
    const policy = sandboxPolicy.resolve({ session: agent.session })
    try {
      const spec = shell.resolve({
        command: trimmed,
        ...(cwd !== undefined ? { workdir: cwd } : {}),
        sandboxPolicy: policy,
        timeoutMs,
        signal: controller.signal,
      })
      const result = await shell.run(spec)
      const textOf = (part: { text: string } | string): string =>
        typeof part === 'string' ? part : (part?.text ?? '')
      const output = [textOf(result.stdout), textOf(result.stderr)].filter(Boolean).join('\n')
      const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1
      noteToSession(agent, trimmed, output || '(no output)', exitCode)
    } catch (error) {
      noteToSession(agent, trimmed, 'error: ' + (error instanceof Error ? error.message : String(error)), -1)
    } finally {
      running.delete(trimmed)
    }
  })()
  return {
    immediate: { kind: 'success', text: 'started: ' + trimmed + ' — result will be injected into context when finished (/bq to cancel)' },
    done,
  }
}

/** Execute one command and build its card result; `include` decides whether the result also enters the session flow. */
export async function executeBangCommand(deps: {
  shell: ShellLike
  sandboxPolicy: SandboxPolicyLike
  timeoutMs?: number
}, agent: AgentLike, command: string, include: boolean, signal?: AbortSignal, running?: Map<string, RunningBang>): Promise<BangCardResult> {
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
  // Self-owned cancellation: the official command pipeline never aborts its
  // signal from the Web UI (ui-commands executes without one, gateway falls
  // back to NEVER_ABORTED_SIGNAL), so /bq must be able to abort this run.
  // The invocation signal (whenever the UI does forward one) is bridged onto
  // the same controller — either abort path stops the shell.
  const controller = new AbortController()
  running?.set(trimmed, { controller, startedAt: Date.now() })
  const bridge = signal !== undefined && !signal.aborted ? () => controller.abort() : undefined
  if (signal !== undefined && signal.aborted) controller.abort()
  if (bridge !== undefined) signal!.addEventListener('abort', bridge, { once: true })
  try {
    const spec = shell.resolve({
      command: trimmed,
      ...(cwd !== undefined ? { workdir: cwd } : {}),
      sandboxPolicy: policy,
      timeoutMs,
      signal: controller.signal,
    })
    const result = await shell.run(spec)
    const textOf = (part: { text: string } | string): string =>
      typeof part === 'string' ? part : (part?.text ?? '')
    const output = [textOf(result.stdout), textOf(result.stderr)].filter(Boolean).join('\n')
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1
    if (include) noteToSession(agent, trimmed, output || '(no output)', exitCode)
    return { kind: exitCode === 0 ? 'success' : 'error', text: renderCardText(trimmed, exitCode, output, !include) }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  } finally {
    running?.delete(trimmed)
    if (bridge !== undefined) signal!.removeEventListener('abort', bridge)
  }
}

/** Abort a running command by exact text, or the most recent run. */
export function cancelRunning(running: Map<string, RunningBang>, rawInput: string): BangCardResult {
  const target = String(rawInput || '').trim()
  if (target !== '') {
    const entry = running.get(target)
    if (entry === undefined) return { kind: 'error', text: 'no running bang command: ' + target }
    entry.controller.abort()
    return { kind: 'success', text: 'cancelled: ' + target }
  }
  // Most recent run (Map preserves insertion order; delete clears on settle).
  let latest: { command: string; entry: RunningBang } | undefined
  for (const [command, entry] of running) {
    if (latest === undefined || entry.startedAt > latest.entry.startedAt) latest = { command, entry }
  }
  if (latest === undefined) return { kind: 'error', text: 'no running bang command' }
  latest.entry.controller.abort()
  return { kind: 'success', text: 'cancelled: ' + latest.command }
}
