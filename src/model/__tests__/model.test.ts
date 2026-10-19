import { describe, expect, it } from 'vitest'
import { INITIAL_TASKS, ModelSession } from '../scenarios'
import type { DomSnap, Trace } from '../types'

function html(dom: DomSnap, id = 'container'): string {
  const n = dom.nodes[id]
  if (n.kind === 'text') return n.text
  const inner = n.children.map((c) => html(dom, c)).join('')
  if (n.kind === 'container') return inner
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  return n.tag === "input" ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${inner}</${n.tag}>`
}

const last = (t: Trace) => t.steps[t.steps.length - 1]

describe('counter', () => {
  it('mounts, then updates only the text node', () => {
    const s = new ModelSession('counter', 'keyed')
    const mount = s.mount()
    expect(html(last(mount).dom)).toBe('<button className="counter">Count: 0</button>')
    expect(last(mount).mutations.map((m) => m.op)).toEqual(['appendChild'])

    const t = s.apply({ type: 'counter/increment' })
    expect(html(last(t).dom)).toBe('<button className="counter">Count: 1</button>')
    expect(last(t).mutations).toHaveLength(1)
    expect(last(t).mutations[0]).toMatchObject({ op: 'setText', from: '0', to: '1' })
    const counter = last(t).current.find((f) => f.type === 'Counter')!
    expect(counter.hooks[0].value).toBe('1')
    expect(last(t).pending).toHaveLength(0)
    // Double buffering: the committed Counter fiber is the other buffer now.
    expect(counter.buffer).toBe('b')
    s.apply({ type: 'counter/increment' })
    expect(s.renderer.current.child!.buffer).toBe('a')
  })
})

describe('tasks', () => {
  const next = [INITIAL_TASKS[1], INITIAL_TASKS[0], { id: 'c', text: 'Learn Fiber', done: false }]

  it('keyed: reuses fibers, moves one, inserts one, keeps state with the item', () => {
    const s = new ModelSession('tasks', 'keyed')
    s.mount()
    const t = s.apply({ type: 'tasks/set', tasks: next, label: 'Reorder + add' })
    const group = last(t).groups.find((g) => g.parentLabel === '<ul>')!
    expect(group.decisions.map((d) => [d.key, d.action])).toEqual([
      ['b', 'reuse'],
      ['a', 'move'],
      ['c', 'insert'],
    ])
    expect(html(last(t).dom)).toBe(
      '<ul className="tasks"><li><input type="checkbox">Learn Hooks</li><li className="done"><input type="checkbox" checked="true">Learn React</li><li><input type="checkbox">Learn Fiber</li></ul>',
    )
  })

  it('no keys: state stays with the position', () => {
    const s = new ModelSession('tasks', 'index')
    s.mount()
    const t = s.apply({ type: 'tasks/set', tasks: next, label: 'Reorder + add' })
    const group = last(t).groups.find((g) => g.parentLabel === '<ul>')!
    expect(group.decisions.map((d) => d.action)).toEqual(['reuse', 'reuse', 'insert'])
    // "Learn Hooks" now sits in the fiber that holds done = true.
    expect(html(last(t).dom)).toContain('<li className="done"><input type="checkbox" checked="true">Learn Hooks</li>')
  })

  it('toggle finds the right item', () => {
    const s = new ModelSession('tasks', 'keyed')
    s.mount()
    const t = s.apply({ type: 'tasks/toggle', id: 'b', index: 1 })
    expect(html(last(t).dom)).toContain('<li className="done"><input type="checkbox" checked="true">Learn Hooks</li>')
  })
})

describe('props', () => {
  it('memo child bails out, plain child renders without DOM changes', () => {
    const s = new ModelSession('props', 'keyed')
    s.mount()
    const t = s.apply({ type: 'props/increment' })
    const fibers = last(t).current
    expect(fibers.find((f) => f.type === 'PlainChild')!.status).toBe('rendered')
    expect(fibers.find((f) => f.type === 'MemoChild')!.status).toBe('bailout')
    expect(last(t).mutations.map((m) => m.code)).toEqual(['textNode.nodeValue = "1"'])
  })
})

describe('effects', () => {
  it('runs layout effects before paint and passive effects after', () => {
    const s = new ModelSession('effects', 'keyed')
    s.mount()
    const t = s.apply({ type: 'effects/toggle' })
    const order = t.steps.filter((x) => ['browser', 'effects'].includes(x.stage) || x.title.includes('useLayoutEffect')).map((x) => x.stage)
    expect(order).toEqual(['commit', 'browser', 'effects'])
  })
})

describe('search', () => {
  it('abandons the stale transition render and ends on the latest query', () => {
    const s = new ModelSession('search', 'keyed')
    s.mount()
    const t = s.apply({ type: 'search/burst', values: ['r', 're'] })
    expect(t.steps.some((x) => x.branch === 'abandoned')).toBe(true)
    const dom = html(last(t).dom)
    expect(dom).toContain('value="re"')
    expect(dom).toContain('<li>React</li>')
    expect(dom).not.toContain('Vite')
    expect(last(t).pending).toHaveLength(0)
  })
})
