import { memo, useEffect, useLayoutEffect, useState, useTransition, type JSX } from 'react'
import { INITIAL_TASKS, SEARCH_ITEMS, type Action, type Task, type Variant } from '../model/scenarios'
import { observed, useRenderLog } from './observed'

// Real React components. Each one mirrors a model component in src/model/scenarios.ts.

interface LiveProps {
  emit: (action: Action) => void
}

export function LiveCounter({ emit }: LiveProps): JSX.Element {
  const [count, setCount] = useState(0)
  useRenderLog('Counter', `(count = ${count})`)
  return (
    <button
      className="counter"
      onClick={() => {
        observed.mark('click on Counter')
        setCount((c) => c + 1)
        emit({ type: 'counter/increment' })
      }}
    >
      Count: {count}
    </button>
  )
}

function LiveTaskItem({ text, initialDone, onToggle }: { text: string; initialDone: boolean; onToggle: () => void }): JSX.Element {
  const [done, setDone] = useState(initialDone)
  useRenderLog('TaskItem', `"${text}" (done = ${String(done)})`)
  return (
    <li className={done ? 'done' : ''}>
      <input
        type="checkbox"
        checked={done}
        aria-label={`Toggle ${text}`}
        onChange={() => {
          observed.mark(`toggle "${text}"`)
          setDone((d) => !d)
          onToggle()
        }}
      />
      {text}
    </li>
  )
}

const EXTRA = ['Learn Fiber', 'Learn Suspense', 'Learn Transitions', 'Learn Server Components']

export function LiveTasks({ emit, variant }: LiveProps & { variant: Variant }): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [nextId, setNextId] = useState(0)
  useRenderLog('TaskList', `(${tasks.map((t) => t.id).join(', ')})`)

  const update = (next: Task[], label: string, used = 0): void => {
    observed.mark(label)
    setTasks(next)
    setNextId((n) => n + used)
    emit({ type: 'tasks/set', tasks: next, label })
  }
  const newTask = (): Task => ({
    id: String.fromCharCode(99 + nextId),
    text: EXTRA[nextId % EXTRA.length],
    done: false,
  })

  return (
    <div className="live-tasks">
      <ul className="tasks">
        {tasks.map((task, index) => (
          <LiveTaskItem
            key={variant === 'keyed' ? task.id : index}
            text={task.text}
            initialDone={task.done}
            onToggle={() => emit({ type: 'tasks/toggle', id: task.id, index })}
          />
        ))}
      </ul>
      <div className="live-actions">
        <button onClick={() => update([...tasks].reverse().concat(newTask()), 'Reorder + add', 1)}>Reorder + add</button>
        <button onClick={() => update([newTask(), ...tasks], 'Add to top', 1)}>Add to top</button>
        <button disabled={tasks.length === 0} onClick={() => update(tasks.slice(1), 'Remove first')}>
          Remove first
        </button>
      </div>
    </div>
  )
}

function Display({ value }: { value: number }): JSX.Element {
  useRenderLog('Display', `(value = ${value})`)
  return <p className="display">Value: {value}</p>
}

function PlainChild({ label }: { label: string }): JSX.Element {
  useRenderLog('PlainChild', '')
  return <span className="plain">{label}</span>
}

const MemoChild = memo(function MemoChild({ label }: { label: string }): JSX.Element {
  useRenderLog('MemoChild', '')
  return <span className="memo">{label}</span>
})

export function LiveParent({ emit }: LiveProps): JSX.Element {
  const [count, setCount] = useState(0)
  useRenderLog('Parent', `(count = ${count})`)
  return (
    <div className="parent">
      <button
        onClick={() => {
          observed.mark('click Increment')
          setCount((c) => c + 1)
          emit({ type: 'props/increment' })
        }}
      >
        Increment
      </button>
      <Display value={count} />
      <PlainChild label="Plain child" />
      <MemoChild label="Memo child" />
    </div>
  )
}

export function LiveEffects({ emit }: LiveProps): JSX.Element {
  const [on, setOn] = useState(false)
  useRenderLog('EffectsDemo', `(on = ${String(on)})`)
  useLayoutEffect(() => {
    observed.push('layout', `useLayoutEffect ran (on = ${String(on)})`)
    requestAnimationFrame(() => observed.push('paint', 'next animation frame (the browser is about to paint)'))
  }, [on])
  useEffect(() => {
    observed.push('effect', `useEffect ran (on = ${String(on)})`)
  }, [on])
  return (
    <div className={on ? 'box on' : 'box'}>
      <button
        onClick={() => {
          observed.mark('click Highlight')
          setOn((o) => !o)
          emit({ type: 'effects/toggle' })
        }}
      >
        {on ? 'Unhighlight' : 'Highlight'}
      </button>
    </div>
  )
}

function slowWork(ms: number): void {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* deliberately slow so the transition render can be interrupted */
  }
}

function Results({ query }: { query: string }): JSX.Element {
  useRenderLog('Results', `(query = "${query}")`)
  const items = SEARCH_ITEMS.filter((i) => i.toLowerCase().includes(query.toLowerCase()))
  return (
    <ul className="results">
      {items.map((i) => (
        <SlowItem key={i} label={i} />
      ))}
    </ul>
  )
}

function SlowItem({ label }: { label: string }): JSX.Element {
  slowWork(8)
  return <li>{label}</li>
}

export function LiveSearch({ emit }: LiveProps): JSX.Element {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()
  useRenderLog('SearchDemo', `(text = "${text}", query = "${query}")`)

  const type = (value: string): void => {
    setText(value)
    startTransition(() => setQuery(value))
  }

  return (
    <div className="search">
      <input
        value={text}
        placeholder="Search…"
        aria-label="Search"
        onChange={(e) => {
          observed.mark(`type "${e.target.value}"`)
          type(e.target.value)
          emit({ type: 'search/type', value: e.target.value })
        }}
      />
      <button
        className="secondary"
        onClick={() => {
          const first = `${text}r`
          const second = `${text}re`
          observed.mark(`fast typing "${first}" → "${second}"`)
          type(first)
          setTimeout(() => {
            observed.push('event', `second keystroke "${second}" (15 ms later)`)
            type(second)
          }, 15)
          emit({ type: 'search/burst', values: [first, second] })
        }}
      >
        Fast typing: +"r", then +"e"
      </button>
      <span className={isPending ? 'pending on' : 'pending'}>{isPending ? 'transition pending…' : 'idle'}</span>
      <Results query={query} />
    </div>
  )
}
