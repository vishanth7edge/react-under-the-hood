import type { JSX } from 'react'
import type { Trace } from '../model/types'
import { SourceBadge, STAGES } from './common'

interface Props {
  trace: Trace
  index: number
  playing: boolean
  speed: number
  onIndex: (i: number) => void
  onPlay: (p: boolean) => void
  onSpeed: (ms: number) => void
  onInspect: () => void
}

const SPEEDS = [
  { ms: 2400, label: '0.5×' },
  { ms: 1200, label: '1×' },
  { ms: 600, label: '2×' },
  { ms: 250, label: '4×' },
]

export function Debugger({ trace, index, playing, speed, onIndex, onPlay, onSpeed, onInspect }: Props): JSX.Element {
  const step = trace.steps[index]
  const last = trace.steps.length - 1
  const hasAbandon = trace.steps.some((s) => s.branch === 'abandoned')
  const seen = new Set(trace.steps.slice(0, index + 1).map((s) => s.stage))

  return (
    <div className="debugger" role="region" aria-label="Execution debugger">
      <div className="dbg-top">
        <span className="panel-letter">F</span>
        <div className="dbg-controls">
          <button onClick={() => onIndex(0)} disabled={index === 0} title="Reset to the first step (R)">
            ⏮ Reset
          </button>
          <button onClick={() => onIndex(index - 1)} disabled={index === 0} title="Step back (←)">
            ◀ Back
          </button>
          <button className="primary" onClick={() => onPlay(!playing)} title="Play / pause (Space)">
            {playing ? '❚❚ Pause' : index === last ? '↺ Replay' : '▶ Play'}
          </button>
          <button onClick={() => onIndex(index + 1)} disabled={index === last} title="Step forward (→)">
            Forward ▶
          </button>
          <label className="speed">
            Speed
            <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s.ms} value={s.ms}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onInspect} title="Inspect the node this step is about">
            🔍 Inspect node
          </button>
        </div>
        <div className="dbg-trace">
          <strong>{trace.title}</strong>
          <span>
            step {index + 1} / {trace.steps.length}
          </span>
        </div>
      </div>

      <div className="pipeline" aria-label="Rendering pipeline">
        {STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`stage stage-${s.id} ${step.stage === s.id ? 'active' : ''} ${seen.has(s.id) ? 'seen' : ''}`}
            title={s.desc}
          >
            <span className="stage-n">{i + 1}</span>
            {s.label}
          </div>
        ))}
        {hasAbandon && (
          <div className={`stage stage-abandoned ${step.branch === 'abandoned' ? 'active' : 'seen'}`} title="A render that was thrown away without committing">
            ↺ Abandoned
          </div>
        )}
      </div>

      <div className="scrubber" aria-label="Timeline">
        {trace.steps.map((s) => (
          <button
            key={s.index}
            className={`tick tick-${s.branch ?? s.stage} ${s.index === index ? 'current' : ''} ${s.index < index ? 'past' : ''}`}
            onClick={() => onIndex(s.index)}
            title={`${s.index + 1}. ${s.title}`}
            aria-label={`Go to step ${s.index + 1}: ${s.title}`}
          />
        ))}
      </div>

      <div className={`narration ${step.branch ? 'abandoned' : ''}`} aria-live="polite">
        <div className="narration-head">
          <span className={`stage-pill stage-${step.branch ?? step.stage}`}>{step.branch ? 'abandoned' : step.stage}</span>
          <h3>{step.title}</h3>
          <SourceBadge source={step.source} />
        </div>
        <p>{step.detail}</p>
      </div>
    </div>
  )
}
