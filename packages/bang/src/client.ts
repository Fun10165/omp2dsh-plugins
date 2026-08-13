/**
 * bang — client half: custom `conversation.chat.commandview` cards for the
 * `/b` and `/bb` commands, rendered in the conversation flow.
 *
 * The default GenericCommandCard is collapsed until clicked; users who run a
 * bang command usually want to see the output immediately, so these cards
 * are expanded by default (click the header to collapse). `/bb` cards carry
 * an explicit "excluded from context" label.
 *
 * Contract (DSH packages/client/AGENTS.md): a client plugin exports only
 * `inject` and `apply`; composition happens through `ctx.slots.inject` +
 * `ctx.slots.register` inside `apply`. The build (tsdown, see
 * tsdown.config.ts) wraps this file in `window.__ModuleLoader__.load` with
 * react resolved from the loader module table.
 */

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { cancelLine } from './index.js'
import type { ClientContext, CommandNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandRowOwnerProps, CommandRowProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `conversation.chat.commandview` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Required services: the slot registry. */
export const inject = ['slots']

/** Card state: running while unsettled; outcome kind after settlement. */
type CardState = 'running' | 'success' | 'error'

function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CardState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'success'
}

/** CSS-in-JS, all values from the DSH `--dsw-alias-*` design tokens. */
const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'var(--dsw-font-family)',
}
const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  userSelect: 'none',
}
const chevStyle: CSSProperties = { opacity: 0.6, fontSize: 10, width: 12, textAlign: 'center' }
const titleStyle: CSSProperties = { fontFamily: 'var(--ds-font-family-code)', fontWeight: 600 }
const exclStyle: CSSProperties = { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11 }
const stateStyle: CSSProperties = { marginLeft: 'auto', opacity: 0.75, fontSize: 11 }
const cancelStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-state-error-primary)',
  borderRadius: 6,
  padding: '1px 8px',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'var(--dsw-font-family)',
}
const bodyStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  padding: '6px 10px 8px',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  fontFamily: 'var(--ds-font-family-code)',
  fontSize: 11,
  maxHeight: 320,
  overflow: 'auto',
}
const errorStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' }

/** Build the expanded-by-default card markup. Pure React rendering. */
function BangCardView({ node, open, onToggle, onCancel }: {
  node: CommandNode
  open: boolean
  onToggle: () => void
  onCancel?: () => void
}): ReactNode {
  const name = node.name || ''
  const args = (node.args || '').trim()
  const outcome = node.outcome
  const running = outcome === null
  const state = stateOf(outcome)
  const body = running ? '' : (outcome.text || '')
  const isExcluded = name === 'bb'
  const stateLabel = running ? 'Running…' : state === 'success' ? 'Done' : 'Failed'

  return createElement(
    'div',
    { style: rootStyle },
    createElement(
      'div',
      { style: headStyle, onClick: onToggle },
      createElement('span', { style: chevStyle }, open ? '▾' : '▸'),
      createElement('span', { style: titleStyle }, '/' + name + (args ? ' ' + args : '')),
      isExcluded ? createElement('span', { style: exclStyle }, 'excluded from context') : null,
      // Cancel affordance while running: the composer claim may be held by a
      // synchronous /bb, so cancellation must NOT depend on the input box.
      running && onCancel !== undefined
        ? createElement(
            'button',
            { style: cancelStyle, onClick: (event: { stopPropagation(): void }) => { event.stopPropagation(); onCancel() } },
            '⏹ cancel',
          )
        : null,
      createElement('span', { style: stateStyle }, stateLabel),
    ),
    open && !running
      ? createElement('div', { style: state === 'error' ? { ...bodyStyle, ...errorStyle } : bodyStyle }, body)
      : null,
  )
}

/** Keyed commandview registrant: expanded by default, one per command name. */
function BangCard({ node, sessionId, onCancel }: CommandRowProps & { onCancel?: (line: string) => void }): ReactNode {
  const [open, setOpen] = useState(true)
  return createElement(BangCardView, {
    node,
    open,
    onToggle: () => setOpen((value) => !value),
    onCancel: onCancel !== undefined && node.outcome === null
      ? () => onCancel(cancelLine(node))
      : undefined,
  })
}

/**
 * Client plugin body: register the `/b` and `/bb` cards on the
 * conversation's keyed commandview hole. Waiting on the declaration mirrors
 * the official registrants: a direct register racing the declaration fails
 * boot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Cancel goes through the official command pipeline as /bq, dispatched via
  // ctx.remote — completely independent of the composer, so it works even
  // while a synchronous /bb holds the input claim.
  const remote = (ctx as { remote?: { commands?: { execute(sessionId: string, line: string): Promise<unknown> } } }).remote
  const onCancel = (sessionId: string, line: string): void => {
    if (remote?.commands === undefined) return
    void remote.commands.execute(sessionId, line).catch(() => {})
  }
  const Card = (props: CommandRowProps): ReactNode =>
    createElement(BangCard, { ...props, onCancel: (line) => onCancel(props.sessionId, line) })
  for (const key of ['b', 'bb']) {
    ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
      { name: 'conversation.chat.commandview', key },
      Card,
    ))
  }
}
