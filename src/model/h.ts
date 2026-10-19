import type { Child, MElement, ModelComponent, Props, SerializedElement } from './types'

/** createElement for the model: h('button', { className: 'x' }, 'Count: ', count) */
export function h(
  type: string | ModelComponent,
  props: Props | null,
  ...children: Child[]
): MElement {
  const { key, ...rest } = props ?? {}
  return {
    $$model: true,
    type,
    key: key === undefined || key === null ? null : String(key),
    props: rest,
    children,
  }
}

/** Declare a model component. `source` is the JSX shown to students. */
export function component<P extends Props>(
  name: string,
  source: string,
  render: (props: P) => Child,
  options: { memo?: boolean } = {},
): ModelComponent {
  const fn = ((props: Props) => render(props as P)) as ModelComponent
  fn.displayName = name
  fn.isMemo = options.memo ?? false
  fn.source = source.trim()
  return fn
}

export function isElement(value: unknown): value is MElement {
  return typeof value === 'object' && value !== null && (value as MElement).$$model === true
}

export type NormalizedChild = { kind: 'element'; element: MElement } | { kind: 'text'; text: string }

/** Flatten children the way JSX children behave: arrays flatten, null/boolean render nothing. */
export function normalizeChildren(children: Child[]): NormalizedChild[] {
  const out: NormalizedChild[] = []
  const visit = (child: Child): void => {
    if (Array.isArray(child)) {
      child.forEach(visit)
    } else if (child === null || child === undefined || typeof child === 'boolean') {
      return
    } else if (typeof child === 'string' || typeof child === 'number') {
      out.push({ kind: 'text', text: String(child) })
    } else if (isElement(child)) {
      out.push({ kind: 'element', element: child })
    }
  }
  children.forEach(visit)
  return out
}

export function formatValue(value: unknown, depth = 0): string {
  if (typeof value === 'function') return 'ƒ'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return String(value)
  if (depth > 1) return Array.isArray(value) ? `[…${value.length}]` : '{…}'
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v, depth + 1)).join(', ')}]`
  const entries = Object.entries(value as Record<string, unknown>)
  return `{ ${entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`).join(', ')} }`
}

export function elementTypeName(type: string | ModelComponent): string {
  return typeof type === 'string' ? type : type.displayName
}

export function serializeChildren(children: Child[]): SerializedElement[] {
  return normalizeChildren(children).map((c) =>
    c.kind === 'text'
      ? { type: '#text', key: null, props: {}, children: [], text: c.text }
      : serializeElement(c.element),
  )
}

export function serializeElement(el: MElement): SerializedElement {
  const props: Record<string, string> = {}
  for (const [k, v] of Object.entries(el.props)) props[k] = formatValue(v)
  return { type: elementTypeName(el.type), key: el.key, props, children: serializeChildren(el.children) }
}

/** The output of a component render (one child, possibly an array or text). */
export function serializeOutput(child: Child): SerializedElement {
  if (isElement(child)) return serializeElement(child)
  const list = serializeChildren([child])
  return list.length === 1 ? list[0] : { type: 'Fragment', key: null, props: {}, children: list }
}
