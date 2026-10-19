import { component, h } from './h'
import { ModelRenderer, useEffect, useLayoutEffect, useState } from './renderer'
import type { Fiber, MElement, Trace } from './types'

export interface Task {
  id: string
  text: string
  done: boolean
}

export type Action =
  | { type: 'counter/increment' }
  | { type: 'tasks/set'; tasks: Task[]; label: string }
  | { type: 'tasks/toggle'; id: string; index: number }
  | { type: 'props/increment' }
  | { type: 'effects/toggle' }
  | { type: 'search/type'; value: string }
  | { type: 'search/burst'; values: [string, string] }

export type ScenarioId = 'counter' | 'tasks' | 'props' | 'effects' | 'search'
export type Variant = 'keyed' | 'index'

export interface ScenarioInfo {
  id: ScenarioId
  title: string
  tagline: string
  hint: string
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'counter',
    title: 'State & hooks',
    tagline: 'Click once: follow count from 0 to 1 through the hook queue, render, reconcile and commit.',
    hint: 'Click the button, then step through. Watch hook 1 on the Counter fiber and the single text node that changes.',
  },
  {
    id: 'tasks',
    title: 'Lists & keys',
    tagline: 'Reorder a list with and without keys and see which fibers (and their state) are reused.',
    hint: '"Learn React" starts ticked. Click Reorder + add, then switch to "No keys" and do it again.',
  },
  {
    id: 'props',
    title: 'Props & re-renders',
    tagline: 'A parent re-render renders its children too, unless memo() bails out.',
    hint: 'Click Increment. Plain child re-renders with no DOM change; the memo child is skipped.',
  },
  {
    id: 'effects',
    title: 'Effects timing',
    tagline: 'Where useLayoutEffect and useEffect run relative to commit and paint.',
    hint: 'Click Highlight. Compare the model order with the observed timings from real React.',
  },
  {
    id: 'search',
    title: 'Interrupted render',
    tagline: 'A transition render is thrown away when a new keystroke arrives.',
    hint: 'Use "Fast typing" to send two keystrokes 15 ms apart and follow the abandoned render.',
  },
]

export const INITIAL_TASKS: Task[] = [
  { id: 'a', text: 'Learn React', done: true },
  { id: 'b', text: 'Learn Hooks', done: false },
]

export const SEARCH_ITEMS = ['React', 'Redux', 'Recoil', 'Remix', 'Relay', 'Vite']

// ---------------------------------------------------------------------------
// Model versions of the live components. Keep them in sync with src/live.
// ---------------------------------------------------------------------------

const Counter = component(
  'Counter',
  `function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button className="counter" onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}`,
  () => {
    const [count] = useState(0, 'count')
    return h('button', { className: 'counter', onClick: () => undefined }, 'Count: ', count)
  },
)

function taskComponents(variant: Variant) {
  const TaskItem = component<{ text: string; initialDone: boolean }>(
    'TaskItem',
    `function TaskItem({ text, initialDone }) {
  const [done, setDone] = useState(initialDone);

  return (
    <li className={done ? 'done' : ''}>
      <input type="checkbox" checked={done}
        onChange={() => setDone(d => !d)} />
      {text}
    </li>
  );
}`,
    ({ text, initialDone }) => {
      const [done] = useState(initialDone, 'done')
      return h('li', { className: done ? 'done' : '' }, h('input', { type: 'checkbox', checked: done }), text)
    },
  )
  const TaskList = component(
    'TaskList',
    `function TaskList() {
  const [tasks, setTasks] = useState(initialTasks);

  return (
    <ul className="tasks">
      {tasks.map((task${variant === 'index' ? ', index' : ''}) => (
        <TaskItem key={${variant === 'keyed' ? 'task.id' : 'index'}}
          text={task.text} initialDone={task.done} />
      ))}
    </ul>
  );
}`,
    () => {
      const [tasks] = useState<Task[]>(INITIAL_TASKS, 'tasks')
      return h(
        'ul',
        { className: 'tasks' },
        tasks.map((t) => h(TaskItem, { key: variant === 'keyed' ? t.id : null, text: t.text, initialDone: t.done })),
      )
    },
  )
  return { TaskList }
}

const Display = component<{ value: number }>(
  'Display',
  `function Display({ value }) {
  return <p className="display">Value: {value}</p>;
}`,
  ({ value }) => h('p', { className: 'display' }, 'Value: ', value),
)

const PlainChild = component<{ label: string }>(
  'PlainChild',
  `function PlainChild({ label }) {
  return <span className="plain">{label}</span>;
}`,
  ({ label }) => h('span', { className: 'plain' }, label),
)

const MemoChild = component<{ label: string }>(
  'MemoChild',
  `const MemoChild = memo(function MemoChild({ label }) {
  return <span className="memo">{label}</span>;
});`,
  ({ label }) => h('span', { className: 'memo' }, label),
  { memo: true },
)

const Parent = component(
  'Parent',
  `function Parent() {
  const [count, setCount] = useState(0);

  return (
    <div className="parent">
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <Display value={count} />
      <PlainChild label="Plain child" />
      <MemoChild label="Memo child" />
    </div>
  );
}`,
  () => {
    const [count] = useState(0, 'count')
    return h(
      'div',
      { className: 'parent' },
      h('button', { onClick: () => undefined }, 'Increment'),
      h(Display, { value: count }),
      h(PlainChild, { label: 'Plain child' }),
      h(MemoChild, { label: 'Memo child' }),
    )
  },
)

const EffectsDemo = component(
  'EffectsDemo',
  `function EffectsDemo() {
  const [on, setOn] = useState(false);

  useLayoutEffect(() => {
    measureBox();      // before paint
  }, [on]);

  useEffect(() => {
    logAnalytics(on);  // after commit
  }, [on]);

  return (
    <div className={on ? 'box on' : 'box'}>
      <button onClick={() => setOn(o => !o)}>
        {on ? 'Unhighlight' : 'Highlight'}
      </button>
    </div>
  );
}`,
  () => {
    const [on] = useState(false, 'on')
    useLayoutEffect(() => `measureBox(): box is ${on ? 'highlighted' : 'plain'}`, [on], 'measure box')
    useEffect(() => `logAnalytics(${String(on)})`, [on], 'analytics')
    return h('div', { className: on ? 'box on' : 'box' }, h('button', { onClick: () => undefined }, on ? 'Unhighlight' : 'Highlight'))
  },
)

const Results = component<{ query: string }>(
  'Results',
  `function Results({ query }) {
  const items = ITEMS.filter(i =>
    i.toLowerCase().includes(query.toLowerCase()));
  return (
    <ul className="results">
      {items.map(i => <li key={i}>{i}</li>)}
    </ul>
  );
}`,
  ({ query }) =>
    h(
      'ul',
      { className: 'results' },
      SEARCH_ITEMS.filter((i) => i.toLowerCase().includes(query.toLowerCase())).map((i) => h('li', { key: i }, i)),
    ),
)

const SearchDemo = component(
  'SearchDemo',
  `function SearchDemo() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  function onChange(e) {
    setText(e.target.value);              // urgent
    startTransition(() => {
      setQuery(e.target.value);           // can wait
    });
  }

  return (
    <div className="search">
      <input value={text} onChange={onChange} />
      <Results query={query} />
    </div>
  );
}`,
  () => {
    const [text] = useState('', 'text')
    const [query] = useState('', 'query')
    return h('div', { className: 'search' }, h('input', { value: text, placeholder: 'Search…' }), h(Results, { query }))
  },
)

function rootElement(id: ScenarioId, variant: Variant): MElement {
  switch (id) {
    case 'counter':
      return h(Counter, null)
    case 'tasks':
      return h(taskComponents(variant).TaskList, null)
    case 'props':
      return h(Parent, null)
    case 'effects':
      return h(EffectsDemo, null)
    case 'search':
      return h(SearchDemo, null)
  }
}

// ---------------------------------------------------------------------------

/** Keeps a model renderer in step with the live app and turns each action into a trace. */
export class ModelSession {
  readonly renderer: ModelRenderer

  constructor(
    readonly scenario: ScenarioId,
    readonly variant: Variant,
  ) {
    this.renderer = new ModelRenderer(rootElement(scenario, variant))
  }

  mount(): Trace {
    const r = this.renderer
    r.beginTrace('Initial mount')
    r.observed(
      'trigger',
      'createRoot(container).render(<App />)',
      'The real React app on the left has mounted. Here the model replays the same mount: there is no previous tree, ' +
        'so every fiber is new and the whole DOM is built off-screen, then inserted once.',
    )
    r.schedule(['Default'], 'The initial root.render() call creates the first update on the root.')
    r.performWork(['Default'])
    return r.endTrace()
  }

  apply(action: Action): Trace {
    const r = this.renderer
    const fn = (name: string): Fiber => {
      const f = r.find((x) => x.type === name)
      if (!f) throw new Error(`No fiber for ${name}`)
      return f
    }
    const click = (what: string, target?: Fiber | null): void =>
      r.observed(
        'trigger',
        `Click on ${what}`,
        'You clicked in the real app. React listens for events once, at the root container, finds the fiber for the ' +
          'clicked element and calls the onClick prop you passed. That handler calls a state setter.',
        target ?? null,
      )

    switch (action.type) {
      case 'counter/increment': {
        r.beginTrace('Click: setCount(c => c + 1)')
        const counter = fn('Counter')
        click('<button className="counter">', counter)
        r.enqueue(counter, 0, (c: number) => c + 1, 'setCount(c => c + 1)', 'Sync')
        r.schedule(['Sync'], 'An update was queued from a click.')
        r.performWork(['Sync'])
        break
      }
      case 'tasks/set': {
        r.beginTrace(action.label)
        const list = fn('TaskList')
        click(`"${action.label}"`, list)
        r.enqueue(list, 0, action.tasks, `setTasks([${action.tasks.map((t) => t.id).join(', ')}])`, 'Sync')
        r.schedule(['Sync'], 'An update was queued from a click.')
        r.performWork(['Sync'])
        break
      }
      case 'tasks/toggle': {
        const items = r.findAll((f) => f.type === 'TaskItem')
        const item =
          this.variant === 'keyed' ? items.find((f) => f.key === action.id) : items.find((f) => f.index === action.index)
        if (!item) throw new Error('TaskItem not found')
        r.beginTrace(`Toggle checkbox ${action.index + 1}`)
        r.observed(
          'trigger',
          `Change on checkbox ${action.index + 1}`,
          'The checkbox onChange handler calls setDone on the TaskItem that owns this row. In the model we find that ' +
            `fiber by ${this.variant === 'keyed' ? `key "${action.id}"` : `position ${action.index}`}.`,
          item,
        )
        r.enqueue(item, 0, (d: boolean) => !d, 'setDone(d => !d)', 'Sync')
        r.schedule(['Sync'], 'An update was queued from a change event.')
        r.performWork(['Sync'])
        break
      }
      case 'props/increment': {
        r.beginTrace('Click: Parent setCount(c => c + 1)')
        const parent = fn('Parent')
        click('Increment', parent)
        r.enqueue(parent, 0, (c: number) => c + 1, 'setCount(c => c + 1)', 'Sync')
        r.schedule(['Sync'], 'An update was queued from a click.')
        r.performWork(['Sync'])
        break
      }
      case 'effects/toggle': {
        r.beginTrace('Click: setOn(o => !o)')
        const demo = fn('EffectsDemo')
        click('Highlight', demo)
        r.enqueue(demo, 0, (o: boolean) => !o, 'setOn(o => !o)', 'Sync')
        r.schedule(['Sync'], 'An update was queued from a click.')
        r.performWork(['Sync'])
        break
      }
      case 'search/type': {
        r.beginTrace(`Type "${action.value}"`)
        this.keystroke(action.value)
        r.render(['Transition'])
        r.commit()
        break
      }
      case 'search/burst': {
        const [first, second] = action.values
        r.beginTrace(`Fast typing: "${first}" then "${second}"`)
        this.keystroke(first)
        const status = r.render(['Transition'], { pauseAfter: 3 })
        r.observed(
          'trigger',
          `Second keystroke arrives: "${second}"`,
          'While React was yielding in the middle of the transition render, the next key press event fired in the real app.',
          fn('SearchDemo'),
        )
        const demo = fn('SearchDemo')
        r.enqueue(demo, 0, second, `setText("${second}")`, 'Sync')
        r.enqueue(demo, 1, second, `setQuery("${second}")`, 'Transition')
        if (status === 'paused') {
          r.abandon(
            'A new update arrived for the lane being rendered, and an urgent update is waiting. The half-finished ' +
              `transition render for "${first}" is now stale.`,
          )
        }
        r.schedule(['Sync'], 'The urgent text update must be shown first.')
        r.performWork(['Sync'])
        r.record(
          'schedule',
          'Restart the transition render from scratch',
          `Both transition updates ("${first}" and "${second}") are still queued. React renders the transition ` +
            'again from the current tree, processing them in order, so the list jumps straight to the latest query.',
        )
        r.render(['Transition'])
        r.commit()
        break
      }
    }
    return r.endTrace()
  }

  private keystroke(value: string): void {
    const r = this.renderer
    const demo = r.find((f) => f.type === 'SearchDemo')
    if (!demo) throw new Error('SearchDemo not found')
    r.observed(
      'trigger',
      `Key press: input value is now "${value}"`,
      'onChange calls setText (urgent) and, inside startTransition, setQuery (can wait). Two updates, two lanes.',
      demo,
    )
    r.enqueue(demo, 0, value, `setText("${value}")`, 'Sync')
    r.enqueue(demo, 1, value, `setQuery("${value}")`, 'Transition')
    r.schedule(['Sync', 'Transition'], 'Two updates on different lanes were queued.')
    r.performWork(['Sync'])
    r.record(
      'schedule',
      'Urgent update committed; transition still pending',
      'The input already shows the new text. The query update was skipped in that render because its lane was not ' +
        'included, so React now starts a separate, interruptible render for the transition lane.',
    )
  }
}

