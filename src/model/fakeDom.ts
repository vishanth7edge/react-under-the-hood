import type { DomNodeSnap, DomSnap } from './types'

/**
 * A tiny stand-in for the browser DOM that the model renderer commits to.
 * Keeping it serialisable lets the debugger step backwards through commits.
 */
export class FakeDom {
  private nodes = new Map<string, DomNodeSnap>()
  private removed = new Set<string>()
  private counter = 1

  constructor() {
    this.nodes.set('container', {
      id: 'container',
      kind: 'container',
      tag: 'div#root',
      attrs: {},
      text: '',
      parent: null,
      children: [],
    })
  }

  createElement(tag: string, attrs: Record<string, string>): string {
    const id = `d${this.counter++}`
    this.nodes.set(id, { id, kind: 'element', tag, attrs: { ...attrs }, text: '', parent: null, children: [] })
    return id
  }

  createText(text: string): string {
    const id = `d${this.counter++}`
    this.nodes.set(id, { id, kind: 'text', tag: '#text', attrs: {}, text, parent: null, children: [] })
    return id
  }

  get(id: string): DomNodeSnap {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`Unknown DOM node ${id}`)
    return node
  }

  private detach(id: string): void {
    const node = this.get(id)
    if (node.parent) {
      const parent = this.get(node.parent)
      parent.children = parent.children.filter((c) => c !== id)
      node.parent = null
    }
  }

  appendChild(parentId: string, childId: string): void {
    this.detach(childId)
    this.get(parentId).children.push(childId)
    this.get(childId).parent = parentId
    this.removed.delete(childId)
  }

  insertBefore(parentId: string, childId: string, beforeId: string): void {
    this.detach(childId)
    const parent = this.get(parentId)
    const at = parent.children.indexOf(beforeId)
    parent.children.splice(at < 0 ? parent.children.length : at, 0, childId)
    this.get(childId).parent = parentId
    this.removed.delete(childId)
  }

  removeChild(childId: string): void {
    this.detach(childId)
    this.removed.add(childId)
  }

  setText(id: string, text: string): void {
    this.get(id).text = text
  }

  setProperty(id: string, prop: string, value: string | null): void {
    const node = this.get(id)
    if (value === null) delete node.attrs[prop]
    else node.attrs[prop] = value
  }

  /** Nodes created by a render that was thrown away never reach the document. */
  discard(ids: string[]): void {
    ids.forEach((id) => this.nodes.delete(id))
  }

  label(id: string | null): string {
    if (!id) return 'null'
    const node = this.nodes.get(id)
    if (!node) return id
    if (node.kind === 'text') return `#text "${node.text}"`
    if (node.kind === 'container') return 'div#root'
    return `<${node.tag}>`
  }

  serialize(): DomSnap {
    const nodes: Record<string, DomNodeSnap> = {}
    this.nodes.forEach((n, id) => {
      nodes[id] = { ...n, attrs: { ...n.attrs }, children: [...n.children] }
    })
    // Detached roots: created during render but not yet inserted (removed nodes are gone for good).
    const detached = [...this.nodes.values()]
      .filter((n) => n.kind !== 'container' && n.parent === null && !this.removed.has(n.id))
      .map((n) => n.id)
    return { nodes, detached }
  }
}
