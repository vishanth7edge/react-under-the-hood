import type { JSX } from 'react'
import type { FiberSnap, HookSnap } from '../model/types'
import { findByPair, findFiber, Panel, type PanelProps } from './common'

function pickFiber({ step, selection }: PanelProps): FiberSnap | null {
  if (selection?.kind === 'fiber') {
    const f = findFiber(step, selection.id)?.fiber
    if (f?.tag === 'FunctionComponent') return f
  }
  if (step.focusPair !== null) {
    const f = findByPair(step, step.focusPair)
    if (f?.tag === 'FunctionComponent') return f
  }
  return (step.wip ?? step.current).find((f) => f.tag === 'FunctionComponent') ?? null
}

function HookCard({ hook, highlighted }: { hook: HookSnap; highlighted: boolean }): JSX.Element {
  const kindLabel = hook.kind === 'state' ? 'useState' : hook.kind === 'layout' ? 'useLayoutEffect' : 'useEffect'
  return (
    <div className={`hook ${highlighted ? 'hl' : ''}`}>
      <div className="hook-head">
        <span className="hook-n">Hook {hook.index + 1}</span>
        <code>{kindLabel}</code>
        <span className="hook-name">{hook.name}</span>
      </div>
      {hook.kind === 'state' ? (
        <div className="hook-state">
          {hook.prev !== null && hook.changed ? (
            <>
              <div>
                <small>previous state</small>
                <b className={hook.prev.length > 12 ? 'long' : ''}>{hook.prev}</b>
              </div>
              <span className="arrow">→</span>
              <div className="next">
                <small>next state</small>
                <b className={hook.value.length > 12 ? 'long' : ''}>{hook.value}</b>
              </div>
            </>
          ) : (
            <div>
              <small>memoizedState</small>
              <b className={hook.value.length > 12 ? 'long' : ''}>{hook.value}</b>
            </div>
          )}
        </div>
      ) : (
        <div className="hook-effect">
          <small>deps {hook.deps}</small>
          <span className={hook.needsRun ? 'tag-run' : 'tag-skip'}>{hook.needsRun ? 'will run' : 'idle'}</span>
        </div>
      )}
      {hook.kind === 'state' && (
        <div className="queue">
          <small>update queue</small>
          {hook.queue.length === 0 ? (
            <span className="empty">empty</span>
          ) : (
            hook.queue.map((u) => {
              const status = hook.processed.includes(u.id) ? 'processed' : hook.skipped.includes(u.id) ? 'skipped' : 'pending'
              return (
                <span key={u.id} className={`update update-${status}`} title={`${status} · lane ${u.lane}`}>
                  #{u.id} {u.label} <em>{u.lane}</em>
                  <i>{status === 'processed' ? '✓ applied in this render' : status === 'skipped' ? '⤳ skipped (lane not rendering)' : 'waiting'}</i>
                </span>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export function StatePanel(props: PanelProps): JSX.Element {
  const { step } = props
  const fiber = pickFiber(props)
  const hl = step.highlight.hook
  const inWip = fiber ? step.wip?.some((f) => f.id === fiber.id) : false
  const sourceLines = fiber?.source?.split('\n') ?? []

  return (
    <Panel letter="B" title="Component state & hooks" subtitle="Where state lives and how updates are queued" badge="model">
      {!fiber ? (
        <p className="muted">No function component in this tree.</p>
      ) : (
        <>
          <div className="identity">
            <div>
              <small>component identity</small>
              <b>{fiber.label}</b>
            </div>
            <div>
              <small>fiber</small>
              <b>
                #{fiber.id} <span className="muted">{inWip ? 'work-in-progress' : 'current'}</span>
              </b>
            </div>
            <div>
              <small>position</small>
              <b>{fiber.key !== null ? `key "${fiber.key}"` : `index ${fiber.index}`}</b>
            </div>
          </div>

          <div className="hook-chain" aria-label="Hooks linked list">
            <span className="chain-start">fiber.memoizedState</span>
            {fiber.hooks.map((h) => (
              <span key={h.index} className="chain-link">
                → <HookCard hook={h} highlighted={hl?.index === h.index && hl.fiberId === fiber.id} />
              </span>
            ))}
            <span className="chain-end">→ null</span>
          </div>

          {sourceLines.length > 0 && (
            <pre className="code-source">
              {sourceLines.map((line, i) => (
                <div key={i} className={/use(State|Effect|LayoutEffect)\(/.test(line) ? 'hook-line' : ''}>
                  {line || ' '}
                </div>
              ))}
            </pre>
          )}

          <div className="pending">
            <small>All pending updates on the root</small>
            {step.pending.length === 0 ? (
              <span className="empty">none</span>
            ) : (
              step.pending.map((u) => (
                <span key={u.id} className="update update-pending">
                  #{u.id} {u.owner} · {u.hookName}: {u.label} <em>{u.lane}</em>
                </span>
              ))
            )}
          </div>

          <p className="callout">
            React does not read state back from the DOM. Hook state is stored on the component&apos;s fiber as a list,
            matched by call order, which is why hooks can&apos;t be called conditionally. This is a conceptual view, not a
            memory dump; the real structures are an implementation detail that changes between versions.
          </p>
        </>
      )}
    </Panel>
  )
}
