import { useState, type JSX } from 'react'
import type { FiberSnap, SerializedElement } from '../model/types'
import { FlagChip, Panel, type PanelProps } from './common'

// ---------------- React elements (prev vs next) ----------------

interface Line {
  depth: number
  text: string
  changed: boolean
}

function elementLines(el: SerializedElement | null, other: SerializedElement | null, depth: number, out: Line[]): void {
  if (!el) return
  const pad = depth
  if (el.type === '#text') {
    out.push({ depth: pad, text: JSON.stringify(el.text), changed: !other || other.type !== '#text' || other.text !== el.text })
    return
  }
  const typeChanged = !other || other.type !== el.type || other.key !== el.key
  out.push({ depth: pad, text: '{', changed: false })
  out.push({ depth: pad + 1, text: `type: ${/^[A-Z]/.test(el.type) ? el.type : JSON.stringify(el.type)},`, changed: typeChanged })
  if (el.key !== null) out.push({ depth: pad + 1, text: `key: "${el.key}",`, changed: typeChanged })
  const propEntries = Object.entries(el.props)
  if (propEntries.length || el.children.length) {
    out.push({ depth: pad + 1, text: 'props: {', changed: false })
    propEntries.forEach(([k, v]) => out.push({ depth: pad + 2, text: `${k}: ${v},`, changed: !other || other.props[k] !== v }))
    if (el.children.length) {
      out.push({ depth: pad + 2, text: 'children: [', changed: false })
      el.children.forEach((c, i) => elementLines(c, other?.children[i] ?? null, pad + 3, out))
      out.push({ depth: pad + 2, text: ']', changed: false })
    }
    out.push({ depth: pad + 1, text: '}', changed: false })
  }
  out.push({ depth: pad, text: '}', changed: false })
}

function ElementView({ el, other, title, empty }: { el: SerializedElement | null; other: SerializedElement | null; title: string; empty: string }): JSX.Element {
  const lines: Line[] = []
  elementLines(el, other, 0, lines)
  return (
    <div className="element-view">
      <small>{title}</small>
      {el ? (
        <pre>
          {lines.map((l, i) => (
            <div key={i} className={l.changed && other ? 'changed' : ''} style={{ paddingLeft: `${l.depth * 1.1}em` }}>
              {l.text}
            </div>
          ))}
        </pre>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  )
}

// ---------------- Fiber trees ----------------

function FiberRow({
  f,
  props,
  hoverPair,
  setHoverPair,
  deleting,
}: {
  f: FiberSnap
  props: PanelProps
  hoverPair: number | null
  setHoverPair: (p: number | null) => void
  deleting: boolean
}): JSX.Element {
  const { step, selection, onSelect } = props
  const tagShort = { HostRoot: 'root', FunctionComponent: 'fn', HostComponent: 'host', HostText: 'text' }[f.tag]
  const cls = [
    'fiber',
    `fiber-${f.tag}`,
    step.highlight.fibers.includes(f.id) ? 'hl' : '',
    selection?.kind === 'fiber' && selection.id === f.id ? 'selected' : '',
    hoverPair === f.pair ? 'pair' : '',
    deleting ? 'deleting' : '',
  ].join(' ')
  return (
    <button
      className={cls}
      style={{ marginLeft: `${f.depth * 14}px` }}
      onClick={() => onSelect({ kind: 'fiber', id: f.id })}
      onMouseEnter={() => setHoverPair(f.pair)}
      onMouseLeave={() => setHoverPair(null)}
      title={`Fiber #${f.id}. Alternate: ${f.alternateId ? '#' + f.alternateId : 'none'}. Click to inspect.`}
    >
      <span className={`ftag ftag-${f.tag}`}>{tagShort}</span>
      <span className="flabel">{f.label}</span>
      {f.key !== null && <span className="fkey">key=&quot;{f.key}&quot;</span>}
      <span className="fid">#{f.id}</span>
      {f.status && f.status !== 'new' && <span className={`fstatus fstatus-${f.status}`}>{f.status}</span>}
      {f.flags.map((fl) => (
        <FlagChip key={fl} flag={fl} />
      ))}
      {deleting && <FlagChip flag="Deletion" />}
    </button>
  )
}

function Tree({ title, fibers, props, hoverPair, setHoverPair, deleting, note }: {
  title: string
  fibers: FiberSnap[] | null
  props: PanelProps
  hoverPair: number | null
  setHoverPair: (p: number | null) => void
  deleting: Set<string>
  note: string
}): JSX.Element {
  return (
    <div className="tree">
      <div className="tree-head">
        <b>{title}</b>
        <small>{note}</small>
      </div>
      {fibers ? (
        fibers.map((f) => (
          <FiberRow key={f.id} f={f} props={props} hoverPair={hoverPair} setHoverPair={setHoverPair} deleting={deleting.has(f.id)} />
        ))
      ) : (
        <p className="muted tree-empty">No render in progress. React only builds a work-in-progress tree while rendering.</p>
      )}
    </div>
  )
}

export function FiberPanel(props: PanelProps): JSX.Element {
  const { step } = props
  const [hoverPair, setHoverPair] = useState<number | null>(null)
  const deleting = new Set((step.wip ?? []).flatMap((f) => f.deletions))
  const diff = step.elementDiff

  return (
    <Panel letter="C" title="Virtual DOM & Fiber" subtitle="React elements describe the UI; fibers track the work" badge="model">
      <div className="elements">
        <div className="elements-head">
          <b>React elements {diff ? `returned by <${diff.component}>` : ''}</b>
          <small>Lightweight objects. Changed values are highlighted.</small>
        </div>
        <div className="elements-grid">
          <ElementView el={diff?.prev ?? null} other={diff?.next ?? null} title="Previous render" empty={diff ? 'First render: no previous output.' : 'No component has rendered yet in this update.'} />
          <ElementView el={diff?.next ?? null} other={diff?.prev ?? null} title="Next render" empty="Waiting for a component to render." />
        </div>
      </div>

      <div className="trees">
        <Tree title="current" note="what is on screen" fibers={step.current} props={props} hoverPair={hoverPair} setHoverPair={setHoverPair} deleting={deleting} />
        <Tree title="work-in-progress" note={step.lanes ? `rendering ${step.lanes.join(' + ')}` : 'idle'} fibers={step.wip} props={props} hoverPair={hoverPair} setHoverPair={setHoverPair} deleting={new Set()} />
      </div>
      <p className="legend">
        Hover a fiber to see its <b>alternate</b> in the other tree (same number, other buffer: #3a ↔ #3b).{' '}
        <span className="fstatus fstatus-rendered">rendered</span> function was called ·{' '}
        <span className="fstatus fstatus-bailout">bailout</span> skipped ·{' '}
        <span className="fstatus fstatus-cloned">cloned</span> reused without work
      </p>
    </Panel>
  )
}
