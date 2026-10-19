import type { JSX, ReactNode } from 'react'
import { findFiber, FlagChip, type Selection } from './common'
import type { Step } from '../model/types'

interface Props {
  step: Step
  selection: Selection
  onSelect: (s: Selection) => void
  onClose: () => void
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="insp-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function Inspector({ step, selection, onSelect, onClose }: Props): JSX.Element {
  const link = (id: string | null): ReactNode =>
    id ? (
      <button className="link" onClick={() => onSelect({ kind: 'fiber', id })}>
        #{id} {findFiber(step, id)?.fiber.label ?? ''}
      </button>
    ) : (
      <span className="muted">null</span>
    )
  const domLink = (id: string | null): ReactNode =>
    id ? (
      <button className="link" onClick={() => onSelect({ kind: 'dom', id })}>
        {id}
      </button>
    ) : (
      <span className="muted">null</span>
    )

  let title = ''
  let body: ReactNode = null

  if (selection.kind === 'fiber') {
    const found = findFiber(step, selection.id)
    if (found) {
      const f = found.fiber
      title = `Fiber #${f.id} ${f.label}`
      body = (
        <>
          <p className="insp-role">
            {found.tree === 'wip' ? 'In the work-in-progress tree (being built).' : 'In the current tree (on screen).'}{' '}
            {f.tag === 'FunctionComponent'
              ? 'A component fiber: it owns hooks and calls your function during render.'
              : f.tag === 'HostComponent'
                ? 'A host fiber: it owns one DOM element.'
                : f.tag === 'HostText'
                  ? 'A text fiber: it owns one DOM text node.'
                  : 'The root of the fiber tree, attached to the container element.'}
          </p>
          <dl>
            <Row label="tag">{f.tag}</Row>
            <Row label="type">{f.type}</Row>
            <Row label="key">{f.key ?? <span className="muted">null</span>}</Row>
            <Row label="index">{f.index}</Row>
            <Row label="return (parent)">{link(f.parentId)}</Row>
            <Row label="child">{link(f.childId)}</Row>
            <Row label="sibling">{link(f.siblingId)}</Row>
            <Row label="alternate">{link(f.alternateId)}</Row>
            <Row label="stateNode (DOM)">{domLink(f.domId)}</Row>
            <Row label="flags">{f.flags.length ? f.flags.map((x) => <FlagChip key={x} flag={x} />) : <span className="muted">none</span>}</Row>
            <Row label="status">{f.status ?? <span className="muted">—</span>}</Row>
            <Row label="props">
              <code>{Object.keys(f.props).length ? Object.entries(f.props).map(([k, v]) => `${k}: ${v}`).join(', ') : '{}'}</code>
            </Row>
            {f.updatePayload && (
              <Row label="updatePayload">
                {f.updatePayload.map((p) => (
                  <code key={p.prop}>
                    {p.prop}: &quot;{p.from}&quot; → &quot;{p.to}&quot;
                  </code>
                ))}
              </Row>
            )}
            {f.hooks.length > 0 && (
              <Row label="hooks (memoizedState)">
                {f.hooks.map((h) => (
                  <code key={h.index}>
                    {h.index + 1}. {h.name} = {h.value}
                  </code>
                ))}
              </Row>
            )}
            {f.deletions.length > 0 && <Row label="deletions">{f.deletions.map((d) => link(d))}</Row>}
          </dl>
        </>
      )
    }
  } else if (selection.kind === 'dom') {
    const n = step.dom.nodes[selection.id]
    const owner = [...(step.wip ?? []), ...step.current].find((f) => f.domId === selection.id)
    if (n) {
      title = `DOM node ${n.id}`
      body = (
        <>
          <p className="insp-role">A real document node (in this model, a serialisable stand-in). Fibers point to it through stateNode.</p>
          <dl>
            <Row label="nodeType">{n.kind}</Row>
            <Row label="tag">{n.tag}</Row>
            {n.kind === 'text' && <Row label="nodeValue">“{n.text}”</Row>}
            <Row label="properties">
              <code>{Object.keys(n.attrs).length ? Object.entries(n.attrs).map(([k, v]) => `${k}=${v}`).join(' ') : 'none'}</code>
            </Row>
            <Row label="parentNode">{n.parent ? domLink(n.parent) : <span className="muted">detached</span>}</Row>
            <Row label="childNodes">{n.children.length ? n.children.map((c) => <span key={c}>{domLink(c)} </span>) : <span className="muted">none</span>}</Row>
            <Row label="owned by fiber">{owner ? link(owner.id) : <span className="muted">none</span>}</Row>
          </dl>
        </>
      )
    }
  } else if (selection.kind === 'mutation') {
    const m = step.mutations[selection.index]
    if (m) {
      title = `Mutation ${m.index + 1}: ${m.op}`
      body = (
        <>
          <p className="insp-role">{m.summary}</p>
          <dl>
            <Row label="code">
              <code>{m.code}</code>
            </Row>
            <Row label="target">{domLink(m.target)}</Row>
            {m.parent && <Row label="parent">{domLink(m.parent)}</Row>}
            {m.before && <Row label="before">{domLink(m.before)}</Row>}
            <Row label="caused by fiber">{link(m.fiberId)}</Row>
          </dl>
        </>
      )
    }
  } else if (selection.kind === 'decision') {
    const g = step.groups.find((x) => x.index === selection.group)
    const d = g?.decisions[selection.index]
    if (g && d) {
      title = `Reconciliation: ${d.action} ${d.label}`
      body = (
        <>
          <p className="insp-role">{d.reason}</p>
          <dl>
            <Row label="parent">{link(g.parentId)}</Row>
            <Row label="key">{d.key ?? <span className="muted">null (matched by index)</span>}</Row>
            <Row label="old index">{d.oldIndex ?? '—'}</Row>
            <Row label="new index">{d.newIndex ?? '—'}</Row>
            <Row label="fiber">{link(d.fiberId)}</Row>
            {d.oldFiberId && d.oldFiberId !== d.fiberId && <Row label="previous fiber">{link(d.oldFiberId)}</Row>}
          </dl>
        </>
      )
    }
  } else if (selection.kind === 'effect') {
    const e = step.effects[selection.index]
    if (e) {
      title = `${e.kind === 'layout' ? 'useLayoutEffect' : 'useEffect'} "${e.name}"`
      body = (
        <>
          <p className="insp-role">
            {e.kind === 'layout'
              ? 'Ran during commit, after DOM mutations and before the browser paints.'
              : 'Ran after commit. It does not block the paint (except when React flushes it early for a discrete event).'}
          </p>
          <dl>
            <Row label="component">{e.component}</Row>
            <Row label="result">{e.message}</Row>
            <Row label="fiber">{link(e.fiberId)}</Row>
          </dl>
        </>
      )
    }
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <header>
        <h2>{title || 'Not in this step'}</h2>
        <button className="link" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>
      {body ?? <p className="muted">This item does not exist at the current step. Step forward or back, or pick another node.</p>}
    </aside>
  )
}
