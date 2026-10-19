import { useState, type JSX } from 'react'
import type { Decision, ReconcileGroup } from '../model/types'
import { Panel, type PanelProps } from './common'

const ROW = 46
const GAP = 8

const ACTION_TEXT: Record<Decision['action'], string> = {
  mount: 'mount',
  reuse: 'reuse',
  move: 'reuse + move',
  insert: 'insert',
  replace: 'replace',
  delete: 'delete',
}

function interesting(g: ReconcileGroup): boolean {
  return g.prev.length + g.next.length > 1 || g.decisions.some((d) => d.action !== 'reuse')
}

export function DiffPanel(props: PanelProps): JSX.Element {
  const { step, selection, onSelect } = props
  const [picked, setPicked] = useState<number | null>(null)
  const groups = step.groups
  const fromStep = step.highlight.group
  const fallback = [...groups].reverse().find((g) => g.tracked && interesting(g)) ?? groups[groups.length - 1]
  const group = groups.find((g) => g.index === (fromStep ?? picked)) ?? fallback

  return (
    <Panel letter="D" title="Reconciliation & diff" subtitle="Which child fibers are reused, moved, inserted or deleted, and why" badge="model">
      {!group ? (
        <p className="muted">Reconciliation happens during render. Step forward to see React compare children.</p>
      ) : (
        <>
          <div className="diff-pick">
            <label>
              Parent
              <select value={group.index} onChange={(e) => setPicked(Number(e.target.value))} disabled={fromStep !== null}>
                {groups.map((g) => (
                  <option key={g.index} value={g.index}>
                    {g.parentLabel} ({g.next.length} children)
                  </option>
                ))}
              </select>
            </label>
            <span className={`keymode ${group.keyed ? 'on' : 'off'}`}>{group.keyed ? 'matched by key' : 'matched by position'}</span>
            {!group.tracked && <span className="keymode">new parent: mount</span>}
          </div>

          <DiffColumns group={group} selected={selection?.kind === 'decision' && selection.group === group.index ? selection.index : null} onSelect={(i) => onSelect({ kind: 'decision', group: group.index, index: i })} />

          <ol className="decisions">
            {group.decisions.map((d, i) => (
              <li key={i}>
                <button
                  className={`decision action-${d.action} ${selection?.kind === 'decision' && selection.group === group.index && selection.index === i ? 'selected' : ''}`}
                  onClick={() => onSelect({ kind: 'decision', group: group.index, index: i })}
                >
                  <span className={`act act-${d.action}`}>{ACTION_TEXT[d.action]}</span>
                  <b>{d.label}</b>
                  {d.key !== null && <code>key=&quot;{d.key}&quot;</code>}
                  <span className="reason">{d.reason}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  )
}

function DiffColumns({ group, selected, onSelect }: { group: ReconcileGroup; selected: number | null; onSelect: (i: number) => void }): JSX.Element {
  const rows = Math.max(group.prev.length, group.next.length, 1)
  const height = rows * (ROW + GAP)
  const y = (i: number): number => i * (ROW + GAP) + ROW / 2
  const byOld = new Map(group.decisions.filter((d) => d.oldIndex !== null).map((d) => [d.oldIndex as number, d]))
  const byNew = new Map(group.decisions.filter((d) => d.newIndex !== null).map((d) => [d.newIndex as number, d]))

  return (
    <div className="diff-cols">
      <div className="diff-col">
        <small>Previous children (current fibers)</small>
        {group.prev.length === 0 && <div className="diff-item empty">none</div>}
        {group.prev.map((c) => {
          const d = byOld.get(c.index)
          const reused = d && d.action !== 'delete' && d.action !== 'replace'
          return (
            <div key={c.fiberId} className={`diff-item ${reused ? '' : 'gone'}`} style={{ height: ROW, marginBottom: GAP }}>
              <span className="pos">{c.index}</span>
              <span>
                <b>{c.label}</b> {c.key !== null && <code>key=&quot;{c.key}&quot;</code>}
                {c.state && <em className="item-state">{c.state}</em>}
              </span>
            </div>
          )
        })}
      </div>
      <svg className="diff-lines" width="64" height={height} aria-hidden="true">
        {group.decisions.map((d, i) =>
          d.oldIndex !== null && d.newIndex !== null && d.action !== 'replace' ? (
            <path
              key={i}
              className={`line act-${d.action} ${selected === i ? 'selected' : ''}`}
              d={`M0 ${y(d.oldIndex)} C 32 ${y(d.oldIndex)}, 32 ${y(d.newIndex)}, 64 ${y(d.newIndex)}`}
              onClick={() => onSelect(i)}
            />
          ) : null,
        )}
      </svg>
      <div className="diff-col">
        <small>Next children (new elements)</small>
        {group.next.map((c) => {
          const d = byNew.get(c.index)
          const i = d ? group.decisions.indexOf(d) : -1
          return (
            <button
              key={c.fiberId}
              className={`diff-item act-bg-${d?.action ?? 'reuse'} ${selected === i ? 'selected' : ''}`}
              style={{ height: ROW, marginBottom: GAP }}
              onClick={() => i >= 0 && onSelect(i)}
            >
              <span className="pos">{c.index}</span>
              <span>
                <b>{c.label}</b> {c.key !== null && <code>key=&quot;{c.key}&quot;</code>}
                {c.state && <em className="item-state">{c.state}</em>}
              </span>
              {d && <span className={`act act-${d.action}`}>{ACTION_TEXT[d.action]}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
