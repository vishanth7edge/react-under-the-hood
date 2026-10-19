import { FakeDom } from './fakeDom'
import {
  elementTypeName,
  formatValue,
  normalizeChildren,
  serializeOutput,
  type NormalizedChild,
} from './h'
import type {
  Child,
  ChildRef,
  Decision,
  DomSnap,
  EffectLog,
  ElementDiff,
  Fiber,
  FiberSnap,
  FiberTag,
  Highlight,
  Hook,
  HookSnap,
  Lane,
  MElement,
  ModelComponent,
  Mutation,
  PayloadEntry,
  Props,
  ReconcileGroup,
  Stage,
  Step,
  Trace,
  UpdateSnap,
} from './types'

// ---------------------------------------------------------------------------
// Hooks. While a model component renders, `rendering` points at its fiber,
// exactly like React's "currently rendering fiber" + hook cursor.
// ---------------------------------------------------------------------------

interface RenderingContext {
  fiber: Fiber
  index: number
  lanes: Lane[]
}

let rendering: RenderingContext | null = null

function nextHookSlot(): { ctx: RenderingContext; index: number; prev: Hook | undefined } {
  if (!rendering) throw new Error('Hooks can only be called while a model component renders')
  const index = rendering.index++
  return { ctx: rendering, index, prev: rendering.fiber.alternate?.hooks[index] }
}

/** useState for model components. Updates are dispatched by scenarios through the renderer. */
export function useState<T>(initial: T, name = 'state'): [T] {
  const { ctx, index, prev } = nextHookSlot()
  let hook: Hook
  if (!prev) {
    hook = {
      kind: 'state',
      name,
      memoizedState: initial,
      queue: { updates: [] },
      deps: null,
      create: null,
      needsRun: false,
      processed: [],
      skipped: [],
      hasPrev: false,
      prevState: undefined,
    }
  } else {
    // Process the queued updates whose lane is part of this render.
    let state = prev.memoizedState
    const processed: number[] = []
    const skipped: number[] = []
    for (const update of prev.queue?.updates ?? []) {
      if (ctx.lanes.includes(update.lane)) {
        state = typeof update.action === 'function' ? (update.action as (s: unknown) => unknown)(state) : update.action
        processed.push(update.id)
      } else {
        skipped.push(update.id)
      }
    }
    hook = {
      ...prev,
      memoizedState: state,
      prevState: prev.memoizedState,
      hasPrev: true,
      processed,
      skipped,
    }
  }
  ctx.fiber.hooks[index] = hook
  return [hook.memoizedState as T]
}

function effectHook(kind: 'layout' | 'passive', create: () => string, deps: unknown[], name: string): void {
  const { ctx, index, prev } = nextHookSlot()
  const prevDeps = prev?.deps ?? null
  const changed =
    !prev || !prevDeps || prevDeps.length !== deps.length || deps.some((d, i) => !Object.is(d, prevDeps[i]))
  ctx.fiber.hooks[index] = {
    kind,
    name,
    memoizedState: changed ? 'scheduled to run after commit' : 'deps unchanged, skipped',
    queue: null,
    deps,
    create,
    needsRun: changed,
    processed: [],
    skipped: [],
    hasPrev: !!prev,
    prevState: prev?.memoizedState,
  }
  if (changed) ctx.fiber.flags.add(kind === 'layout' ? 'Layout' : 'Passive')
}

export function useLayoutEffect(create: () => string, deps: unknown[], name = 'layout effect'): void {
  effectHook('layout', create, deps, name)
}

export function useEffect(create: () => string, deps: unknown[], name = 'effect'): void {
  effectHook('passive', create, deps, name)
}

// ---------------------------------------------------------------------------

const DOM_PROPS = ['className', 'type', 'checked', 'value', 'placeholder']

export const LANE_LABEL: Record<Lane, string> = {
  Sync: 'SyncLane (discrete event, e.g. click or keypress)',
  Default: 'DefaultLane (e.g. initial root.render)',
  Transition: 'TransitionLane (startTransition, can be interrupted)',
}

function domProps(props: Props | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!props) return out
  for (const name of DOM_PROPS) {
    const v = props[name]
    if (v !== undefined && v !== null && v !== false && v !== '') out[name] = String(v)
  }
  return out
}

function shallowEqual(a: Props | null, b: Props | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]))
}

function fiberLabel(f: { tag: FiberTag; type: string; pendingProps: Props }): string {
  if (f.tag === 'HostRoot') return 'HostRoot'
  if (f.tag === 'HostText') return `"${String(f.pendingProps.text)}"`
  return `<${f.type}>`
}

function emptyHighlight(): Highlight {
  return { fibers: [], dom: [], group: null, mutation: null, effect: null, hook: null }
}

interface RecordOptions {
  source?: 'observed' | 'model'
  branch?: 'abandoned'
  focus?: Fiber | null
  fibers?: Fiber[]
  dom?: string[]
  group?: number
  mutation?: number
  effect?: number
  hook?: { fiber: Fiber; index: number }
}

let traceCounter = 1

/**
 * A small, synchronous, step-recording Fiber renderer.
 * It follows React's shape (double-buffered fibers, begin/complete work,
 * keyed child reconciliation, mutation / layout / passive commit phases)
 * while staying small enough to read in one sitting.
 */
export class ModelRenderer {
  readonly dom = new FakeDom()
  current: Fiber
  private wipRoot: Fiber | null = null
  private nextUnit: Fiber | null = null
  private lanes: Lane[] = []
  private pairCounter = 1
  private updateCounter = 1
  private createdThisRender: string[] = []
  private focusPair: number | null = null

  // Per-trace recording state
  private steps: Step[] = []
  private mutations: Mutation[] = []
  private groups: ReconcileGroup[] = []
  private effects: EffectLog[] = []
  private elementDiff: ElementDiff | null = null
  private traceTitle = ''
  private domBefore: DomSnap

  constructor(root: MElement) {
    this.current = this.newFiber('HostRoot', 'HostRoot', null, {}, [root], null)
    this.current.domId = 'container'
    this.current.memoizedProps = this.current.pendingProps
    this.domBefore = this.dom.serialize()
  }

  // ---------------- Trace recording ----------------

  beginTrace(title: string): void {
    this.traceTitle = title
    this.steps = []
    this.mutations = []
    this.groups = []
    this.effects = []
    this.elementDiff = null
    this.focusPair = null
    this.domBefore = this.dom.serialize()
  }

  endTrace(): Trace {
    return { id: traceCounter++, title: this.traceTitle, steps: this.steps, domBefore: this.domBefore }
  }

  record(stage: Stage, title: string, detail: string, opts: RecordOptions = {}): void {
    if (opts.focus) this.focusPair = opts.focus.pair
    const highlight = emptyHighlight()
    highlight.fibers = (opts.fibers ?? (opts.focus ? [opts.focus] : [])).map((f) => f.id)
    highlight.dom = opts.dom ?? []
    highlight.group = opts.group ?? null
    highlight.mutation = opts.mutation ?? null
    highlight.effect = opts.effect ?? null
    highlight.hook = opts.hook ? { fiberId: opts.hook.fiber.id, index: opts.hook.index } : null
    this.steps.push({
      index: this.steps.length,
      stage,
      source: opts.source ?? 'model',
      branch: opts.branch ?? null,
      title,
      detail,
      focusPair: this.focusPair,
      highlight,
      current: this.serializeTree(this.current),
      wip: this.wipRoot ? this.serializeTree(this.wipRoot) : null,
      dom: this.dom.serialize(),
      mutations: this.mutations.map((m) => ({ ...m })),
      groups: structuredClone(this.groups),
      effects: this.effects.map((e) => ({ ...e })),
      elementDiff: this.elementDiff ? structuredClone(this.elementDiff) : null,
      pending: this.pendingUpdates(),
      lanes: this.wipRoot ? [...this.lanes] : null,
    })
  }

  observed(stage: Stage, title: string, detail: string, focus?: Fiber | null): void {
    this.record(stage, title, detail, { source: 'observed', focus: focus ?? null })
  }

  // ---------------- Queries ----------------

  find(predicate: (f: Fiber) => boolean, root: Fiber = this.current): Fiber | null {
    const stack: Fiber[] = [root]
    while (stack.length) {
      const f = stack.shift()!
      if (predicate(f)) return f
      for (let c = f.child; c; c = c.sibling) stack.push(c)
    }
    return null
  }

  findAll(predicate: (f: Fiber) => boolean, root: Fiber = this.current): Fiber[] {
    const out: Fiber[] = []
    const visit = (f: Fiber): void => {
      if (predicate(f)) out.push(f)
      for (let c = f.child; c; c = c.sibling) visit(c)
    }
    visit(root)
    return out
  }

  private pendingUpdates(): UpdateSnap[] {
    const out: UpdateSnap[] = []
    this.findAll((f) => f.tag === 'FunctionComponent').forEach((f) =>
      f.hooks.forEach((h) =>
        h.queue?.updates.forEach((u) =>
          out.push({ id: u.id, label: u.label, lane: u.lane, owner: fiberLabel(f), hookName: h.name }),
        ),
      ),
    )
    return out
  }

  // ---------------- Updates ----------------

  /** setState(action) from an event handler: append an update to the hook's queue. */
  enqueue(fiber: Fiber, hookIndex: number, action: unknown, label: string, lane: Lane): void {
    const hook = fiber.hooks[hookIndex]
    if (!hook?.queue) throw new Error(`Hook ${hookIndex} of ${fiber.type} is not a state hook`)
    const update = { id: this.updateCounter++, label, lane, action }
    hook.queue.updates.push(update)
    const name = hook.name
    this.record(
      'trigger',
      `${label} queues an update on <${fiber.type}>`,
      `The state setter does not change "${name}" immediately and does not touch the DOM. ` +
        `It appends update #${update.id} (${label}) to the queue of hook ${hookIndex + 1} ("${name}"), ` +
        `which belongs to the <${fiber.type}> fiber. Lane: ${LANE_LABEL[lane]}.`,
      { focus: fiber, hook: { fiber, index: hookIndex } },
    )
  }

  schedule(lanes: Lane[], why: string): void {
    const lane = lanes[0]
    const how =
      lane === 'Transition'
        ? 'Transition work is scheduled as a lower-priority task. React renders it in small slices and can be interrupted by more urgent updates.'
        : lane === 'Sync'
          ? 'Discrete events (clicks, key presses) get the highest priority. React will render this synchronously, typically in a microtask right after the event handler returns.'
          : 'React schedules a task to render the root.'
    this.record(
      'schedule',
      `Schedule a render on the root (${lanes.join(' + ')})`,
      `${why} React marks the root as having pending work on ${lanes.map((l) => LANE_LABEL[l]).join(', ')}. ${how} ` +
        'Several setState calls in the same event are batched into one render.',
    )
  }

  // ---------------- Render phase ----------------

  /** Run the render phase. With pauseAfter, stop after N units of work (time-slicing). */
  render(lanes: Lane[], opts: { pauseAfter?: number } = {}): 'done' | 'paused' {
    if (!this.wipRoot) {
      this.lanes = lanes
      this.createdThisRender = []
      this.groups = []
      this.elementDiff = null
      this.wipRoot = this.createWorkInProgress(this.current, this.current.pendingProps, this.current.elementChildren)
      this.nextUnit = this.wipRoot
      this.record(
        'render',
        `Render phase begins (lanes: ${lanes.join(', ')})`,
        'React creates a work-in-progress (WIP) copy of HostRoot. The current tree is what is on screen; ' +
          'the WIP tree is built beside it. Each fiber pairs with its "alternate" in the other tree (ids like #1a / #1b). ' +
          'Nothing in the DOM changes during render.',
        { focus: null, fibers: [this.wipRoot] },
      )
    }
    let units = 0
    while (this.nextUnit) {
      this.nextUnit = this.performUnitOfWork(this.nextUnit)
      units++
      if (opts.pauseAfter && units >= opts.pauseAfter && this.nextUnit) {
        this.record(
          'render',
          'React yields to the browser mid-render',
          `Transition rendering is time-sliced: after a few units of work React checks whether it should yield. ` +
            `The half-built WIP tree is kept; next unit of work: ${fiberLabel(this.nextUnit)}.`,
          { fibers: [this.nextUnit] },
        )
        return 'paused'
      }
    }
    this.record(
      'render',
      'Render phase complete',
      'The work-in-progress tree is finished and every change is marked with flags (Placement, Update, ChildDeletion…). ' +
        'Still no DOM writes: everything so far could be thrown away without the user noticing.',
      { fibers: this.wipRoot ? this.findAll((f) => f.flags.size > 0, this.wipRoot) : [] },
    )
    return 'done'
  }

  /** Throw away an in-progress render, as React does when a more urgent update interrupts it. */
  abandon(reason: string): void {
    this.dom.discard(this.createdThisRender)
    this.createdThisRender = []
    const discarded = this.wipRoot
    this.wipRoot = null
    this.nextUnit = null
    this.record(
      'render',
      'Render abandoned: work-in-progress tree discarded',
      `${reason} React throws away the half-built WIP tree${discarded ? '' : ''}. The current tree, the DOM and the ` +
        'update queues are untouched, so the pending transition update is still waiting. Renders can be restarted ' +
        'or abandoned because the render phase has no visible side effects.',
      { branch: 'abandoned' },
    )
  }

  private performUnitOfWork(fiber: Fiber): Fiber | null {
    const next = this.beginWork(fiber)
    if (next) return next
    let node: Fiber | null = fiber
    while (node) {
      this.completeWork(node)
      if (node === this.wipRoot) return null
      if (node.sibling) return node.sibling
      node = node.return
    }
    return null
  }

  private hasWork(current: Fiber): boolean {
    return current.hooks.some((h) => h.queue?.updates.some((u) => this.lanes.includes(u.lane)))
  }

  private childrenHaveWork(current: Fiber): boolean {
    for (let c = current.child; c; c = c.sibling) {
      if (this.hasWork(c) || this.childrenHaveWork(c)) return true
    }
    return false
  }

  private beginWork(wip: Fiber): Fiber | null {
    const current = wip.alternate
    switch (wip.tag) {
      case 'HostRoot':
        this.reconcileChildren(wip, wip.elementChildren)
        return wip.child
      case 'HostText':
        return null
      case 'HostComponent': {
        if (current && current.memoizedProps === wip.pendingProps && current.child) {
          wip.status = 'cloned'
          this.cloneChildFibers(wip, current)
          if (!this.childrenHaveWork(current)) {
            this.cloneSubtree(wip)
            return null
          }
          return wip.child
        }
        this.reconcileChildren(wip, wip.elementChildren)
        return wip.child
      }
      case 'FunctionComponent':
        return this.updateFunctionComponent(wip, current)
    }
  }

  private updateFunctionComponent(wip: Fiber, current: Fiber | null): Fiber | null {
    const comp = wip.component as ModelComponent
    const hasUpdate = current ? this.hasWork(current) : false
    const sameProps = current
      ? comp.isMemo
        ? shallowEqual(current.memoizedProps, wip.pendingProps)
        : current.memoizedProps === wip.pendingProps
      : false

    if (current && sameProps && !hasUpdate) {
      wip.status = 'bailout'
      const why =
        comp.isMemo && current.memoizedProps !== wip.pendingProps
          ? 'it is wrapped in memo() and the new props are shallow-equal to the old ones'
          : 'its parent did not re-render it (same props object) and it has no pending updates'
      this.cloneChildFibers(wip, current)
      if (!this.childrenHaveWork(current)) {
        this.cloneSubtree(wip)
        this.record(
          'render',
          `Bail out: skip <${comp.displayName}>`,
          `React does not call ${comp.displayName}() because ${why}. Nothing below it has work either, so the ` +
            'whole subtree is reused as-is. This is why unchanged parts of the tree are cheap.',
          { focus: wip },
        )
        return null
      }
      this.record(
        'render',
        `Bail out of <${comp.displayName}>, but keep walking`,
        `React skips ${comp.displayName}() because ${why}. A descendant has a pending update, so React clones ` +
          'the child fibers and continues down to it.',
        { focus: wip },
      )
      return wip.child
    }

    // Call the component function with hooks pointing at this fiber.
    wip.status = 'rendered'
    wip.hooks = []
    rendering = { fiber: wip, index: 0, lanes: this.lanes }
    let output: Child
    try {
      output = comp(wip.pendingProps)
    } finally {
      rendering = null
    }
    wip.renderOutput = serializeOutput(output)
    this.elementDiff = {
      fiberId: wip.id,
      component: comp.displayName,
      prev: current?.renderOutput ?? null,
      next: wip.renderOutput,
    }

    const notes: string[] = []
    wip.hooks.forEach((hook, i) => {
      if (hook.kind !== 'state') return
      if (!hook.hasPrev) {
        notes.push(`Hook ${i + 1} (${hook.name}) is created with initial state ${formatValue(hook.memoizedState)}.`)
        return
      }
      if (hook.processed.length) {
        const labels = (current?.hooks[i]?.queue?.updates ?? [])
          .filter((u) => hook.processed.includes(u.id))
          .map((u) => u.label)
        notes.push(
          `Hook ${i + 1} (${hook.name}): React finds it by call order on this fiber, applies ${labels.join(', ')} → ` +
            `${formatValue(hook.prevState)} becomes ${formatValue(hook.memoizedState)}.`,
        )
      } else {
        notes.push(`Hook ${i + 1} (${hook.name}) is read from the fiber: ${formatValue(hook.memoizedState)}.`)
      }
      if (hook.skipped.length) {
        notes.push(
          `Update #${hook.skipped.join(', #')} on "${hook.name}" is skipped: its lane is not part of this render, so it stays queued.`,
        )
      }
    })
    const reason = !current
      ? 'First render (mount).'
      : hasUpdate
        ? 'It has pending state updates.'
        : comp.isMemo
          ? 'memo() compared props and found a change.'
          : 'Its parent re-rendered and passed a new props object (no memo), so it renders too.'

    this.record(
      'render',
      `Render <${comp.displayName}>: call ${comp.displayName}(props)`,
      `${reason} ${notes.join(' ')} The function returns React elements: plain objects describing the next UI ` +
        '(shown under React elements). React never reads state back from the DOM.',
      { focus: wip },
    )
    this.reconcileChildren(wip, [output])
    return wip.child
  }

  private cloneChildFibers(wip: Fiber, current: Fiber): void {
    let prev = null as Fiber | null
    wip.child = null
    for (let c = current.child; c; c = c.sibling) {
      const clone = this.createWorkInProgress(c, c.memoizedProps ?? c.pendingProps, c.elementChildren)
      clone.return = wip
      clone.index = c.index
      clone.status = 'cloned'
      if (prev) prev.sibling = clone
      else wip.child = clone
      prev = clone
    }
  }

  private cloneSubtree(wip: Fiber): void {
    for (let c = wip.child; c; c = c.sibling) {
      if (c.alternate) {
        this.cloneChildFibers(c, c.alternate)
        this.cloneSubtree(c)
      }
    }
  }

  // ---------------- Reconciliation ----------------

  private childRef(f: Fiber): ChildRef {
    const stateHook = f.hooks.find((h) => h.kind === 'state')
    return {
      fiberId: f.id,
      label: fiberLabel(f),
      key: f.key,
      index: f.index,
      type: f.type,
      state: stateHook ? `${stateHook.name}: ${formatValue(stateHook.memoizedState)}` : null,
    }
  }

  private reconcileChildren(wip: Fiber, children: Child[]): void {
    const elements = normalizeChildren(children)
    const current = wip.alternate
    const track = current !== null
    const oldFibers: Fiber[] = []
    for (let c = current?.child ?? null; c; c = c.sibling) oldFibers.push(c)

    const existing = new Map<string, Fiber>()
    oldFibers.forEach((f) => existing.set(f.key !== null ? `k:${f.key}` : `i:${f.index}`, f))
    const keyed = elements.some((e) => e.kind === 'element' && e.element.key !== null)

    const decisions: Decision[] = []
    let lastPlacedIndex = 0
    let first = null as Fiber | null
    let prev = null as Fiber | null

    elements.forEach((el, i) => {
      const key = el.kind === 'element' ? el.element.key : null
      const typeName = el.kind === 'text' ? '#text' : elementTypeName(el.element.type)
      const old = existing.get(key !== null ? `k:${key}` : `i:${i}`)
      const props: Props = el.kind === 'text' ? { text: el.text } : el.element.props
      const childEls: Child[] = el.kind === 'text' ? [] : el.element.children
      const how = key !== null ? `key "${key}"` : `position ${i} (no key)`
      let fiber: Fiber

      if (old && old.type === typeName) {
        existing.delete(key !== null ? `k:${key}` : `i:${i}`)
        fiber = this.createWorkInProgress(old, props, childEls)
        let action: Decision['action'] = 'reuse'
        let reason =
          `Matched by ${how} and same type ${typeName === '#text' ? 'text' : `<${typeName}>`} → reuse fiber ` +
          `#${old.pair}: its state and DOM node are kept.`
        if (old.index < lastPlacedIndex) {
          fiber.flags.add('Placement')
          action = 'move'
          reason =
            `Matched by ${how}, but it was at old index ${old.index}, which is before the last placed index ` +
            `${lastPlacedIndex}. React keeps the fiber and marks Placement: its DOM node must move.`
        } else {
          lastPlacedIndex = old.index
        }
        decisions.push({ action, key, oldIndex: old.index, newIndex: i, label: fiberLabel(fiber), fiberId: fiber.id, oldFiberId: old.id, reason })
      } else {
        fiber = this.fiberFromChild(el)
        if (track) fiber.flags.add('Placement')
        const action: Decision['action'] = !track ? 'mount' : old ? 'replace' : 'insert'
        const reason = !track
          ? 'Parent is new, so this child is created as part of a brand-new subtree. Its DOM node is built off-screen and inserted together with its parent.'
          : old
            ? `Same ${how}, but the type changed from ${old.type} to ${typeName} → the old fiber is deleted and a new one is created (state is lost).`
            : `No old child matches ${how} → create a new fiber and mark Placement (insert its DOM node).`
        decisions.push({ action, key, oldIndex: old ? old.index : null, newIndex: i, label: fiberLabel(fiber), fiberId: fiber.id, oldFiberId: old?.id ?? null, reason })
      }
      fiber.index = i
      fiber.return = wip
      fiber.sibling = null
      if (prev) prev.sibling = fiber
      else first = fiber
      prev = fiber
    })

    existing.forEach((old) => {
      if (!track) return
      wip.deletions.push(old)
      wip.flags.add('ChildDeletion')
      decisions.push({
        action: 'delete',
        key: old.key,
        oldIndex: old.index,
        newIndex: null,
        label: fiberLabel(old),
        fiberId: old.id,
        oldFiberId: old.id,
        reason: `Nothing in the next children matched ${old.key !== null ? `key "${old.key}"` : `position ${old.index}`} with the same type → delete this fiber and its DOM node at commit.`,
      })
    })
    wip.child = first

    const next: Fiber[] = []
    for (let c: Fiber | null = wip.child; c; c = c.sibling) next.push(c)
    const group: ReconcileGroup = {
      index: this.groups.length,
      parentId: wip.id,
      parentLabel: fiberLabel(wip),
      keyed,
      tracked: track,
      prev: oldFibers.map((f) => this.childRef(f)),
      next: next.map((f) => this.childRef(f)),
      decisions,
    }
    this.groups.push(group)

    if (elements.length === 0 && oldFibers.length === 0) return
    const counts = decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.action]: (acc[d.action] ?? 0) + 1 }), {})
    const summary = Object.entries(counts)
      .map(([a, n]) => `${n} ${a}`)
      .join(', ')
    this.record(
      'reconcile',
      `Reconcile children of ${fiberLabel(wip)}`,
      `React compares the previous child fibers with the new elements using type, key and position: ${summary}. ` +
        (track
          ? keyed
            ? 'Keys let React match items even when they move.'
            : 'Without keys, React can only match by position.'
          : 'This parent is new, so nothing needs to be compared.'),
      { focus: wip.tag === 'FunctionComponent' ? wip : null, fibers: [wip, ...next], group: group.index },
    )
  }

  // ---------------- Complete phase ----------------

  private hostChildren(fiber: Fiber): Fiber[] {
    const out: Fiber[] = []
    const visit = (f: Fiber): void => {
      if (f.tag === 'HostComponent' || f.tag === 'HostText') out.push(f)
      else for (let c = f.child; c; c = c.sibling) visit(c)
    }
    for (let c = fiber.child; c; c = c.sibling) visit(c)
    return out
  }

  private completeWork(wip: Fiber): void {
    const current = wip.alternate
    if (wip.tag === 'HostComponent') {
      if (wip.domId === null) {
        const id = this.dom.createElement(wip.type, domProps(wip.pendingProps))
        wip.domId = id
        this.createdThisRender.push(id)
        const kids = this.hostChildren(wip)
        kids.forEach((k) => k.domId && this.dom.appendChild(id, k.domId))
        this.record(
          'render',
          `Complete <${wip.type}>: create its DOM node off-screen`,
          `completeWork creates a real <${wip.type}> element (${id})${kids.length ? ` and appends its ${kids.length} child node(s)` : ''}. ` +
            'It is not in the document yet. New subtrees are assembled off-screen and inserted in one go at commit.',
          { focus: null, fibers: [wip], dom: [id] },
        )
      } else if (current) {
        const before = domProps(current.memoizedProps)
        const after = domProps(wip.pendingProps)
        const payload: PayloadEntry[] = []
        new Set([...Object.keys(before), ...Object.keys(after)]).forEach((prop) => {
          if (before[prop] !== after[prop]) payload.push({ prop, from: before[prop] ?? '', to: after[prop] ?? '' })
        })
        if (payload.length) {
          wip.flags.add('Update')
          wip.updatePayload = payload
          this.record(
            'render',
            `Complete <${wip.type}>: props changed`,
            `completeWork diffs the old and new DOM props and stores an update payload: ` +
              `${payload.map((p) => `${p.prop}: "${p.from}" → "${p.to}"`).join(', ')}. The DOM write waits for commit.`,
            { fibers: [wip], dom: [wip.domId] },
          )
        }
      }
    } else if (wip.tag === 'HostText') {
      const text = String(wip.pendingProps.text)
      if (wip.domId === null) {
        wip.domId = this.dom.createText(text)
        this.createdThisRender.push(wip.domId)
      } else if (current && String(current.memoizedProps?.text) !== text) {
        wip.flags.add('Update')
        wip.updatePayload = [{ prop: 'nodeValue', from: String(current.memoizedProps?.text), to: text }]
        this.record(
          'render',
          `Complete text node: "${String(current.memoizedProps?.text)}" → "${text}"`,
          'The text fiber is reused (same position, same type). Only its content differs, so it gets an Update flag. ' +
            'The surrounding element and its attributes are untouched.',
          { fibers: [wip], dom: [wip.domId] },
        )
      }
    }
    wip.memoizedProps = wip.pendingProps
  }

  // ---------------- Commit phase ----------------

  commit(): void {
    const finished = this.wipRoot
    if (!finished) throw new Error('Nothing to commit')
    this.record(
      'commit',
      'Commit phase begins',
      'React walks the finished WIP tree and applies every flagged change. Unlike render, commit runs synchronously ' +
        'and cannot be interrupted, so the user never sees a half-updated screen.',
      { fibers: this.findAll((f) => f.flags.size > 0 || f.deletions.length > 0, finished) },
    )
    const mutationsBefore = this.mutations.length
    this.commitMutationEffects(finished)
    if (this.mutations.length === mutationsBefore) {
      this.record('commit', 'No DOM mutations needed', 'Components rendered, but reconciliation found nothing to change in the DOM.')
    }

    // Swap the trees: the finished WIP becomes current.
    this.current = finished
    this.wipRoot = null
    this.createdThisRender = []
    this.findAll(() => true).forEach((f) =>
      f.hooks.forEach((h) => {
        if (h.queue && h.processed.length) h.queue.updates = h.queue.updates.filter((u) => !h.processed.includes(u.id))
      }),
    )
    this.record(
      'commit',
      'Swap trees: root.current → finished work',
      'The work-in-progress tree becomes the current tree (what is on screen). The old current tree is kept as the ' +
        'alternate and its fibers will be recycled as the next work-in-progress: this is double buffering. ' +
        'Processed updates leave their queues.',
      { fibers: [finished] },
    )

    this.runEffects(finished, 'layout')
    const changed = this.mutations.length > mutationsBefore
    this.record(
      'browser',
      changed ? 'Browser: style, layout, paint, composite' : 'Browser: nothing to repaint',
      changed
        ? 'React has finished. The browser now recalculates styles and layout, paints the changed pixels and composites ' +
            'layers. This is the browser\'s own work, outside React (simulated here).'
        : 'No DOM mutations were committed, so there is nothing new for the browser to paint.',
    )
    this.runEffects(finished, 'passive')

    // The committed work is done: clear per-render bookkeeping so the next trace starts clean.
    this.findAll(() => true).forEach((f) => {
      f.flags = new Set()
      f.deletions = []
      f.updatePayload = null
      f.status = null
      f.hooks = f.hooks.map((h) => ({ ...h, processed: [], skipped: [], hasPrev: false, prevState: undefined }))
    })
  }

  private hostParentDom(fiber: Fiber): string {
    let p = fiber.return
    while (p) {
      if (p.tag === 'HostComponent' || p.tag === 'HostRoot') return p.domId as string
      p = p.return
    }
    return 'container'
  }

  private topHostNodes(fiber: Fiber): string[] {
    if (fiber.tag === 'HostComponent' || fiber.tag === 'HostText') return fiber.domId ? [fiber.domId] : []
    return this.hostChildren(fiber).flatMap((f) => (f.domId ? [f.domId] : []))
  }

  /** React's getHostSibling: the next DOM node that is already in place. */
  private hostSibling(fiber: Fiber): string | null {
    let node: Fiber = fiber
    for (;;) {
      while (!node.sibling) {
        const parent: Fiber | null = node.return
        if (!parent || parent.tag === 'HostComponent' || parent.tag === 'HostRoot') return null
        node = parent
      }
      node = node.sibling
      let found = true
      while (node.tag === 'FunctionComponent') {
        if (node.flags.has('Placement') || !node.child) {
          found = false
          break
        }
        node = node.child
      }
      if (found && !node.flags.has('Placement') && node.domId) return node.domId
    }
  }

  private pushMutation(m: Omit<Mutation, 'index'>, fiber: Fiber, title: string): void {
    const index = this.mutations.length
    this.mutations.push({ ...m, index })
    this.record('commit', title, m.summary, {
      fibers: [fiber],
      dom: [m.target, ...(m.parent ? [m.parent] : [])],
      mutation: index,
    })
  }

  private commitMutationEffects(fiber: Fiber): void {
    fiber.deletions.forEach((deleted) => {
      const parent = fiber.tag === 'HostComponent' || fiber.tag === 'HostRoot' ? (fiber.domId as string) : this.hostParentDom(fiber)
      this.topHostNodes(deleted).forEach((id) => {
        const label = this.dom.label(id)
        this.dom.removeChild(id)
        this.pushMutation(
          {
            op: 'removeChild',
            target: id,
            parent,
            before: null,
            fiberId: deleted.id,
            code: `${this.dom.label(parent)}.removeChild(${label})`,
            summary: `${fiberLabel(deleted)} was deleted during reconciliation, so its DOM node is removed. Any state in that subtree is gone.`,
          },
          fiber,
          `Remove ${label}`,
        )
      })
    })
    for (let c = fiber.child; c; c = c.sibling) this.commitMutationEffects(c)

    if (fiber.flags.has('Placement')) {
      const parent = this.hostParentDom(fiber)
      const before = this.hostSibling(fiber)
      this.topHostNodes(fiber).forEach((id) => {
        const label = this.dom.label(id)
        const moving = this.dom.get(id).parent !== null
        if (before) this.dom.insertBefore(parent, id, before)
        else this.dom.appendChild(parent, id)
        this.pushMutation(
          {
            op: before ? 'insertBefore' : 'appendChild',
            target: id,
            parent,
            before,
            fiberId: fiber.id,
            code: before
              ? `${this.dom.label(parent)}.insertBefore(${label}, ${this.dom.label(before)})`
              : `${this.dom.label(parent)}.appendChild(${label})`,
            summary: moving
              ? `${fiberLabel(fiber)} has a Placement flag but already has a DOM node: the existing node is moved, not recreated.`
              : `${fiberLabel(fiber)} is new, so its off-screen DOM node (with all its children) is inserted into the document.`,
          },
          fiber,
          `${moving ? 'Move' : 'Insert'} ${label}`,
        )
      })
    }

    if (fiber.flags.has('Update') && fiber.updatePayload && fiber.domId) {
      const id = fiber.domId
      fiber.updatePayload.forEach((p) => {
        if (fiber.tag === 'HostText') {
          this.dom.setText(id, p.to)
          this.pushMutation(
            {
              op: 'setText',
              target: id,
              parent: null,
              before: null,
              prop: 'nodeValue',
              from: p.from,
              to: p.to,
              fiberId: fiber.id,
              code: `textNode.nodeValue = "${p.to}"`,
              summary: `Only the text changes ("${p.from}" → "${p.to}"). The same DOM text node is kept; nothing is recreated.`,
            },
            fiber,
            `Update text: "${p.from}" → "${p.to}"`,
          )
        } else {
          this.dom.setProperty(id, p.prop, p.to === '' ? null : p.to)
          this.pushMutation(
            {
              op: 'setProperty',
              target: id,
              parent: null,
              before: null,
              prop: p.prop,
              from: p.from,
              to: p.to,
              fiberId: fiber.id,
              code: `${this.dom.label(id)}.${p.prop} = ${JSON.stringify(p.to)}`,
              summary: `Apply the update payload computed during render: ${p.prop} "${p.from}" → "${p.to}".`,
            },
            fiber,
            `Update <${fiber.type}>.${p.prop}`,
          )
        }
      })
    }
  }

  private runEffects(root: Fiber, kind: 'layout' | 'passive'): void {
    const visit = (f: Fiber): void => {
      for (let c = f.child; c; c = c.sibling) visit(c)
      if (f.tag !== 'FunctionComponent') return
      f.hooks.forEach((hook, i) => {
        if (hook.kind !== kind || !hook.needsRun || !hook.create) return
        const message = hook.create()
        hook.needsRun = false
        const index = this.effects.length
        this.effects.push({ index, kind, component: f.type, name: hook.name, message, fiberId: f.id })
        this.record(
          kind === 'layout' ? 'commit' : 'effects',
          kind === 'layout' ? `useLayoutEffect "${hook.name}" runs` : `useEffect "${hook.name}" runs`,
          kind === 'layout'
            ? `Layout effects run synchronously after the DOM is mutated but before the browser paints, so they can read layout (${message}). Heavy work here delays the paint.`
            : `Passive effects run after commit, usually after paint (${message}). For discrete events such as clicks, React may flush them before paint: compare with the observed log on the left.`,
          { fibers: [f], effect: index, hook: { fiber: f, index: i } },
        )
      })
    }
    visit(root)
  }

  performWork(lanes: Lane[]): void {
    this.render(lanes)
    this.commit()
  }

  // ---------------- Fibers ----------------

  private newFiber(
    tag: FiberTag,
    type: string,
    key: string | null,
    props: Props,
    children: Child[],
    comp: ModelComponent | null,
  ): Fiber {
    const pair = this.pairCounter++
    return {
      id: `${pair}a`,
      pair,
      buffer: 'a',
      tag,
      type,
      component: comp,
      key,
      index: 0,
      pendingProps: props,
      memoizedProps: null,
      elementChildren: children,
      child: null,
      sibling: null,
      return: null,
      alternate: null,
      hooks: [],
      domId: null,
      flags: new Set(),
      deletions: [],
      updatePayload: null,
      status: 'new',
      renderOutput: null,
    }
  }

  private fiberFromChild(child: NormalizedChild): Fiber {
    if (child.kind === 'text') return this.newFiber('HostText', '#text', null, { text: child.text }, [], null)
    const el = child.element
    if (typeof el.type === 'string') return this.newFiber('HostComponent', el.type, el.key, el.props, el.children, null)
    return this.newFiber('FunctionComponent', el.type.displayName, el.key, el.props, el.children, el.type)
  }

  private createWorkInProgress(current: Fiber, pendingProps: Props, children: Child[]): Fiber {
    let wip = current.alternate
    if (!wip) {
      wip = {
        ...current,
        id: `${current.pair}${current.buffer === 'a' ? 'b' : 'a'}`,
        buffer: current.buffer === 'a' ? 'b' : 'a',
        alternate: current,
      }
      current.alternate = wip
    }
    wip.tag = current.tag
    wip.type = current.type
    wip.component = current.component
    wip.key = current.key
    wip.index = current.index
    wip.pendingProps = pendingProps
    wip.memoizedProps = current.memoizedProps
    wip.elementChildren = children
    wip.child = null
    wip.sibling = null
    wip.return = null
    wip.hooks = current.hooks.map((h) => ({ ...h, processed: [], skipped: [], hasPrev: false, prevState: undefined, needsRun: false }))
    wip.domId = current.domId
    wip.flags = new Set()
    wip.deletions = []
    wip.updatePayload = null
    wip.status = null
    wip.renderOutput = current.renderOutput
    return wip
  }

  // ---------------- Snapshots ----------------

  private serializeTree(root: Fiber): FiberSnap[] {
    const out: FiberSnap[] = []
    const visit = (f: Fiber, depth: number): void => {
      out.push(this.snapFiber(f, depth))
      for (let c = f.child; c; c = c.sibling) visit(c, depth + 1)
    }
    visit(root, 0)
    return out
  }

  private snapFiber(f: Fiber, depth: number): FiberSnap {
    const props: Record<string, string> = {}
    for (const [k, v] of Object.entries(f.pendingProps)) props[k] = formatValue(v)
    const queueOwner = fiberLabel(f)
    const hooks: HookSnap[] = f.hooks.map((h, index) => ({
      index,
      kind: h.kind,
      name: h.name,
      value: formatValue(h.memoizedState),
      prev: h.hasPrev && h.kind === 'state' ? formatValue(h.prevState) : null,
      changed: h.hasPrev && h.kind === 'state' && !Object.is(h.prevState, h.memoizedState),
      queue: (h.queue?.updates ?? []).map((u) => ({ id: u.id, label: u.label, lane: u.lane, owner: queueOwner, hookName: h.name })),
      processed: [...h.processed],
      skipped: [...h.skipped],
      deps: h.deps ? formatValue(h.deps) : null,
      needsRun: h.needsRun,
    }))
    return {
      id: f.id,
      pair: f.pair,
      buffer: f.buffer,
      depth,
      tag: f.tag,
      type: f.type,
      label: fiberLabel(f),
      key: f.key,
      index: f.index,
      parentId: f.return?.id ?? null,
      childId: f.child?.id ?? null,
      siblingId: f.sibling?.id ?? null,
      alternateId: f.alternate?.id ?? null,
      flags: [...f.flags],
      status: f.status,
      domId: f.domId,
      props,
      hooks,
      updatePayload: f.updatePayload ? f.updatePayload.map((p) => ({ ...p })) : null,
      deletions: f.deletions.map((d) => d.id),
      source: f.component?.source ?? null,
    }
  }
}
