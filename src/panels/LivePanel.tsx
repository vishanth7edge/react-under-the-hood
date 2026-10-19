import { memo, useEffect, useRef, type JSX } from 'react'
import { LiveCounter, LiveEffects, LiveParent, LiveSearch, LiveTasks } from '../live/LiveApps'
import { observed, useDomObserver, useObservedLog } from '../live/observed'
import type { Action, ScenarioId, Variant } from '../model/scenarios'
import { Panel } from './common'

interface Props {
  scenario: ScenarioId
  variant: Variant
  epoch: number
  hint: string
  emit: (action: Action) => void
}

// Memoized so the real app only renders when the student interacts with it,
// not every time the debugger moves or the observed log updates.
const LiveStage = memo(function LiveStage({ scenario, variant, emit }: Pick<Props, 'scenario' | 'variant' | 'emit'>): JSX.Element {
  switch (scenario) {
    case 'counter':
      return <LiveCounter emit={emit} />
    case 'tasks':
      return <LiveTasks emit={emit} variant={variant} />
    case 'props':
      return <LiveParent emit={emit} />
    case 'effects':
      return <LiveEffects emit={emit} />
    case 'search':
      return <LiveSearch emit={emit} />
  }
})

function ObservedLog(): JSX.Element {
  const log = useObservedLog()
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [log])
  return (
    <div className="observed">
      <div className="observed-head">
        <small>Observed in the real app</small>
        <button className="link" onClick={() => observed.clear()}>
          clear
        </button>
      </div>
      <ol ref={listRef}>
        {log.length === 0 && <li className="muted">Interact with the app to see real renders, commits, effects and DOM mutations.</li>}
        {log.map((e) => (
          <li key={e.id} className={`obs obs-${e.kind}`}>
            <span className="t">{e.kind === 'event' ? '' : `+${e.time.toFixed(1)} ms`}</span>
            <span className="k">{e.kind}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
      <p className="fineprint">
        DOM entries come from a MutationObserver. Property-only writes such as <code>input.checked</code> are not
        attribute mutations, so they don&apos;t appear here, even though React performs them.
      </p>
    </div>
  )
}

export const LivePanel = memo(function LivePanel({ scenario, variant, epoch, hint, emit }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDomObserver(ref, `${scenario}-${variant}-${epoch}`)

  return (
    <Panel letter="A" title="Interactive React app" subtitle="Real React 19. Interact here; every action starts a new trace." badge="observed">
      <p className="hint">{hint}</p>
      <div className="live-stage" ref={ref} key={`${scenario}-${variant}-${epoch}`}>
        <LiveStage scenario={scenario} variant={variant} emit={emit} />
      </div>
      <ObservedLog />
    </Panel>
  )
})
