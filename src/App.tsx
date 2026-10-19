import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { observed } from './live/observed'
import { ModelSession, SCENARIOS, type Action, type ScenarioId, type Variant } from './model/scenarios'
import type { Trace } from './model/types'
import type { Selection } from './panels/common'
import { Debugger } from './panels/Debugger'
import { DiffPanel } from './panels/DiffPanel'
import { DomPanel } from './panels/DomPanel'
import { FiberPanel } from './panels/FiberPanel'
import { Inspector } from './panels/Inspector'
import { LivePanel } from './panels/LivePanel'
import { StatePanel } from './panels/StatePanel'

interface Session {
  model: ModelSession
  trace: Trace
}

function startSession(scenario: ScenarioId, variant: Variant): Session {
  const model = new ModelSession(scenario, variant)
  return { model, trace: model.mount() }
}

export function App(): JSX.Element {
  const [scenario, setScenario] = useState<ScenarioId>('counter')
  const [variant, setVariant] = useState<Variant>('keyed')
  const [epoch, setEpoch] = useState(0)
  const [session, setSession] = useState<Session>(() => startSession('counter', 'keyed'))
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1200)
  const [autoPlay, setAutoPlay] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const autoPlayRef = useRef(autoPlay)
  autoPlayRef.current = autoPlay

  const { trace } = session
  const step = trace.steps[Math.min(index, trace.steps.length - 1)]
  const info = SCENARIOS.find((s) => s.id === scenario)!

  const restart = (next: ScenarioId, nextVariant: Variant): void => {
    observed.clear()
    setScenario(next)
    setVariant(nextVariant)
    setEpoch((e) => e + 1)
    setSession(startSession(next, nextVariant))
    setIndex(0)
    setPlaying(false)
    setSelection(null)
  }

  const emit = useCallback(
    (action: Action) => {
      const current = sessionRef.current
      const nextTrace = current.model.apply(action)
      setSession({ model: current.model, trace: nextTrace })
      setIndex(0)
      setSelection(null)
      setPlaying(autoPlayRef.current)
    },
    [],
  )

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(i, sessionRef.current.trace.steps.length - 1))), [])

  // Playback
  useEffect(() => {
    if (!playing) return
    if (index >= trace.steps.length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex((i) => i + 1), speed)
    return () => clearTimeout(t)
  }, [playing, index, speed, trace])

  const togglePlay = (p: boolean): void => {
    if (p && index >= trace.steps.length - 1) setIndex(0)
    setPlaying(p)
  }

  // Keyboard: ← → step, space play/pause, R reset
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return
      if (e.key === 'ArrowRight') {
        setPlaying(false)
        go(index + 1)
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false)
        go(index - 1)
      } else if (e.key === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault()
        togglePlay(!playing)
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        setPlaying(false)
        go(0)
      } else if (e.key === 'Escape') {
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const inspectFocus = (): void => {
    const id = step.highlight.fibers[0] ?? step.wip?.[0]?.id ?? step.current[0]?.id
    if (id) setSelection({ kind: 'fiber', id })
  }

  const panelProps = { step, selection, onSelect: setSelection }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>React Under the Hood</h1>
          <p>One interaction, six synchronized views: state, elements, fibers, reconciliation, commit and the DOM.</p>
        </div>
        <nav className="scenarios" aria-label="Scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={s.id === scenario ? 'active' : ''} onClick={() => restart(s.id, variant)} title={s.tagline}>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="top-controls">
          {scenario === 'tasks' && (
            <div className="segmented" role="group" aria-label="Keys mode">
              <button className={variant === 'keyed' ? 'active' : ''} onClick={() => restart('tasks', 'keyed')}>
                With keys
              </button>
              <button className={variant === 'index' ? 'active' : ''} onClick={() => restart('tasks', 'index')}>
                No keys (index)
              </button>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
            Auto-play new traces
          </label>
          <button onClick={() => restart(scenario, variant)}>Reset app</button>
        </div>
      </header>

      <p className="tagline">
        <b>{info.title}:</b> {info.tagline}
      </p>

      <Debugger
        trace={trace}
        index={index}
        playing={playing}
        speed={speed}
        onIndex={(i) => {
          setPlaying(false)
          go(i)
        }}
        onPlay={togglePlay}
        onSpeed={setSpeed}
        onInspect={inspectFocus}
      />

      <main className={`grid ${selection ? 'with-inspector' : ''}`}>
        <div className="col col-a">
          <LivePanel scenario={scenario} variant={variant} epoch={epoch} hint={info.hint} emit={emit} />
          <StatePanel {...panelProps} />
        </div>
        <div className="col col-c">
          <FiberPanel {...panelProps} />
        </div>
        <div className="col col-d">
          <DiffPanel key={trace.id} {...panelProps} />
          <DomPanel {...panelProps} before={trace.domBefore} />
        </div>
        {selection && <Inspector step={step} selection={selection} onSelect={setSelection} onClose={() => setSelection(null)} />}
      </main>

      <footer className="foot">
        <b>Observed vs simulated.</b> Panel A and its log are real React 19. Panels B–E replay a small educational
        renderer that follows React&apos;s design (fibers, double buffering, keyed reconciliation, commit phases) but is
        not React&apos;s source. React DevTools has no supported API to single-step Fiber work, so the deep view is a
        transparent model.
      </footer>
    </div>
  )
}
