/**
 * bang — quick command runner ported from omp's bang input modes.
 *
 * Architecture (all official DSH mechanisms):
 *  1. Registers THREE independent commands: `/b <cmd>`, `/bb <cmd>`, `/bq`.
 *     (Port of omp's `!` vs `!!`: two distinct prefixes, not an argument
 *     marker — `/bang !!ls` was rejected as an ill-formed hybrid.)
 *  2. Execution goes through the DSH shell service with the session's cwd and
 *     resolved sandbox policy (the bash tool's exact path). GUI launchers
 *     (`zed .`, `code .`) are NOT blocked by the file sandbox — the sandbox
 *     constrains file writes, not command execution.
 *  3. `/b` (in-context, background): the handler returns immediately so the
 *     composer claim releases; the shell runs off the event loop and its
 *     result is appended to the session flow as a plugin user message via
 *     `session.append('user/message', …, { surfaceOp: 'append' })` — visible,
 *     durable, model-visible in later turns, WITHOUT waking the driver.
 *  4. `/bb` (excluded, synchronous): card-only result labeled
 *     "Excluded from context"; cancelled via the card's ⏹ button (ctx.remote
 *     dispatches /bq — independent of the held composer claim).
 *  5. `/bq`: aborts through a plugin-owned AbortController registry — the
 *     ONLY reliable cancel path (the official UI never forwards a signal).
 *
 * This file is the assembly layer only: types, text, notes, and execution
 * live in sibling files (AGENTS.md: one responsibility per file).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandRegistryLike, RunningBang, SandboxPolicyLike, ShellLike } from './types.js'
import { executeBangCommand, startBangBackground, cancelRunning } from './execution.js'

/** Cordis function-plugin name — must match the cordis.patch.yml row id. */
export const name = 'bang'

/** Services this plugin hard-depends on. */
export const inject = ['commands', 'shell', 'sandboxPolicy']

export type * from './types.js'
export { renderCardText, noteText, cancelLine } from './text.js'
export { noteToSession } from './notes.js'
export { startBangBackground, executeBangCommand, cancelRunning } from './execution.js'

export function apply(ctx: Context): void {
  const commands = ctx.get('commands') as CommandRegistryLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  if (commands === undefined || shell === undefined || sandboxPolicy === undefined) {
    ctx.logger?.warn?.('bang: commands/shell/sandboxPolicy unavailable; /b /bb /bq not registered')
    return
  }

  /** Plugin-owned running registry: /bq aborts by exact command text (or the most recent when omitted). */
  const running = new Map<string, RunningBang>()

  commands.register({
    name: 'b',
    description: 'Run a command quickly; result renders as a command card AND enters the conversation flow (model-visible in later turns, no turn is triggered)',
    input: { hint: '<command>' },
    handler: ({ agent, rawInput }) => startBangBackground({ shell, sandboxPolicy }, agent, rawInput, running).immediate,
  })

  commands.register({
    name: 'bb',
    description: 'Run a command quickly; result renders as a command card ONLY, excluded from model context',
    input: { hint: '<command>' },
    handler: ({ agent, rawInput, signal }) => executeBangCommand({ shell, sandboxPolicy }, agent, rawInput, false, signal, running),
  })

  commands.register({
    name: 'bq',
    description: 'Cancel a running bang command: /bq <command> cancels by exact text, bare /bq cancels the most recent run',
    input: { hint: '[<command>]' },
    handler: ({ rawInput }) => cancelRunning(running, rawInput),
  })
}
