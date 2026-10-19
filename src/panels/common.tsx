import type { JSX, ReactNode } from 'react'
import type { FiberSnap, Step } from '../model/types'

export type Selection =
  | { kind: 'fiber'; id: string }
  | { kind: 'dom'; id: string }
  | { kind: 'mutation'; index: number }
  | { kind: 'decision'; group: number; index: number }
  | { kind: 'effect'; index: number }

export interface PanelProps {
  step: Step
  selection: Selection | null
  onSelect: (s: Selection) => void
}

export function Panel({
  letter,
  title,
  subtitle,
  badge,
  children,
  className = '',
}: {
  letter: string
  title: string
  subtitle?: string
  badge?: 'observed' | 'model'
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-head">
        <span className="panel-letter">{letter}</span>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {badge && <SourceBadge source={badge} />}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function SourceBadge({ source }: { source: 'observed' | 'model' }): JSX.Element {
  return (
    <span className={`source source-${source}`} title={source === 'observed' ? 'Measured from the real React app' : 'Simplified educational model'}>
      {source === 'observed' ? 'Observed · real React' : 'Simulated · model'}
    </span>
  )
}

export function findFiber(step: Step, id: string): { fiber: FiberSnap; tree: 'current' | 'wip' } | null {
  const w = step.wip?.find((f) => f.id === id)
  if (w) return { fiber: w, tree: 'wip' }
  const c = step.current.find((f) => f.id === id)
  return c ? { fiber: c, tree: 'current' } : null
}

export function findByPair(step: Step, pair: number): FiberSnap | null {
  return step.wip?.find((f) => f.pair === pair) ?? step.current.find((f) => f.pair === pair) ?? null
}

export function FlagChip({ flag }: { flag: string }): JSX.Element {
  return <span className={`flag flag-${flag}`}>{flag}</span>
}

export const STAGES: { id: Step['stage']; label: string; desc: string }[] = [
  { id: 'trigger', label: 'Trigger', desc: 'Event handler runs and calls a state setter' },
  { id: 'schedule', label: 'Schedule', desc: 'React schedules work based on the update lane' },
  { id: 'render', label: 'Render', desc: 'Components run; the next output is calculated' },
  { id: 'reconcile', label: 'Reconcile', desc: 'Previous and next children are compared' },
  { id: 'commit', label: 'Commit', desc: 'DOM mutations and layout effects are applied' },
  { id: 'browser', label: 'Browser', desc: 'Style, layout, paint and compositing' },
  { id: 'effects', label: 'Effects', desc: 'useEffect callbacks run after commit' },
]
