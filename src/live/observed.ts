import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'

/**
 * Observed facts from the real React app: renders, commits, effects and DOM mutations.
 * Written from render functions too, so it lives outside React state and notifies asynchronously.
 */
export type ObservedKind = 'event' | 'render' | 'commit' | 'layout' | 'effect' | 'paint' | 'dom' | 'note'

export interface ObservedEntry {
  id: number
  time: number
  kind: ObservedKind
  text: string
}

let entries: ObservedEntry[] = []
let snapshot: ObservedEntry[] = []
let counter = 1
let origin = performance.now()
let scheduled = false
const listeners = new Set<() => void>()

function notify(): void {
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    snapshot = [...entries]
    listeners.forEach((l) => l())
  }, 0)
}

export const observed = {
  push(kind: ObservedKind, text: string): void {
    entries.push({ id: counter++, time: performance.now() - origin, kind, text })
    if (entries.length > 200) entries = entries.slice(-200)
    // Render entries are buffered silently. Notifying during a render would schedule an update
    // that interrupts a transition render, which restarts it, which logs again: a starvation loop.
    // They show up with the next commit, effect or DOM entry instead.
    if (kind !== 'render') notify()
  },
  /** Start a new group: times are shown relative to this moment. */
  mark(text: string): void {
    origin = performance.now()
    entries.push({ id: counter++, time: 0, kind: 'event', text })
    notify()
  },
  clear(): void {
    entries = []
    origin = performance.now()
    notify()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot(): ObservedEntry[] {
    return snapshot
  },
}

export function useObservedLog(): ObservedEntry[] {
  return useSyncExternalStore(observed.subscribe, observed.getSnapshot)
}

/** Log every render of a component, and when React commits it. */
export function useRenderLog(name: string, detail: string): void {
  const renders = useRef(0)
  renders.current += 1
  observed.push('render', `${name} rendered (#${renders.current}) ${detail}`)
  useLayoutEffect(() => {
    observed.push('commit', `${name} committed ${detail}`)
  })
}

function describeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#text "${node.textContent ?? ''}"`
  if (node instanceof Element) return `<${node.tagName.toLowerCase()}${node.className ? `.${node.className.split(' ').join('.')}` : ''}>`
  return node.nodeName
}

/** Record the real DOM mutations React makes inside `ref`. */
export function useDomObserver(ref: RefObject<HTMLElement | null>, resetKey: unknown): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mo = new MutationObserver((records) => {
      records.forEach((r) => {
        if (r.type === 'characterData') {
          observed.push('dom', `text changed: "${r.oldValue ?? ''}" → "${r.target.textContent ?? ''}"`)
        } else if (r.type === 'attributes') {
          const target = r.target as Element
          if ((r.oldValue ?? '') === (target.getAttribute(r.attributeName ?? '') ?? '')) return
          observed.push(
            'dom',
            `${describeNode(target)} attribute ${r.attributeName}: "${r.oldValue ?? ''}" → "${target.getAttribute(r.attributeName ?? '') ?? ''}"`,
          )
        } else {
          r.removedNodes.forEach((n) => observed.push('dom', `removed ${describeNode(n)} from ${describeNode(r.target)}`))
          r.addedNodes.forEach((n) =>
            observed.push(
              'dom',
              `inserted ${describeNode(n)} into ${describeNode(r.target)}${r.nextSibling ? ` before ${describeNode(r.nextSibling)}` : ''}`,
            ),
          )
        }
      })
    })
    mo.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeOldValue: true,
    })
    return () => mo.disconnect()
  }, [ref, resetKey])
}
