/**
 * bang — client half: the `⚡ !` / `🔒 !` trigger button in the composer tool
 * row and the result dock under the composer card.
 *
 * Transport seam: this file calls the three methods through a tiny `rpc`
 * object. The dynamic-plugin prototype wires `rpc` to `host.call` with the
 * method names 'bang/run', 'bang/note', 'bang/cwd'. A bundled deployment can
 * wire the same three names to @Remote methods or an HTTP JSON API without
 * touching this component.
 *
 * DSH philosophy handled here: `!cmd` results are injected into the session
 * flow (visible == in-context) and the dock labels them "injected"; `!!cmd`
 * results are shown ONLY in the dock, labeled "excluded from context — the
 * model cannot see this", so the user is never misled about what the model
 * knows.
 */

/** The RPC seam (see module doc). */
export interface BangRpc {
  run(command: string): Promise<{ ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }>
  note(text: string): Promise<{ ok: boolean; error?: string }>
}

/** Parse a draft into a bang invocation, or null. */
export function parseBangDraft(draft: string): { command: string; exclude: boolean } | null {
  const trimmed = draft.trim()
  if (trimmed.startsWith('!!')) {
    const command = trimmed.slice(2).trim()
    return command ? { command, exclude: true } : null
  }
  if (trimmed.startsWith('!')) {
    const command = trimmed.slice(1).trim()
    return command ? { command, exclude: false } : null
  }
  return null
}

/** One dock entry. */
export interface BangRunState {
  command: string
  exclude: boolean
  status: 'running' | 'done' | 'failed' | 'error'
  output: string
  exitCode: number | null
  error: string | null
}

/** Execute a bang invocation: run, then optionally inject into the session flow. */
export async function executeBang(
  rpc: BangRpc,
  parsed: { command: string; exclude: boolean },
  onState: (state: BangRunState) => void,
): Promise<BangRunState> {
  const base = { command: parsed.command, exclude: parsed.exclude }
  onState({ ...base, status: 'running', output: '', exitCode: null, error: null })
  try {
    const res = await rpc.run(parsed.command)
    if (!res || !res.ok) {
      const state: BangRunState = { ...base, status: 'error', output: '', exitCode: null, error: (res && res.error) || 'run failed' }
      onState(state)
      return state
    }
    const output = [res.stdout, res.stderr].filter(Boolean).join('\n') || '(no output)'
    const state: BangRunState = {
      ...base,
      status: res.exitCode === 0 ? 'done' : 'failed',
      output,
      exitCode: res.exitCode ?? -1,
      error: null,
    }
    onState(state)
    if (!parsed.exclude) {
      // Visible in the Web UI == part of context: write the result into the
      // session flow (durable, model sees it in later turns), without waking
      // the driver so the current turn is never interrupted.
      const note = '> bang executed `' + parsed.command + '`\n\n```\n' + output + '\n```'
      try {
        await rpc.note(note)
      } catch {
        // injection failure must not mask the execution feedback
      }
    }
    return state
  } catch (error) {
    const state: BangRunState = { ...base, status: 'error', output: '', exitCode: null, error: String(error) }
    onState(state)
    return state
  }
}
