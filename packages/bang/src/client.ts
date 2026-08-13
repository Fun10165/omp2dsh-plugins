/**
 * bang — client half: custom `conversation.chat.commandview` cards for the
 * `/b` and `/bb` commands, rendered in the conversation flow.
 *
 * The default GenericCommandCard is collapsed until clicked; users who run a
 * bang command usually want to see the output immediately, so these cards
 * are expanded by default (click the header to collapse). `/bb` cards carry
 * an explicit "excluded from context" label.
 *
 * This file runs in the DSH browser runtime, where `React`, `styles` and the
 * slot registry are injected globals — no imports, no JSX (plain JS source
 * compiled by tsc with ambient declarations).
 */

/* Ambient browser-runtime globals (injected by the DSH client runtime). */
declare const React: {
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown
  useState<T>(initial: T): [T, (next: T) => void]
}
declare const styles: { insert(css: string): () => void }

/** Ambient shape of the slot registry face used here. */
interface SlotRegistryLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: { name: string; key?: string; id?: string; order?: number }, component: (props: unknown) => unknown): () => void
}

/** The command node projected from command/run + command/done. */
export interface BangCommandNode {
  kind: 'command'
  seq: number
  commandId: string
  name: string | null
  args: string | null
  outcome: { kind: 'success' | 'error'; text?: string } | null
}

/** Build the expanded-by-default card markup. Exported for reference; pure React rendering. */
export function BangCardView(node: BangCommandNode, open: boolean, onToggle: () => void): unknown {
  const name = node.name || ''
  const args = (node.args || '').trim()
  const outcome = node.outcome
  const running = outcome === null
  const state = running ? 'Running…' : outcome.kind === 'success' ? 'Done' : 'Failed'
  const body = running ? '' : (outcome.text || '')
  const isExcluded = name === 'bb'
  return React.createElement('div', { className: 'bang-card' },
    React.createElement('div', { className: 'head', onClick: onToggle },
      React.createElement('span', { className: 'chev' }, open ? '▾' : '▸'),
      React.createElement('span', { className: 'title' }, '/' + name + (args ? ' ' + args : '')),
      isExcluded ? React.createElement('span', { className: 'excl' }, 'excluded from context') : null,
      React.createElement('span', { className: 'state' }, state),
    ),
    open && !running ? React.createElement('div', { className: 'body' }, body) : null,
  )
}

/** Register the /b and /bb command cards on the commandview slot. */
export function registerBangCardViews(slots: SlotRegistryLike): () => void {
  const css =
    '.bang-card{display:flex;flex-direction:column;border:1px solid var(--border-1,rgba(128,128,128,.25));border-radius:8px;background:var(--bg-2,rgba(128,128,128,.06));font-size:12px;line-height:1.5;color:var(--text-1,#d8dee9);font-family:var(--font-family,system-ui)}' +
    '.bang-card .head{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;user-select:none}' +
    '.bang-card .head:hover{background:var(--bg-2,rgba(128,128,128,.1))}' +
    '.bang-card .chev{opacity:.6;font-size:10px;width:12px;text-align:center}' +
    '.bang-card .title{font-family:ui-monospace,monospace;font-weight:600}' +
    '.bang-card .state{margin-left:auto;opacity:.75;font-size:11px}' +
    '.bang-card .excl{color:#e6b450;font-size:11px}' +
    '.bang-card .body{white-space:pre-wrap;word-break:break-word;padding:6px 10px 8px;border-top:1px solid var(--border-1,rgba(128,128,128,.15));font-family:ui-monospace,monospace;font-size:11px;max-height:320px;overflow:auto}'
  const disposeStyle = styles.insert(css)

  const Card = (props: { node: BangCommandNode }): unknown => {
    const [open, setOpen] = React.useState(true) // expanded by default: users run bang to see output
    return BangCardView(props.node, open, () => setOpen(!open))
  }

  const disposers: Array<() => void> = []
  for (const key of ['b', 'bb']) {
    slots.inject('conversation.chat.commandview', () => {
      const dispose = slots.register({ name: 'conversation.chat.commandview', key }, (props: unknown) => React.createElement(Card, props as { node: BangCommandNode }))
      disposers.push(dispose)
      return dispose
    })
  }
  return () => {
    disposeStyle()
    for (const dispose of disposers) dispose()
  }
}
