/**
 * bang — client half: the `⚡ !` / `🔒 !` trigger button in the composer tool
 * row. Execution goes through the OFFICIAL command pipeline: the button maps
 * the draft to `/bang <cmd>` (or `/bang !!<cmd>`) and dispatches it; the
 * commands service logs `command/run`/`command/done` and the Web UI renders a
 * persistent command card in the conversation flow. No dock, no invented
 * rendering, nothing submitted to the model.
 */

/** The RPC seam: one method, the command line to execute. */
export interface BangRpc {
  exec(line: string): Promise<{ ok: boolean; error?: string }>
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

/** Build the official command line for the pipeline. */
export function bangLine(parsed: { command: string; exclude: boolean }): string {
  return '/bang ' + (parsed.exclude ? '!!' : '') + parsed.command
}

/** Dispatch one bang invocation through the official pipeline. */
export async function executeBang(rpc: BangRpc, parsed: { command: string; exclude: boolean }): Promise<boolean> {
  const res = await rpc.exec(bangLine(parsed))
  return res?.ok === true
}
