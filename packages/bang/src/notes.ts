/**
 * bang — session-flow injection: append the result as a plugin user message
 * (visible in the Web UI, durable, model-visible in later turns) WITHOUT
 * waking the driver. DSH philosophy: visible in the UI == in context.
 */

import type { AgentLike } from './types.js'
import { noteText } from './text.js'

/** Append the result to the session flow (in-context, no wake). */
export function noteToSession(agent: AgentLike, command: string, output: string, exitCode: number): boolean {
  if (agent.session === undefined || typeof agent.session.append !== 'function') return false
  try {
    agent.session.append(
      'user/message',
      {
        id: 'bang-' + Date.now() + '-' + Math.floor(Math.random() * 1e9),
        role: 'user',
        content: [{ type: 'text', text: noteText(command, output, exitCode) }],
        source: { kind: 'plugin', plugin: 'bang' },
      },
      { surfaceOp: 'append' },
    )
    return true
  } catch {
    return false
  }
}
