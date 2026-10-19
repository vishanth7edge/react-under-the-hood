// Types for the educational React model.
// This is a deliberately simplified model of React's internals, not a copy of them.

export type Lane = 'Sync' | 'Default' | 'Transition'

export type Stage = 'trigger' | 'schedule' | 'render' | 'reconcile' | 'commit' | 'browser' | 'effects'

export type Primitive = string | number | boolean | null | undefined
export type Child = MElement | Primitive | Child[]
export type Props = Record<string, unknown>

export interface ModelComponent {
  (props: Props): Child
  displayName: string
  isMemo: boolean
  source: string
}

export interface MElement {
  $$model: true
  type: string | ModelComponent
  key: string | null
  props: Props
  children: Child[]
}

export type FiberTag = 'HostRoot' | 'FunctionComponent' | 'HostComponent' | 'HostText'
export type Flag = 'Placement' | 'Update' | 'ChildDeletion' | 'Layout' | 'Passive'
export type FiberStatus = 'new' | 'rendered' | 'bailout' | 'cloned' | null

export interface Update {
  id: number
  label: string
  lane: Lane
  action: unknown
}

export interface Hook {
  kind: 'state' | 'layout' | 'passive'
  name: string
  memoizedState: unknown
  queue: { updates: Update[] } | null
  deps: unknown[] | null
  create: (() => string) | null
  needsRun: boolean
  processed: number[]
  skipped: number[]
  hasPrev: boolean
  prevState: unknown
}

export interface PayloadEntry {
  prop: string
  from: string
  to: string
}

export interface SerializedElement {
  type: string
  key: string | null
  props: Record<string, string>
  children: SerializedElement[]
  text?: string
}

export interface Fiber {
  id: string
  pair: number
  buffer: 'a' | 'b'
  tag: FiberTag
  type: string
  component: ModelComponent | null
  key: string | null
  index: number
  pendingProps: Props
  memoizedProps: Props | null
  elementChildren: Child[]
  child: Fiber | null
  sibling: Fiber | null
  return: Fiber | null
  alternate: Fiber | null
  hooks: Hook[]
  domId: string | null
  flags: Set<Flag>
  deletions: Fiber[]
  updatePayload: PayloadEntry[] | null
  status: FiberStatus
  renderOutput: SerializedElement | null
}

// ---------- Snapshots: plain, serialisable copies used by the UI ----------

export interface UpdateSnap {
  id: number
  label: string
  lane: Lane
  owner: string
  hookName: string
}

export interface HookSnap {
  index: number
  kind: Hook['kind']
  name: string
  value: string
  prev: string | null
  changed: boolean
  queue: UpdateSnap[]
  processed: number[]
  skipped: number[]
  deps: string | null
  needsRun: boolean
}

export interface FiberSnap {
  id: string
  pair: number
  buffer: 'a' | 'b'
  depth: number
  tag: FiberTag
  type: string
  label: string
  key: string | null
  index: number
  parentId: string | null
  childId: string | null
  siblingId: string | null
  alternateId: string | null
  flags: Flag[]
  status: FiberStatus
  domId: string | null
  props: Record<string, string>
  hooks: HookSnap[]
  updatePayload: PayloadEntry[] | null
  deletions: string[]
  source: string | null
}

export interface DomNodeSnap {
  id: string
  kind: 'element' | 'text' | 'container'
  tag: string
  attrs: Record<string, string>
  text: string
  parent: string | null
  children: string[]
}

export interface DomSnap {
  nodes: Record<string, DomNodeSnap>
  detached: string[]
}

export type MutationOp = 'appendChild' | 'insertBefore' | 'removeChild' | 'setText' | 'setProperty'

export interface Mutation {
  index: number
  op: MutationOp
  target: string
  parent: string | null
  before: string | null
  prop?: string
  from?: string
  to?: string
  fiberId: string
  code: string
  summary: string
}

export type DecisionAction = 'mount' | 'reuse' | 'move' | 'insert' | 'replace' | 'delete'

export interface ChildRef {
  fiberId: string
  label: string
  key: string | null
  index: number
  type: string
  state: string | null
}

export interface Decision {
  action: DecisionAction
  key: string | null
  oldIndex: number | null
  newIndex: number | null
  label: string
  fiberId: string
  oldFiberId: string | null
  reason: string
}

export interface ReconcileGroup {
  index: number
  parentId: string
  parentLabel: string
  keyed: boolean
  tracked: boolean
  prev: ChildRef[]
  next: ChildRef[]
  decisions: Decision[]
}

export interface EffectLog {
  index: number
  kind: 'layout' | 'passive'
  component: string
  name: string
  message: string
  fiberId: string
}

export interface ElementDiff {
  fiberId: string
  component: string
  prev: SerializedElement | null
  next: SerializedElement
}

export interface Highlight {
  fibers: string[]
  dom: string[]
  group: number | null
  mutation: number | null
  effect: number | null
  hook: { fiberId: string; index: number } | null
}

export interface Step {
  index: number
  stage: Stage
  source: 'observed' | 'model'
  branch: 'abandoned' | null
  title: string
  detail: string
  focusPair: number | null
  highlight: Highlight
  current: FiberSnap[]
  wip: FiberSnap[] | null
  dom: DomSnap
  mutations: Mutation[]
  groups: ReconcileGroup[]
  effects: EffectLog[]
  elementDiff: ElementDiff | null
  pending: UpdateSnap[]
  lanes: Lane[] | null
}

export interface Trace {
  id: number
  title: string
  steps: Step[]
  domBefore: DomSnap
}
