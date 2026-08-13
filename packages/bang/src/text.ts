/**
 * bang — pure text rendering: card text, injected-note text, cancel line.
 * All plain ASCII where the user asked for ASCII; provenance is explicit.
 */

/** Build the card text: plain ASCII, no emoji. */
export function renderCardText(command: string, exitCode: number, output: string, exclude: boolean): string {
  const body = output || '(no output)'
  return (
    '[exit ' + exitCode + '] ' + command + '\n\n' + body +
    (exclude ? '\n\nExcluded from context: visible on this card only.' : '')
  )
}

/** The injected message text: explicit provenance plus the exit code so the model knows whether the command succeeded. */
export function noteText(command: string, output: string, exitCode: number): string {
  return (
    '> /b ' + command + ' [exit ' + exitCode + ']' +
    '：用户执行指令的输出（由 bang 插件自动注入，非用户直接输入；仅作上下文参考，除非用户要求否则无需回应）' +
    '\n\n```\n' + output + '\n```'
  )
}

/** The /bq line that cancels a running card: the card args ARE the exact
 * command text the running registry is keyed by (name is /b or /bb, args is
 * the shell command). Lives on the node side so it stays unit-testable. */
export function cancelLine(node: { name: string | null; args: string | null }): string {
  const args = (node.args || '').trim()
  return args ? '/bq ' + args : '/bq'
}
